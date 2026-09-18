import { PerspectiveCamera, Vector3 } from "three/webgpu";

export interface ChaseCameraParams {
  distanceBehind: number;
  heightAbove: number;
  /** How fast the camera position catches up to its desired spot (1/s). */
  followRate: number;
  /** How fast the look-at target catches up - deliberately slower than followRate. */
  rotateRate: number;
  lookAheadDist: number;
  baseFov: number;
  fovSpeedFactor: number;
  maxFov: number;
  /** Max camera roll (radians) at full slip angle. */
  maxRoll: number;
}

export const DEFAULT_CHASE_CAMERA_PARAMS: ChaseCameraParams = {
  distanceBehind: 6,
  heightAbove: 2.5,
  followRate: 7,
  rotateRate: 3.5,
  lookAheadDist: 4,
  baseFov: 60,
  fovSpeedFactor: 0.03,
  maxFov: 75,
  maxRoll: (4 * Math.PI) / 180,
};

/**
 * Exponential-decay chase camera: position/rotation smoothing is expressed
 * as a rate (1/s), not a per-frame lerp factor, so it behaves the same at
 * 30fps on a phone and 120fps on a desktop (`t = 1 - exp(-rate * dt)`
 * converges to the same steady state regardless of how many steps it took).
 */
export class ChaseCamera {
  readonly camera: PerspectiveCamera;
  readonly params: ChaseCameraParams;

  private currentLookAt = new Vector3();
  private initialized = false;

  private readonly desiredPos = new Vector3();
  private readonly desiredLookAt = new Vector3();

  constructor(aspect: number, params: Partial<ChaseCameraParams> = {}) {
    this.params = { ...DEFAULT_CHASE_CAMERA_PARAMS, ...params };
    this.camera = new PerspectiveCamera(this.params.baseFov, aspect, 0.1, 400);
  }

  /**
   * @param carPos world position of the car
   * @param carForwardX/Z unit forward vector of the car (XZ plane)
   * @param speedMs current car speed, m/s
   * @param slipAngle signed rear slip angle (radians), for the drift roll
   */
  update(
    dt: number,
    carPos: Vector3,
    carForwardX: number,
    carForwardZ: number,
    speedMs: number,
    slipAngle: number,
  ): void {
    const p = this.params;

    this.desiredPos
      .set(carForwardX, 0, carForwardZ)
      .multiplyScalar(-p.distanceBehind)
      .add(carPos);
    this.desiredPos.y += p.heightAbove;

    this.desiredLookAt.set(carForwardX, 0, carForwardZ).multiplyScalar(p.lookAheadDist).add(carPos);

    if (!this.initialized) {
      this.camera.position.copy(this.desiredPos);
      this.currentLookAt.copy(this.desiredLookAt);
      this.initialized = true;
    } else {
      const t = 1 - Math.exp(-p.followRate * dt);
      this.camera.position.lerp(this.desiredPos, t);

      const rotT = 1 - Math.exp(-p.rotateRate * dt);
      this.currentLookAt.lerp(this.desiredLookAt, rotT);
    }

    this.camera.lookAt(this.currentLookAt);

    const speedKmh = speedMs * 3.6;
    this.camera.fov = Math.min(p.maxFov, p.baseFov + speedKmh * p.fovSpeedFactor);
    this.camera.updateProjectionMatrix();

    // Roll around the camera's own forward axis, applied after lookAt so it
    // doesn't fight the yaw/pitch that lookAt already set.
    const roll = Math.max(-1, Math.min(1, -slipAngle * 2)) * p.maxRoll;
    this.camera.rotateZ(roll);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
