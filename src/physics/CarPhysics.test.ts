import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { CarPhysics, tireLateralForce, type CarInput } from "./CarPhysics";

function forwardVector(heading: number): Vector3 {
  // Three.js convention used throughout the game: an unrotated object's
  // front faces local -Z.
  return new Vector3(-Math.sin(heading), 0, -Math.cos(heading));
}

describe("steering convention (regression - this exact bug shipped once)", () => {
  it("steer=1 (right) turns the car toward whichever world side a chase camera actually renders as screen-right", () => {
    // Ground truth derived independently of CarPhysics, from Three.js's own
    // Matrix4.lookAt, using the same chase-camera placement main.ts uses
    // (camera behind the car, looking along its forward vector, up = +Y).
    // This is the "zero zgadywania" check: it doesn't trust any sign
    // convention decided by hand, it asks the actual renderer math.
    const camera = new PerspectiveCamera(70, 16 / 9, 0.1, 100);
    const forward = forwardVector(0);
    const carPos = new Vector3(0, 0, 0);
    camera.position.copy(carPos).addScaledVector(forward, -6);
    camera.position.y += 2.5;
    camera.lookAt(carPos.clone().addScaledVector(forward, 4));
    camera.updateMatrixWorld();

    const ndcPlusX = new Vector3(20, 1, 0).project(camera);
    const ndcMinusX = new Vector3(-20, 1, 0).project(camera);
    expect(ndcPlusX.x).toBeGreaterThan(ndcMinusX.x); // sanity: the two markers are on opposite screen sides
    const screenRightIsWorldPlusX = ndcPlusX.x > 0;

    // Drive with steer=1 (the "right" key) and see which world side the
    // nose actually swings toward.
    const car = new CarPhysics();
    const dt = 1 / 60;
    const input: CarInput = { throttle: 1, brake: 0, steer: 1, handbrake: 0 };
    for (let i = 0; i < 30; i++) car.update(dt, input, "asphalt");

    const newForward = forwardVector(car.heading);
    const noseSwungTowardPlusX = newForward.x > forward.x;

    expect(noseSwungTowardPlusX).toBe(screenRightIsWorldPlusX);
    // Human-readable companion assertion for the same fact: under this
    // engine's rotation.y/-Z-front convention, turning right means heading
    // goes negative (see the class-level doc comment in CarPhysics.ts).
    expect(car.heading).toBeLessThan(0);
  });

  it("steer=-1 (left) turns the opposite way", () => {
    const car = new CarPhysics();
    const dt = 1 / 60;
    const input: CarInput = { throttle: 1, brake: 0, steer: -1, handbrake: 0 };
    for (let i = 0; i < 30; i++) car.update(dt, input, "asphalt");
    expect(car.heading).toBeGreaterThan(0);
  });
});

describe("reverse steering (regression - reversing turned tighter than forward and drifted on its own)", () => {
  it("reverse top speed is capped - holding brake to back up doesn't climb to an unrealistic speed", () => {
    // No dedicated reverse gear exists (see the REST_EPS branch in step()) -
    // without a cap, reusing the brake's full stopping force to accelerate
    // backward reached >35 m/s (125+ km/h) in reverse before drag alone
    // caught up, which is both absurd for "hold brake to back up" and, as
    // the next test covers, past the speed range the reverse steering fix
    // was verified stable at.
    const car = new CarPhysics();
    const dt = 1 / 60;
    for (let i = 0; i < 300; i++) car.update(dt, { throttle: 0, brake: 1, steer: 0, handbrake: 0 }, "asphalt");
    expect(car.velocityZ).toBeGreaterThan(0); // confirms it's actually reversing by now
    expect(car.speed).toBeLessThanOrEqual(car.params.reverseTopSpeed + 0.5);
  });

  it("holding full steer while reversing settles into a controlled turn instead of spinning out", () => {
    // A steered front axle is stabilising when it *leads* (forward driving)
    // but behaves like a trailing caster once it's dragged behind instead
    // (reversing) - a real vehicle-dynamics effect, the same reason a
    // shopping trolley's front wheels flutter when pushed backward. Caught
    // from a player report of reversing turning far tighter than forward
    // and drifting with no handbrake involved: sustained full brake+steer
    // in reverse used to make the rear slip angle climb without bound
    // (measured reaching >1.2 rad, most of the way to this tyre model's
    // hard ceiling of pi/2, i.e. an effective spin-out), while the same
    // manoeuvre driving forward settles around ~0.3 rad and stays there.
    // Fixed with extra yaw damping specifically while reversing (ineffective
    // once vf >= 0, so forward handling is untouched) plus the reverse
    // speed cap above, together keeping reverse inside the range where that
    // damping was verified to hold the slip angle bounded.
    const car = new CarPhysics();
    const dt = 1 / 60;
    for (let i = 0; i < 180; i++) car.update(dt, { throttle: 0, brake: 1, steer: 0, handbrake: 0 }, "asphalt");

    let maxSlip = 0;
    for (let i = 0; i < 180; i++) {
      car.update(dt, { throttle: 0, brake: 1, steer: 1, handbrake: 0 }, "asphalt");
      maxSlip = Math.max(maxSlip, Math.abs(car.slipAngle));
    }
    // Comfortably below the old bug's >1.2 rad blow-up, and below this car's
    // own forward-driving saturation point (~0.3 rad, see the "grip-limited
    // cornering" test above) - reverse should feel at least as controlled
    // as forward, not more prone to sliding.
    expect(maxSlip).toBeLessThan(0.2);
  });
});

