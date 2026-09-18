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
    // 1s+ of accumulated speed change (throttle building speed, which on
    // its own shrinks the slip *angle* for a given lateral velocity)
    // swamp the much smaller instantaneous grip-sharing effect.
    function toSlippingState() {
      const car = new CarPhysics();
      const dt = 1 / 60;
      for (let i = 0; i < 300; i++) car.update(dt, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, "asphalt");
      for (let i = 0; i < 10; i++) car.update(dt, { throttle: 0.3, brake: 0, steer: 0.6, handbrake: 0 }, "asphalt");
      return car;
    }
    const withThrottle = toSlippingState();
    const coasting = toSlippingState();
    const slipBefore = withThrottle.slipAngle;
    expect(coasting.slipAngle).toBeCloseTo(slipBefore, 6); // same deterministic setup

    const dt = 1 / 60;
    withThrottle.update(dt, { throttle: 1, brake: 0, steer: 0.6, handbrake: 0 }, "asphalt");
    coasting.update(dt, { throttle: 0, brake: 0, steer: 0.6, handbrake: 0 }, "asphalt");

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
      // climbing into positive (reverse) territory, monotonically the
      // whole way. A real oscillation would show up here as a step back
      // down after a step up.
      expect(car.velocityZ).toBeGreaterThanOrEqual(prevVz - 1e-6);
      prevVz = car.velocityZ;
      if (Math.abs(car.velocityZ) < 0.05) sawNearStop = true;
      if (car.velocityZ > 0.5) sawReverse = true;
    }
    expect(sawNearStop).toBe(true);
    expect(sawReverse).toBe(true);
  });
});
