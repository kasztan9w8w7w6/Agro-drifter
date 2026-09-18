/**
 * Arcade drift model (bicycle model with saturating tyre lateral force),
 * ported from a 2D top-down prototype onto the world's XZ plane (Y = up).
 *
 * Convention: `heading` is the object's `rotation.y` in Three.js's standard
 * right-handed, Y-up world, where an unrotated object's front faces local
 * **-Z** (matches `mesh.rotation.y = heading`, camera/gizmo defaults, etc.).
 * Under that convention, a chase camera sitting behind the car and looking
 * along its forward vector sees *increasing* heading as a turn toward
 * screen-**left** - it's an inherent property of right-handed Y-up rotation
 * viewed from a "driver's" perspective rather than top-down, not a bug to
 * design around. The 2D prototype this was ported from used a different
 * (mirrored) chirality, where growing its angle read as "turning right", so
 * porting the slip/steer formulas unmodified silently inverted the controls.
 * The single, deliberate fix is the minus sign on `targetSteer` below -
 * everything else keeps the original, already-validated formulas. Covered
 * by a regression test in `CarPhysics.test.ts` so this can't silently
 * regress again.
 *
 * Tuned and headless-tested for: no NaN/blow-up over long random input
 * runs, the car actually settles (straightens, slows) once
 * throttle/steer/handbrake are released, and the handbrake/power-oversteer
 * drift is actually reachable (not just theoretically present).
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

export type Surface = "asphalt" | "gravel" | "mud" | "ice" | "grass" | "glass";

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
  /** 1/s exponential decay rate for yaw rate (not a per-frame multiplier - see update()). */
  yawDampingRate: number;
  weightTransferStrength: number;
  weightTransferMax: number;
  driftSlipThreshold: number;
  minDriftSpeed: number;
  /**
   * How much throttle alone (no handbrake) can break rear grip at speed -
   * "power oversteer", the RWD-drift-happy feel. 0 = never (FWD-ish,
   * planted), higher = easier to kick the tail out on gas + steer alone.
   */
  powerOversteerFactor: number;
  /** Speed (m/s) at which power-oversteer reaches full effect. */
  powerOversteerSpeedThreshold: number;
  /**
   * Instant yaw-rate impulse (rad/s) applied the frame the handbrake is
   * freshly pressed while turning - a discrete "kick" on top of the
   * continuous grip-loss physics, not derived from it. Real drift/arcade
   * games (Ridge Racer's drift button, CarX's handbrake) treat drift
   * initiation as a deliberate snap for feel, not something that should
   * only emerge gradually from a slip-angle curve.
   */
  handbrakeKickYawRate: number;
  /** Minimum speed (m/s) for the handbrake kick to trigger - no snap from a standstill. */
  handbrakeKickMinSpeed: number;
  surfaceGrip: Record<Surface, number>;
}

export const DEFAULT_CAR_PHYSICS_PARAMS: CarPhysicsParams = {
  mass: 1150,
  cgToFront: 1.15,
  cgToRear: 1.35,
  // Higher than session 1's 420: that value made yaw so fast/twitchy that
  // ordinary steering felt nervous rather than weighty - arcade racers
  // (Forza, NFS) keep everyday steering controlled and let the handbrake
  // kick (below) supply the snappy drift entry instead of relying on low
  // inertia everywhere.
  inertia: 620,
  gravity: 9.81,
  enginePower: 9200,
  brakeForce: 12500,
  dragCoeff: 3.6,
  rollResist: 60,
  maxSteerAngle: 0.5,
  steerSpeedFalloff: 0.04,
  // Slower than session 1's 11: steering angle now ramps in over ~0.15s
  // instead of snapping in ~0.09s, reads as smooth/progressive rather than
  // twitchy while still feeling immediate.
  steerResponse: 7,
  frontStiffness: 13,
  rearStiffness: 9.5,
  muFront: 1.18,
  muRear: 0.85,
  handbrakeGripMultiplier: 0.1,
  yawDampingRate: 0.85,
  weightTransferStrength: 0.05,
  weightTransferMax: 0.4,
  // Measured headroom under the tuned rear grip/power-oversteer/inertia
  // constants above: full-lock steer at speed alone (no handbrake) peaks
  // at ~0.0575 rad of rear slip (it saturates there regardless of
  // powerOversteerFactor - the wheelspinLoss cap, not the factor, is what's
  // binding), while ordinary cornering (steer <= 0.6) stays under 0.035
  // (see CarPhysics.test.ts).
  driftSlipThreshold: 0.05,
  minDriftSpeed: 3,
  powerOversteerFactor: 0.5,
  powerOversteerSpeedThreshold: 15,
  handbrakeKickYawRate: 3.2,
  handbrakeKickMinSpeed: 3,
  surfaceGrip: { asphalt: 1.0, gravel: 0.72, mud: 0.48, ice: 0.28, grass: 0.6, glass: 0.4 },
};

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Upper bound on a single integration step, regardless of the caller's frame rate. */
const MAX_SUBSTEP_DT = 1 / 120;

export class CarPhysics {
  readonly params: CarPhysicsParams;

  // World-space state, XZ plane, Y up.
  x = 0;
  z = 0;
  /** Radians, `rotation.y` convention: 0 = facing -Z, positive turns toward screen-left. */
  heading = 0;

  private vx = 0; // world-space velocity
  private vz = 0;
  private yawRate = 0;
  private steerAngle = 0;
  private prevHandbrake = 0;

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

