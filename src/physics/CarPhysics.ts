/**
 * Drift model (bicycle model, RWD) ported from a 2D top-down prototype
 * onto the world's XZ plane (Y = up).
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
 * Tyre model: each axle's lateral force follows `maxForce * sin(2 *
 * atan(slip / peakSlip))` - a simplified Pacejka "magic formula" shape
 * (rises near-linearly from zero, peaks exactly at `peakSlip` with
 * `maxForce`, then *falls off* beyond it - unlike a plain clamp, which
 * would plateau at maxForce forever). That falloff is what makes pushing
 * past the limit actually cost you grip instead of just capping it: the
 * difference between a forgiving arcade slide and a sim-like one that
 * punishes overcorrection.
 *
 * The driven (rear) axle's longitudinal engine force and its lateral tyre
 * force share one traction budget (`rearMaxForce`) via a real friction
 * circle: demanding more of both than the tyre can give scales *both* down
 * together. That's what makes throttle mid-corner cost you lateral grip
 * (power oversteer) as a direct physical consequence, not a bolted-on
 * "wheelspin" formula.
 *
 * No scripted "drift kick": drift entry comes entirely from the handbrake
 * collapsing rear grip (`handbrakeGripMultiplier`) into that same tyre
 * curve, not from an artificial yaw-rate impulse - real weight transfer,
 * real slip angles, nothing faked for feel.
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
  /** Slip angle (rad) at which the front tyre's lateral force peaks - past it, grip falls off. */
  frontPeakSlip: number;
  /** Same, for the rear tyre - lower than front by design (breaks away first, RWD drift character). */
  rearPeakSlip: number;
  muFront: number;
  muRear: number;
  handbrakeGripMultiplier: number;
  /** 1/s exponential decay rate for yaw rate (not a per-frame multiplier - see update()). */
  yawDampingRate: number;
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
  inertia: 620,
  gravity: 9.81,
  enginePower: 9200,
  brakeForce: 12500,
  dragCoeff: 3.6,
  rollResist: 60,
  maxSteerAngle: 0.5,
  steerSpeedFalloff: 0.04,
  steerResponse: 7,
  // ~8.6 deg front / ~6.3 deg rear - real street-tyre slip-angle peaks are
  // roughly in this range; rear lower than front means the rear steps
  // past its peak (and starts losing grip) before the front does, which
  // is what makes this car want to rotate under power/trail-braking
  // rather than plough straight (understeer) - an RWD drift car's basic
  // character, produced by the tyre model itself now, not a fudge factor.
  frontPeakSlip: 0.15,
  rearPeakSlip: 0.11,
  muFront: 1.18,
  muRear: 0.85,
  handbrakeGripMultiplier: 0.1,
  yawDampingRate: 0.85,
  weightTransferStrength: 0.05,
  weightTransferMax: 0.4,
  // Rear slip past this counts as "drifting" (FX/scoring/camera roll) -
  // comfortably above what ordinary cornering produces, comfortably below
  // rearPeakSlip so it flags the approach to the limit, not just chaos
  // beyond it (see CarPhysics.test.ts for the measured numbers this sits between).
  driftSlipThreshold: 0.05,
  minDriftSpeed: 3,
  surfaceGrip: { asphalt: 1.0, gravel: 0.72, mud: 0.48, ice: 0.28, grass: 0.6, glass: 0.4 },
};

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Simplified Pacejka "magic formula" shape (C=2, E=0): rises from zero,
 * peaks exactly at `maxForce` when `|slipAngle| == peakSlip`, then falls
 * off for larger slip - both sin and atan are odd functions, so the sign
 * of the output always matches the sign of slipAngle without a separate check.
 */
