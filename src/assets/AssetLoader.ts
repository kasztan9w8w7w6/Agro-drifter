import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { Material, Mesh, Object3D, type BufferGeometry } from "three/webgpu";

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
 * there - the placeholder just stays.
 */
export function swapInRealModelWhenReady(container: Object3D, path: string): void {
  void loadRaw(path).then((raw) => {
    if (!raw) return;
    container.clear();
    container.add(raw.clone(true));
  });
}

/**
 * For InstancedMesh use (trees, barriers, ...): the geometry+material of
 * the first mesh found in the file, so real per-instance draw-call budgets
 * stay intact (one InstancedMesh, not one clone per instance). Null if the
 * file isn't there or contains no mesh.
 */
export async function loadInstanceGeometry(
  path: string,
): Promise<{ geometry: BufferGeometry; material: Material | Material[] } | null> {
  const raw = await loadRaw(path);
  if (!raw) return null;
  const state: { found: Mesh | null } = { found: null };
  raw.traverse((child) => {
    if (!state.found && child instanceof Mesh) state.found = child;
  });
  return state.found ? { geometry: state.found.geometry, material: state.found.material } : null;
}