describe("tyre curve (simplified Pacejka: rises, peaks, then falls off)", () => {
  it("peaks exactly at maxForce when slip angle equals peakSlip", () => {
    const maxForce = 1000;
    const peakSlip = 0.11;
    expect(tireLateralForce(peakSlip, maxForce, peakSlip)).toBeCloseTo(maxForce, 5);
  });

  it("gives back LESS force well past the peak than AT the peak - this is what makes overcorrecting costly", () => {
    const maxForce = 1000;
    const peakSlip = 0.11;
    const atPeak = tireLateralForce(peakSlip, maxForce, peakSlip);
    const wayPast = tireLateralForce(peakSlip * 4, maxForce, peakSlip);
    expect(wayPast).toBeLessThan(atPeak * 0.6);
  });

  it("is antisymmetric: force always opposes/matches the sign of slip angle consistently", () => {
    const f = tireLateralForce(0.05, 1000, 0.11);
    const g = tireLateralForce(-0.05, 1000, 0.11);
    expect(g).toBeCloseTo(-f, 6);
  });
});

describe("grip-limited cornering (regression - the car once cornered tighter than its own tyres allow)", () => {
  it("cannot sustain cornering acceleration beyond roughly what mu*g provides, even at full lock", () => {
    // Caught by hand: the old integration re-derived world velocity from
    // (vf, vs) through the *new*, post-yaw heading every step. That silently
    // rotates the velocity vector along with the body regardless of actual
    // lateral force, letting the car "turn for free" - verified reaching
    // ~4g of apparent cornering acceleration on tyres that cap out under
    // 1g. Velocity must integrate from world-space force alone; yaw is a
    // separate, purely rotational update.
    const car = new CarPhysics();
    const dt = 1 / 60;
    for (let i = 0; i < 300; i++) car.update(dt, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, "asphalt");

    const maxPossibleG = Math.max(car.params.muFront, car.params.muRear) * car.params.gravity;
    let maxLateralAccelG = 0;
    let prevVx = car.velocityX;
    let prevVz = car.velocityZ;
    for (let i = 0; i < 60; i++) {
      car.update(dt, { throttle: 0.4, brake: 0, steer: 1, handbrake: 0 }, "asphalt");
      const ax = (car.velocityX - prevVx) / dt;
      const az = (car.velocityZ - prevVz) / dt;
      maxLateralAccelG = Math.max(maxLateralAccelG, Math.hypot(ax, az) / car.params.gravity);
      prevVx = car.velocityX;
      prevVz = car.velocityZ;
    }
    // Generous headroom (drag/braking transients can spike this briefly) -
    // the old bug blew past this by 4-5x, so this margin still catches it.
    expect(maxLateralAccelG).toBeLessThan(maxPossibleG * 1.8);
  });
});

