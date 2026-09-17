import Phaser from "phaser";
import { generateTextures } from "../textures";
import { Car, CarInput } from "../entities/Car";
import { SynthAudio } from "../audio";
import { saveGame, loadGame } from "../save";
import {
  GAME_WIDTH,
  GAME_HEIGHT,
  WORLD_WIDTH,
  WORLD_LENGTH,
  ROAD_WIDTH,
  ROAD_CURVE_AMPLITUDE,
  ROAD_CURVE_PERIOD,
  FUEL_MAX,
  FUEL_DRAIN_PER_WORLD_PX,
  FUEL_IDLE_DRAIN,
  DAMAGE_MAX,
  OBSTACLE_TYPES,
  ObstacleType,
} from "../config";

const START_Y = WORLD_LENGTH - 120;
const FINISH_Y = 140;
const FUELING_DURATION = 2.5;

function roadCenterX(y: number): number {
  return WORLD_WIDTH / 2 + Math.sin(y / ROAD_CURVE_PERIOD) * ROAD_CURVE_AMPLITUDE;
}

type LevelState = "driving" | "fueling" | "done";

export class GameScene extends Phaser.Scene {
  private car!: Car;
  private audio = new SynthAudio();
  private audioUnlocked = false;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keyA!: Phaser.Input.Keyboard.Key;
  private keyD!: Phaser.Input.Keyboard.Key;
  private keyW!: Phaser.Input.Keyboard.Key;
  private keyS!: Phaser.Input.Keyboard.Key;
  private keySpace!: Phaser.Input.Keyboard.Key;
  private keyR!: Phaser.Input.Keyboard.Key;

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
  private bannerText!: Phaser.GameObjects.Text;

  private pumpBarrel?: Phaser.GameObjects.Image;
  private pumpBarrelFrame = 0;
  private pumpBarrelTimer = 0;

  constructor() {
    super("game");
  }

