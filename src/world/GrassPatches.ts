import { DynamicDrawUsage, Group, InstancedMesh, Matrix4, Quaternion, Vector3 } from "three/webgpu";
import { RoadCourse } from "./RoadCourse";
import { loadInstanceGeometries } from "../assets/AssetLoader";

interface GrassPlacement {
  x: number;
  z: number;
  scale: number;
  rotY: number;
}

/**
 * The uploaded grass clump's own bounding box is ~137 units tall (same
 * large-source-scene units as the maple tree), scaled here to a believable
 * ~0.6m roadside tuft.
 */
const REAL_GRASS_BASE_SCALE = 0.6 / 137;

function scatterPlacements(course: RoadCourse, count: number): GrassPlacement[] {
  const placements: GrassPlacement[] = [];
  for (let i = 0; i < count; i++) {
    const z = Math.random() * course.params.length;
    const side = Math.random() < 0.5 ? -1 : 1;
    const margin = course.widthAt(z) / 2 + Math.random() * 4; // right at the road edge, unlike trees further back
    placements.push({
      x: course.centerXAt(z) + side * margin,
      z,
      scale: 0.7 + Math.random() * 0.8,
      rotY: Math.random() * Math.PI * 2,
    });
  }
  return placements;
}

function applyPlacements(mesh: InstancedMesh, placements: GrassPlacement[], scaleMultiplier: number): void {
  const m = new Matrix4();
  const pos = new Vector3();
  const quat = new Quaternion();
  const scaleVec = new Vector3();
  const axis = new Vector3(0, 1, 0);
  placements.forEach((p, i) => {
    const scale = p.scale * scaleMultiplier;
    quat.setFromAxisAngle(axis, p.rotY);
    scaleVec.set(scale, scale, scale);
    pos.set(p.x, 0, p.z);
    m.compose(pos, quat, scaleVec);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
}

/**
 * Roadside grass tufts, same InstancedMesh-per-mesh approach as `Trees.ts`.
 * No placeholder primitive - purely decorative, so a missing `grass.glb`
 * just means no grass tufts rather than a fallback shape.
 */
export function buildGrassPatches(course: RoadCourse, count = 350): Group {
  const group = new Group();
  const placements = scatterPlacements(course, count);

  void loadInstanceGeometries("assets/models/grass.glb").then((meshes) => {
    const real = meshes.map(({ geometry, material }) => {
      // Tufts sit at world Y=0, only 2cm above the ground plane (Y=-0.02,
      // see buildGround in main.ts) - deliberately not coplanar, but at this
      // camera's near/far (0.1/400, see ChaseCamera.ts) the depth buffer's
      // precision is heavily skewed toward *close* distances, so by the
      // time grass a few dozen metres out is on screen, that 2cm real-world
      // gap can land inside a single depth-buffer bucket: same class of
      // z-fighting as the road/centerline/glass-decal cases (RoadMesh.ts,
      // Obstacles.ts), just distance-triggered instead of always-on - which
      // matches it showing up specifically while driving past grass at
      // range, not just at rest. Same fix: bias it toward the camera at the
      // GPU level rather than trying to widen the Y gap (which would risk
      // floating tufts above visibly-sloped ground elsewhere on the course).
      for (const mat of Array.isArray(material) ? material : [material]) {
        mat.polygonOffset = true;
        mat.polygonOffsetFactor = -4;
        mat.polygonOffsetUnits = -4;
      }
      const instanced = new InstancedMesh(geometry, material, count);
      instanced.instanceMatrix.setUsage(DynamicDrawUsage);
      applyPlacements(instanced, placements, REAL_GRASS_BASE_SCALE);
      return instanced;
    });
    group.add(...real);
  });

  return group;
}
