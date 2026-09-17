import Phaser from "phaser";

/**
 * Every sprite in this prototype is generated on the fly with 2D canvas
 * drawing instead of loaded from image files, so there are no external art
 * assets to source or license yet - just quick, replaceable placeholders
 * that already read clearly at pixel-art scale.
 */
function tex(scene: Phaser.Scene, key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): void {
  const canvasTexture = scene.textures.createCanvas(key, w, h);
  if (!canvasTexture) return;
  const ctx = canvasTexture.getContext();
  ctx.clearRect(0, 0, w, h);
  draw(ctx);
  canvasTexture.refresh();
}

export function generateTextures(scene: Phaser.Scene): void {
  // Grass tile (village night ground).
  tex(scene, "grass-tile", 32, 32, (ctx) => {
    ctx.fillStyle = "#152a17";
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = "#1b3420";
    for (let i = 0; i < 10; i++) {
      const x = (i * 7) % 32;
      const y = (i * 13) % 32;
      ctx.fillRect(x, y, 2, 2);
    }
  });

  // Road tile with dashed centre line handled separately in GameScene.
  tex(scene, "road-tile", 32, 32, (ctx) => {
    ctx.fillStyle = "#2b2b2f";
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = "#262629";
    ctx.fillRect(0, 0, 32, 4);
    ctx.fillRect(0, 28, 32, 4);
  });

  tex(scene, "road-edge", 8, 32, (ctx) => {
    ctx.fillStyle = "#c9c9b8";
    ctx.fillRect(0, 0, 3, 12);
    ctx.fillRect(0, 20, 3, 12);
  });

  // Simple Polish-village building block (blokowisko silhouette).
  tex(scene, "building", 48, 64, (ctx) => {
    ctx.fillStyle = "#3a3630";
    ctx.fillRect(0, 0, 48, 64);
    ctx.fillStyle = "#c9a63a";
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        const lit = (row + col) % 3 !== 0;
        ctx.fillStyle = lit ? "#e0b84a" : "#1c1a16";
        ctx.fillRect(6 + col * 14, 6 + row * 12, 8, 8);
      }
    }
  });

  tex(scene, "tree", 28, 36, (ctx) => {
    ctx.fillStyle = "#3b2418";
    ctx.fillRect(12, 20, 4, 16);
    ctx.fillStyle = "#1f3a22";
    ctx.beginPath();
    ctx.arc(14, 14, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#274a2b";
    ctx.beginPath();
    ctx.arc(10, 10, 6, 0, Math.PI * 2);
    ctx.fill();
  });

  // Player car, nose pointing "up" (negative Y) - fictional silhouette,
  // not a licensed make/model.
  tex(scene, "car", 20, 34, (ctx) => {
    ctx.fillStyle = "#b3241c";
    ctx.fillRect(3, 4, 14, 26);
    ctx.fillStyle = "#7a1712";
    ctx.fillRect(3, 4, 14, 6);
    ctx.fillStyle = "#101014";
    ctx.fillRect(2, 2, 4, 6);
    ctx.fillRect(14, 2, 4, 6);
    ctx.fillRect(2, 26, 4, 6);
    ctx.fillRect(14, 26, 4, 6);
    ctx.fillStyle = "#dfe8ff";
    ctx.fillRect(6, 10, 8, 6);
    ctx.fillStyle = "#ffe27a";
    ctx.fillRect(4, 3, 3, 2);
    ctx.fillRect(13, 3, 3, 2);
  });

  // Obstacles.
  tex(scene, "deer", 22, 26, (ctx) => {
    ctx.fillStyle = "#6b4a30";
    ctx.fillRect(6, 8, 10, 12);
    ctx.fillRect(4, 4, 8, 8);
    ctx.fillStyle = "#3a2a1a";
    ctx.fillRect(4, 0, 2, 5);
    ctx.fillRect(9, 0, 2, 5);
    ctx.fillRect(3, 18, 3, 8);
    ctx.fillRect(9, 18, 3, 8);
    ctx.fillRect(14, 18, 3, 8);
    ctx.fillStyle = "#ffd54a";
    ctx.fillRect(9, 6, 2, 2);
  });

  tex(scene, "bottle", 10, 14, (ctx) => {
    ctx.fillStyle = "#1f6b3a";
    ctx.fillRect(3, 2, 4, 10);
    ctx.fillRect(2, 8, 6, 5);
    ctx.fillStyle = "#8fe0b0";
    ctx.fillRect(6, 9, 2, 2);
    ctx.fillStyle = "#c9c9c9";
    ctx.fillRect(0, 12, 3, 2);
    ctx.fillRect(6, 11, 3, 2);
  });

  tex(scene, "pothole", 26, 18, (ctx) => {
    ctx.fillStyle = "#0c0c0d";
    ctx.beginPath();
    ctx.ellipse(13, 9, 13, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#232326";
    ctx.beginPath();
    ctx.ellipse(13, 9, 9, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  // Gas station.
  tex(scene, "gasstation", 120, 90, (ctx) => {
    ctx.fillStyle = "#284b6b";
    ctx.fillRect(0, 0, 120, 30);
    ctx.fillStyle = "#e8d24a";
    ctx.fillRect(4, 34, 112, 40);
    ctx.fillStyle = "#284b6b";
    ctx.font = "bold 14px monospace";
    ctx.fillText("ORLIK", 30, 60);
    ctx.fillStyle = "#101014";
    ctx.fillRect(20, 74, 24, 16);
    ctx.fillRect(76, 74, 24, 16);
  });

  // Pump body with a rotating "3D" barrel icon on top made from 4 baked
  // rotation frames (a cheap pre-rendered spin, no runtime 3D needed).
  tex(scene, "pump-body", 18, 30, (ctx) => {
    ctx.fillStyle = "#c23b2b";
    ctx.fillRect(0, 0, 18, 30);
    ctx.fillStyle = "#f2f2f2";
    ctx.fillRect(3, 4, 12, 8);
    ctx.fillStyle = "#101014";
    ctx.fillRect(4, 22, 10, 4);
  });

  for (let frame = 0; frame < 4; frame++) {
    const widths = [16, 9, 3, 9];
    const w = widths[frame];
    tex(scene, `barrel-spin-${frame}`, 16, 16, (ctx) => {
      ctx.fillStyle = "#2f6fb3";
      ctx.fillRect(8 - w / 2, 1, w, 14);
      ctx.fillStyle = "#dce6f5";
      ctx.fillRect(8 - w / 2, 1, Math.max(1, w / 3), 14);
    });
  }

  tex(scene, "nozzle", 6, 6, (ctx) => {
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, 6, 6);
  });
}
