import {
  BoxGeometry,
  CircleGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Scene,
} from "three/webgpu";
import { RoadCourse } from "./RoadCourse";
import { CarPhysics, type Surface } from "../physics/CarPhysics";
import { Palette } from "../palette";
import { buildGlassDecalTexture } from "./glassDecal";
import { swapInRealModelWhenReady } from "../assets/AssetLoader";

const CAR_BUMPER_RADIUS = 1.4;
const DEER_HIT_COOLDOWN_S = 1.5;
const DEER_SPEED_SCALE_ON_HIT = 0.35;

/** Placeholder low-poly deer: body + head + four legs. Swap via the asset manifest once a real CC0 model is picked (brief section 3.3 flags this one as unverified). */
function buildDeerPlaceholder(): Group {
  const group = new Group();
  const furMat = new MeshStandardMaterial({ color: Palette.deerFur });
  const darkMat = new MeshStandardMaterial({ color: Palette.deerDark });

  const body = new Mesh(new BoxGeometry(0.6, 0.7, 1.5), furMat);
  body.position.y = 0.75;
  group.add(body);

  const head = new Mesh(new BoxGeometry(0.35, 0.35, 0.5), darkMat);
  head.position.set(0, 1.1, -0.95);
  group.add(head);

  const legGeo = new BoxGeometry(0.14, 0.75, 0.14);
  for (const [lx, lz] of [
    [-0.2, 0.55],
    [0.2, 0.55],
    [-0.2, -0.55],
    [0.2, -0.55],
  ]) {
    const leg = new Mesh(legGeo, darkMat);
    leg.position.set(lx, 0.375, lz);
    group.add(leg);
  }

  return group;
}

interface DeerObstacle {
  object: Group;
  z: number;
  amplitude: number;
  speed: number;
  radius: number;
  hitCooldown: number;
}

interface GlassZone {
  x: number;
  z: number;
  radius: number;
}

/**
 * One `obstacles[]`-style collision system (brief section 8): the deer
 * patrols a sinusoid across the road and bleeds car speed on contact; the
 * glass patch is a continuous low-grip zone the car feels through physics,
 * not just sees. `surfaceOverrideAt` slots into the same `surface` argument
 * `CarPhysics.update` already takes for road/off-road.
 */
export class ObstacleField {
  private deer: DeerObstacle;
  private glassZones: GlassZone[];
  private elapsed = 0;
  lastDeerHitAt = -Infinity;

  constructor(scene: Scene, course: RoadCourse) {
    const deerZ = course.params.length * 0.55;
    const deerObject = buildDeerPlaceholder();
    scene.add(deerObject);
    swapInRealModelWhenReady(deerObject, "assets/models/deer.glb");
    this.deer = {
      object: deerObject,
      z: deerZ,
      amplitude: course.widthAt(deerZ) * 0.9,
      speed: 0.6,
      radius: 1.1,
      hitCooldown: 0,
    };

    const glassZ = course.params.length * 0.25;
    const glassX = course.centerXAt(glassZ) + course.widthAt(glassZ) * 0.15;
    this.glassZones = [{ x: glassX, z: glassZ, radius: 2.6 }];

    const decalGeo = new CircleGeometry(this.glassZones[0].radius, 20);
    decalGeo.rotateX(-Math.PI / 2);
    const decalMat = new MeshBasicMaterial({
      map: buildGlassDecalTexture(),
      transparent: true,
      depthWrite: false,
    });
    const decal = new Mesh(decalGeo, decalMat);
    decal.position.set(glassX, 0.015, glassZ);
    scene.add(decal);
  }

  /** Current live deer position, for the minimap. */
  get deerPosition(): { x: number; z: number } {
    return { x: this.deer.object.position.x, z: this.deer.z };
  }

  /** Glass zone position(s), for the minimap. */
  get glassZonePositions(): { x: number; z: number }[] {
    return this.glassZones.map(({ x, z }) => ({ x, z }));
  }

  /** Returns a surface override (e.g. "glass") when the car is in a hazard zone, or null to fall through to the road/off-road surface. */
  surfaceOverrideAt(x: number, z: number): Surface | null {
    for (const zone of this.glassZones) {
      const dx = x - zone.x;
      const dz = z - zone.z;
      if (dx * dx + dz * dz < zone.radius * zone.radius) return "glass";
    }
    return null;
  }

  /** Returns true the frame a deer collision actually lands a speed-penalty hit (for camera/FX feedback). */
  update(dt: number, physics: CarPhysics): boolean {
    this.elapsed += dt;
    this.deer.hitCooldown = Math.max(0, this.deer.hitCooldown - dt);

    const x = Math.sin(this.elapsed * this.deer.speed) * this.deer.amplitude;
    this.deer.object.position.set(x, 0, this.deer.z);
    this.deer.object.rotation.y = Math.cos(this.elapsed * this.deer.speed) >= 0 ? 0 : Math.PI;

    const dx = physics.x - x;
    const dz = physics.z - this.deer.z;
    const hitRadius = this.deer.radius + CAR_BUMPER_RADIUS;
    if (dx * dx + dz * dz < hitRadius * hitRadius && this.deer.hitCooldown <= 0) {
      physics.applyImpactSpeedScale(DEER_SPEED_SCALE_ON_HIT);
      this.deer.hitCooldown = DEER_HIT_COOLDOWN_S;
      this.lastDeerHitAt = this.elapsed;
      return true;
    }
    return false;
  }
}