  /** World-space velocity components (not just heading/speed - differs during a drift). */
  get velocityX(): number {
    return this.vx;
  }

  get velocityZ(): number {
    return this.vz;
  }

  setPosition(x: number, z: number, heading = this.heading): void {
    this.x = x;
    this.z = z;
    this.heading = heading;
  }

  /** Scales current velocity (e.g. hitting an obstacle bleeds speed instantly). */
  applyImpactSpeedScale(scale: number): void {
    this.vx *= scale;
    this.vz *= scale;
  }

  private axes(heading: number): { fx: number; fz: number; rx: number; rz: number } {
    const s = Math.sin(heading);
    const c = Math.cos(heading);
    // Three.js convention: front(0) = (0,0,-1). right(heading) is forward
    // rotated to match the car's own right side (and a chase camera's
    // screen-right when placed behind the car looking along its forward).
    return { fx: -s, fz: -c, rx: c, rz: -s };
  }

  /**
   * Advances the simulation by `dt` seconds. Internally split into fixed
   * sub-steps (see `MAX_SUBSTEP_DT`): this is a coupled nonlinear system
   * (slip angle depends on velocity, force depends on slip angle, velocity
   * depends on force), not a simple exponential-toward-target, so there's
   * no closed form that's exact at any step size the way the steering/yaw
   * damping smoothing is - explicit Euler needs a small enough step here to
   * stay accurate, especially with this car's low yaw inertia (fast yaw
   * response = a stiffer system). Verified: without sub-stepping, 20fps vs
   * 60fps diverged by ~0.7 rad of heading after 2s of steering; with it,
   * well under 0.05 rad.
   */
  update(dt: number, input: CarInput, surface: Surface = "asphalt"): void {
    const p = this.params;
    const handbrakeJustPressed = input.handbrake > 0 && this.prevHandbrake <= 0;
    this.prevHandbrake = input.handbrake;
    if (handbrakeJustPressed && Math.abs(input.steer) > 0.1 && this.speed > p.handbrakeKickMinSpeed) {
      // Sign matches -input.steer everywhere else in this file (see the
      // class-level doc comment on the steering convention).
      this.yawRate += -Math.sign(input.steer) * p.handbrakeKickYawRate;
    }

    const substeps = Math.max(1, Math.ceil(dt / MAX_SUBSTEP_DT));
    const subDt = dt / substeps;
    for (let i = 0; i < substeps; i++) {
      this.step(subDt, input, surface);
    }
  }

  private step(dt: number, input: CarInput, surface: Surface): void {
    const p = this.params;
    const gripMul = p.surfaceGrip[surface] ?? 1.0;

    const { fx, fz, rx, rz } = this.axes(this.heading);
    const vf = this.vx * fx + this.vz * fz; // forward speed
    const vs = this.vx * rx + this.vz * rz; // lateral (rightward) speed
    const speedNow = Math.hypot(vf, vs);

    // Steering: relaxes toward a speed-limited target angle. Negated: see
    // the class-level doc comment for why a naive port of the 2D formula
    // turns the car the wrong way in this 3D convention.
    const speedFactor = 1 / (1 + Math.abs(vf) * p.steerSpeedFalloff);
    const targetSteer = -input.steer * p.maxSteerAngle * speedFactor;
    // Exponential-decay smoothing (same form as the chase camera), not the
    // `Math.min(1, dt*rate)` linear approximation the original pseudocode
    // used - that form is FPS-dependent (verified: it produced a ~6x
    // difference in heading after 1s of steering at 20fps vs 60fps).
    this.steerAngle += (targetSteer - this.steerAngle) * (1 - Math.exp(-p.steerResponse * dt));

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

    // Power oversteer: throttle alone (no handbrake) eats into rear grip as
    // speed builds, so a car with a high enough powerOversteerFactor can be
    // kicked into a drift on gas + steer alone, like a real RWD car breaking
    // rear traction - not just via the handbrake.
    const throttleRatio = clamp(Math.abs(longForce) / p.enginePower, 0, 1);
    const oversteerSpeedFactor = clamp(speedNow / p.powerOversteerSpeedThreshold, 0, 1);
    const wheelspinLoss = clamp(p.powerOversteerFactor * throttleRatio * oversteerSpeedFactor, 0, 0.6);

    const frontMaxForce = p.muFront * Nf * gripMul;
    const rearMaxForce = p.muRear * Nr * gripMul * handbrakeMul * (1 - wheelspinLoss);
    // Force opposes the slip angle (no extra minus: slip is already signed
    // opposite to the velocity error it's correcting), so this damps the
    // slide instead of amplifying it.
    const frontLatForce = clamp(frontSlip * p.frontStiffness * frontMaxForce, -frontMaxForce, frontMaxForce);
    const rearLatForce = clamp(rearSlip * p.rearStiffness * rearMaxForce, -rearMaxForce, rearMaxForce);

    const yawTorque = frontLatForce * p.cgToFront - rearLatForce * p.cgToRear;
    this.yawRate += (yawTorque / p.inertia) * dt;
    // Exponential decay over real time, not a fixed per-frame multiplier -
    // the original `yawRate *= 0.985` form loses ~60%/s at 60fps but only
    // ~26%/s at 20fps (same class of FPS-dependence bug as the steering
    // blend above, just easier to miss since nothing clamps it to 1).
    this.yawRate *= Math.exp(-p.yawDampingRate * dt);

    // Drag acts on total speed, not just the forward component, so a car
    // sliding sideways still bleeds speed instead of coasting forever.
    const totalSpeed = speedNow;
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
