/**
 * RPM-driven drivetrain for the Fiat 126p-style RWD car: gears, a torque
 * curve, a slipping clutch with flywheel inertia, and stalling - all
 * upstream of `CarPhysics`, which still only ever sees a single
 * longitudinal force at the rear axle. Nothing here touches Y or knows
 * about slip angles/tyres; it hands CarPhysics a force, CarPhysics's
 * existing friction circle decides what that force costs in lateral grip.
 *
 * Deliberately not a `RaycastVehicle`/rigid-body wheel simulation - this
 * project has no physics engine (no cannon-es, no Rapier); `CarPhysics` is
 * a hand-rolled analytical bicycle model integrated directly in `x/z`.
 * "Wheels" here are virtual: real enough to drive the RPM/torque/Ackermann
 * maths the brief asks for, but there's no per-wheel rigid body to attach
 * a raycast to.
 *
 * Reverse is NOT driven through this gear/torque model - `CarPhysics` keeps
 * its own separately-tuned brake-to-reverse force (see the REST_EPS/
 * `reverseTopSpeed` comments there; that fix took real empirical work to
 * stabilise and isn't worth risking here). While reversing, this class
 * still tracks a believable RPM/gear readout (using `reverseRatio`) for the
 * HUD, but never contributes force - see the `reversing` input flag.
 */

export interface TorqueCurvePoint {
  rpm: number;
  torqueNm: number;
}

export interface DrivetrainParams {
  /** 1st..Nth gear ratios, forward only. */
  gearRatios: number[];
  /** Magnitude of the reverse gear's ratio - RPM readout only while backing up, see the class doc comment. */
  reverseRatio: number;
  finalDrive: number;
  /** metres - ~13" steel wheel on a 126p. */
  wheelRadius: number;
  /** kg*m^2, combined engine+flywheel rotational inertia - how quickly the engine can change RPM under a given net torque. */
  flywheelInertia: number;
  /** Below this, the engine makes no torque at all (spec: "below idle the engine generates no power"). */
  idleRpm: number;
  /** Reference point only (the LUT's own peak is what actually governs output) - kept for documentation/HUD. */
  peakTorqueRpm: number;
  /** Above this, hard ignition cut - torque instantly zero, producing the characteristic jolt as the friction circle's demand drops out from under the tyre. */
  redlineRpm: number;
  /** Piecewise-linear torque curve, ascending by rpm. Values below the first point or the idle cut return 0; values above the last point hold its torque until `redlineRpm` cuts it. */
  torqueCurve: TorqueCurvePoint[];
  /** Nm per RPM of error, how hard the idle-air governor corrects toward `idleRpm` when the driver isn't on the throttle - a control loop, not part of the torque curve, so it doesn't fight the curve's own shape (which rises too fast just past idle to give a naturally stable idle point on its own). */
  idleGovernorGain: number;
  /** Nm, the governor's correction cap - deliberately well below `clutchCapacityNm` so a hard clutch-drop at a stop with no throttle still overwhelms it and stalls the engine, matching a real idle-air valve's limited authority. */
  idleGovernorMaxNm: number;
  /** Automatic upshift/downshift thresholds (this drivetrain has no manual shift input in this pass). */
  shiftUpRpm: number;
  shiftDownRpm: number;
  /** Seconds the driveline treats as "mid-shift" (torque delivery suppressed) after a gear change, so shifts aren't an instant force teleport. */
  shiftLagS: number;
  /** Nm, the clutch disk's maximum transmissible torque (both directions) at full pedal release - a real disk's static friction capacity doesn't care how much torque the engine actually has to give at the moment it bites, which is exactly what makes a mistimed launch bog or stall the engine rather than "just work"; tuned below this tiny engine's own peak torque so ordinary driving still transmits the full torque curve (slip stays inside `clutchSlipRangeRpm` under normal load) while a mismatched, too-fast release genuinely costs RPM. */
  clutchCapacityNm: number;
  /** RPM gap at which the clutch's proportional slip torque saturates at `clutchCapacityNm` - small gaps transmit proportionally less, matching a dry-friction plate rather than a hard on/off lock. */
  clutchSlipRangeRpm: number;
  /** Nm, engine internal friction/pumping losses at 0 RPM. */
  engineFrictionBase: number;
  /** Nm per RPM, additional friction that grows linearly with engine speed. */
  engineFrictionCoeff: number;
  /** RPM difference (engine vs wheel-implied) above which snapping the clutch shut counts as a "clutch kick". */
  clutchKickDeltaRpm: number;
  /** N, the shock load injected at the rear axle for exactly the step a clutch kick fires. */
  clutchKickShockForce: number;
  /** Below this RPM, with a gear engaged and the clutch not pressed, the engine dies. */
  stallRpm: number;
  /** Seconds the ignition key must be held to restart a stalled engine. */
  ignitionHoldS: number;
  /** N, fixed engine-braking deceleration force applied while stalled and still moving (spec: "coasts with engine braking at max"). */
  stalledEngineBrakingForce: number;
}

