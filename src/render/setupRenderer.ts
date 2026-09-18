import { RenderPipeline, WebGPURenderer, type PerspectiveCamera, type Scene } from "three/webgpu";
import { retroPass } from "three/addons/tsl/display/RetroPassNode.js";

export interface RetroRenderer {
  renderer: WebGPURenderer;
  pipeline: RenderPipeline;
  render(): void;
  setSize(width: number, height: number): void;
  /** Temporarily push the retro pass's internal resolution scale (e.g. a hit "glitch" or a save-point "focus" pulse), independent of the base scale. */
  setRetroScale(scale: number): void;
  baseRetroScale: number;
}

/**
 * WebGPURenderer with automatic WebGL2 fallback (built into three.js - no
 * separate code path needed), running the scene through `RetroPassNode` for
 * the PS1 look: vertex snapping, affine texture mapping, low internal
 * resolution with nearest-neighbour upscaling.
 */
export async function createRetroRenderer(
  container: HTMLElement,
  scene: Scene,
  camera: PerspectiveCamera,
  retroScale: number,
): Promise<RetroRenderer> {
  const renderer = new WebGPURenderer({ antialias: false });
  await renderer.init();
  container.appendChild(renderer.domElement);

  const pass = retroPass(scene, camera);
  pass.setResolutionScale(retroScale);

  const pipeline = new RenderPipeline(renderer, pass);

  return {
    renderer,
    pipeline,
    render: () => pipeline.render(),
    setSize(width: number, height: number) {
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    setRetroScale: (scale: number) => pass.setResolutionScale(scale),
    baseRetroScale: retroScale,
  };
}
