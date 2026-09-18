import { describe, expect, it } from "vitest";
import { Drivetrain, engineTorqueAt, DEFAULT_DRIVETRAIN_PARAMS } from "./Drivetrain";

const dt = 1 / 60;
const ZERO = { throttle: 0, clutch: 1, ignition: false, reversing: false };
const PRESS_CLUTCH = { throttle: 0, clutch: 0, ignition: false, reversing: false };

/** Presses the clutch once (opts into the manual model, see `everUsedClutch` in Drivetrain.ts) then releases it - a normal "sat there with the clutch down, then let it up" moment, which is the only way to reach the fully-manual stalling behaviour these tests target. A default caller who never touches the clutch key at all stays in the backward-compatible automatic mode instead (covered separately below) and can never stall. */
function pressThenReleaseClutch(car: Drivetrain, vf = 0): void {
  car.update(dt, PRESS_CLUTCH, vf);
  car.update(dt, ZERO, vf);
}

describe("torque curve (idle cut, LUT interpolation, redline cut)", () => {
  it("is exactly zero below idle rpm", () => {
    expect(engineTorqueAt(500, DEFAULT_DRIVETRAIN_PARAMS)).toBe(0);
  });

  it("is exactly zero above redline (hard ignition cut)", () => {
    expect(engineTorqueAt(6501, DEFAULT_DRIVETRAIN_PARAMS)).toBe(0);
    expect(engineTorqueAt(9000, DEFAULT_DRIVETRAIN_PARAMS)).toBe(0);
  });

  it("interpolates linearly between LUT points and peaks at the documented peak-torque point", () => {
    const p = DEFAULT_DRIVETRAIN_PARAMS;
    const at2500 = engineTorqueAt(2500, p); // halfway between the 2000 and 3000 LUT points
    expect(at2500).toBeCloseTo((42 + 50) / 2, 5);
    const peak = Math.max(...p.torqueCurve.map((pt) => pt.torqueNm));
    expect(engineTorqueAt(4000, p)).toBeCloseTo(peak, 5);
  });
});

describe("free-revving (clutch fully pressed)", () => {
  it("throttle with the clutch down revs the engine up toward redline, rate-limited by flywheel inertia (not instant)", () => {
    const dt2 = new Drivetrain();
    const rpmAfterOneStep: number[] = [];
    for (let i = 0; i < 150; i++) {
      dt2.update(dt, { throttle: 1, clutch: 0, ignition: false, reversing: false }, 0);
      rpmAfterOneStep.push(dt2.rpm);
    }
    // Climbs, but not instantly to redline on the very first step - flywheel
    // inertia must rate-limit it.
    expect(rpmAfterOneStep[0]).toBeLessThan(DEFAULT_DRIVETRAIN_PARAMS.redlineRpm * 0.5);
    expect(dt2.rpm).toBeGreaterThan(DEFAULT_DRIVETRAIN_PARAMS.redlineRpm * 0.8);
    expect(dt2.rpm).toBeLessThanOrEqual(DEFAULT_DRIVETRAIN_PARAMS.redlineRpm * 1.02 + 1e-6);
  });

  it("wheel speed has zero effect on rpm while the clutch is fully pressed", () => {
    const stopped = new Drivetrain();
    const moving = new Drivetrain();
    for (let i = 0; i < 60; i++) {
      stopped.update(dt, { throttle: 0.5, clutch: 0, ignition: false, reversing: false }, 0);
      moving.update(dt, { throttle: 0.5, clutch: 0, ignition: false, reversing: false }, 25);
    }
    expect(stopped.rpm).toBeCloseTo(moving.rpm, 3);
  });
});