  create(): void {
    generateTextures(this);

    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_LENGTH);
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_LENGTH);

    this.buildGround();
    this.buildRoad();
    this.buildDecorations();

    const save = loadGame();
    this.fuel = save ? save.fuel : FUEL_MAX;

    this.car = new Car(this, roadCenterX(START_Y), START_Y);
    this.physics.add.existing(this.car.sprite);
    const body = this.car.sprite.body as Phaser.Physics.Arcade.Body;
    body.setSize(14, 26);
    body.setOffset(3, 4);
    if (save) this.car.applyDamage(save.damage);

    this.cameras.main.startFollow(this.car.sprite, true, 0.12, 0.12);

    this.buildObstacles();
    this.buildGasStation();
    this.buildHud();

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
        this.audio.unlock();
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
    this.add.tileSprite(0, 0, WORLD_WIDTH, WORLD_LENGTH, "grass-tile").setOrigin(0, 0);
  }

  private buildRoad(): void {
    const gfx = this.add.graphics();
    const step = 20;
    const leftPoints: Phaser.Math.Vector2[] = [];
    const rightPoints: Phaser.Math.Vector2[] = [];
    for (let y = 0; y <= WORLD_LENGTH; y += step) {
      const cx = roadCenterX(y);
      leftPoints.push(new Phaser.Math.Vector2(cx - ROAD_WIDTH / 2, y));
      rightPoints.push(new Phaser.Math.Vector2(cx + ROAD_WIDTH / 2, y));
    }
    const poly = [...leftPoints, ...rightPoints.reverse()];
    gfx.fillStyle(0x2b2b2f, 1);
    gfx.fillPoints(poly, true);

    gfx.fillStyle(0xc9c9b8, 1);
    for (let y = 0; y < WORLD_LENGTH; y += 40) {
      if (Math.floor(y / 40) % 2 !== 0) continue;
      const cx = roadCenterX(y);
      gfx.fillRect(cx - ROAD_WIDTH / 2 - 3, y, 3, 20);
      gfx.fillRect(cx + ROAD_WIDTH / 2, y, 3, 20);
    }

    gfx.fillStyle(0xd8d84a, 1);
    for (let y = 0; y < WORLD_LENGTH; y += 40) {
      if (Math.floor(y / 40) % 2 !== 0) continue;
      const cx = roadCenterX(y);
      gfx.fillRect(cx - 2, y, 4, 20);
    }
  }

  private buildDecorations(): void {
    for (let y = 40; y < WORLD_LENGTH - 40; y += 90) {
      const cx = roadCenterX(y);
      const leftX = cx - ROAD_WIDTH / 2 - 20 - Math.random() * 30;
      const rightX = cx + ROAD_WIDTH / 2 + 20 + Math.random() * 30;
      this.add.image(leftX, y, Math.random() < 0.4 ? "building" : "tree").setOrigin(0.5, 1);
      this.add.image(rightX, y + 30, Math.random() < 0.4 ? "building" : "tree").setOrigin(0.5, 1);
    }
  }

  private buildObstacles(): void {
    this.obstacles = this.physics.add.staticGroup();
    const spacing = 260;
    for (let y = START_Y - 200; y > FINISH_Y + 150; y -= spacing) {
      const cx = roadCenterX(y);
      const type = OBSTACLE_TYPES[Phaser.Math.Between(0, OBSTACLE_TYPES.length - 1)];
      const offset = Phaser.Math.FloatBetween(-1, 1) * (ROAD_WIDTH / 2 - 24);
      const x = cx + offset;
      const sprite = this.obstacles.create(x, y, type) as Phaser.Physics.Arcade.Sprite;
      sprite.setData("type", type);
      sprite.refreshBody();
    }
  }

  private buildGasStation(): void {
    const cx = roadCenterX(FINISH_Y);
    this.add.image(cx + ROAD_WIDTH / 2 + 75, FINISH_Y - 10, "gasstation").setOrigin(0.5, 1);

    const pumpX = cx + ROAD_WIDTH / 2 + 20;
    const pumpY = FINISH_Y + 10;
    this.add.image(pumpX, pumpY, "pump-body").setOrigin(0.5, 1);
    this.pumpBarrel = this.add.image(pumpX, pumpY - 34, "barrel-spin-0");

    const zone = this.add.zone(pumpX, pumpY, 70, 70);
    this.physics.add.existing(zone, true);
    this.stationZone = zone;
    this.dockPoint.set(pumpX - 26, pumpY - 6);
  }

  private buildHud(): void {
    this.fuelBarGfx = this.add.graphics().setScrollFactor(0).setDepth(100);
    this.damageBarGfx = this.add.graphics().setScrollFactor(0).setDepth(100);
    this.hudText = this.add
      .text(10, 44, "", { fontFamily: "monospace", fontSize: "10px", color: "#ffffff" })
      .setScrollFactor(0)
      .setDepth(100);
    this.add
      .text(10, 6, "PALIWO", { fontFamily: "monospace", fontSize: "9px", color: "#ffffff" })
      .setScrollFactor(0)
      .setDepth(100);
    this.bannerText = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, "", {
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#ffe27a",
        align: "center",
        backgroundColor: "#000000cc",
        padding: { x: 8, y: 8 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(200)
      .setVisible(false);
  }

  private handleObstacleHit(obstacle: Phaser.Physics.Arcade.Sprite): void {
    if (!obstacle.active) return;
    const type = obstacle.getData("type") as ObstacleType;
    switch (type) {
      case "deer":
        this.car.applyDamage(18);
        this.car.speedPenaltyTimer = Math.max(this.car.speedPenaltyTimer, 0.6);
        this.car.velocity.scale(0.3);
        this.audio.playCrash();
        break;
      case "bottle":
        this.car.applyDamage(6);
        this.car.gripPenaltyTimer = Math.max(this.car.gripPenaltyTimer, 3);
        this.audio.playGlass();
        break;
      case "pothole":
        this.car.applyDamage(10);
        this.car.velocity.scale(0.45);
        this.audio.playThud();
        break;
    }
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
      this.audio.playPumpBeep();
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

  private updateHud(): void {
    this.fuelBarGfx.clear();
    this.fuelBarGfx.fillStyle(0x222222, 1);
    this.fuelBarGfx.fillRect(10, 16, 120, 8);
    this.fuelBarGfx.fillStyle(this.fuel < 20 ? 0xd8402c : 0x4ad84a, 1);
    this.fuelBarGfx.fillRect(10, 16, 120 * (this.fuel / FUEL_MAX), 8);

    this.damageBarGfx.clear();
    this.damageBarGfx.fillStyle(0x222222, 1);
    this.damageBarGfx.fillRect(10, 30, 120, 8);
    this.damageBarGfx.fillStyle(0xd8a02c, 1);
    this.damageBarGfx.fillRect(10, 30, 120 * (this.car.damage / DAMAGE_MAX), 8);

    const remaining = Math.max(0, Math.round(this.car.y - FINISH_Y));
    const warning = this.fuel <= 0 ? "\nBRAK PALIWA!" : "";
    this.hudText.setText(`Dystans do stacji: ${remaining}m${warning}`);
  }

  update(_time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs / 1000, 0.05);

    if (Phaser.Input.Keyboard.JustDown(this.keyR) && this.state === "done") {
      this.scene.restart();
      return;
    }

    if (this.state === "driving") {
      const up = this.cursors.up?.isDown || this.keyW.isDown;
      const down = this.cursors.down?.isDown || this.keyS.isDown;
      const left = this.cursors.left?.isDown || this.keyA.isDown;
      const right = this.cursors.right?.isDown || this.keyD.isDown;

      const rawThrottle = (up ? 1 : 0) - (down ? 1 : 0);
      const input: CarInput = {
        throttle: this.fuel <= 0 ? Math.min(0, rawThrottle) : rawThrottle,
        steer: (right ? 1 : 0) - (left ? 1 : 0),
        handbrake: this.keySpace.isDown,
      };

      this.car.update(dt, input);
      (this.car.sprite.body as Phaser.Physics.Arcade.Body).updateFromGameObject();
      this.car.sprite.x = Phaser.Math.Clamp(this.car.sprite.x, 20, WORLD_WIDTH - 20);

      const distance = Math.abs(this.lastY - this.car.y);
      this.lastY = this.car.y;
      this.fuel -= distance * FUEL_DRAIN_PER_WORLD_PX;
      this.fuel -= FUEL_IDLE_DRAIN * dt;
      this.fuel = Phaser.Math.Clamp(this.fuel, 0, FUEL_MAX);

      this.audio.setEngineIntensity(Math.abs(rawThrottle), Math.min(1, this.car.speed / 340));
    } else if (this.state === "fueling") {
      this.updateFueling(dt);
    }

    this.updateHud();
  }
}
