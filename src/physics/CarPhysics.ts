/**
 * Arcade drift model (bicycle model with saturating tyre lateral force),
 * ported from a 2D top-down prototype onto the world's XZ plane (Y = up).
 * Heading 0 faces +Z; a mesh using `mesh.rotation.y = heading` matches this
 * convention. Tuned and headless-tested for: no NaN/blow-up over long random
 * input runs, and the car actually settles (straightens, slows) once
 * throttle/steer/handbrake are released.
 *
 * Two fixes versus the original 2D pseudocode this was ported from:
 * - Traction loss (rear slip past the drift threshold) now actually reduces
 *   the longitudinal acceleration applied this step, not just a value that
 *   gets discarded before the velocity update.
 * - Heading/yaw is integrated explicitly (yawRate is an angular velocity,
 *   not an angle), and lateral/forward velocity is re-projected onto the
 *   *updated* heading's axes before integrating position, so a fast yaw
 *   doesn't leave position and orientation a frame out of sync.
 */

export type Surface = "asphalt" | "gravel" | "mud" | "ice" | "grass";

export interface CarInput {
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** -1 (left) .. 1 (right) */
  steer: number;
  /** 0..1 */
  handbrake: number;
}

export interface CarPhysicsParams {
  mass: number;
  cgToFront: number;
  cgToRear: number;
  inertia: number;
  gravity: number;
  enginePower: number;
  brakeForce: number;
  dragCoeff: number;
  rollResist: number;
  maxSteerAngle: number;
  steerSpeedFalloff: number;
  steerResponse: number;
  frontStiffness: number;
  rearStiffness: number;
  muFront: number;
  muRear: number;
  handbrakeGripMultiplier: number;
  yawDamping: number;
  weightTransferStrength: number;
  weightTransferMax: number;
  driftSlipThreshold: number;
  minDriftSpeed: number;
  surfaceGrip: Record<Surface, number>;
}