describe("stability under sustained random input", () => {
  it("never produces NaN/Infinity or an unbounded speed over a long, varied input run", () => {
    const car = new CarPhysics();
    const dt = 1 / 60;
    let maxSpeed = 0;
    for (let i = 0; i < 60 * 60; i++) {
      const t = i * dt;
      const input: CarInput = {
        throttle: Math.max(0, Math.sin(t * 0.7)),
        brake: Math.max(0, -Math.sin(t * 1.3)),
        steer: Math.sin(t * 0.9 + 1) * (0.5 + 0.5 * Math.sin(t * 0.2)),
        handbrake: Math.sin(t * 0.37) > 0.6 ? 1 : 0,
      };
      car.update(dt, input, "asphalt");
      expect(Number.isFinite(car.x)).toBe(true);
      expect(Number.isFinite(car.z)).toBe(true);
      expect(Number.isFinite(car.heading)).toBe(true);
      maxSpeed = Math.max(maxSpeed, car.speed);
    }
    expect(maxSpeed).toBeLessThan(200);
  });

  it("behaves the same regardless of frame rate (dt-independence)", () => {
    const drive = (dt: number, steps: number) => {
      const car = new CarPhysics();
      for (let i = 0; i < steps; i++) {
        car.update(dt, { throttle: 1, brake: 0, steer: 0.6, handbrake: 0 }, "asphalt");
      }
      return car;
    };
    const at60fps = drive(1 / 60, 60 * 3);
    const at20fps = drive(1 / 20, 20 * 3);
    // update() internally sub-steps to a fixed resolution regardless of the
    // caller's dt, so these should match closely, not just "in the same
    // ballpark".
    expect(Math.abs(at60fps.heading - at20fps.heading)).toBeLessThan(0.01);
    expect(Math.abs(at60fps.speed - at20fps.speed)).toBeLessThan(0.1);
  });

  it("settles (straightens and slows) after inputs are released mid-drift", () => {
    const car = new CarPhysics();
    const dt = 1 / 60;
    for (let i = 0; i < 180; i++) {
      car.update(dt, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, "asphalt");
    }
    for (let i = 0; i < 60; i++) {
      car.update(dt, { throttle: 1, brake: 0, steer: 1, handbrake: 1 }, "asphalt");
    }
    const speedDuringDrift = car.speed;
    for (let i = 0; i < 300; i++) {
      car.update(dt, { throttle: 0, brake: 0, steer: 0, handbrake: 0 }, "asphalt");
    }
    expect(Math.abs(car.slipAngle)).toBeLessThan(0.02);
    expect(car.speed).toBeLessThan(speedDuringDrift);
  });
});

describe("precision at small inputs", () => {
  it("a small steering input at speed stays well under the tyre's peak slip - controllable, not twitchy", () => {
    const car = new CarPhysics();
    const dt = 1 / 60;
    for (let i = 0; i < 300; i++) car.update(dt, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, "asphalt");
    let maxSlip = 0;
    for (let i = 0; i < 120; i++) {
      car.update(dt, { throttle: 0.5, brake: 0, steer: 0.15, handbrake: 0 }, "asphalt");
      maxSlip = Math.max(maxSlip, Math.abs(car.slipAngle));
    }
    expect(maxSlip).toBeLessThan(car.params.rearPeakSlip);
  });
});

describe("handbrake drift (no scripted kick - purely from collapsed rear grip)", () => {
  it("turning with the handbrake held reaches the drift threshold within a few frames, growing from real grip loss", () => {
    const car = new CarPhysics();
    const dt = 1 / 60;
    for (let i = 0; i < 300; i++) car.update(dt, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, "asphalt");
    expect(car.isDrifting).toBe(false);

    let framesToDrift = -1;
    for (let i = 0; i < 30; i++) {
      car.update(dt, { throttle: 1, brake: 0, steer: 1, handbrake: 1 }, "asphalt");
      if (car.isDrifting && framesToDrift === -1) framesToDrift = i;
    }
    expect(framesToDrift).toBeGreaterThanOrEqual(0);
    expect(framesToDrift).toBeLessThan(20); // under ~0.33s - fast, but earned by physics, not scripted
  });
});

