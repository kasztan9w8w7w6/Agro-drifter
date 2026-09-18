import { CanvasTexture, SRGBColorSpace } from "three/webgpu";
import { Palette, toCss, toCssAlpha } from "../palette";

/**
 * Scattered-glass decal, drawn procedurally on a canvas (no external asset -
 * the brief calls this out explicitly as code-generated, not a downloaded
 * texture) rather than a real photo/scan, which would need its own license
 * check anyway.
 */
export function buildGlassDecalTexture(): CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.clearRect(0, 0, size, size);

  const shardCount = 26;
  for (let i = 0; i < shardCount; i++) {
    const cx = Math.random() * size;
    const cy = Math.random() * size;
    const r = 4 + Math.random() * 14;
    const sides = 3 + Math.floor(Math.random() * 2);
    ctx.beginPath();
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2 + Math.random() * 0.6;
      const rr = r * (0.6 + Math.random() * 0.6);
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      if (s === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = toCssAlpha(Palette.bottleGlass, 0.35 + Math.random() * 0.25);
    ctx.fill();
    ctx.strokeStyle = toCss(Palette.bottleHighlight);
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