export const DEFAULT_CAR_PHYSICS_PARAMS: CarPhysicsParams = {
  mass: 1150,
  cgToFront: 1.15,
  cgToRear: 1.35,
  inertia: 1550,
  gravity: 9.81,
  enginePower: 9200,
  brakeForce: 12500,
  dragCoeff: 3.6,
  rollResist: 60,
  maxSteerAngle: 0.56,
  steerSpeedFalloff: 0.035,
  steerResponse: 11,
  frontStiffness: 13,
  rearStiffness: 9.5,
  muFront: 1.18,
  muRear: 1.05,
  handbrakeGripMultiplier: 0.2,
  yawDamping: 0.985,
  weightTransferStrength: 0.05,
  weightTransferMax: 0.4,
  driftSlipThreshold: 0.12,
  minDriftSpeed: 3,
  surfaceGrip: { asphalt: 1.0, gravel: 0.72, mud: 0.48, ice: 0.28, grass: 0.6 },
};

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class CarPhysics {
  readonly params: CarPhysicsParams;

  // World-space state, XZ plane, Y up.
  x = 0;
  z = 0;
  /** Radians, 0 = facing +Z, positive turns toward +X. */
  heading = 0;

  private vx = 0; // world-space velocity
  private vz = 0;
  private yawRate = 0;
  private steerAngle = 0;

  /** Rear slip angle from the last step, for drift FX/camera roll. */
  slipAngle = 0;
  isDrifting = false;

  constructor(params: Partial<CarPhysicsParams> = {}) {
    this.params = { ...DEFAULT_CAR_PHYSICS_PARAMS, ...params };
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  get speedKmh(): number {
    return this.speed * 3.6;
  }

  setPosition(x: number, z: number, heading = this.heading): void {
    this.x = x;
    this.z = z;
    this.heading = heading;
  }

  private axes(heading: number): { fx: number; fz: number; rx: number; rz: number } {
    const s = Math.sin(heading);
    const c = Math.cos(heading);
    // forward = (sin h, cos h); right = forward rotated -90deg around Y.
    return { fx: s, fz: c, rx: c, rz: -s };
  }

  update(dt: number, input: CarInput, surface: Surface = "asphalt"): void {
    const p = this.params;
    const gripMul = p.surfaceGrip[surface] ?? 1.0;

    const { fx, fz, rx, rz } = this.axes(this.heading);
    const vf = this.vx * fx + this.vz * fz; // forward speed
    const vs = this.vx * rx + this.vz * rz; // lateral (rightward) speed

    // Steering: relaxes toward a speed-limited target angle.
    const speedFactor = 1 / (1 + Math.abs(vf) * p.steerSpeedFalloff);
    const targetSteer = input.steer * p.maxSteerAngle * speedFactor;
    this.steerAngle += (targetSteer - this.steerAngle) * Math.min(1, dt * p.steerResponse);

    // Longitudinal force (engine, brake, rolling resistance) before traction loss.
    let longForce = 0;
    if (input.throttle > 0) longForce += input.throttle * p.enginePower;
    if (input.brake > 0) longForce -= input.brake * p.brakeForce * Math.sign(vf || 1);
    if (Math.abs(vf) > 0.01) longForce -= p.rollResist * Math.sign(vf);

    // Weight transfer front/rear from longitudinal accel (pre-traction estimate is fine here).
    const wheelBase = p.cgToFront + p.cgToRear;
    const staticNf = (p.mass * p.gravity * p.cgToRear) / wheelBase;
    const staticNr = (p.mass * p.gravity * p.cgToFront) / wheelBase;
    const longAccelEstimate = longForce / p.mass;
    const transferForce = clamp(
      p.mass * longAccelEstimate * p.weightTransferStrength,
      -p.weightTransferMax * staticNf,
      p.weightTransferMax * staticNr,
    );
    const Nf = Math.max(0, staticNf - transferForce);
    const Nr = Math.max(0, staticNr + transferForce);
    const handbrakeMul = input.handbrake > 0 ? 1 - (1 - p.handbrakeGripMultiplier) * input.handbrake : 1.0;

    const speedEps = Math.abs(vf) + 0.4;
    const dirSign = vf < 0 ? -1 : 1;
    const frontSlip = dirSign * this.steerAngle - Math.atan2(vs + this.yawRate * p.cgToFront, speedEps);
    const rearSlip = -Math.atan2(vs - this.yawRate * p.cgToRear, speedEps);

    const rearSlipExcess = Math.max(0, Math.abs(rearSlip) - p.driftSlipThreshold);
    const tractionAvailable = input.handbrake > 0 ? 1 : clamp(1 - rearSlipExcess * 3, 0.35, 1);
    longForce *= tractionAvailable; // actually reduce the force used below, not just a discarded estimate
    const longAccel = longForce / p.mass;

    const frontMaxForce = p.muFront * Nf * gripMul;
    const rearMaxForce = p.muRear * Nr * gripMul * handbrakeMul;
    // Force opposes the slip angle (no extra minus: slip is already signed
    // opposite to the velocity error it's correcting), so this damps the
    // slide instead of amplifying it.
    const frontLatForce = clamp(frontSlip * p.frontStiffness * frontMaxForce, -frontMaxForce, frontMaxForce);
    const rearLatForce = clamp(rearSlip * p.rearStiffness * rearMaxForce, -rearMaxForce, rearMaxForce);

    const yawTorque = frontLatForce * p.cgToFront - rearLatForce * p.cgToRear;
    this.yawRate += (yawTorque / p.inertia) * dt;
    this.yawRate *= p.yawDamping;

    // Drag acts on total speed, not just the forward component, so a car
    // sliding sideways still bleeds speed instead of coasting forever.
    const totalSpeed = Math.hypot(vf, vs);
    const dragMag = p.dragCoeff * totalSpeed * totalSpeed;
    const dragVf = totalSpeed > 0.01 ? (-dragMag * vf) / totalSpeed : 0;
    const dragVs = totalSpeed > 0.01 ? (-dragMag * vs) / totalSpeed : 0;

    const newVf = vf + (longAccel + dragVf / p.mass) * dt;
    const newVs = vs + ((frontLatForce + rearLatForce) / p.mass + dragVs / p.mass) * dt;

    this.heading += this.yawRate * dt;

    const { fx: nfx, fz: nfz, rx: nrx, rz: nrz } = this.axes(this.heading);
    this.vx = newVf * nfx + newVs * nrx;
    this.vz = newVf * nfz + newVs * nrz;

    this.x += this.vx * dt;
    this.z += this.vz * dt;

    this.slipAngle = rearSlip;
    this.isDrifting = Math.abs(rearSlip) > p.driftSlipThreshold && this.speed > p.minDriftSpeed;
  }
}
