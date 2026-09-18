import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { BufferAttribute, Material, Mesh, Object3D, type BufferGeometry } from "three/webgpu";

/**
 * Single place real assets get wired in. Every 3D-model spawn in the game
 * goes through this module: if `public/<path>` exists (a real, licensed
 * .glb dropped in per README's asset manifest), that's used; if it 404s or
 * fails to parse, the caller's placeholder primitive is used instead.
 * Nothing else in the game needs to change when a real file arrives - drop
 * it at the right path and the next load (or, for objects already spawned,
 * the async swap-in) picks it up.
 */

const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder);

function resolvePublicUrl(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return `${base}/${path.replace(/^\//, "")}`;
}

const rawScenes = new Map<string, Promise<Object3D | null>>();

/** Loads once per path (memoized), null on any failure (missing file, bad parse, etc). */
function loadRaw(path: string): Promise<Object3D | null> {
  let promise = rawScenes.get(path);
  if (!promise) {
    promise = gltfLoader
      .loadAsync(resolvePublicUrl(path))
      .then((gltf) => gltf.scene)
      .catch(() => null);
    rawScenes.set(path, promise);
  }
  return promise;
}

/** For a single spawned object: real model if available, else the given placeholder. */
export async function loadModel(path: string, buildPlaceholder: () => Object3D): Promise<Object3D> {
  const raw = await loadRaw(path);
  if (raw) {
    // Geometry/material are shared by reference (standard Object3D.clone
    // behaviour) - only the scene-graph nodes are duplicated, so spawning
    // many instances of the same model stays cheap.
    const instance = raw.clone(true);
    instance.userData.isPlaceholder = false;
    return instance;
  }
  const placeholder = buildPlaceholder();
  placeholder.userData.isPlaceholder = true;
  return placeholder;
}

/**
 * For an object already placed in the scene with a synchronous placeholder
 * (so the game never shows an empty gap while loading): swaps the real
 * model in once it's fetched, if it's available. A no-op if the file isn't
 * there - the placeholder just stays. `scale` corrects for real-world
 * assets authored at a scene/terrain scale rather than a single-object one
 * (e.g. a "building kit" GLB whose own bounding box spans 55m - clearly
 * meant to be scaled down for use as one small structure).
 */
export function swapInRealModelWhenReady(
  container: Object3D,
  path: string,
  scale = 1,
  localOffset: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
): void {
  void loadRaw(path).then((raw) => {
    if (!raw) return;
    container.clear();
    const instance = raw.clone(true);
    instance.scale.setScalar(scale);
    instance.position.set(localOffset.x * scale, localOffset.y * scale, localOffset.z * scale);
    container.add(instance);
  });
}

export interface InstanceGeometry {
  geometry: BufferGeometry;
  material: Material | Material[];
}

/**
 * `KHR_mesh_quantization` (this project's meshopt pipeline emits it)
 * stores positions/normals as normalized int16/int8 attributes -
 * `BufferAttribute.getX/Y/Z` correctly decodes them back to real floats,
 * but `BufferGeometry.applyMatrix4()` writes its transformed result back
 * through `setXYZ`, which for a normalized integer attribute just writes
 * the raw float into the underlying Int16Array/Int8Array with no
 * re-quantization - a transformed value like "175.6" truncates/wraps
 * instead of scaling, silently corrupting the geometry. Converting to a
 * plain Float32, non-normalized attribute first (once, before any
 * matrix is applied) sidesteps that: same real-world values, but now a
 * type `setXYZ` can write to safely.
 */
function dequantizedAttribute(attr: BufferAttribute): BufferAttribute {
  if (!attr.normalized) return attr.clone();
  const out = new Float32Array(attr.count * attr.itemSize);
  for (let i = 0; i < attr.count; i++) {
    for (let c = 0; c < attr.itemSize; c++) {
      out[i * attr.itemSize + c] = attr.getComponent(i, c);
    }
  }
  return new BufferAttribute(out, attr.itemSize, false);
}

/**
 * For InstancedMesh use (trees, barriers, ...): the geometry+material of
 * *every* mesh found in the file (real multi-material models - a tree's
 * trunk vs. leaf textures, say - come back as more than one), so real
 * per-instance draw-call budgets stay intact (one InstancedMesh per mesh
 * found, not one clone per instance). Empty array if the file isn't there
 * or contains no mesh.
 *
 * Bakes each mesh's own node transform into a *cloned* geometry before
 * returning it - `gltf-transform join` merges sibling nodes' transforms
 * into one mesh, but that mesh's own node can still carry a transform of
 * its own, and quantized/meshopt-compressed geometry (this project's own
 * pipeline defaults to meshopt) routinely does exactly that: positions
 * come back normalized to roughly [-1, 1] with the real scale/offset
 * living on the node, not the geometry. Skipping this bake silently
 * produced trees a few centimetres tall - correct shape, wrong-by-300x
 * size, invisible at any normal camera distance.
 */
export async function loadInstanceGeometries(path: string): Promise<InstanceGeometry[]> {
  const raw = await loadRaw(path);
  if (!raw) return [];
  const found: InstanceGeometry[] = [];
  raw.updateMatrixWorld(true);
  raw.traverse((child) => {
    if (child instanceof Mesh) {
      // matrixWorld, not matrix: the mesh can be nested under intermediate
      // group nodes (a "Sketchfab_Scene" wrapper, etc.), and since `raw` is
      // detached from any real scene graph, matrixWorld here is exactly
      // "transform relative to raw" - every ancestor's transform, none of
      // whatever `raw` itself gets placed at later.
      const geometry = child.geometry.clone();
      geometry.setAttribute("position", dequantizedAttribute(geometry.attributes.position as BufferAttribute));
      if (geometry.attributes.normal) {
        geometry.setAttribute("normal", dequantizedAttribute(geometry.attributes.normal as BufferAttribute));
      }
      geometry.applyMatrix4(child.matrixWorld);
      found.push({ geometry, material: child.material });
    }
  });
  return found;
}
