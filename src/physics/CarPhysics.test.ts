import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { CarPhysics, type CarInput } from "./CarPhysics";

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
    // ballpark" - a looser tolerance here would have hidden the real bug
    // this test caught (20fps vs 60fps diverged by ~0.7 rad before fixing
    // the yaw-damping/steering smoothing to be dt-independent and adding
    // sub-stepping).
    expect(Math.abs(at60fps.heading - at20fps.heading)).toBeLessThan(0.01);
    expect(Math.abs(at60fps.speed - at20fps.speed)).toBeLessThan(0.1);
  });

  it("settles (straightens and slows) after inputs are released mid-drift", () => {
    const car = new CarPhysics();
    const dt = 1 / 60;
    for (let i = 0; i < 120; i++) {
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

describe("handbrake kick (instant drift-entry snap)", () => {
  it("tapping the handbrake while turning immediately registers as drifting - not gradually over several frames", () => {
    const car = new CarPhysics();
    const dt = 1 / 60;
    for (let i = 0; i < 120; i++) car.update(dt, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, "asphalt");
    expect(car.isDrifting).toBe(false);

    // First frame the handbrake is pressed while turning: should already count as drifting.
    car.update(dt, { throttle: 1, brake: 0, steer: 1, handbrake: 1 }, "asphalt");
    expect(car.isDrifting).toBe(true);
  });

  it("does not kick from a near-standstill", () => {
    const car = new CarPhysics();
    const dt = 1 / 60;
    car.update(dt, { throttle: 0, brake: 0, steer: 1, handbrake: 1 }, "asphalt");
    expect(Math.abs(car.heading)).toBeLessThan(0.05);
  });

  it("only fires on the rising edge, not every frame the handbrake stays held", () => {
    const withRepeatedPress = new CarPhysics();
    const heldOnce = new CarPhysics();
    const dt = 1 / 60;
    for (const car of [withRepeatedPress, heldOnce]) {
      for (let i = 0; i < 120; i++) car.update(dt, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, "asphalt");
    }
    for (let i = 0; i < 10; i++) heldOnce.update(dt, { throttle: 1, brake: 0, steer: 1, handbrake: 1 }, "asphalt");
    // Releasing and re-pressing the handbrake every frame would re-trigger the kick each time.
    for (let i = 0; i < 10; i++) {
      withRepeatedPress.update(dt, { throttle: 1, brake: 0, steer: 1, handbrake: 1 }, "asphalt");
      withRepeatedPress.update(dt, { throttle: 1, brake: 0, steer: 1, handbrake: 0 }, "asphalt");
    }
    // Sanity: the repeated-press car got far more kick impulses than the held one, so if
    // this assertion ever needs loosening it's a sign the edge-detection broke, not that
    // the exact bound is sacred.
    expect(Math.abs(withRepeatedPress.heading)).toBeGreaterThan(Math.abs(heldOnce.heading) * 1.3);
  });
});

describe("power oversteer (drift without the handbrake)", () => {
  it("throttle + hard steer alone, at speed, breaks rear grip enough to count as drifting", () => {
    const car = new CarPhysics();
    const dt = 1 / 60;
    // Build up speed in a straight line first (this car's ~1150kg/9200N
    // gives roughly 8 m/s^2 off the line, so 15 m/s needs ~1.9s / 115 frames
    // at 60fps - give it real headroom rather than cutting it close).
    for (let i = 0; i < 180; i++) {
      car.update(dt, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, "asphalt");
    }
    expect(car.speed).toBeGreaterThan(car.params.powerOversteerSpeedThreshold);

    let driftedWithoutHandbrake = false;
    for (let i = 0; i < 90; i++) {
      car.update(dt, { throttle: 1, brake: 0, steer: 1, handbrake: 0 }, "asphalt");
      if (car.isDrifting) driftedWithoutHandbrake = true;
    }
    expect(driftedWithoutHandbrake).toBe(true);
  });

  it("powerOversteerFactor=0 never induces a drift from throttle+steer alone", () => {
    const car = new CarPhysics({ powerOversteerFactor: 0 });
    const dt = 1 / 60;
    for (let i = 0; i < 90; i++) {
      car.update(dt, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, "asphalt");
    }
    let drifted = false;
    for (let i = 0; i < 90; i++) {
      car.update(dt, { throttle: 1, brake: 0, steer: 1, handbrake: 0 }, "asphalt");
      if (car.isDrifting) drifted = true;
    }
    expect(drifted).toBe(false);
  });
});
