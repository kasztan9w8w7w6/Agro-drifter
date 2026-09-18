import type { CarInput } from "../physics/CarPhysics";

/**
 * Single {throttle, brake, steer, handbrake} abstraction fed by whichever
 * input sources are active (keyboard, touch, and later gamepad) - the
 * physics and camera code never need to know which one produced a given
 * frame's numbers. Sources are combined by taking the strongest signal per
 * axis, so e.g. touch and keyboard can't cancel each other out.
 */
export interface InputSource {
  read(): CarInput;
  dispose(): void;
}

const ZERO_INPUT: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };

export class InputManager {
  private sources: InputSource[] = [];

  add(source: InputSource): void {
    this.sources.push(source);
  }

  read(): CarInput {
    let out = ZERO_INPUT;
    for (const source of this.sources) {
      const s = source.read();
      out = {
        throttle: Math.max(out.throttle, s.throttle),
        brake: Math.max(out.brake, s.brake),
        // Strongest-magnitude steer wins, not max() (which would bias right).
        steer: Math.abs(s.steer) > Math.abs(out.steer) ? s.steer : out.steer,
        handbrake: Math.max(out.handbrake, s.handbrake),
      };
    }
    return out;
  }

  dispose(): void {
    for (const source of this.sources) source.dispose();
    this.sources = [];
  }
}