describe("stalling and ignition (regression target: gear engaged + clutch up + rpm < 500 -> dead engine)", () => {
  it("releasing the clutch at a standstill with no throttle stalls the engine", () => {
    const car = new Drivetrain();
    pressThenReleaseClutch(car);
    let stalledAt = -1;
    for (let i = 0; i < 120; i++) {
      car.update(dt, ZERO, 0);
      if (car.isStalled && stalledAt === -1) stalledAt = i;
    }
    expect(stalledAt).toBeGreaterThanOrEqual(0);
    expect(car.rpm).toBe(0);
    expect(car.gear).toBe(0);
  });

  it("never stalls while the clutch key has never been touched (backward-compatible automatic mode)", () => {
    const car = new Drivetrain();
    for (let i = 0; i < 180; i++) {
      car.update(dt, ZERO, 0);
    }
    expect(car.isStalled).toBe(false);
    expect(car.rpm).toBeGreaterThanOrEqual(DEFAULT_DRIVETRAIN_PARAMS.idleRpm);
  });

  it("does not stall while the clutch is held down, even at a dead stop with no throttle", () => {
    const car = new Drivetrain();
    for (let i = 0; i < 180; i++) {
      car.update(dt, PRESS_CLUTCH, 0);
    }
    expect(car.isStalled).toBe(false);
  });

  it("restarts only after holding ignition for the full 2 seconds, and resets rpm/gear", () => {
    const car = new Drivetrain();
    pressThenReleaseClutch(car);
    for (let i = 0; i < 60; i++) car.update(dt, ZERO, 0); // stall it
    expect(car.isStalled).toBe(true);

    // Just under 2s of holding ignition: still stalled.
    for (let i = 0; i < 60 * 2 - 3; i++) {
      car.update(dt, { throttle: 0, clutch: 1, ignition: true, reversing: false }, 0);
    }
    expect(car.isStalled).toBe(true);
    expect(car.isCranking).toBe(true);

    // Keep holding, clutch pressed this time so the instant it restarts it
    // idles freely instead of immediately re-stalling on a released clutch
    // at 0 wheel speed (a separate, already-covered scenario above).
    let restartedAt = -1;
    for (let i = 0; i < 10; i++) {
      car.update(dt, { throttle: 0, clutch: 0, ignition: true, reversing: false }, 0);
      if (!car.isStalled && restartedAt === -1) restartedAt = i;
    }
    expect(restartedAt).toBeGreaterThanOrEqual(0);
    expect(car.isStalled).toBe(false);
    expect(car.gear).toBe(1);
  });

  it("releasing ignition early resets the crank timer instead of banking progress", () => {
    const car = new Drivetrain();
    pressThenReleaseClutch(car);
    for (let i = 0; i < 60; i++) car.update(dt, ZERO, 0); // stall it

    for (let i = 0; i < 60; i++) car.update(dt, { throttle: 0, clutch: 1, ignition: true, reversing: false }, 0); // 1s of cranking
    car.update(dt, { throttle: 0, clutch: 1, ignition: false, reversing: false }, 0); // let go early

    for (let i = 0; i < 60; i++) car.update(dt, { throttle: 0, clutch: 1, ignition: true, reversing: false }, 0); // another 1s - shouldn't be enough
    expect(car.isStalled).toBe(true);
  });

  it("coasts under fixed engine braking while stalled and moving", () => {
    const car = new Drivetrain();
    pressThenReleaseClutch(car);
    for (let i = 0; i < 60; i++) car.update(dt, ZERO, 0); // stall it
    const { wheelForce } = car.update(dt, ZERO, 10); // still moving forward despite being stalled
    expect(wheelForce).toBeLessThan(0); // opposes forward motion
  });
});

describe("clutch kick (regression target: snapping the clutch shut at a big rpm gap fires a shock)", () => {
  it("fires a one-step shock when the clutch is slammed shut with the engine held far above wheel-implied rpm", () => {
    const car = new Drivetrain();
    // Rev it up with the clutch down while stationary.
    for (let i = 0; i < 90; i++) car.update(dt, { throttle: 1, clutch: 0, ignition: false, reversing: false }, 0);
    expect(car.rpm).toBeGreaterThan(4000); // comfortably more than 3000 rpm above the ~0 the (stationary) wheels imply

    const { shockForce } = car.update(dt, { throttle: 1, clutch: 1, ignition: false, reversing: false }, 0);
    expect(shockForce).toBeGreaterThan(0);
    expect(shockForce).toBe(DEFAULT_DRIVETRAIN_PARAMS.clutchKickShockForce);
  });

  it("does not fire from a smooth, gradual clutch release at the same rpm gap", () => {
    const car = new Drivetrain();
    for (let i = 0; i < 90; i++) car.update(dt, { throttle: 1, clutch: 0, ignition: false, reversing: false }, 0);
    expect(car.rpm).toBeGreaterThan(4000);

    let sawShock = false;
    for (let i = 1; i <= 20; i++) {
      const { shockForce } = car.update(dt, { throttle: 1, clutch: i / 20, ignition: false, reversing: false }, 0);
      if (shockForce > 0) sawShock = true;
    }
    expect(sawShock).toBe(false);
  });

  it("does not fire while reversing", () => {
    const car = new Drivetrain();
    for (let i = 0; i < 90; i++) car.update(dt, { throttle: 1, clutch: 0, ignition: false, reversing: true }, 0);
    const { shockForce, wheelForce } = car.update(dt, { throttle: 1, clutch: 1, ignition: false, reversing: true }, 0);
    expect(shockForce).toBe(0);
    expect(wheelForce).toBe(0); // reverse propulsion is never this class's job, see CarPhysics
  });
});

describe("automatic gearbox", () => {
  it("upshifts as rpm climbs past the shift-up threshold, and never exceeds the top gear", () => {
    const car = new Drivetrain();
    const dt2 = 1 / 60;
    let vf = 0;
    let sawUpshift = false;
    for (let i = 0; i < 60 * 20; i++) {
      const before = car.gear;
      // Ease the clutch in over the first second, like an actual launch,
      // rather than dumping it instantly at idle - dumping a clutch at
      // idle with no rpm built up stalls a real car too (see the stalling
      // tests above), this test is about the gearbox, not that.
      const clutch = Math.min(1, i / 60);
      const { wheelForce } = car.update(dt2, { throttle: 1, clutch, ignition: false, reversing: false }, vf);
      vf += (wheelForce / 600) * dt2; // same ballpark mass as the real car, just to get wheel speed moving
      if (car.gear > before) sawUpshift = true;
    }
    expect(sawUpshift).toBe(true);
    expect(car.gear).toBeLessThanOrEqual(DEFAULT_DRIVETRAIN_PARAMS.gearRatios.length);
  });
});
