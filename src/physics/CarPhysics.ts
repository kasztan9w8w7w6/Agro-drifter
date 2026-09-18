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

import { Drivetrain, type DrivetrainParams } from "./Drivetrain";

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
  /** 0 (pedal to the floor, fully disengaged) .. 1 (pedal up, fully engaged) - see Drivetrain.ts. Optional and defaults to 1 (always engaged) so every pre-existing caller/test that predates the clutch stays exactly as it behaved before. */
  clutch?: number;
  /** Ignition key held (restarts a stalled engine after `Drivetrain.params.ignitionHoldS`). Optional, defaults to false. */
  ignition?: boolean;
}

export interface CarPhysicsParams {
  mass: number;
  cgToFront: number;
  cgToRear: number;
  inertia: number;
  gravity: number;
  brakeForce: number;
  dragCoeff: number;
  rollResist: number;
  /** rad - the hard cap on wheel angle, reached at low speed (see `steerFalloffK`/`steerFalloffC`). */
  maxSteerAngle: number;
  /** rad*(km/h) - numerator of the speed-sensitive steering curve `min(maxSteerAngle, steerFalloffK / (speedKmh + steerFalloffC))`. */
  steerFalloffK: number;
  /** km/h - denominator offset of that same curve. */
  steerFalloffC: number;
  steerResponse: number;
  /** metres - front/rear track width, for the Ackermann virtual-wheel-angle getters (this bicycle model steers a single virtual front wheel; these expose what the left/right wheels *would* be doing for visuals/telemetry). */
  trackWidth: number;
  /** How strongly a drift pulls the (target) steer angle toward countersteering the car's own body-slip vector, on top of the player's own input - 0 disables it. */
  selfAligningStrength: number;
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
  /** m/s cap on how fast holding brake-to-reverse can push the car backward. */
  reverseTopSpeed: number;
  surfaceGrip: Record<Surface, number>;
}