export const DEFAULT_DRIVETRAIN_PARAMS: DrivetrainParams = {
  gearRatios: [3.25, 2.05, 1.3, 0.87],
  reverseRatio: 3.0,
  finalDrive: 4.87,
  wheelRadius: 0.28,
  flywheelInertia: 0.08,
  idleRpm: 900,
  peakTorqueRpm: 4000,
  redlineRpm: 6500,
  // Stylised Fiat 126p-ish 650/700cc twin: peak torque a modest ~58Nm,
  // nothing at all below idle, falling off hard past redline.
  torqueCurve: [
    { rpm: 900, torqueNm: 30 },
    { rpm: 2000, torqueNm: 42 },
    { rpm: 3000, torqueNm: 50 },
    { rpm: 4000, torqueNm: 58 },
    { rpm: 5000, torqueNm: 52 },
    { rpm: 6000, torqueNm: 38 },
    { rpm: 6500, torqueNm: 20 },
  ],
  idleGovernorGain: 2,
  idleGovernorMaxNm: 12,
  shiftUpRpm: 5600,
  shiftDownRpm: 1800,
  shiftLagS: 0.15,
  clutchCapacityNm: 45,
  clutchSlipRangeRpm: 400,
  engineFrictionBase: 6,
  engineFrictionCoeff: 0.003,
  clutchKickDeltaRpm: 3000,
  clutchKickShockForce: 2600,
  stallRpm: 500,
  ignitionHoldS: 2,
  stalledEngineBrakingForce: 900,
};

export interface DrivetrainInput {
  /** 0..1 */
  throttle: number;
  /** 0 (pedal to the floor, fully disengaged) .. 1 (pedal up, fully engaged). */
  clutch: number;
  /** Ignition key held (starter cranking while stalled). */
  ignition: boolean;
  /** CarPhysics is currently driving the car backward via its own brake-to-reverse force - see the class doc comment. */
  reversing: boolean;
}

export interface DrivetrainOutput {
  /** N, longitudinal force to apply at the driven (rear) axle this step - already includes any clutch-kick shock. Always 0 while `reversing` (CarPhysics supplies that force itself). */
  wheelForce: number;
  /** N, the portion of `wheelForce` that was a one-step clutch-kick shock (0 most steps) - exposed for FX/tests, not meant to be added again. */
  shockForce: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * RPM band below `idleRpm` over which torque ramps linearly to 0, instead
 * of an instant step. A hard step at exactly idle would be an
 * unrecoverable trap the moment RPM dips even slightly under it for any
 * reason (friction wins with nothing to push back, and the curve gives
 * exactly 0 forever after, throttle or not - verified this happening in
 * practice via the idle governor's own small, permanently nonzero
 * steady-state error against constant friction, a textbook pure-P-control
 * limitation) - a small ramp is also just more realistic than a real
 * engine's idle behaviour, which isn't razor-sharp either.
 */
const IDLE_RAMP_RPM = 150;

/** Piecewise-linear lookup; ramped to 0 just below idle (see `IDLE_RAMP_RPM`), 0 above `redlineRpm` (hard ignition cut), holds the end value between the last curve point and redline. */
function torqueAt(rpm: number, p: DrivetrainParams): number {
  if (rpm > p.redlineRpm) return 0;
  if (rpm < p.idleRpm) {
    if (rpm < p.idleRpm - IDLE_RAMP_RPM) return 0;
    const t = (rpm - (p.idleRpm - IDLE_RAMP_RPM)) / IDLE_RAMP_RPM;
    return p.torqueCurve[0].torqueNm * t;
  }
  const curve = p.torqueCurve;
  if (rpm <= curve[0].rpm) return curve[0].torqueNm;
  for (let i = 1; i < curve.length; i++) {
    if (rpm <= curve[i].rpm) {
      const a = curve[i - 1];
      const b = curve[i];
      const t = (rpm - a.rpm) / (b.rpm - a.rpm);
      return a.torqueNm + (b.torqueNm - a.torqueNm) * t;
    }
  }
  return curve[curve.length - 1].torqueNm;
}

export class Drivetrain {
  readonly params: DrivetrainParams;

  rpm: number;
  isStalled = false;
  isCranking = false;

