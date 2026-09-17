import Phaser from "phaser";
import { generateTextures } from "../textures";
import { Palette } from "../palette";
import { Car, CarInput } from "../entities/Car";
import { SynthAudio } from "../audio/sfx";
import { MusicDirector } from "../audio/music";
import { TouchControls } from "../controls/TouchControls";
import { saveGame, loadGame } from "../save";
import { FINISH_Y, START_Y, isOnRoad, obstacleSpacingAt, roadCenterX, roadWidthAt } from "../level";
import {
  GAME_WIDTH,
  GAME_HEIGHT,
  WORLD_WIDTH,
  WORLD_LENGTH,
  CAR_MAX_SPEED,
  FUEL_MAX,
  FUEL_DRAIN_PER_WORLD_PX,
  FUEL_IDLE_DRAIN,
  DAMAGE_MAX,
  OBSTACLE_TYPES,
  ObstacleType,
} from "../config";

const FUELING_DURATION = 2.5;
const OFFROAD_SHOULDER = 26;

type LevelState = "driving" | "fueling" | "done";

export class GameScene extends Phaser.Scene {
  private car!: Car;
  private sfx = new SynthAudio();
  private music = new MusicDirector();
  private audioUnlocked = false;
  private touch!: TouchControls;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keyA!: Phaser.Input.Keyboard.Key;
  private keyD!: Phaser.Input.Keyboard.Key;
  private keyW!: Phaser.Input.Keyboard.Key;
  private keyS!: Phaser.Input.Keyboard.Key;
  private keySpace!: Phaser.Input.Keyboard.Key;
  private keyR!: Phaser.Input.Keyboard.Key;
  private prevHandbrakeDown = false;

  private obstacles!: Phaser.Physics.Arcade.StaticGroup;
  private stationZone!: Phaser.GameObjects.Zone;
  private dockPoint = new Phaser.Math.Vector2();

  private fuel = FUEL_MAX;
  private state: LevelState = "driving";
  private lastY = START_Y;

  private fuelingElapsed = 0;
  private fuelingStartFuel = 0;
  private beepTimer = 0;

  private fuelBarGfx!: Phaser.GameObjects.Graphics;
  private damageBarGfx!: Phaser.GameObjects.Graphics;
  private hudText!: Phaser.GameObjects.Text;
  private driftText!: Phaser.GameObjects.Text;
  private bannerText!: Phaser.GameObjects.Text;

  private pumpBarrel?: Phaser.GameObjects.Image;
  private pumpBarrelFrame = 0;
  private pumpBarrelTimer = 0;

  private skidGfx!: Phaser.GameObjects.Graphics;
  private skidThrottle = 0;
  private smokeEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private sparkEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private lightCone!: Phaser.GameObjects.Image;
  private speedLinesGfx!: Phaser.GameObjects.Graphics;
  private wasDrifting = false;

  constructor() {
    super("game");
  }