describe("friction circle: throttle mid-corner costs lateral grip (not an arbitrary formula)", () => {
  it("from an identical slipping state, one more step with throttle grows rear slip faster than coasting", () => {
    // Two cars driven through an *identical, deterministic* warmup into a
    // mildly slipping corner, then diverge for exactly one step - isolates
    // the friction circle's effect on that single step instead of letting
    // accumulated speed change (throttle building speed, which on its own
    // shrinks the slip *angle* for a given lateral velocity, via the
    // larger `speedEps` denominator in the slip formulas) swamp the much
    // smaller instantaneous grip-sharing effect. Warms up for under a
    // second, not several - the RPM/gear-limited Drivetrain (Drivetrain.ts)
    // delivers much less force once well into a higher gear at speed than
    // this model's old flat `enginePower` figure did, so by several seconds
    // in, that same swamping happens even at a fixed one-step comparison;
    // still-launching-in-1st-gear is where the friction circle's cost is
    // large relative to the tyres' own grip and clearly dominates.
    function toSlippingState() {
      const car = new CarPhysics();
      const dt = 1 / 60;
      for (let i = 0; i < 40; i++) car.update(dt, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, "asphalt");
      for (let i = 0; i < 10; i++) car.update(dt, { throttle: 0.3, brake: 0, steer: 1, handbrake: 0 }, "asphalt");
      return car;
    }
    const withThrottle = toSlippingState();
    const coasting = toSlippingState();
    const slipBefore = withThrottle.slipAngle;
    expect(coasting.slipAngle).toBeCloseTo(slipBefore, 6); // same deterministic setup

    const dt = 1 / 60;
    withThrottle.update(dt, { throttle: 1, brake: 0, steer: 1, handbrake: 0 }, "asphalt");
    coasting.update(dt, { throttle: 0, brake: 0, steer: 1, handbrake: 0 }, "asphalt");

    const deltaWithThrottle = Math.abs(withThrottle.slipAngle) - Math.abs(slipBefore);
    const deltaCoasting = Math.abs(coasting.slipAngle) - Math.abs(slipBefore);
    expect(deltaWithThrottle).toBeGreaterThan(deltaCoasting);
  });
});

describe("braking at a standstill (regression - held brake once made the car chatter in place)", () => {
  it("brake decelerates forward motion smoothly to a stop, then reverses without oscillating at the crossover", () => {
    // Caught from a player report of the *background* shaking whenever the
    // car came to a stop: brakeAndRollForce used to pick its direction from
    // Math.sign(vf || 1), a strong force with no limit on how far past
    // vf=0 it could push in a single (sub)step. Right at a standstill that
    // overshoot flipped the sign next step, which overshot back, forever -
    // a fast, tiny (sub-mm) oscillation in vf that's invisible on the car
    // itself but that the chase camera's velocity-lead look-at target (and
    // the retro pass's vertex snapping on top of that) turns into a
    // visible shake/flicker of everything else on screen.
    //
    // This game has no separate reverse throttle - holding brake once
    // essentially stopped is how you reverse - so the fix has to still let
    // speed climb smoothly *through* zero into reverse, just without ever
    // ticking back the *other* way once it's past. Sampled every frame
    // through the whole braking run (not a guessed frame count for "now
    // it's stopped, now it's reversing") so both halves get checked
    // however many frames each actually takes.
    const car = new CarPhysics();
    const dt = 1 / 60;
    for (let i = 0; i < 120; i++) car.update(dt, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, "asphalt");

    let prevVz = car.velocityZ; // starts negative (moving forward, heading 0)
    let sawNearStop = false;
    let sawReverse = false;
    for (let i = 0; i < 300; i++) {
      car.update(dt, { throttle: 0, brake: 1, steer: 0, handbrake: 0 }, "asphalt");
      // velocityZ must never increase (go back toward negative/forward)
      // once braking - it should decelerate toward zero, then keep
      // climbing into positive (reverse) territory, essentially
      // monotonically the whole way. A real oscillation (the original bug)
      // showed up here as a fast, repeated step back down after a step up,
      // sub-mm each time but every single frame - `-0.03` gives room for
      // the tiny, one-time settle as speed approaches `reverseTopSpeed`
      // (drag catching up with the capped force) without masking that.
      expect(car.velocityZ).toBeGreaterThanOrEqual(prevVz - 0.03);
      prevVz = car.velocityZ;
      // 0.25, not the tighter 0.05 this used to be: outer-frame samples are
      // only taken once per dt=1/60 call, but the crossing between "still
      // decelerating forward" and "now pushing backward" (REST_EPS) can
      // fall inside one of update()'s internal ~1/120s substeps - the
      // uncapped reverse push can carry velocityZ from comfortably negative
      // to comfortably positive within that single outer sample, skipping
      // right over a narrower window without ever oscillating. This is
      // sampling granularity, not the original chatter bug (which repeated
      // every frame, sub-mm each time, not a one-off ~0.1-0.2 m/s crossing).
      if (Math.abs(car.velocityZ) < 0.25) sawNearStop = true;
      if (car.velocityZ > 0.5) sawReverse = true;
    }
    expect(sawNearStop).toBe(true);
    expect(sawReverse).toBe(true);
  });
});

