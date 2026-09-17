import Phaser from "phaser";
import { GAME_WIDTH, GAME_HEIGHT } from "./config";
import { GameScene } from "./scenes/GameScene";

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "app",
  pixelArt: true,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: "#0a0a0a",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: "arcade",
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  input: {
    activePointers: 3,
  },
  scene: [GameScene],
});
