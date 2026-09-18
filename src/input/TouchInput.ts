import type { CarInput } from "../physics/CarPhysics";
import type { InputSource } from "./InputManager";

type ButtonKey = "left" | "right" | "gas" | "brake" | "handbrake" | "clutch" | "ignition";

const LAYOUT: Record<ButtonKey, { label: string; style: Partial<CSSStyleDeclaration> }> = {
  left: { label: "◀", style: { left: "18px", bottom: "26px" } },
  right: { label: "▶", style: { left: "94px", bottom: "26px" } },
  // Mirrors "handbrake" on the left side, same row - the other hand's
  // natural spot for the clutch, same reasoning as Shift vs. Space on
  // keyboard (see KeyboardInput.ts).
  clutch: { label: "CLU", style: { left: "18px", bottom: "102px" } },
  handbrake: { label: "HB", style: { right: "18px", bottom: "102px" } },
  brake: { label: "BRK", style: { right: "18px", bottom: "26px" } },
  gas: { label: "GAS", style: { right: "94px", bottom: "26px" } },
  // Only matters while stalled (hold ~2s to restart) - tucked out of the
  // way of the driving buttons above it.
  ignition: { label: "IGN", style: { right: "94px", bottom: "178px" } },
};

/**
 * On-screen touch controls as plain DOM buttons overlaid on the canvas -
 * deliberately not part of the 3D scene, so they stay crisp regardless of
 * the retro pass's internal render resolution. Each button tracks the set
 * of pointer ids currently pressing it so a finger dragging off one button
 * and releasing elsewhere still clears the right button (matches multi-touch
 * behaviour the original 2D prototype relied on).
 */
export class TouchInput implements InputSource {
  readonly active: boolean;
  private container: HTMLDivElement | null = null;
  private pressed: Partial<Record<ButtonKey, Set<number>>> = {};

  constructor(parent: HTMLElement = document.body) {
    this.active = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    if (!this.active) return;

    const container = document.createElement("div");
    container.style.position = "fixed";
    container.style.inset = "0";
    container.style.pointerEvents = "none";
    container.style.zIndex = "10";
    container.style.touchAction = "none";
    parent.appendChild(container);
    this.container = container;

    for (const key of Object.keys(LAYOUT) as ButtonKey[]) {
      this.buildButton(container, key);
    }
  }

  private buildButton(container: HTMLDivElement, key: ButtonKey): void {
    const { label, style } = LAYOUT[key];
    const el = document.createElement("div");
    el.textContent = label;
    Object.assign(el.style, {
      position: "absolute",
      width: "64px",
      height: "64px",
      borderRadius: "50%",
      background: "rgba(240, 236, 226, 0.18)",
      border: "2px solid rgba(240, 236, 226, 0.5)",
      color: "#f2eee6",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "sans-serif",
      fontSize: "18px",
      userSelect: "none",
      pointerEvents: "auto",
      touchAction: "none",
      ...style,
    });

    const ids = new Set<number>();
    this.pressed[key] = ids;

    el.addEventListener("pointerdown", (e) => {
      ids.add(e.pointerId);
      el.style.background = "rgba(240, 236, 226, 0.4)";
      e.preventDefault();
    });
    const release = (e: PointerEvent) => {
      ids.delete(e.pointerId);
      if (ids.size === 0) el.style.background = "rgba(240, 236, 226, 0.18)";
    };
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    el.addEventListener("pointerleave", release);

    container.appendChild(el);
  }

  private isPressed(key: ButtonKey): boolean {
    return (this.pressed[key]?.size ?? 0) > 0;
  }

  read(): CarInput {
    if (!this.active) return { throttle: 0, brake: 0, steer: 0, handbrake: 0, clutch: 1, ignition: false };
    const left = this.isPressed("left");
    const right = this.isPressed("right");
    return {
      throttle: this.isPressed("gas") ? 1 : 0,
      brake: this.isPressed("brake") ? 1 : 0,
      steer: (right ? 1 : 0) - (left ? 1 : 0),
      handbrake: this.isPressed("handbrake") ? 1 : 0,
      clutch: this.isPressed("clutch") ? 0 : 1,
      ignition: this.isPressed("ignition"),
    };
  }

  dispose(): void {
    this.container?.remove();
    this.container = null;
  }
}
