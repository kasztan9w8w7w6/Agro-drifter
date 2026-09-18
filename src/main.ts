import {
  BoxGeometry,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  Scene,
  Timer,
} from "three/webgpu";
import { createRetroRenderer } from "./render/setupRenderer";
import { ChaseCamera } from "./render/ChaseCamera";
import { CarPhysics } from "./physics/CarPhysics";
import { InputManager } from "./input/InputManager";
import { KeyboardInput } from "./input/KeyboardInput";
import { TouchInput } from "./input/TouchInput";
import { Palette, toCss } from "./palette";
import { loadModel } from "./assets/AssetLoader";
import { RoadCourse } from "./world/RoadCourse";
import { buildRoadCenterLine, buildRoadSurfaceMesh } from "./world/RoadMesh";
import { buildTrees } from "./world/Trees";
import { buildGrassPatches } from "./world/GrassPatches";
import { ObstacleField } from "./world/Obstacles";
import { SavePoint } from "./world/SavePoint";
import { Radio } from "./audio/Radio";
import { Minimap, type MinimapPoi } from "./ui/Minimap";

// Session 2 scope: first playable loop (road, trees, deer, broken glass,
// one save point, radio) on top of Session 1's render/camera/physics
// foundation - still placeholder geometry for anything that needs a real
// downloaded asset (car/trees/deer/kiosk), per README's asset manifest.

function buildCarPlaceholder(): Group {
  const group = new Group();

  const body = new Mesh(new BoxGeometry(1.7, 1, 3.8), new MeshStandardMaterial({ color: Palette.carBody }));
  body.position.y = 0.55;
  group.add(body);

  const nose = new Mesh(new BoxGeometry(1.1, 0.6, 0.6), new MeshStandardMaterial({ color: Palette.carGlass }));
  nose.position.set(0, 0.65, -2.1); // heading 0 = -Z (Three.js convention), so the nose marks "front"
  group.add(nose);

  return group;
}

