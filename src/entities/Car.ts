import Phaser from "phaser";
import {
  CAR_ACCEL,
  CAR_BASE_GRIP,
  CAR_HANDBRAKE_GRIP,
  CAR_MAX_SPEED,
  CAR_NATURAL_DRAG,
  CAR_REVERSE_ACCEL,
  CAR_REVERSE_MAX_SPEED,
  CAR_TURN_RATE,
  DAMAGE_MAX,
} from "../config";

export interface CarInput {
  throttle: number; // -1..1 (reverse..forward)
  steer: number; // -1..1 (left..right)
  handbrake: boolean;
}

/**
 * Arcade top-down drift model: velocity is decomposed into a forward and a
 * lateral (slip) component each step. Lateral speed bleeds off at "grip"
 * per second - a low grip (handbrake, or damage) lets it linger, which is
 * what reads as a drift/powerslide instead of the car simply turning.
 */
export class Car {
  sprite: Phaser.GameObjects.Image;
  heading = -Math.PI / 2; // pointing "up" the level
  velocity = new Phaser.Math.Vector2(0, 0);
  damage = 0;
  speedPenaltyTimer = 0; // pothole/glass slowdown window
  gripPenaltyTimer = 0; // popped-tire handling penalty window

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

  applyDamage(amount: number): void {
    this.damage = Phaser.Math.Clamp(this.damage + amount, 0, DAMAGE_MAX);
  }

  update(dt: number, input: CarInput): void {
    if (this.speedPenaltyTimer > 0) this.speedPenaltyTimer -= dt;
    if (this.gripPenaltyTimer > 0) this.gripPenaltyTimer -= dt;

    const damageFactor = 1 - this.damage / (DAMAGE_MAX * 2); // handling worsens with damage
    const forward = new Phaser.Math.Vector2(Math.cos(this.heading), Math.sin(this.heading));
    const lateral = new Phaser.Math.Vector2(-forward.y, forward.x);

    const forwardSpeed = this.velocity.dot(forward);
    const lateralSpeed = this.velocity.dot(lateral);

    const maxSpeed = (this.speedPenaltyTimer > 0 ? CAR_MAX_SPEED * 0.45 : CAR_MAX_SPEED) * Math.max(0.5, damageFactor);
    const accel = input.throttle >= 0 ? CAR_ACCEL : CAR_REVERSE_ACCEL;
    const cap = input.throttle >= 0 ? maxSpeed : CAR_REVERSE_MAX_SPEED;

    let newForwardSpeed = forwardSpeed + input.throttle * accel * dt;
    newForwardSpeed = Phaser.Math.Clamp(newForwardSpeed, -CAR_REVERSE_MAX_SPEED, cap);

    // Steering rate scales with speed so the car doesn't spin in place.
    const speedRatio = Phaser.Math.Clamp(Math.abs(forwardSpeed) / CAR_MAX_SPEED, 0, 1);
    const turnDir = forwardSpeed >= 0 ? 1 : -1;
    this.heading += input.steer * CAR_TURN_RATE * speedRatio * turnDir * dt;

    const grip = this.gripPenaltyTimer > 0 ? CAR_HANDBRAKE_GRIP * 1.4 : input.handbrake ? CAR_HANDBRAKE_GRIP : CAR_BASE_GRIP;
    const gripThisFrame = Math.min(1, grip * dt);
    const newLateralSpeed = Phaser.Math.Linear(lateralSpeed, 0, gripThisFrame);

    this.velocity = forward.clone().scale(newForwardSpeed).add(lateral.clone().scale(newLateralSpeed));
    this.velocity.scale(CAR_NATURAL_DRAG);

    this.sprite.x += this.velocity.x * dt;
    this.sprite.y += this.velocity.y * dt;
    this.sprite.rotation = this.heading + Math.PI / 2;
  }
}
