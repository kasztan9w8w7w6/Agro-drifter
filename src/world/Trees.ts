import {
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from "three/webgpu";
import { RoadCourse } from "./RoadCourse";
import { Palette } from "../palette";
import { loadInstanceGeometries } from "../assets/AssetLoader";

interface TreePlacement {
  x: number;
  z: number;
  scale: number;
  rotY: number;
}

/**
 * The uploaded maple tree's own bounding box is ~311 units tall (clearly
 * not metres - some large default unit from its source scene), scaled
 * here to a believable ~6m roadside tree. Its base sits ~1.28 units below
 * its own origin even after that; at this scale that's under 3cm, small
 * enough to ignore rather than add a second correction on top.
 */
const REAL_TREE_BASE_SCALE = 6 / 311;

function scatterPlacements(course: RoadCourse, count: number): TreePlacement[] {
  const placements: TreePlacement[] = [];
  for (let i = 0; i < count; i++) {
    const z = Math.random() * course.params.length;
    const side = Math.random() < 0.5 ? -1 : 1;
    const margin = course.widthAt(z) / 2 + 2 + Math.random() * 22;
    placements.push({
      x: course.centerXAt(z) + side * margin,
      z,
      scale: 0.75 + Math.random() * 0.6,
      rotY: Math.random() * Math.PI * 2,
    });
  }
  return placements;
}

function applyPlacements(
  mesh: InstancedMesh,
  placements: TreePlacement[],
  pivotYPerScale: number,
  scaleMultiplier = 1,
): void {
  const m = new Matrix4();
  const pos = new Vector3();
  const quat = new Quaternion();
  const scaleVec = new Vector3();
  const axis = new Vector3(0, 1, 0);
  placements.forEach((p, i) => {
    const scale = p.scale * scaleMultiplier;
    quat.setFromAxisAngle(axis, p.rotY);
    scaleVec.set(scale, scale, scale);
    pos.set(p.x, pivotYPerScale * scale, p.z);
    m.compose(pos, quat, scaleVec);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
}

/**
 * Roadside trees as InstancedMesh draw calls (section 9's perf budget:
 * "one draw call for the whole row, not one per tree"). Placeholder is a
 * two-part cone+cylinder shape (two InstancedMesh); if `assets/models/
 * tree.glb` shows up, it swaps to one InstancedMesh per mesh found in that
 * file (a real multi-material tree - trunk bark vs. leaf textures - comes
 * back as more than one mesh; this project's own asset pipeline collapses
 * a many-mesh export like a raw Sketchfab download down to one per
 * material with `gltf-transform join` before it's dropped in, so this
 * stays a small, fixed number of draw calls regardless of tree count).
 */
export function buildTrees(course: RoadCourse, count = 220): Group {
  const group = new Group();
  const placements = scatterPlacements(course, count);

  const trunkHeight = 1.4;
  const canopyHeight = 3.2;

  const trunkGeo = new CylinderGeometry(0.15, 0.2, trunkHeight, 6);
  const trunkMat = new MeshStandardMaterial({ color: Palette.treeTrunk });
  const trunks = new InstancedMesh(trunkGeo, trunkMat, count);
  trunks.instanceMatrix.setUsage(DynamicDrawUsage);
  applyPlacements(trunks, placements, trunkHeight / 2);

  const canopyGeo = new ConeGeometry(1.6, canopyHeight, 7);
  const canopyMat = new MeshStandardMaterial({ color: Palette.treeCanopy });
  const canopies = new InstancedMesh(canopyGeo, canopyMat, count);
  canopies.instanceMatrix.setUsage(DynamicDrawUsage);
  applyPlacements(canopies, placements, trunkHeight + canopyHeight / 2);

  group.add(trunks, canopies);

  void loadInstanceGeometries("assets/models/tree.glb").then((meshes) => {
    if (meshes.length === 0) return;
    const real = meshes.map(({ geometry, material }) => {
      const instanced = new InstancedMesh(geometry, material, count);
      instanced.instanceMatrix.setUsage(DynamicDrawUsage);
      applyPlacements(instanced, placements, 0, REAL_TREE_BASE_SCALE);
      return instanced;
    });
    group.clear();
    group.add(...real);
  });

  return group;
}