describe("speed-sensitive steering, Ackermann geometry, self-aligning torque", () => {
  it("reaches (near) full lock at low speed", () => {
    const car = new CarPhysics();
    const dt = 1 / 60;
    for (let i = 0; i < 60; i++) car.update(dt, { throttle: 0, brake: 0, steer: 1, handbrake: 0 }, "asphalt");
    expect(Math.abs(car.wheelAngle)).toBeGreaterThan(car.params.maxSteerAngle * 0.98);
  });

  it("caps the wheel angle to a much narrower band once up to speed", () => {
    const slow = new CarPhysics();
    const dt = 1 / 60;
    for (let i = 0; i < 60; i++) slow.update(dt, { throttle: 0, brake: 0, steer: 1, handbrake: 0 }, "asphalt");

    const fast = new CarPhysics();
    for (let i = 0; i < 300; i++) fast.update(dt, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, "asphalt");
    expect(fast.speedKmh).toBeGreaterThan(40); // comfortably past the curve's 10km/h reference point
    for (let i = 0; i < 60; i++) fast.update(dt, { throttle: 0, brake: 0, steer: 1, handbrake: 0 }, "asphalt");

    expect(Math.abs(fast.wheelAngle)).toBeLessThan(Math.abs(slow.wheelAngle));
    expect(Math.abs(fast.wheelAngle)).toBeLessThan(fast.params.maxSteerAngle * 0.8);
  });

  it("Ackermann: the inner wheel always turns more than the outer one, on both sides", () => {
    const dt = 1 / 60;
    const right = new CarPhysics();
    for (let i = 0; i < 60; i++) right.update(dt, { throttle: 0, brake: 0, steer: 1, handbrake: 0 }, "asphalt");
    const { left: rightTurnLeft, right: rightTurnRight } = right.ackermannWheelAngles;
    // Whichever side has the bigger magnitude is the inner wheel for this
    // turn - it must exceed |wheelAngle| itself, and the other side (outer)
    // must fall short of it, on both sides of a common turn centre.
    const [innerR, outerR] = Math.abs(rightTurnLeft) > Math.abs(rightTurnRight) ? [rightTurnLeft, rightTurnRight] : [rightTurnRight, rightTurnLeft];
    expect(Math.abs(innerR)).toBeGreaterThan(Math.abs(right.wheelAngle));
    expect(Math.abs(outerR)).toBeLessThan(Math.abs(right.wheelAngle));

    const left = new CarPhysics();
    for (let i = 0; i < 60; i++) left.update(dt, { throttle: 0, brake: 0, steer: -1, handbrake: 0 }, "asphalt");
    const { left: leftTurnLeft, right: leftTurnRight } = left.ackermannWheelAngles;
    const [innerL, outerL] = Math.abs(leftTurnLeft) > Math.abs(leftTurnRight) ? [leftTurnLeft, leftTurnRight] : [leftTurnRight, leftTurnLeft];
    expect(Math.abs(innerL)).toBeGreaterThan(Math.abs(left.wheelAngle));
    expect(Math.abs(outerL)).toBeLessThan(Math.abs(left.wheelAngle));
  });

  it("goes straight (both wheel angles 0) when not steering", () => {
    const car = new CarPhysics();
    expect(car.ackermannWheelAngles).toEqual({ left: 0, right: 0 });
  });

  it("self-aligning torque: mid-drift, the wheel angle biases toward countersteer even with no player steering input", () => {
    const car = new CarPhysics();
    const dt = 1 / 60;
    for (let i = 0; i < 300; i++) car.update(dt, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, "asphalt");
    for (let i = 0; i < 40; i++) car.update(dt, { throttle: 1, brake: 0, steer: 1, handbrake: 1 }, "asphalt");
    expect(car.isDrifting).toBe(true); // sanity: this manoeuvre actually drifts

    // Player lets go of steer entirely (0) for a few frames while still
    // drifting - a plain bicycle model would relax straight back toward
    // wheelAngle=0. This one should instead show a clear, nonzero bias
    // (the assist), well past ordinary smoothing lag.
    car.update(dt, { throttle: 1, brake: 0, steer: 0, handbrake: 1 }, "asphalt");
    expect(Math.abs(car.wheelAngle)).toBeGreaterThan(0.05);
  });
});

