import Phaser from "phaser";
import { Palette, toCss, toCssAlpha } from "./palette";

/**
 * Every sprite in this prototype is generated on the fly with 2D canvas
 * drawing instead of loaded from image files, so there are no external art
 * assets to source or license yet - just quick, replaceable placeholders
 * that already read clearly at pixel-art scale and all pull from the same
 * palette so the world reads as one consistent place.
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
    ctx.fillStyle = toCss(Palette.grassDark);
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = toCss(Palette.grassMid);
    for (let i = 0; i < 10; i++) {
      const x = (i * 7) % 32;
      const y = (i * 13) % 32;
      ctx.fillRect(x, y, 2, 2);
    }
  });

  tex(scene, "dirt-tile", 32, 32, (ctx) => {
    ctx.fillStyle = toCss(Palette.offroadDirt);
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = toCssAlpha(0x000000, 0.15);
    for (let i = 0; i < 8; i++) {
      ctx.fillRect((i * 11) % 32, (i * 17) % 32, 3, 1);
    }
  });

  // Simple Polish-village building block (blokowisko silhouette).
  tex(scene, "building", 48, 64, (ctx) => {
    ctx.fillStyle = toCss(Palette.buildingShadow);
    ctx.fillRect(0, 0, 48, 64);
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        const lit = (row + col) % 3 !== 0;
        ctx.fillStyle = toCss(lit ? Palette.buildingLit : Palette.buildingUnlit);
        ctx.fillRect(6 + col * 14, 6 + row * 12, 8, 8);
      }
    }
  });

  tex(scene, "tree", 28, 36, (ctx) => {
    ctx.fillStyle = "#2a1b12";
    ctx.fillRect(12, 20, 4, 16);
    ctx.fillStyle = toCss(Palette.grassDark);
    ctx.beginPath();
    ctx.arc(14, 14, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = toCss(Palette.grassMid);
    ctx.beginPath();
    ctx.arc(10, 10, 6, 0, Math.PI * 2);
    ctx.fill();
  });

  tex(scene, "streetlamp", 10, 46, (ctx) => {
    ctx.fillStyle = "#161418";
    ctx.fillRect(4, 10, 2, 36);
    ctx.fillStyle = "#1c1a20";
    ctx.fillRect(2, 4, 6, 8);
    ctx.fillStyle = toCss(Palette.lampGlowCore);
    ctx.fillRect(3, 5, 4, 4);
  });

  // Player car, nose pointing "up" (negative Y) - fictional silhouette,
  // not a licensed make/model.
  tex(scene, "car", 20, 34, (ctx) => {
    ctx.fillStyle = toCss(Palette.carBody);
    ctx.fillRect(3, 4, 14, 26);
    ctx.fillStyle = toCss(Palette.carShadow);
    ctx.fillRect(3, 4, 14, 6);
    ctx.fillStyle = "#101014";
    ctx.fillRect(2, 2, 4, 6);
    ctx.fillRect(14, 2, 4, 6);
    ctx.fillRect(2, 26, 4, 6);
    ctx.fillRect(14, 26, 4, 6);
    ctx.fillStyle = toCss(Palette.carGlass);
    ctx.fillRect(6, 10, 8, 6);
    ctx.fillStyle = toCss(Palette.carChrome);
    ctx.fillRect(4, 3, 3, 2);
    ctx.fillRect(13, 3, 3, 2);
  });

  // Obstacles.
  tex(scene, "deer", 22, 26, (ctx) => {
    ctx.fillStyle = toCss(Palette.deerFur);
    ctx.fillRect(6, 8, 10, 12);
    ctx.fillRect(4, 4, 8, 8);
    ctx.fillStyle = toCss(Palette.deerDark);
    ctx.fillRect(4, 0, 2, 5);
    ctx.fillRect(9, 0, 2, 5);
    ctx.fillRect(3, 18, 3, 8);
    ctx.fillRect(9, 18, 3, 8);
    ctx.fillRect(14, 18, 3, 8);
    ctx.fillStyle = toCss(Palette.deerEye);
    ctx.fillRect(9, 6, 2, 2);
  });

  tex(scene, "bottle", 10, 14, (ctx) => {
    ctx.fillStyle = toCss(Palette.bottleGlass);
    ctx.fillRect(3, 2, 4, 10);
    ctx.fillRect(2, 8, 6, 5);
    ctx.fillStyle = toCss(Palette.bottleHighlight);
    ctx.fillRect(6, 9, 2, 2);
    ctx.fillStyle = "#c9c9c9";
    ctx.fillRect(0, 12, 3, 2);
    ctx.fillRect(6, 11, 3, 2);
  });

  tex(scene, "pothole", 26, 18, (ctx) => {
    ctx.fillStyle = toCss(Palette.potholeVoid);
    ctx.beginPath();
    ctx.ellipse(13, 9, 13, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = toCss(Palette.potholeRim);
    ctx.beginPath();
    ctx.ellipse(13, 9, 9, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  // Gas station.
  tex(scene, "gasstation", 120, 90, (ctx) => {
    ctx.fillStyle = "#284b6b";
    ctx.fillRect(0, 0, 120, 30);
    ctx.fillStyle = toCss(Palette.roadLine);
    ctx.fillRect(4, 34, 112, 40);
    ctx.fillStyle = "#284b6b";
    ctx.font = "bold 14px monospace";
    ctx.fillText("ORLIK", 30, 60);
    ctx.fillStyle = "#101014";
    ctx.fillRect(20, 74, 24, 16);
    ctx.fillRect(76, 74, 24, 16);
  });

  tex(scene, "pump-body", 18, 30, (ctx) => {
    ctx.fillStyle = toCss(Palette.carBody);
    ctx.fillRect(0, 0, 18, 30);
    ctx.fillStyle = "#f2f2f2";
    ctx.fillRect(3, 4, 12, 8);
    ctx.fillStyle = "#101014";
    ctx.fillRect(4, 22, 10, 4);
  });

  // Pump barrel with a rotating "3D" icon on top made from 4 baked
  // rotation frames (a cheap pre-rendered spin, no runtime 3D needed).
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

  // Soft round glow - tinted + additive-blended at runtime for streetlamps,
  // headlights, sparks, etc. A smooth gradient here is intentional: glow
  // is meant to read as light, not as a pixel-art object.
  tex(scene, "glow-soft", 64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,0.9)");
    g.addColorStop(0.4, "rgba(255,255,255,0.35)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });

  // Headlight cone: a soft, modest glow near the car's nose fading out
  // quickly - meant to read as ambient light spill, not a bright wash
  // over the pixel art. Rotated + anchored to the car's nose at runtime.
  tex(scene, "light-cone", 60, 90, (ctx) => {
    const g = ctx.createRadialGradient(30, 90, 0, 30, 90, 88);
    g.addColorStop(0, "rgba(255,255,255,0.5)");
    g.addColorStop(0.3, "rgba(255,255,255,0.15)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 60, 90);
  });

  tex(scene, "smoke-particle", 12, 12, (ctx) => {
    const g = ctx.createRadialGradient(6, 6, 0, 6, 6, 6);
    g.addColorStop(0, toCssAlpha(Palette.smoke, 0.55));
    g.addColorStop(1, toCssAlpha(Palette.smoke, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 12, 12);
  });

  tex(scene, "spark-particle", 6, 6, (ctx) => {
    ctx.fillStyle = toCss(Palette.spark);
    ctx.fillRect(1, 1, 4, 4);
  });

  tex(scene, "vignette", 256, 144, (ctx) => {
    const g = ctx.createRadialGradient(128, 72, 40, 128, 72, 190);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.6, "rgba(0,0,0,0.15)");
    g.addColorStop(1, "rgba(0,0,0,0.65)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 144);
  });

  tex(scene, "scanlines", 4, 4, (ctx) => {
    ctx.clearRect(0, 0, 4, 4);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(0, 0, 4, 1);
  });

  // Touch controls (mobile).
  tex(scene, "touch-btn", 34, 34, (ctx) => {
    ctx.fillStyle = "rgba(20,18,26,0.55)";
    ctx.beginPath();
    ctx.roundRect(1, 1, 32, 32, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(232,210,74,0.7)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(2, 2, 30, 30, 7);
    ctx.stroke();
  });

  tex(scene, "icon-arrow", 20, 20, (ctx) => {
    ctx.fillStyle = toCss(Palette.hudText);
    ctx.beginPath();
    ctx.moveTo(13, 3);
    ctx.lineTo(13, 17);
    ctx.lineTo(4, 10);
    ctx.closePath();
    ctx.fill();
  });

  tex(scene, "icon-gas", 20, 20, (ctx) => {
    ctx.fillStyle = toCss(Palette.fuelGreen);
    ctx.beginPath();
    ctx.moveTo(6, 17);
    ctx.lineTo(14, 17);
    ctx.lineTo(14, 9);
    ctx.lineTo(10, 2);
    ctx.lineTo(6, 9);
    ctx.closePath();
    ctx.fill();
  });

  tex(scene, "icon-brake", 20, 20, (ctx) => {
    ctx.fillStyle = toCss(Palette.damageRed);
    ctx.fillRect(5, 5, 10, 10);
  });

  tex(scene, "icon-handbrake", 20, 20, (ctx) => {
    ctx.fillStyle = toCss(Palette.neonCyan);
    ctx.font = "bold 12px monospace";
    ctx.fillText("HB", 2, 14);
  });
}