export const DEFAULT_CAR_PHYSICS_PARAMS: CarPhysicsParams = {
  // Fiat 126p ballpark: ~600kg, ~2.02m wheelbase, engine mounted over the
  // rear axle - cgToRear smaller than cgToFront puts most of the static
  // weight (staticNr below, ~62%) on the driven rear axle, same rear-engine
  // weight bias the real car has.
  mass: 600,
  cgToFront: 1.25,
  cgToRear: 0.77,
  inertia: 300,
  gravity: 9.81,
  // Scaled down from this model's original (much heavier, generic-car)
  // tuning by the same mass ratio (600/1150) - brakeForce/rollResist were
  // empirically fitted against that mass, and propulsion is no longer a
  // flat `enginePower` figure here at all (see `Drivetrain.ts`).
  brakeForce: 6500,
  dragCoeff: 3.6,
  rollResist: 31,
  maxSteerAngle: 0.5,
  // Solved so the curve passes through the brief's two reference points
  // exactly: full lock (maxSteerAngle=0.5 rad) at 10 km/h, ~12 deg (0.2094
  // rad) at 100 km/h. 0.5=k/(10+c), 0.2094=k/(100+c) -> c=54.87, k=32.435.
  steerFalloffK: 32.435,
  steerFalloffC: 54.87,
  steerResponse: 7,
  // ~126p track width.
  trackWidth: 1.22,
  selfAligningStrength: 0.4,
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
  // ~50 km/h - generous for backing up, and comfortably inside the speed
  // range the reverse yaw-damping boost above is tuned against (see the
  // comment on `reverseYawDampingBoost` in step()).
  reverseTopSpeed: 14,
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

  /** Current front (virtual) wheel angle, rad - for telemetry/tests; see `ackermannWheelAngles` for the per-side split. */
  get wheelAngle(): number {
    return this.steerAngle;
  }

  /** Rear slip angle from the last step, for drift FX/camera roll. */
  slipAngle = 0;
  isDrifting = false;

  readonly drivetrain: Drivetrain;

  constructor(params: Partial<CarPhysicsParams> = {}, drivetrainParams: Partial<DrivetrainParams> = {}) {
    this.params = { ...DEFAULT_CAR_PHYSICS_PARAMS, ...params };
    this.drivetrain = new Drivetrain(drivetrainParams);
  }

  /** Engine RPM (see `Drivetrain.ts`) - for the HUD. */
  get rpm(): number {
    return this.drivetrain.rpm;
  }

  /** -1 reverse, 0 stalled, 1..N forward gear - for the HUD. */
  get gear(): number {
    return this.drivetrain.gear;
  }

  get isStalled(): boolean {
    return this.drivetrain.isStalled;
  }

  /** True while the starter is cranking (ignition held, engine not yet caught) - CarPhysics blocks every other input while this is true, see step(). */
  get isCranking(): boolean {
    return this.drivetrain.isCranking;
  }

  /**
   * Ackermann steering geometry (rad) for the left/right *virtual* front
   * wheels this bicycle model doesn't otherwise have (there is no
   * `RaycastVehicle` here, just one effective steer angle for the whole
   * front axle - see Drivetrain.ts's class doc comment on why) - exposed
   * for visuals/telemetry (e.g. animating a real car model's two front
   * wheel meshes) and for tests. The inner wheel toward the turn always
   * gets the larger magnitude: with a common turn centre for both wheels,
   * the inner one is closer to it and so needs the tighter angle.
   */
  get ackermannWheelAngles(): { left: number; right: number } {
    const p = this.params;
    const wheelBase = p.cgToFront + p.cgToRear;
    if (Math.abs(this.steerAngle) < 1e-4) return { left: 0, right: 0 };
    const turnRadius = wheelBase / Math.tan(this.steerAngle);
    const halfTrack = p.trackWidth / 2;
    return {
      left: Math.atan(wheelBase / (turnRadius - halfTrack)),
      right: Math.atan(wheelBase / (turnRadius + halfTrack)),
    };
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

    // Starter cranking blocks every other input for its duration (spec:
    // "zablokuj inne wejścia na ten czas") - clutch/ignition themselves are
    // never blocked, they're what's driving the cranking in the first
    // place. Checked against *last* step's isCranking, not this step's -
    // Drivetrain.update() below is what actually flips it, so using this
    // step's value would let the very frame the engine catches slip a
    // frame of real input through early.
    const wasCranking = this.drivetrain.isCranking;
    const throttle = wasCranking ? 0 : input.throttle;
    const steer = wasCranking ? 0 : input.steer;
    const brake = wasCranking ? 0 : input.brake;
    const handbrake = wasCranking ? 0 : input.handbrake;
    const clutchInput = clamp(input.clutch ?? 1, 0, 1);
    const ignitionInput = input.ignition ?? false;
    // This game has no separate reverse throttle - holding brake while
    // already stopped (or already rolling backward) is how you reverse,
    // same one-pedal convention as most arcade racers - see its use below.
    const REST_EPS = 0.05;

    // Steering: relaxes toward a speed-limited target angle. Negated: see
    // the class-level doc comment for why a naive port of the 2D formula
    // turns the car the wrong way in this 3D convention.
    //
    // Speed-sensitive max lock: `min(maxSteerAngle, k/(speedKmh + c))` -
    // full lock at low speed, tapering to a much narrower band at speed
    // (see the constants' own comment for the two reference points this
    // was solved against), rather than the old `1/(1+|vf|*falloff)` shape.
    const speedKmh = Math.abs(vf) * 3.6;
    const maxSteerAtSpeed = Math.min(p.maxSteerAngle, p.steerFalloffK / (speedKmh + p.steerFalloffC));
    let targetSteer = -steer * maxSteerAtSpeed;

    // Self-aligning torque / countersteer assist: mid-drift (using *last*
    // step's isDrifting/slipAngle - this step's rear slip isn't known yet,
    // it depends on this very steerAngle, and a one-substep-old value is
    // well within this model's own sub-stepping error budget), the front
    // wheels naturally weathervane toward the car's actual velocity vector
    // rather than staying wherever the player last put them - the same
    // caster effect that makes a real car's wheel spin itself back toward
    // "straight" (here, toward opposite-lock) once the rear steps out.
    // Blended in on top of the player's own input, not replacing it - the
    // player still has to catch it, this just gives the wheel a head start.
    if (this.isDrifting) {
      const bodySlipEstimate = Math.atan2(vs, Math.abs(vf) + 0.4);
      const assist = clamp(-bodySlipEstimate * p.selfAligningStrength, -p.maxSteerAngle, p.maxSteerAngle);
      targetSteer += assist;
    }

    // Exponential-decay smoothing (same form as the chase camera), not the
    // `Math.min(1, dt*rate)` linear approximation the original pseudocode
    // used - that form is FPS-dependent (verified: it produced a ~6x
    // difference in heading after 1s of steering at 20fps vs 60fps).
    this.steerAngle += (targetSteer - this.steerAngle) * (1 - Math.exp(-p.steerResponse * dt));

    // RWD: propulsion only ever goes through the rear axle (see the
    // friction circle below), now sourced from the RPM/torque-curve
    // Drivetrain (Drivetrain.ts) rather than a flat `throttle*enginePower`
    // figure - can be negative (engine braking) even with the throttle
    // untouched, which the friction circle below costs lateral grip for
    // exactly the same reason ordinary braking does. Reverse is NOT driven
    // through it - see the `reversing` flag and Drivetrain's own class doc
    // comment for why that stays this file's own, separately-tuned force.
    const reversing = vf < -REST_EPS;
    const driveOut = this.drivetrain.update(
      dt,
      { throttle, clutch: clutchInput, ignition: ignitionInput, reversing },
      vf,
    );
    const engineForce = driveOut.wheelForce;
    let brakeAndRollForce = 0;
    // Brake means two different things depending on vf's sign relative to
    // the small rest band above: decelerate current forward motion
    // (REST_EPS < vf), or drive backward (vf <= REST_EPS). Only the
    // deceleration case gets clamped to "at most enough force to bring vf
    // to exactly zero this step" - a full, un-clamped brake force applied
    // for a whole step can overshoot past vf=0 and land on the *other*
    // side, and since that side used to ALSO try to decelerate (now back
    // toward 0), it flips back next step, and so on: a fast, tiny
    // sign-flipping oscillation in vf while held at a standstill
    // (imperceptible on the car itself, a few mm of position noise per
    // substep) that the chase camera's velocity-lead look-at target
    // faithfully amplifies into a visible background shake, and that the
    // retro pass's vertex snapping turns into flicker on thin/distant
    // geometry. The reverse case is exempt from that clamp on purpose:
    // it's *supposed* to keep pushing vf negative, not settle at zero -
    // clamping it there silently disabled reversing entirely.
    // Tracked separately from `brakeAndRollForce` for the weight-transfer
    // estimate below: only counts force that's actually *decelerating*
    // forward motion (real braking - nose dives, weight to front, same as
    // any car). Reverse propulsion deliberately does NOT feed that estimate
    // - see the comment below, by its use.
    let brakeDecelForce = 0;
    if (brake > 0) {
      if (vf > REST_EPS) {
        const maxStoppingForce = (vf * p.mass) / dt;
        brakeDecelForce = -Math.min(brake * p.brakeForce, maxStoppingForce);
        brakeAndRollForce += brakeDecelForce;
      } else if (-vf < p.reverseTopSpeed) {
        // Reversing has no gear of its own, so without a cap the brake's
        // full stopping force (calibrated for shedding highway speed
        // quickly) keeps accelerating the car backward indefinitely - drag
        // alone doesn't rein it in until well over 100 km/h in reverse,
        // way past anything a player expects "hold brake to back up" to
        // do, and also past the speed range the reverse yaw-damping fix
        // below was tuned and verified against.
        brakeAndRollForce -= brake * p.brakeForce;
      }
    }
    if (Math.abs(vf) > 0.01) brakeAndRollForce -= p.rollResist * Math.sign(vf);

    const wheelBase = p.cgToFront + p.cgToRear;
    const staticNf = (p.mass * p.gravity * p.cgToRear) / wheelBase;
    const staticNr = (p.mass * p.gravity * p.cgToFront) / wheelBase;
    // Reverse propulsion (the `vf <= REST_EPS` branch above) is excluded
    // here on purpose: it reuses the same numeric force as full braking
    // (see the comment above `REST_EPS`), so treating it the same as real
    // braking made the weight-transfer maths read "hard braking" and dump
    // ~40% of the rear axle's normal load onto the front every time the
    // player just held brake to reverse - a stationary or slow-reversing
    // car doesn't nose-dive like that. Losing that much rear grip is what
    // let the rear tyres blow straight past their peak slip angle from a
    // tiny steering input, which is what made reversing turn far tighter
    // than driving forward and drift with no handbrake involved. Forward
    // acceleration and real forward-motion braking still transfer weight
    // exactly as before - only reverse propulsion is now weight-neutral.
    const longAccelEstimate = (engineForce + brakeDecelForce) / p.mass;
    const transferForce = clamp(
      p.mass * longAccelEstimate * p.weightTransferStrength,
      -p.weightTransferMax * staticNf,
      p.weightTransferMax * staticNr,
    );
    const Nf = Math.max(0, staticNf - transferForce);
    const Nr = Math.max(0, staticNr + transferForce);
    const handbrakeMul = handbrake > 0 ? 1 - (1 - p.handbrakeGripMultiplier) * handbrake : 1.0;

    const frontMaxForce = p.muFront * Nf * gripMul;
    const rearMaxForce = p.muRear * Nr * gripMul * handbrakeMul;

    // Magnitude-only denominator (`speedEps`, not signed `vf`) so each
    // tyre's slip angle stays a function of "how much is it scrubbing
    // sideways relative to how fast it's rolling", which is symmetric in
    // forward/reverse - the tyre doesn't care which way it's rolling, only
    // how much it's sliding sideways while doing so, same as a shopping
    // cart wheel rolls straight either direction until pushed sideways.
    // (Using signed vf instead would swing the slip angle out toward
    // +-pi/2 whenever reversing, which the tyre curve below reads as "way
    // past peakSlip" and collapses to near-zero force - the opposite of
    // what a sliding tyre should do.) No steer-direction or `dirSign`
    // correction needed here either: `this.steerAngle` is the wheel's
    // actual physical angle relative to the body, unaffected by which way
    // the car happens to be travelling.
    const speedEps = Math.abs(vf) + 0.4;
    const frontSlip = this.steerAngle - Math.atan2(vs + this.yawRate * p.cgToFront, speedEps);
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
    // Reversing with the front (steered) axle now trailing rather than
    // leading is a real vehicle-dynamics effect, not a formula bug: a
    // steered axle is self-centring/stabilising when it *leads* (forward
    // driving) but behaves like a trailing caster when it's dragged behind
    // instead - the same reason a shopping trolley's front wheels flutter
    // when backed up, or a reversing trailer needs constant correction.
    // Measured here (see CarPhysics.test.ts): holding the same steer input
    // at a matched speed, coasting with zero other forces, rear slip angle
    // climbs without settling in reverse while it saturates around 0.3 rad
    // forward - confirmed present even with the slip-angle formulas above
    // made fully direction-symmetric and weight transfer neutralised for
    // reverse (see `brakeDecelForce` above), so it isn't an artefact of
    // either of those. Real reverse gearing keeps this in check by simply
    // not letting a car reverse anywhere near as fast as it drives forward
    // (see `reverseTopSpeed`); this extra damping, active only while
    // vf < 0, is the yaw-side equivalent - it doesn't touch forward
    // handling at all (boost is exactly 1 there).
    const reverseYawDampingBoost = vf < 0 ? 4 : 1;
    this.yawRate *= Math.exp(-p.yawDampingRate * reverseYawDampingBoost * dt);

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