describe("drivetrain integration (RPM/gear telemetry, stalling, cranking, clutch kick)", () => {
  it("reports engine RPM and a forward gear while driving normally, never touching the clutch", () => {
    const car = new CarPhysics();
    const dt = 1 / 60;
    for (let i = 0; i < 120; i++) car.update(dt, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, "asphalt");
    expect(car.rpm).toBeGreaterThan(0);
    expect(car.gear).toBeGreaterThanOrEqual(1);
    expect(car.isStalled).toBe(false);
  });

  it("never stalls for a caller that never touches the clutch input (backward-compatible automatic mode)", () => {
    const car = new CarPhysics();
    const dt = 1 / 60;
    for (let i = 0; i < 120; i++) car.update(dt, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, "asphalt");
    for (let i = 0; i < 180; i++) car.update(dt, { throttle: 0, brake: 0, steer: 0, handbrake: 0 }, "asphalt");
    expect(car.isStalled).toBe(false);
  });

  it("stalls when the clutch is pressed then released at a standstill with no throttle, and reports gear 0", () => {
    const car = new CarPhysics();
    const dt = 1 / 60;
    car.update(dt, { throttle: 0, brake: 0, steer: 0, handbrake: 0, clutch: 0, ignition: false }, "asphalt");
    let stalledAt = -1;
    for (let i = 0; i < 120; i++) {
      car.update(dt, { throttle: 0, brake: 0, steer: 0, handbrake: 0, clutch: 1, ignition: false }, "asphalt");
      if (car.isStalled && stalledAt === -1) stalledAt = i;
    }
    expect(stalledAt).toBeGreaterThanOrEqual(0);
    expect(car.gear).toBe(0);
  });

  it("blocks every other input while the starter is cranking, and restarts only after the full ignition hold", () => {
    const car = new CarPhysics();
    const dt = 1 / 60;
    car.update(dt, { throttle: 0, brake: 0, steer: 0, handbrake: 0, clutch: 0, ignition: false }, "asphalt");
    for (let i = 0; i < 60; i++) car.update(dt, { throttle: 0, brake: 0, steer: 0, handbrake: 0, clutch: 1, ignition: false }, "asphalt");
    expect(car.isStalled).toBe(true);

    // Hold the starter while also flooring throttle+steer - none of that
    // should move the car until the engine actually catches.
    for (let i = 0; i < 130; i++) {
      car.update(dt, { throttle: 1, brake: 0, steer: 1, handbrake: 0, clutch: 0, ignition: true }, "asphalt");
    }
    expect(car.isStalled).toBe(false);
    // Blocked the whole time it was cranking - only the tail end of the
    // 130 frames (after the engine caught) could have moved it at all, so
    // total heading swing stays far below what 130 frames of full
    // throttle+steer would otherwise produce (see the steering-convention
    // tests above: ~30 frames alone pushes heading well past 0.3 rad).
    expect(Math.abs(car.heading)).toBeLessThan(0.1);
  });

  it("clutch kick: dumping the clutch from a big RPM gap gives a much larger one-step speed jump than an equally-timed smooth release", () => {
    const dt = 1 / 60;
    function revUp() {
      const car = new CarPhysics();
      car.update(dt, { throttle: 0, brake: 0, steer: 0, handbrake: 0, clutch: 0, ignition: false }, "asphalt");
      for (let i = 0; i < 90; i++) car.update(dt, { throttle: 1, brake: 0, steer: 0, handbrake: 0, clutch: 0, ignition: false }, "asphalt");
      return car;
    }
    const kicked = revUp();
    const speedBeforeKick = kicked.speed;
    kicked.update(dt, { throttle: 1, brake: 0, steer: 0, handbrake: 0, clutch: 1, ignition: false }, "asphalt");
    const kickJump = kicked.speed - speedBeforeKick;

    const smooth = revUp();
    const speedBeforeSmooth = smooth.speed;
    // Barely lets the pedal up - nowhere near the "released" threshold the
    // kick needs, so no shock fires, just the ordinary slipping-clutch force.
    smooth.update(dt, { throttle: 1, brake: 0, steer: 0, handbrake: 0, clutch: 0.05, ignition: false }, "asphalt");
    const smoothJump = smooth.speed - speedBeforeSmooth;

    expect(kickJump).toBeGreaterThan(smoothJump * 5);
  });

  it("shows gear -1 while backing up under the brake-to-reverse convention", () => {
    const car = new CarPhysics();
    const dt = 1 / 60;
    for (let i = 0; i < 180; i++) car.update(dt, { throttle: 0, brake: 1, steer: 0, handbrake: 0 }, "asphalt");
    expect(car.velocityZ).toBeGreaterThan(0.5); // confirms it's actually reversing
    expect(car.gear).toBe(-1);
  });
});
