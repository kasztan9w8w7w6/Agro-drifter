import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
} from "three/webgpu";
import { RoadCourse } from "./RoadCourse";
import { Palette } from "../palette";

const SEGMENT_LENGTH = 6;

/**
 * A single ribbon mesh following the course's curve/width, sampled every
 * `SEGMENT_LENGTH` metres - one merged, static geometry rather than one
 * draw call per segment (section 9's "merge static geometry per chunk").
 * Needs a uv attribute even though nothing samples a texture: the retro
 * pass's vertex shader reads uv() unconditionally, and geometry without one
 * (like `GridHelper`) warns and renders wrong through it.
 */
export function buildRoadSurfaceMesh(course: RoadCourse): Mesh {
  const samples = Math.max(2, Math.ceil(course.params.length / SEGMENT_LENGTH) + 1);
  const positions = new Float32Array(samples * 2 * 3);
  const uvs = new Float32Array(samples * 2 * 2);
  const indices: number[] = [];

  for (let i = 0; i < samples; i++) {
    const z = course.params.length - i * SEGMENT_LENGTH;
    const half = course.widthAt(z) / 2;
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

    const uvBase = i * 2 * 2;
    const v = i / (samples - 1);
    uvs[uvBase + 0] = 0;
    uvs[uvBase + 1] = v;
    uvs[uvBase + 2] = 1;
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

  const material = new MeshStandardMaterial({ color: Palette.asphalt });
  return new Mesh(geometry, material);
}

/** Dashed centre line as instanced boxes - one draw call for the whole course. */
export function buildRoadCenterLine(course: RoadCourse): InstancedMesh {
  const dashLength = 3;
  const gapLength = 4;
  const period = dashLength + gapLength;
  const count = Math.max(1, Math.floor(course.params.length / period));

  const geometry = new BoxGeometry(0.25, 0.03, dashLength);
  const material = new MeshStandardMaterial({ color: Palette.roadLine });
  const mesh = new InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);

  const m = new Matrix4();
  for (let i = 0; i < count; i++) {
    const z = course.params.length - i * period - dashLength / 2;
    const cx = course.centerXAt(z);
    m.makeTranslation(cx, 0.02, z);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}
