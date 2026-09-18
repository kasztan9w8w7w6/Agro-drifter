import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
} from "three/webgpu";
import { texture as textureNode } from "three/tsl";
import { RoadCourse } from "./RoadCourse";
import { Palette } from "../palette";

const SEGMENT_LENGTH = 6;

/**
 * Real, tileable asphalt photo from the uploaded "polish_g-class_main_road"
 * kit (its actual contents: modular road-surface tiles with baked-in lane
 * markings, not a building as first assumed - confirmed by every piece's
 * own geometry being a few centimetres thick and several metres wide/long,
 * and by the kit's own texture atlas being labelled "Horizontal (painted
 * lines) road lines names"). Loaded once and reused for both the road
 * surface here and repeated by real-world distance, not stretched 0..1
 * across the whole course - a single 0..1 UV span would smear one tile's
 * texture across 900m instead of repeating it.
 */
const roadTextureLoader = new TextureLoader();
const asphaltTexture = roadTextureLoader.load("assets/textures/road-asphalt.png");
asphaltTexture.wrapS = RepeatWrapping;
asphaltTexture.wrapT = RepeatWrapping;
asphaltTexture.colorSpace = SRGBColorSpace;
/** Approximate real-world metres the source texture covers, for repeat tiling. */
const ASPHALT_TILE_METRES = 6;

/**
 * A single ribbon mesh following the course's curve/width, sampled every
 * `SEGMENT_LENGTH` metres - one merged, static geometry rather than one
 * draw call per segment (section 9's "merge static geometry per chunk").
 */
export function buildRoadSurfaceMesh(course: RoadCourse): Mesh {
  const samples = Math.max(2, Math.ceil(course.params.length / SEGMENT_LENGTH) + 1);
  const positions = new Float32Array(samples * 2 * 3);
  const uvs = new Float32Array(samples * 2 * 2);
  const indices: number[] = [];

  for (let i = 0; i < samples; i++) {
    const z = course.params.length - i * SEGMENT_LENGTH;
    const width = course.widthAt(z);
    const half = width / 2;
    const cx = course.centerXAt(z);
    const leftX = cx - half;
    const rightX = cx + half;

    const vBase = i * 2 * 3;
    positions[vBase + 0] = leftX;
    positions[vBase + 1] = 0;
    positions[vBase + 2] = z;
    positions[vBase + 3] = rightX;
    positions[vBase + 4] = 0;
    positions[vBase + 5] = z;

    // Real-world-distance UVs so the tileable texture repeats at a
    // consistent physical scale instead of stretching one tile over the
    // whole course length or the whole (varying) road width.
    const uvBase = i * 2 * 2;
    const v = (i * SEGMENT_LENGTH) / ASPHALT_TILE_METRES;
    uvs[uvBase + 0] = 0;
    uvs[uvBase + 1] = v;
    uvs[uvBase + 2] = width / ASPHALT_TILE_METRES;
    uvs[uvBase + 3] = v;

    if (i < samples - 1) {
      const base = i * 2;
      // Winding verified to face +Y: cross(v1-v0, v2-v0) > 0 for this vertex order.
      indices.push(base, base + 1, base + 2);
      indices.push(base + 1, base + 3, base + 2);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  // polygonOffset pushes this surface slightly toward the camera in
  // depth-buffer space (not in world position) so it reliably wins the
  // depth test against the ground plane sitting just 2cm underneath it -
  // standard defence against z-fighting between two near-coplanar
  // surfaces, cheap insurance given the retro pass's low internal
  // resolution leaves less depth precision to work with than a normal
  // render at the same distances.
  const material = new MeshStandardMaterial({
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  // Explicit colorNode, not just `.map`: RetroPassNode (the only pass this
  // game actually renders through) rebuilds every material's colour from
  // `material.colorNode` when swapping it in for the retro look, falling
  // back to a flat, untextured colour if that's unset - `.map` alone still
  // renders correctly through a normal (non-retro) pass, so this only bites
  // because of how this game specifically renders. Set explicitly so the
  // retro-passed output can't silently drop the texture regardless.
  material.colorNode = textureNode(asphaltTexture);
  return new Mesh(geometry, material);
}

/** Dashed centre line as instanced boxes - one draw call for the whole course. */
export function buildRoadCenterLine(course: RoadCourse): InstancedMesh {
  const dashLength = 3;
  const gapLength = 4;
  const period = dashLength + gapLength;
  const count = Math.max(1, Math.floor(course.params.length / period));

  const geometry = new BoxGeometry(0.25, 0.03, dashLength);
  // polygonOffset, not just the small world-space height gap, keeps these
  // dashes from z-fighting the road surface right under them - same
  // defensive reasoning as the road surface's own offset above.
  const material = new MeshStandardMaterial({
    color: Palette.roadLine,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const mesh = new InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);

  const m = new Matrix4();
  for (let i = 0; i < count; i++) {
    const z = course.params.length - i * period - dashLength / 2;
    const cx = course.centerXAt(z);
    m.makeTranslation(cx, 0.05, z);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}
