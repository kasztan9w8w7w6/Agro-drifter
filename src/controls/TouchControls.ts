import Phaser from "phaser";

export interface TouchState {
  left: boolean;
  right: boolean;
  gas: boolean;
  brake: boolean;
  handbrake: boolean;
}

interface Btn {
  key: keyof TouchState;
  pointerIds: Set<number>;
}

/**
 * On-screen buttons for touch devices, pinned to the camera in the same
 * low-res coordinate space as the HUD so they scale with everything else.
 * Each button tracks the pointer id(s) currently pressing it (not just a
 * boolean) so a finger that drags off one button and releases elsewhere
 * still clears correctly under multi-touch.
 */
export class TouchControls {
  readonly state: TouchState = { left: false, right: false, gas: false, brake: false, handbrake: false };
  readonly active: boolean;
  private buttons: Btn[] = [];

  constructor(scene: Phaser.Scene) {
    this.active = scene.sys.game.device.input.touch;
    if (!this.active) return;

    this.buildButton(scene, 24, 106, "left", "icon-arrow", false);
    this.buildButton(scene, 62, 106, "right", "icon-arrow", true);
    this.buildButton(scene, 196, 80, "handbrake", "icon-handbrake", false);
    this.buildButton(scene, 196, 118, "brake", "icon-brake", false);
    this.buildButton(scene, 234, 118, "gas", "icon-gas", false);

    scene.input.on("pointerup", (pointer: Phaser.Input.Pointer) => this.releasePointer(pointer.id));
    scene.input.on("pointerupoutside", (pointer: Phaser.Input.Pointer) => this.releasePointer(pointer.id));
  }

  private buildButton(
    scene: Phaser.Scene,
    x: number,
    y: number,
    key: keyof TouchState,
    iconKey: string,
    flip: boolean,
  ): void {
    const bg = scene.add.image(x, y, "touch-btn").setScrollFactor(0).setDepth(500).setAlpha(0.85);
    bg.setInteractive();
    scene.add.image(x, y, iconKey).setScrollFactor(0).setDepth(501).setFlipX(flip);

    const btn: Btn = { key, pointerIds: new Set() };
    bg.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      btn.pointerIds.add(pointer.id);
      this.state[key] = true;
    });
    this.buttons.push(btn);
  }

  private releasePointer(pointerId: number): void {
    for (const btn of this.buttons) {
      if (btn.pointerIds.delete(pointerId) && btn.pointerIds.size === 0) {
        this.state[btn.key] = false;
      }
    }
  }
}