  /** 1..gearRatios.length - the forward gear currently selected, remembered across reverse/stall so it resumes sensibly. */
  private forwardGear = 1;
  private reversingNow = false;
  private ignitionHeldS = 0;
  private shiftTimer = 0;
  private prevClutch = 1;
  /**
   * True from the first frame the pedal is actually pressed. Until then,
   * this car drives like an idealised automatic (rpm floored at idle,
   * force reads straight off the torque curve with no slip cap) rather
   * than modelling a manual clutch nobody is touching - a locked disk
   * launching a real, gutless 650cc engine from idle at full throttle
   * *would* bog or stall it (see `clutchCapacityNm`'s doc comment), which
   * is exactly the drama a player who opts into clutch play is after, but
   * is not something a player who has never touched the clutch key signed
   * up for by just holding the accelerator - and it's not something any
   * pre-existing caller of this physics engine (tests included) expects
   * either. Pressing the pedal even once opts into the full model,
   * stalling included, for good.
   */
  private everUsedClutch = false;

  constructor(params: Partial<DrivetrainParams> = {}) {
    this.params = { ...DEFAULT_DRIVETRAIN_PARAMS, ...params };
    this.rpm = this.params.idleRpm;
  }

  /** -1 while reversing, 0 while stalled, else the forward gear 1..N - what the HUD should show. */
  get gear(): number {
    if (this.isStalled) return 0;
    return this.reversingNow ? -1 : this.forwardGear;
  }

  private combinedRatio(): number {
    const p = this.params;
    return this.reversingNow ? p.reverseRatio * p.finalDrive : p.gearRatios[this.forwardGear - 1] * p.finalDrive;
  }

  /** Engine RPM implied by wheel speed through the current gear - what the engine would be turning at if the clutch were fully locked, right now, in this gear. */
  private wheelImpliedRpm(vf: number): number {
    const p = this.params;
    const wheelAngularSpeed = Math.abs(vf) / p.wheelRadius; // rad/s
    return ((wheelAngularSpeed * 60) / (2 * Math.PI)) * this.combinedRatio();
  }

