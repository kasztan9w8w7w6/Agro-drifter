import {
  BoxGeometry,
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

// Session 1 scope: prove the render pipeline + chase camera + 3D-ported
// drift physics + unified input on placeholder geometry, before any real
// assets or road/world generation land (see AGRO-DRIFTER brief, section 11).

function buildPlaceholderCar(): Group {
  const group = new Group();

  const body = new Mesh(
    new BoxGeometry(1.7, 1, 3.8),
    new MeshStandardMaterial({ color: Palette.carBody }),
  );
  body.position.y = 0.55;
  group.add(body);

  const nose = new Mesh(
    new BoxGeometry(1.1, 0.6, 0.6),
    new MeshStandardMaterial({ color: Palette.carGlass }),
  );
  nose.position.set(0, 0.65, -2.1); // heading 0 = -Z (Three.js convention), so the nose marks "front"
  group.add(nose);

  return group;
}

function buildGround(scene: Scene): void {
  // A plain mesh (not GridHelper) - the retro pass rewrites materials assuming
  // UV'd mesh geometry, which line-segment helpers don't have.
  const ground = new Mesh(
    new PlaneGeometry(400, 400),
    new MeshStandardMaterial({ color: Palette.grassMid }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // Thin cross-hatched strips as a motion/scale reference on the otherwise
  // featureless plane (still ordinary meshes, so they stay retro-pass safe).
  const lineMat = new MeshStandardMaterial({ color: Palette.roadLine });
  for (let i = -190; i <= 190; i += 20) {
    const stripX = new Mesh(new BoxGeometry(400, 0.05, 0.4), lineMat);
    stripX.position.set(0, 0.01, i);
    scene.add(stripX);
    const stripZ = new Mesh(new BoxGeometry(0.4, 0.05, 400), lineMat);
    stripZ.position.set(i, 0.01, 0);
    scene.add(stripZ);
  }
}

function buildMarkers(scene: Scene): void {
  // Scattered boxes so motion/speed reads clearly on a perfectly flat plane.
  const material = new MeshStandardMaterial({ color: Palette.buildingUnlit });
  for (let i = 0; i < 40; i++) {
    const box = new Mesh(new BoxGeometry(1, 2 + Math.random() * 3, 1), material);
    const angle = Math.random() * Math.PI * 2;
    const dist = 15 + Math.random() * 150;
    box.position.set(Math.cos(angle) * dist, box.geometry.parameters.height / 2, Math.sin(angle) * dist);
    scene.add(box);
  }
}

async function main(): Promise<void> {
  const appEl = document.getElementById("app");
  if (!appEl) throw new Error("#app container missing");

  const scene = new Scene();
  scene.fog = new Fog(Palette.skyBottom, 40, 180);

  const hemi = new HemisphereLight(Palette.skyTop, Palette.grassDark, 0.6);
  scene.add(hemi);
  const sun = new DirectionalLight(Palette.headlightWarm, 1.1);
  sun.position.set(-40, 60, -20);
  scene.add(sun);

  buildGround(scene);
  buildMarkers(scene);

  const car = buildPlaceholderCar();
  scene.add(car);

  const headlight = new PointLight(Palette.headlightWarm, 8, 20);
  car.add(headlight);
  headlight.position.set(0, 0.7, -2.5);

  const chaseCamera = new ChaseCamera(window.innerWidth / window.innerHeight);

  const retro = await createRetroRenderer(appEl, scene, chaseCamera.camera, 0.28);
  retro.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
  retro.setSize(window.innerWidth, window.innerHeight);
  document.body.style.background = toCss(Palette.skyBottom);

  window.addEventListener("resize", () => {
    retro.setSize(window.innerWidth, window.innerHeight);
  });

  const physics = new CarPhysics();

  const input = new InputManager();
  input.add(new KeyboardInput());
  input.add(new TouchInput(appEl));

  const timer = new Timer();
  timer.connect(document); // avoids huge deltas across a tab-switch pause
  const MAX_DT = 1 / 20; // extra clamp for any other kind of frame hitch

  retro.renderer.setAnimationLoop(() => {
    timer.update();
    const dt = Math.min(timer.getDelta(), MAX_DT);

    physics.update(dt, input.read(), "asphalt");

    car.position.set(physics.x, 0, physics.z);
    car.rotation.y = physics.heading;

    const forwardX = -Math.sin(physics.heading);
    const forwardZ = -Math.cos(physics.heading);
    chaseCamera.update(dt, car.position, forwardX, forwardZ, physics.speed, physics.slipAngle);

    retro.render();
  });
}

main().catch((err) => {
  console.error(err);
  const appEl = document.getElementById("app");
  if (appEl) appEl.textContent = "Failed to start renderer: " + (err as Error).message;
});