function buildGround(scene: Scene, course: RoadCourse): void {
  // Z extent must cover the whole course (plus margin) - it's rotated from
  // a plane whose "height" axis becomes world Z, easy to under-size if you
  // think of it as ground "around" the car instead of "under the course".
  const margin = 300;
  const ground = new Mesh(
    new PlaneGeometry(800, course.params.length + margin * 2),
    new MeshStandardMaterial({ color: Palette.grassMid }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.02, course.params.length / 2); // just under the road ribbon - polygonOffset on the road handles the z-fight, not this gap
  scene.add(ground);
}

/** Retro-pass resolution "pulse" for FX (a hit glitch, a save-point focus snap) - eases back to base over `durationS`. */
class RetroPulse {
  private elapsed = 0;
  private duration = 0;
  private from = 0;

  constructor(
    private readonly base: number,
    private readonly setScale: (s: number) => void,
  ) {}

  trigger(target: number, durationS: number): void {
    this.duration = durationS;
    this.elapsed = 0;
    this.from = target;
  }

  update(dt: number): void {
    if (this.duration <= 0) return;
    this.elapsed += dt;
    const t = Math.min(1, this.elapsed / this.duration);
    const scale = this.from + (this.base - this.from) * t;
    this.setScale(scale);
    if (t >= 1) this.duration = 0;
  }
}

function buildRadioButton(onClick: () => void): void {
  const btn = document.createElement("div");
  btn.textContent = "RADIO";
  Object.assign(btn.style, {
    position: "fixed",
    top: "14px",
    left: "14px",
    padding: "8px 14px",
    borderRadius: "6px",
    background: "rgba(240, 236, 226, 0.18)",
    border: "2px solid rgba(240, 236, 226, 0.5)",
    color: "#f2eee6",
    fontFamily: "sans-serif",
    fontSize: "13px",
    letterSpacing: "0.05em",
    userSelect: "none",
    cursor: "pointer",
    zIndex: "10",
  });
  btn.addEventListener("click", onClick);
  document.body.appendChild(btn);
}

async function main(): Promise<void> {
  const appEl = document.getElementById("app");
  if (!appEl) throw new Error("#app container missing");

  const scene = new Scene();
  scene.fog = new Fog(Palette.skyBottom, 40, 180);
  // Explicit, not left to the renderer's default clear colour: empty sky
  // (above the ground plane's silhouette, out to the far clip plane) was
  // rendering as whatever the renderer clears to when nothing else says
  // otherwise - normally close enough to this same dark navy to go
  // unnoticed, but caught it flashing solid white for 1-2 frames during a
  // plain, uneventful drive (no obstacle hit, no resize, nothing else
  // happening) - exactly the kind of one-off a relied-on implicit default
  // produces. Setting it directly makes the sky colour deterministic
  // regardless of what the renderer or backend (WebGPU vs. its WebGL2
  // fallback) does by default.
  scene.background = new Color(Palette.skyBottom);

  const hemi = new HemisphereLight(Palette.skyTop, Palette.grassDark, 0.6);
  scene.add(hemi);
  const sun = new DirectionalLight(Palette.headlightWarm, 1.1);
  sun.position.set(-40, 60, -20);
  scene.add(sun);

  const course = new RoadCourse();
  buildGround(scene, course);
  scene.add(buildRoadSurfaceMesh(course));
  scene.add(buildRoadCenterLine(course));
  scene.add(buildTrees(course));
  scene.add(buildGrassPatches(course));

  const obstacles = new ObstacleField(scene, course);
  const savePoint = new SavePoint(scene, course);

  const deerPoi: MinimapPoi = { ...obstacles.deerPosition, color: toCss(Palette.deerFur) };
  const glassPoi: MinimapPoi = { ...obstacles.glassZonePositions[0], color: toCss(Palette.bottleGlass) };
  const savePoi: MinimapPoi = { ...savePoint.position, color: toCss(Palette.neonToxic) };
  const minimap = new Minimap(course, [deerPoi, glassPoi, savePoi], appEl);

  const carVisual = await loadModel("assets/models/car.glb", buildCarPlaceholder);
  if (!carVisual.userData.isPlaceholder) {
    // The uploaded Fiat 126p model's own hood faces local +Z - confirmed by
    // rendering it in profile from a fixed side camera (bypassing the chase
    // cam) at heading 0: the sloped hood/fender sat on the world +Z side,
    // opposite this engine's -Z-front convention. Without this, the car
    // drives "tyłem" - trunk leading, headlight/look-ahead logic aimed at
    // what is visually the back of the car.
    carVisual.rotation.y = Math.PI;
  }
  const car = new Group();
  car.add(carVisual);
  scene.add(car);

  const headlight = new PointLight(Palette.headlightWarm, 8, 20);
  car.add(headlight);
  headlight.position.set(0, 0.7, -2.5);

  const chaseCamera = new ChaseCamera(window.innerWidth / window.innerHeight);

  // Not the brief's suggested 0.28: at 0.28 with the camera pulled back far
  // enough for a proper chase view, RetroPassNode's vertex-snapping (it
  // rounds each vertex's projected position to the low-res pixel grid)
  // occasionally rounds every vertex of a small/distant object to the same
  // point, collapsing it to zero area - the car would fully vanish at
  // specific camera distances. 0.4 fixes that. (A later bump to 0.6 chased
  // a "flicker" that turned out to be two different, unrelated bugs -
  // scene.background never being set, and no z-fighting guard on the road/
  // ground pair - both fixed at the source now, so there's no reason to
  // pay 0.6's extra GPU cost on top; back to 0.4, especially given the
  // WebGL2 fallback path this runs on most phones is already slower than
  // WebGPU proper.)
  const retro = await createRetroRenderer(appEl, scene, chaseCamera.camera, 0.4);
  retro.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
  retro.setSize(window.innerWidth, window.innerHeight);
  document.body.style.background = toCss(Palette.skyBottom);

  window.addEventListener("resize", () => {
    retro.setSize(window.innerWidth, window.innerHeight);
  });

  const retroPulse = new RetroPulse(retro.baseRetroScale, (s) => retro.setRetroScale(s));

  const physics = new CarPhysics();
  const spawnZ = course.params.length - 30;
  physics.setPosition(course.centerXAt(spawnZ), spawnZ, 0);

  const input = new InputManager();
  input.add(new KeyboardInput());
  input.add(new TouchInput(appEl));

  const radio = new Radio();
  const unlockAudio = () => {
    radio.start();
    window.removeEventListener("keydown", unlockAudio);
    window.removeEventListener("pointerdown", unlockAudio);
  };
  window.addEventListener("keydown", unlockAudio);
  window.addEventListener("pointerdown", unlockAudio);

  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyR") radio.next();
  });
  buildRadioButton(() => radio.next());

  const timer = new Timer();
  timer.connect(document); // avoids huge deltas across a tab-switch pause
  const MAX_DT = 1 / 20; // extra clamp for any other kind of frame hitch

  retro.renderer.setAnimationLoop(() => {
    timer.update();
    const dt = Math.min(timer.getDelta(), MAX_DT);

    const surface = obstacles.surfaceOverrideAt(physics.x, physics.z) ?? (course.isOnRoad(physics.x, physics.z) ? "asphalt" : "grass");
    physics.update(dt, input.read(), surface);

    if (obstacles.update(dt, physics)) {
      retroPulse.trigger(retro.baseRetroScale * 0.45, 0.5); // glitch pulse: chunkier for a beat
    }
    if (savePoint.update(physics.x, physics.z)) {
      retroPulse.trigger(retro.baseRetroScale * 1.8, 1); // focus mode: sharper for a beat
    }
    retroPulse.update(dt);

    car.position.set(physics.x, 0, physics.z);
    car.rotation.y = physics.heading;

    const forwardX = -Math.sin(physics.heading);
    const forwardZ = -Math.cos(physics.heading);

    chaseCamera.update(dt, car.position, forwardX, forwardZ, physics.velocityX, physics.velocityZ, physics.slipAngle);

    radio.setMood({
      driving01: Math.min(1, physics.speed / 30),
      drift01: physics.isDrifting ? 1 : 0,
      danger01: 0,
    });

    const deerNow = obstacles.deerPosition;
    deerPoi.x = deerNow.x;
    deerPoi.z = deerNow.z;
    minimap.update(physics.x, physics.z, physics.heading);

    retro.render();
  });
}

main().catch((err) => {
  console.error(err);
  const appEl = document.getElementById("app");
  if (appEl) appEl.textContent = "Failed to start renderer: " + (err as Error).message;
});