  update(dt: number, input: DrivetrainInput, vf: number): DrivetrainOutput {
    const p = this.params;
    this.reversingNow = input.reversing;
    const engagement = clamp(input.clutch, 0, 1);
    if (engagement < 0.98) this.everUsedClutch = true;

    if (this.isStalled) {
      this.updateStalled(dt, input);
      return input.reversing ? { wheelForce: 0, shockForce: 0 } : this.stalledWheelForce(vf);
    }
    this.isCranking = false;

    // Automatic box: only shifts while the clutch is meaningfully taking
    // power (a slipped/pressed clutch shouldn't be hunting for a gear), and
    // never while reversing (there is no forward gear to hunt for there).
    if (!input.reversing) {
      if (this.shiftTimer > 0) {
        this.shiftTimer = Math.max(0, this.shiftTimer - dt);
      } else if (engagement > 0.5) {
        if (this.rpm > p.shiftUpRpm && this.forwardGear < p.gearRatios.length) {
          this.forwardGear += 1;
          this.shiftTimer = p.shiftLagS;
        } else if (this.rpm < p.shiftDownRpm && this.forwardGear > 1 && input.throttle > 0.3) {
          this.forwardGear -= 1;
          this.shiftTimer = p.shiftLagS;
        }
      }
    }
    const midShift = this.shiftTimer > 0;
    // Torque delivery suppressed mid-shift (a quick auto-clutch blip): the
    // engine free-revs for a beat instead of the ratio changing as an
    // instant force teleport.
    const effectiveEngagement = midShift ? 0 : engagement;

    // Idle-air governor: a control loop that corrects RPM toward idle,
    // kept separate from the torque curve because the curve itself rises
    // too fast just past idle to give a naturally stable idle point on its
    // own (any throttle fraction big enough to hold 900rpm against
    // friction is also big enough to run away toward the curve's much
    // higher free-rev ceiling). Always active, not just off-throttle: the
    // torque curve is hard-zeroed below `idleRpm` regardless of throttle
    // (spec: "below idle the engine generates no power"), which is an
    // unrecoverable trap on its own the instant RPM dips even slightly
    // under idle for any reason (friction wins, curve gives 0 forever
    // after, throttle or not) - the governor is what pulls it back over
    // that line so the accelerator can take over again. Capped well below
    // `clutchCapacityNm` so a hard clutch-drop with no throttle still
    // overwhelms it and stalls the engine, and small enough relative to
    // the curve's real output that it's negligible drag once actually
    // under throttle above idle.
    const idleGovernorTorque = clamp((p.idleRpm - this.rpm) * p.idleGovernorGain, -p.idleGovernorMaxNm, p.idleGovernorMaxNm);

    const wheelRpm = this.wheelImpliedRpm(vf);
    let slipRpm: number;
    let clutchTorque: number;

    if (!this.everUsedClutch) {
      // Idealised automatic: rigidly locked, floored at idle so a launch
      // from a dead stop isn't torque(rpm=0)=0 forever - see the doc
      // comment on `everUsedClutch`.
      this.rpm = clamp(Math.max(wheelRpm, p.idleRpm), 0, p.redlineRpm * 1.02);
      slipRpm = 0;
      clutchTorque = 0;
    } else {
      // Single torque-balance model, whether the clutch is fully pressed,
      // fully released, or anywhere in between - no separate "locked" vs
      // "free" branch. `clutchTorque` is the disk's reaction torque,
      // positive when the engine is spinning faster than the wheels imply
      // (driving them forward, or launching from a stop) and negative when
      // the wheels are spinning faster than the engine (coasting
      // off-throttle drags the engine up via engine braking). It saturates
      // at `clutchCapacityNm` instead of forcing a hard lock, which is what
      // makes a real launch (or a clutch kick) something the engine's own
      // torque has to win rather than a free teleport of RPM.
      slipRpm = this.rpm - wheelRpm;
      clutchTorque = effectiveEngagement * clamp(slipRpm / p.clutchSlipRangeRpm, -1, 1) * p.clutchCapacityNm;

      const engineTorque = torqueAt(this.rpm, p) * input.throttle;
      const frictionTorque = p.engineFrictionBase + this.rpm * p.engineFrictionCoeff;
      const netEngineTorque = engineTorque + idleGovernorTorque - clutchTorque - frictionTorque;
      this.rpm += (netEngineTorque / p.flywheelInertia) * (60 / (2 * Math.PI)) * dt;
      this.rpm = clamp(this.rpm, 0, p.redlineRpm * 1.02);
    }

    // Clutch kick: snapping the pedal back up while the engine is spinning
    // far above what the wheels currently imply dumps that RPM gap through
    // the driveline as a shock, on top of (not instead of) the ordinary
    // clutch torque above - exactly the impulse that breaks rear grip on
    // purpose. Suppressed while reversing (no force is fed to CarPhysics
    // there anyway, see below).
    let shockForce = 0;
    if (!input.reversing && this.prevClutch < 0.3 && engagement > 0.7 && slipRpm > p.clutchKickDeltaRpm) {
      shockForce = p.clutchKickShockForce;
    }
    this.prevClutch = engagement;

    // Stall check: a mostly-released clutch with the engine bogged below
    // idle-worthy RPM means the load (via `clutchTorque` above) is winning
    // against whatever torque the engine has - the same reason a real
    // manual stalls when you release the clutch from a stop without gas,
    // not a bolted-on rule.
    if (engagement > 0.7 && this.rpm < p.stallRpm) {
      this.isStalled = true;
      this.rpm = 0;
      return { wheelForce: 0, shockForce: 0 };
    }

    if (input.reversing) {
      // RPM/gear tracked above purely for the HUD - CarPhysics owns the
      // actual reverse propulsion force (see the class doc comment).
      return { wheelForce: 0, shockForce: 0 };
    }

    const combinedRatio = this.combinedRatio();
    // Automatic mode reads force straight off the torque curve (matches
    // this project's original flat-`enginePower` model's shape: zero at
    // zero throttle, no engine braking modelled) - the manual model instead
    // delivers whatever the clutch disk is actually transmitting.
    const drivingTorque = this.everUsedClutch ? clutchTorque : torqueAt(this.rpm, p) * input.throttle;
    const wheelForce = (drivingTorque * combinedRatio) / p.wheelRadius + shockForce;

    return { wheelForce, shockForce };
  }

  private updateStalled(dt: number, input: DrivetrainInput): void {
    const p = this.params;
    if (input.ignition) {
      this.isCranking = true;
      this.ignitionHeldS += dt;
      if (this.ignitionHeldS >= p.ignitionHoldS) {
        this.isStalled = false;
        this.isCranking = false;
        this.ignitionHeldS = 0;
        this.rpm = p.idleRpm;
        this.forwardGear = 1;
      }
    } else {
      this.isCranking = false;
      this.ignitionHeldS = 0;
    }
  }

  /** Coasts with engine braking at a fixed, maximal rate while dead - no RPM to compute a real friction torque from. */
  private stalledWheelForce(vf: number): DrivetrainOutput {
    const p = this.params;
    const wheelForce = Math.abs(vf) > 0.01 ? -p.stalledEngineBrakingForce * Math.sign(vf) : 0;
    return { wheelForce, shockForce: 0 };
  }
}

export { torqueAt as engineTorqueAt };