export function tireLateralForce(slipAngle: number, maxForce: number, peakSlip: number): number {
  if (maxForce <= 0) return 0;
  return maxForce * Math.sin(2 * Math.atan(slipAngle / peakSlip));
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
   * stay accurate, especially with this car's yaw response. Verified:
   * without sub-stepping, 20fps vs 60fps diverged by ~0.7 rad of heading
   * after 2s of steering; with it, well under 0.05 rad.
   */
  update(dt: number, input: CarInput, surface: Surface = "asphalt"): void {
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

    // RWD: engine force only ever goes through the rear axle (see the
    // friction circle below). Braking and rolling resistance act at the
    // vehicle level - real per-axle brake bias is out of scope here, but
    // the weight-transfer estimate right below still uses their combined
    // demand, so trail-braking still shifts grip front/rear correctly.
    const engineForce = input.throttle > 0 ? input.throttle * p.enginePower : 0;
    let brakeAndRollForce = 0;
    if (input.brake > 0) brakeAndRollForce -= input.brake * p.brakeForce * Math.sign(vf || 1);
    if (Math.abs(vf) > 0.01) brakeAndRollForce -= p.rollResist * Math.sign(vf);

    const wheelBase = p.cgToFront + p.cgToRear;
    const staticNf = (p.mass * p.gravity * p.cgToRear) / wheelBase;
    const staticNr = (p.mass * p.gravity * p.cgToFront) / wheelBase;
    const longAccelEstimate = (engineForce + brakeAndRollForce) / p.mass;
    const transferForce = clamp(
      p.mass * longAccelEstimate * p.weightTransferStrength,
      -p.weightTransferMax * staticNf,
      p.weightTransferMax * staticNr,
    );
    const Nf = Math.max(0, staticNf - transferForce);
    const Nr = Math.max(0, staticNr + transferForce);
    const handbrakeMul = input.handbrake > 0 ? 1 - (1 - p.handbrakeGripMultiplier) * input.handbrake : 1.0;

    const frontMaxForce = p.muFront * Nf * gripMul;
    const rearMaxForce = p.muRear * Nr * gripMul * handbrakeMul;

    const speedEps = Math.abs(vf) + 0.4;
    const dirSign = vf < 0 ? -1 : 1;
    const frontSlip = dirSign * this.steerAngle - Math.atan2(vs + this.yawRate * p.cgToFront, speedEps);
    const rearSlip = -Math.atan2(vs - this.yawRate * p.cgToRear, speedEps);

    const frontLatForce = tireLateralForce(frontSlip, frontMaxForce, p.frontPeakSlip);
    const idealRearLat = tireLateralForce(rearSlip, rearMaxForce, p.rearPeakSlip);

    // Friction circle on the driven axle: the engine's push and the tyre's
    // lateral grip share one traction budget. Demanding more of both than
    // `rearMaxForce` allows scales *both* down together - throttle
    // mid-corner directly costs lateral grip as a physical consequence,
    // not through a separate "wheelspin" formula.
    let rearLongForce = engineForce;
    let rearLatForce = idealRearLat;
    const rearDemand = Math.hypot(rearLongForce, rearLatForce);
    if (rearDemand > rearMaxForce && rearDemand > 1e-3) {
      const scale = rearMaxForce / rearDemand;
      rearLongForce *= scale;
      rearLatForce *= scale;
    }

    const yawTorque = frontLatForce * p.cgToFront - rearLatForce * p.cgToRear;
    this.yawRate += (yawTorque / p.inertia) * dt;
    // Exponential decay over real time, not a fixed per-frame multiplier -
    // the original `yawRate *= 0.985` form loses ~60%/s at 60fps but only
    // ~26%/s at 20fps (same class of FPS-dependence bug as the steering
    // blend above, just easier to miss since nothing clamps it to 1).
    this.yawRate *= Math.exp(-p.yawDampingRate * dt);

    // Drag acts on total speed, not just the forward component, so a car
    // sliding sideways still bleeds speed instead of coasting forever.
    const totalSpeed = Math.hypot(vf, vs);
    const dragMag = p.dragCoeff * totalSpeed * totalSpeed;
    const dragVf = totalSpeed > 0.01 ? (-dragMag * vf) / totalSpeed : 0;
    const dragVs = totalSpeed > 0.01 ? (-dragMag * vs) / totalSpeed : 0;

    // Integrate velocity directly in world space from local-frame forces
    // resolved through the *current* heading's axes - NOT by recomputing
    // (vf, vs) and re-expressing them through the *new*, post-rotation
    // heading. That second approach silently rotates the velocity vector
    // by however much yaw happened this step, regardless of whether any
    // actual lateral force justified it: a car spinning fast on yaw torque
    // alone would appear to carve a tight arc "for free", let it corner
    // tighter than its own tyre grip could ever produce, and made the
    // slip-angle/friction-circle work above nearly pointless (verified:
    // with this bug, sustained ~4g cornering was reachable at rear slip
    // angles under 0.03 rad, on a car whose tyres cap out under 1g).
    // Newton's second law applies in world space; yaw is a separate,
    // purely rotational update that changes orientation, not velocity.
    const accelLocalF = (rearLongForce + brakeAndRollForce + dragVf) / p.mass;
    const accelLocalS = (frontLatForce + rearLatForce + dragVs) / p.mass;
    this.vx += (accelLocalF * fx + accelLocalS * rx) * dt;
    this.vz += (accelLocalF * fz + accelLocalS * rz) * dt;

    this.heading += this.yawRate * dt;

    this.x += this.vx * dt;
    this.z += this.vz * dt;

    this.slipAngle = rearSlip;
    this.isDrifting = Math.abs(rearSlip) > p.driftSlipThreshold && this.speed > p.minDriftSpeed;
  }
}
