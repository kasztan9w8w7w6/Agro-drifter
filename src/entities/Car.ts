import Phaser from "phaser";
import {
  CAR_ACCEL,
  CAR_BASE_GRIP,
  CAR_HANDBRAKE_GRIP,
  CAR_MAX_SPEED,
  CAR_MIN_TURN_SPEED_RATIO,
  CAR_NATURAL_DRAG,
  CAR_OFFROAD_DRAG,
  CAR_OFFROAD_GRIP,
  CAR_REVERSE_ACCEL,
  CAR_REVERSE_MAX_SPEED,
  CAR_TURN_RATE,
  DAMAGE_MAX,
  DRIFT_KICK,
  DRIFT_SLIP_RATIO,
} from "../config";

export interface CarInput {
  throttle: number; // -1..1 (reverse..forward)
  steer: number; // -1..1 (left..right)
  handbrake: boolean;
  handbrakeJustPressed: boolean;
}

/**
 * Arcade top-down drift model: velocity is decomposed into a forward and a
 * lateral (slip) component each step. Lateral speed bleeds off at "grip"
 * per second - low grip (handbrake, off-road, or damaged suspension) lets
 * it linger, which is what reads as a drift/powerslide instead of the car
 * simply turning. A slip-angle ratio (lateral vs forward speed) decides
 * whether the car currently counts as "drifting" for scoring and FX, and a
 * one-off angular "kick" on handbrake tap mimics a real handbrake turn
 * instead of just gradually losing grip.
 */
export class Car {
  sprite: Phaser.GameObjects.Image;
  heading = -Math.PI / 2; // pointing "up" the level
  velocity = new Phaser.Math.Vector2(0, 0);
  damage = 0;
  speedPenaltyTimer = 0; // pothole/glass slowdown window
  gripPenaltyTimer = 0; // popped-tire handling penalty window

  isDrifting = false;
  driftIntensity = 0; // 0..1, how hard the current slide is
  driftDistance = 0; // metres accumulated in the current continuous drift

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.sprite = scene.add.image(x, y, "car");
    this.sprite.setOrigin(0.5, 0.5);
  }

  get x(): number {
    return this.sprite.x;
  }

  get y(): number {
    return this.sprite.y;
  }

  get speed(): number {
    return this.velocity.length();
  }

  /** World position a little behind the car, for rear-wheel FX (smoke, skid marks). */
  rearAxlePoint(offsetSide: number): Phaser.Math.Vector2 {
    const forward = new Phaser.Math.Vector2(Math.cos(this.heading), Math.sin(this.heading));
    const lateral = new Phaser.Math.Vector2(-forward.y, forward.x);
    return new Phaser.Math.Vector2(this.x, this.y).add(forward.scale(-13)).add(lateral.scale(offsetSide));
  }

  applyDamage(amount: number): void {
    this.damage = Phaser.Math.Clamp(this.damage + amount, 0, DAMAGE_MAX);
  }

  /** Consumed by the scene right after a "drift ended" transition to award/reset scoring. */
  consumeDriftDistance(): number {
    const d = this.driftDistance;
    this.driftDistance = 0;
    return d;
  }

  update(dt: number, input: CarInput, onRoad: boolean): void {
    if (this.speedPenaltyTimer > 0) this.speedPenaltyTimer -= dt;
    if (this.gripPenaltyTimer > 0) this.gripPenaltyTimer -= dt;

    // Damage worsens handling: less top speed, more slop in the grip.
    const damageFactor = 1 - this.damage / (DAMAGE_MAX * 2);
    const forward = new Phaser.Math.Vector2(Math.cos(this.heading), Math.sin(this.heading));
    const lateral = new Phaser.Math.Vector2(-forward.y, forward.x);

    const forwardSpeed = this.velocity.dot(forward);
    const lateralSpeed = this.velocity.dot(lateral);

    const maxSpeed = (this.speedPenaltyTimer > 0 ? CAR_MAX_SPEED * 0.45 : CAR_MAX_SPEED) * Math.max(0.5, damageFactor);
    const accel = input.throttle >= 0 ? CAR_ACCEL : CAR_REVERSE_ACCEL;
    const cap = input.throttle >= 0 ? maxSpeed : CAR_REVERSE_MAX_SPEED;

    let newForwardSpeed = forwardSpeed + input.throttle * accel * dt;
    newForwardSpeed = Phaser.Math.Clamp(newForwardSpeed, -CAR_REVERSE_MAX_SPEED, cap);

    // Steering rate scales with speed (with a floor, so parking-lot turns
    // still work) so the car doesn't spin in place, and doesn't over-rotate
    // at top speed either.
    const speedRatio = Phaser.Math.Clamp(Math.abs(forwardSpeed) / CAR_MAX_SPEED, 0, 1);
    const steerResponse = CAR_MIN_TURN_SPEED_RATIO + (1 - CAR_MIN_TURN_SPEED_RATIO) * speedRatio;
    const turnDir = forwardSpeed >= 0 ? 1 : -1;
    this.heading += input.steer * CAR_TURN_RATE * steerResponse * turnDir * dt;

    // A handbrake *tap* while turning gives an instant yaw kick, like
    // stomping the pedal to snap the tail out, instead of only a slow
    // grip fade-out.
    if (input.handbrakeJustPressed && Math.abs(input.steer) > 0.1 && speedRatio > 0.25) {
      this.heading += Math.sign(input.steer) * turnDir * DRIFT_KICK * 0.15;
    }

    let grip = onRoad ? CAR_BASE_GRIP : CAR_OFFROAD_GRIP;
    if (this.gripPenaltyTimer > 0) grip *= 0.55;
    if (input.handbrake) grip = Math.min(grip, CAR_HANDBRAKE_GRIP);
    const gripThisFrame = Math.min(1, grip * dt);
    const newLateralSpeed = Phaser.Math.Linear(lateralSpeed, 0, gripThisFrame);

    this.velocity = forward.clone().scale(newForwardSpeed).add(lateral.clone().scale(newLateralSpeed));
    this.velocity.scale(onRoad ? CAR_NATURAL_DRAG : CAR_OFFROAD_DRAG);

    const slipRatio = Math.abs(newLateralSpeed) / (Math.abs(newForwardSpeed) + 40);
    this.isDrifting = slipRatio > DRIFT_SLIP_RATIO && Math.abs(newForwardSpeed) > 40;
    this.driftIntensity = Phaser.Math.Clamp(slipRatio / (DRIFT_SLIP_RATIO * 2.2), 0, 1);
    if (this.isDrifting) {
      this.driftDistance += Math.abs(newForwardSpeed) * dt;
    }

    this.sprite.x += this.velocity.x * dt;
    this.sprite.y += this.velocity.y * dt;

    // Juice: a small forward/back squash under throttle/braking, and a
    // slight extra lean into the slide while drifting - purely visual,
    // layered on top of the physics heading.
    const squash = Phaser.Math.Clamp(input.throttle, -1, 1) * 0.035;
    this.sprite.setScale(1 - squash, 1 + squash);
    const lean = Phaser.Math.Clamp(-newLateralSpeed / 260, -0.22, 0.22);
    this.sprite.rotation = this.heading + Math.PI / 2 + lean * 0.5;
  }
}
