import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { ChaseCamera } from "./ChaseCamera";

describe("ChaseCamera follow distance at speed (regression)", () => {
  it("settles back near distanceBehind even at high sustained speed, not just at a standstill", () => {
    // Caught in-browser: without velocity feedforward, an exponential-decay
    // follow has a *steady-state* lag of (speed / followRate) behind a
    // constantly-moving target - at this game's ~50 m/s top speed and the
    // default followRate=7, that's ~7m of extra distance on top of the 6m
    // base, nearly doubling it and making the car look tiny/mis-framed.
    const camera = new ChaseCamera(16 / 9);
    const carPos = new Vector3(0, 0, 0);
    const dt = 1 / 60;
    const speed = 50; // m/s, roughly this car's top speed
    const forwardX = 0;
    const forwardZ = -1; // Three.js convention: heading 0 faces -Z

    // Drive in a straight line at constant speed for a few seconds -
    // enough for the exponential smoothing to reach steady state.
    for (let i = 0; i < 60 * 4; i++) {
      carPos.addScaledVector(new Vector3(forwardX, 0, forwardZ), speed * dt);
      camera.update(dt, carPos, forwardX, forwardZ, forwardX * speed, forwardZ * speed, 0);
    }

    const dist = camera.camera.position.distanceTo(carPos);
    const expectedDist = Math.hypot(camera.params.distanceBehind, camera.params.heightAbove);
    expect(Math.abs(dist - expectedDist)).toBeLessThan(0.5);
  });
});
