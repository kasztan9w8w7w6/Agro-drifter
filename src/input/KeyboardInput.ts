import type { CarInput } from "../physics/CarPhysics";
import type { InputSource } from "./InputManager";

const THROTTLE_KEYS = new Set(["ArrowUp", "KeyW"]);
const BRAKE_KEYS = new Set(["ArrowDown", "KeyS"]);
const LEFT_KEYS = new Set(["ArrowLeft", "KeyA"]);
const RIGHT_KEYS = new Set(["ArrowRight", "KeyD"]);
const HANDBRAKE_KEYS = new Set(["Space"]);

export class KeyboardInput implements InputSource {
  private held = new Set<string>();
  private onKeyDown = (e: KeyboardEvent) => {
    this.held.add(e.code);
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.held.delete(e.code);
  };

  constructor() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  read(): CarInput {
    const left = this.anyHeld(LEFT_KEYS);
    const right = this.anyHeld(RIGHT_KEYS);
    return {
      throttle: this.anyHeld(THROTTLE_KEYS) ? 1 : 0,
      brake: this.anyHeld(BRAKE_KEYS) ? 1 : 0,
      steer: (right ? 1 : 0) - (left ? 1 : 0),
      handbrake: this.anyHeld(HANDBRAKE_KEYS) ? 1 : 0,
    };
  }

  private anyHeld(keys: Set<string>): boolean {
    for (const k of keys) if (this.held.has(k)) return true;
    return false;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }
}