  create(): void {
    generateTextures(this);

    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_LENGTH);
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_LENGTH);

    this.buildGround();
    this.skidGfx = this.add.graphics().setDepth(5);
    this.buildRoad();
    this.buildDecorations();
    this.buildStreetlamps();

    const save = loadGame();
    this.fuel = save ? save.fuel : FUEL_MAX;

    this.car = new Car(this, roadCenterX(START_Y), START_Y);
    this.car.sprite.setDepth(20);
    this.physics.add.existing(this.car.sprite);
    const body = this.car.sprite.body as Phaser.Physics.Arcade.Body;
    body.setSize(14, 26);
    body.setOffset(3, 4);
    if (save) this.car.applyDamage(save.damage);

    this.cameras.main.startFollow(this.car.sprite, true, 0.12, 0.12);

    this.lightCone = this.add.image(this.car.x, this.car.y, "light-cone");
    this.lightCone.setBlendMode(Phaser.BlendModes.ADD);
    this.lightCone.setTint(Palette.headlightWarm);
    this.lightCone.setAlpha(0.3);
    this.lightCone.setScale(0.85);
    this.lightCone.setOrigin(0.5, 0.86);
    this.lightCone.setDepth(15);

    this.buildParticles();
    this.buildObstacles();
    this.buildGasStation();
    this.buildHud();
    this.buildOverlay();

    this.touch = new TouchControls(this);

    const kb = this.input.keyboard!;
    this.cursors = kb.createCursorKeys();
    this.keyA = kb.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keyD = kb.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.keyW = kb.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keyS = kb.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.keySpace = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.keyR = kb.addKey(Phaser.Input.Keyboard.KeyCodes.R);

    const unlock = () => {
      if (!this.audioUnlocked) {
        this.audioUnlocked = true;
        this.sfx.unlock();
        this.music.start();
      }
    };
    kb.once("keydown", unlock);
    this.input.once("pointerdown", unlock);

    this.physics.add.overlap(this.car.sprite, this.obstacles, (_car, obstacle) => {
      this.handleObstacleHit(obstacle as Phaser.Physics.Arcade.Sprite);
    });
    this.physics.add.overlap(this.car.sprite, this.stationZone, () => this.tryStartFueling());
  }

  private buildGround(): void {
    this.add.tileSprite(0, 0, WORLD_WIDTH, WORLD_LENGTH, "grass-tile").setOrigin(0, 0).setDepth(0);
  }

  private buildRoad(): void {
    const gfx = this.add.graphics().setDepth(1);
    const step = 16;

    const left: Phaser.Math.Vector2[] = [];
    const right: Phaser.Math.Vector2[] = [];
    const shoulderLeft: Phaser.Math.Vector2[] = [];
    const shoulderRight: Phaser.Math.Vector2[] = [];
    for (let y = 0; y <= WORLD_LENGTH; y += step) {
      const cx = roadCenterX(y);
      const half = roadWidthAt(y) / 2;
      left.push(new Phaser.Math.Vector2(cx - half, y));
      right.push(new Phaser.Math.Vector2(cx + half, y));
      shoulderLeft.push(new Phaser.Math.Vector2(cx - half - OFFROAD_SHOULDER, y));
      shoulderRight.push(new Phaser.Math.Vector2(cx + half + OFFROAD_SHOULDER, y));
    }

    // Dirt shoulders either side of the tarmac - a visual cue for the
    // off-road grip loss, not just an invisible rule.
    gfx.fillStyle(Palette.offroadDirt, 1);
    gfx.fillPoints([...shoulderLeft, ...[...left].reverse()], true);
    gfx.fillPoints([...right, ...[...shoulderRight].reverse()], true);

    gfx.fillStyle(Palette.asphalt, 1);
    gfx.fillPoints([...left, ...[...right].reverse()], true);

    gfx.fillStyle(Palette.roadEdge, 1);
    for (let y = 0; y < WORLD_LENGTH; y += 40) {
      if (Math.floor(y / 40) % 2 !== 0) continue;
      const cx = roadCenterX(y);
      const half = roadWidthAt(y) / 2;
      gfx.fillRect(cx - half - 3, y, 3, 20);
      gfx.fillRect(cx + half, y, 3, 20);
    }

    gfx.fillStyle(Palette.roadLine, 1);
    for (let y = 0; y < WORLD_LENGTH; y += 40) {
      if (Math.floor(y / 40) % 2 !== 0) continue;
      const cx = roadCenterX(y);
      gfx.fillRect(cx - 2, y, 4, 20);
    }
  }

  private buildDecorations(): void {
    for (let y = 40; y < WORLD_LENGTH - 40; y += 90) {
      const cx = roadCenterX(y);
      const half = roadWidthAt(y) / 2;
      const leftX = cx - half - OFFROAD_SHOULDER - 4 - Math.random() * 30;
      const rightX = cx + half + OFFROAD_SHOULDER + 4 + Math.random() * 30;
      this.add.image(leftX, y, Math.random() < 0.4 ? "building" : "tree").setOrigin(0.5, 1).setDepth(3);
      this.add.image(rightX, y + 30, Math.random() < 0.4 ? "building" : "tree").setOrigin(0.5, 1).setDepth(3);
    }
  }

  private buildStreetlamps(): void {
    let side = 1;
    for (let y = 60; y < WORLD_LENGTH - 60; y += 230) {
      const cx = roadCenterX(y);
      const half = roadWidthAt(y) / 2;
      const x = cx + side * (half + 10);
      side *= -1;

      this.add.image(x, y, "streetlamp").setOrigin(0.5, 1).setDepth(4);
      const lampTopY = y - 40;

      const outer = this.add.image(x, lampTopY, "glow-soft");
      outer.setBlendMode(Phaser.BlendModes.ADD);
      outer.setTint(Palette.lampGlowOuter);
      outer.setAlpha(0.35);
      outer.setScale(1.4);
      outer.setDepth(6);

      const core = this.add.image(x, lampTopY, "glow-soft");
      core.setBlendMode(Phaser.BlendModes.ADD);
      core.setTint(Palette.lampGlowCore);
      core.setAlpha(0.6);
      core.setScale(0.55);
      core.setDepth(7);

      this.tweens.add({
        targets: [outer, core],
        alpha: { from: 0.5, to: 0.75 },
        duration: 1400 + Math.random() * 900,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    }
  }

  private buildParticles(): void {
    this.smokeEmitter = this.add.particles(0, 0, "smoke-particle", {
      lifespan: 500,
      speed: { min: 4, max: 22 },
      scale: { start: 1.6, end: 0.3 },
      alpha: { start: 0.4, end: 0 },
      quantity: 1,
      frequency: -1,
    });
    this.smokeEmitter.setDepth(18);

    this.sparkEmitter = this.add.particles(0, 0, "spark-particle", {
      lifespan: 320,
      speed: { min: 60, max: 170 },
      angle: { min: 0, max: 360 },
      scale: { start: 1, end: 0 },
      gravityY: 260,
      quantity: 10,
      frequency: -1,
    });
    this.sparkEmitter.setDepth(22);
  }

  private buildObstacles(): void {
    this.obstacles = this.physics.add.staticGroup();
    let y = START_Y - 250;
    while (y > FINISH_Y + 150) {
      const cx = roadCenterX(y);
      const half = roadWidthAt(y) / 2;
      const type = OBSTACLE_TYPES[Phaser.Math.Between(0, OBSTACLE_TYPES.length - 1)];
      const offset = Phaser.Math.FloatBetween(-1, 1) * (half - 22);
      const x = cx + offset;
      const sprite = this.obstacles.create(x, y, type) as Phaser.Physics.Arcade.Sprite;
      sprite.setData("type", type);
      sprite.setDepth(10);
      sprite.refreshBody();

      y -= obstacleSpacingAt(y) * Phaser.Math.FloatBetween(0.85, 1.15);
    }
  }

  private buildGasStation(): void {
    const cx = roadCenterX(FINISH_Y);
    const half = roadWidthAt(FINISH_Y) / 2;
    this.add.image(cx + half + 75, FINISH_Y - 10, "gasstation").setOrigin(0.5, 1).setDepth(10);

    const pumpX = cx + half + 20;
    const pumpY = FINISH_Y + 10;
    this.add.image(pumpX, pumpY, "pump-body").setOrigin(0.5, 1).setDepth(11);
    this.pumpBarrel = this.add.image(pumpX, pumpY - 34, "barrel-spin-0").setDepth(12);

    const zone = this.add.zone(pumpX, pumpY, 70, 70);
    this.physics.add.existing(zone, true);
    this.stationZone = zone;
    this.dockPoint.set(pumpX - 26, pumpY - 6);
  }

  private buildHud(): void {
    this.add
      .graphics()
      .setScrollFactor(0)
      .setDepth(99)
      .fillStyle(Palette.hudBg, 0.55)
      .fillRoundedRect(4, 2, 122, 42, 4);
    this.fuelBarGfx = this.add.graphics().setScrollFactor(0).setDepth(100);
    this.damageBarGfx = this.add.graphics().setScrollFactor(0).setDepth(100);
    this.hudText = this.add
      .text(8, 34, "", { fontFamily: "monospace", fontSize: "8px", color: "#f2eee6" })
      .setScrollFactor(0)
      .setDepth(100);
    this.add
      .text(8, 3, "PALIWO", { fontFamily: "monospace", fontSize: "7px", color: "#f2eee6" })
      .setScrollFactor(0)
      .setDepth(100);
    this.driftText = this.add
      .text(GAME_WIDTH - 8, 3, "", { fontFamily: "monospace", fontSize: "8px", color: "#2fe0ff" })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(100);
    this.bannerText = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, "", {
        fontFamily: "monospace",
        fontSize: "9px",
        color: "#ffe27a",
        align: "center",
        backgroundColor: "#000000cc",
        padding: { x: 6, y: 6 },
        wordWrap: { width: GAME_WIDTH - 30 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(200)
      .setVisible(false);
  }

  private buildOverlay(): void {
    this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, "vignette").setScrollFactor(0).setDepth(90);
    this.add
      .tileSprite(0, 0, GAME_WIDTH, GAME_HEIGHT, "scanlines")
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(95);
    // Depth 9 keeps this behind the car/obstacles (depth 10+) so the streak
    // reads as a motion cue framing the action, not a smear over it.
    this.speedLinesGfx = this.add.graphics().setScrollFactor(0).setDepth(9);
  }

  private handleObstacleHit(obstacle: Phaser.Physics.Arcade.Sprite): void {
    if (!obstacle.active) return;
    const type = obstacle.getData("type") as ObstacleType;
    switch (type) {
      case "deer":
        this.car.applyDamage(18);
        this.car.speedPenaltyTimer = Math.max(this.car.speedPenaltyTimer, 0.6);
        this.car.velocity.scale(0.3);
        this.sfx.playCrash();
        this.cameras.main.shake(200, 0.007);
        break;
      case "bottle":
        this.car.applyDamage(6);
        this.car.gripPenaltyTimer = Math.max(this.car.gripPenaltyTimer, 3);
        this.sfx.playGlass();
        this.cameras.main.shake(90, 0.003);
        break;
      case "pothole":
        this.car.applyDamage(10);
        this.car.velocity.scale(0.45);
        this.sfx.playThud();
        this.cameras.main.shake(120, 0.004);
        break;
    }
    this.sparkEmitter.emitParticleAt(obstacle.x, obstacle.y);
    obstacle.destroy();
  }

  private tryStartFueling(): void {
    if (this.state !== "driving") return;
    this.state = "fueling";
    this.car.velocity.set(0, 0);
    this.fuelingElapsed = 0;
    this.fuelingStartFuel = this.fuel;
    this.tweens.add({
      targets: this.car.sprite,
      x: this.dockPoint.x,
      y: this.dockPoint.y,
      rotation: 0,
      duration: 500,
      ease: "Sine.easeOut",
    });
  }

  private updateFueling(dt: number): void {
    this.fuelingElapsed += dt;

    this.pumpBarrelTimer += dt;
    if (this.pumpBarrelTimer > 0.12) {
      this.pumpBarrelTimer = 0;
      this.pumpBarrelFrame = (this.pumpBarrelFrame + 1) % 4;
      this.pumpBarrel?.setTexture(`barrel-spin-${this.pumpBarrelFrame}`);
    }

    this.beepTimer += dt;
    if (this.beepTimer > 0.4) {
      this.beepTimer = 0;
      this.sfx.playPumpBeep();
    }

    const progress = Math.min(1, this.fuelingElapsed / FUELING_DURATION);
    this.fuel = Phaser.Math.Linear(this.fuelingStartFuel, FUEL_MAX, progress);

    if (progress >= 1) {
      this.state = "done";
      this.car.damage = Math.max(0, this.car.damage - 30);
      saveGame({
        fuel: this.fuel,
        damage: this.car.damage,
        savedAtStation: "Stacja przy trasie - demo",
        timestamp: Date.now(),
      });
      this.bannerText
        .setText("ZAPISANO NA STACJI\n\nKoniec poziomu demo.\nWcisnij R, aby zagrac ponownie")
        .setVisible(true);
    }
  }

  private updateDriftFx(dt: number): void {
    if (this.car.isDrifting) {
      this.skidThrottle += dt;
      if (this.skidThrottle > 0.03) {
        this.skidThrottle = 0;
        for (const side of [-6, 6]) {
          const pt = this.car.rearAxlePoint(side);
          this.skidGfx.save();
          this.skidGfx.translateCanvas(pt.x, pt.y);
          this.skidGfx.rotateCanvas(this.car.sprite.rotation);
          this.skidGfx.fillStyle(0x0d0c10, 0.35 * this.car.driftIntensity + 0.1);
          this.skidGfx.fillRect(-2, -4, 4, 8);
          this.skidGfx.restore();

          this.smokeEmitter.emitParticleAt(pt.x, pt.y);
        }
      }
      this.driftText.setText("DRYFUJESZ");
    } else if (this.wasDrifting) {
      const distance = this.car.consumeDriftDistance();
      if (distance > 35) {
        this.showDriftPopup(Math.round(distance));
      }
      this.driftText.setText("");
    }
    this.wasDrifting = this.car.isDrifting;
  }

  private showDriftPopup(points: number): void {
    const label = this.add
      .text(this.car.x, this.car.y - 20, `DRYF! +${points}`, {
        fontFamily: "monospace",
        fontSize: "8px",
        color: "#2fe0ff",
      })
      .setOrigin(0.5)
      .setDepth(30);
    this.tweens.add({
      targets: label,
      y: label.y - 18,
      alpha: 0,
      duration: 700,
      ease: "Sine.easeOut",
      onComplete: () => label.destroy(),
    });
  }

  private updateSpeedLines(speedRatio: number, time: number): void {
    this.speedLinesGfx.clear();
    if (speedRatio < 0.78) return;
    const strength = (speedRatio - 0.78) / 0.22;
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT * 0.5;
    const lineCount = 12;
    // Lines start well outside where the car sits so the streak frames the
    // action instead of crossing straight through the player sprite, and a
    // slow per-line flicker keeps it feeling alive rather than a static
    // decal.
    const innerR = 50;
    for (let i = 0; i < lineCount; i++) {
      const jitter = Math.sin(time * 0.0006 + i * 12.9) * 0.12;
      const angle = (i / lineCount) * Math.PI * 2 + jitter;
      const outerR = innerR + strength * (70 + (i % 3) * 14);
      const alpha = 0.16 * strength * (0.55 + 0.45 * Math.sin(time * 0.01 + i * 3));
      this.speedLinesGfx.lineStyle(1, 0xf2eee6, Math.max(0, alpha));
      const x1 = cx + Math.cos(angle) * innerR;
      const y1 = cy + Math.sin(angle) * innerR * 0.6;
      const x2 = cx + Math.cos(angle) * outerR;
      const y2 = cy + Math.sin(angle) * outerR * 0.6;
      this.speedLinesGfx.lineBetween(x1, y1, x2, y2);
    }
  }

  private updateHud(): void {
    this.fuelBarGfx.clear();
    this.fuelBarGfx.fillStyle(Palette.hudBg, 1);
    this.fuelBarGfx.fillRect(8, 12, 90, 6);
    this.fuelBarGfx.fillStyle(this.fuel < 20 ? Palette.fuelLow : Palette.hudFuel, 1);
    this.fuelBarGfx.fillRect(8, 12, 90 * (this.fuel / FUEL_MAX), 6);

    this.damageBarGfx.clear();
    this.damageBarGfx.fillStyle(Palette.hudBg, 1);
    this.damageBarGfx.fillRect(8, 22, 90, 6);
    this.damageBarGfx.fillStyle(Palette.hudDamage, 1);
    this.damageBarGfx.fillRect(8, 22, 90 * (this.car.damage / DAMAGE_MAX), 6);

    const remaining = Math.max(0, Math.round(this.car.y - FINISH_Y));
    const warning = this.fuel <= 0 ? "\nBRAK PALIWA!" : "";
    this.hudText.setText(`Do stacji: ${remaining}m${warning}`);
  }

  update(time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs / 1000, 0.05);

    if (Phaser.Input.Keyboard.JustDown(this.keyR) && this.state === "done") {
      this.scene.restart();
      return;
    }

    if (this.state === "driving") {
      const t = this.touch.state;
      const up = this.cursors.up?.isDown || this.keyW.isDown || t.gas;
      const down = this.cursors.down?.isDown || this.keyS.isDown || t.brake;
      const left = this.cursors.left?.isDown || this.keyA.isDown || t.left;
      const right = this.cursors.right?.isDown || this.keyD.isDown || t.right;
      const handbrakeDown = this.keySpace.isDown || t.handbrake;
      const handbrakeJustPressed = Phaser.Input.Keyboard.JustDown(this.keySpace) || (handbrakeDown && !this.prevHandbrakeDown);
      this.prevHandbrakeDown = handbrakeDown;

      const rawThrottle = (up ? 1 : 0) - (down ? 1 : 0);
      const input: CarInput = {
        throttle: this.fuel <= 0 ? Math.min(0, rawThrottle) : rawThrottle,
        steer: (right ? 1 : 0) - (left ? 1 : 0),
        handbrake: handbrakeDown,
        handbrakeJustPressed,
      };

      const onRoad = isOnRoad(this.car.x, this.car.y);
      this.car.update(dt, input, onRoad);
      (this.car.sprite.body as Phaser.Physics.Arcade.Body).updateFromGameObject();
      this.car.sprite.x = Phaser.Math.Clamp(this.car.sprite.x, 20, WORLD_WIDTH - 20);

      const distance = Math.abs(this.lastY - this.car.y);
      this.lastY = this.car.y;
      this.fuel -= distance * FUEL_DRAIN_PER_WORLD_PX;
      this.fuel -= FUEL_IDLE_DRAIN * dt;
      this.fuel = Phaser.Math.Clamp(this.fuel, 0, FUEL_MAX);

      const speedRatio = Math.min(1, this.car.speed / CAR_MAX_SPEED);
      this.sfx.setEngineIntensity(Math.abs(rawThrottle), speedRatio);
      const danger01 = Math.max(this.fuel <= 15 ? (15 - this.fuel) / 15 : 0, (this.car.damage / DAMAGE_MAX) * 0.6);
      this.music.setMood({ driving01: speedRatio, drift01: this.car.driftIntensity, danger01 });

      this.lightCone.setPosition(this.car.x, this.car.y);
      this.lightCone.setRotation(this.car.sprite.rotation);

      this.updateDriftFx(dt);
      this.updateSpeedLines(speedRatio, time);
    } else if (this.state === "fueling") {
      this.updateFueling(dt);
    }

    this.updateHud();
  }
}
