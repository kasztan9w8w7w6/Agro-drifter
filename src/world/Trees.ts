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
import { loadInstanceGeometry } from "../assets/AssetLoader";

interface TreePlacement {
  x: number;
  z: number;
  scale: number;
  rotY: number;
}

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

function applyPlacements(mesh: InstancedMesh, placements: TreePlacement[], pivotYPerScale: number): void {
  const m = new Matrix4();
  const pos = new Vector3();
  const quat = new Quaternion();
  const scaleVec = new Vector3();
  const axis = new Vector3(0, 1, 0);
  placements.forEach((p, i) => {
    quat.setFromAxisAngle(axis, p.rotY);
    scaleVec.set(p.scale, p.scale, p.scale);
    pos.set(p.x, pivotYPerScale * p.scale, p.z);
    m.compose(pos, quat, scaleVec);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
}

/**
 * Roadside trees as InstancedMesh draw calls (section 9's perf budget:
 * "one draw call for the whole row, not one per tree"). Placeholder is a
 * two-part cone+cylinder shape (two InstancedMesh); if `assets/models/
 * tree.glb` (a single-mesh Kenney Nature Kit tree, per README's manifest)
 * shows up, it swaps to one InstancedMesh built from that geometry, reusing
 * the exact same placements so trees don't jump around on swap.
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

  void loadInstanceGeometry("assets/models/tree.glb").then((real) => {
    if (!real) return;
    const combined = new InstancedMesh(real.geometry, real.material, count);
    combined.instanceMatrix.setUsage(DynamicDrawUsage);
    applyPlacements(combined, placements, 0); // real model's own origin is its ground pivot
    group.clear();
    group.add(combined);
  });

  return group;
}
