import { RoadCourse } from "../world/RoadCourse";

export interface MinimapPoi {
  x: number;
  z: number;
  color: string;
}

const SIZE = 150;
const PADDING = 14;

/**
 * Circular full-course overview map (Mario Kart / Gran Turismo style,
 * fixed layout with a moving position marker) rather than a scrolling
 * local radar (NFS/Forza style) - this course is a single point-to-point
 * route, not an open world, so showing the whole shape plus where you are
 * on it is more useful than a windowed view of just what's nearby.
 * z=`course.length` (spawn) maps to the bottom of the circle, z=0 (the
 * station) to the top, so "driving forward" reads as "moving up the map".
 */
export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private path: { x: number; z: number }[] = [];
  private minX = 0;
  private maxX = 0;
  private readonly course: RoadCourse;
  private readonly pois: MinimapPoi[];

  constructor(course: RoadCourse, pois: MinimapPoi[], parent: HTMLElement = document.body) {
    this.course = course;
    this.pois = pois;

    const samples = 60;
    for (let i = 0; i <= samples; i++) {
      const z = course.params.length * (1 - i / samples);
      const x = course.centerXAt(z);
      this.path.push({ x, z });
      this.minX = Math.min(this.minX, x);
      this.maxX = Math.max(this.maxX, x);
    }
    // Symmetric padding so the map doesn't look lopsided if the course
    // happens to curve mostly to one side.
    const halfSpan = Math.max(10, (this.maxX - this.minX) / 2 + 6);
    const centerX = (this.maxX + this.minX) / 2;
    this.minX = centerX - halfSpan;
    this.maxX = centerX + halfSpan;

    this.canvas = document.createElement("canvas");
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    Object.assign(this.canvas.style, {
      position: "fixed",
      top: "14px",
      right: "14px",
      width: `${SIZE}px`,
      height: `${SIZE}px`,
      borderRadius: "50%",
      border: "2px solid rgba(240, 236, 226, 0.5)",
      background: "rgba(10, 14, 24, 0.55)",
      zIndex: "10",
    });
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
  }

  private project(x: number, z: number): { sx: number; sy: number } {
    const usable = SIZE - PADDING * 2;
    const sx = PADDING + ((x - this.minX) / (this.maxX - this.minX)) * usable;
    const sy = PADDING + (z / this.course.params.length) * usable;
    return { sx, sy };
  }

  update(carX: number, carZ: number, heading: number): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, SIZE, SIZE);

    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "rgba(10, 14, 24, 0.55)";
    ctx.fillRect(0, 0, SIZE, SIZE);

    ctx.strokeStyle = "rgba(232, 210, 74, 0.8)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    this.path.forEach((p, i) => {
      const { sx, sy } = this.project(p.x, p.z);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.stroke();

    for (const poi of this.pois) {
      const { sx, sy } = this.project(poi.x, poi.z);
      ctx.beginPath();
      ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = poi.color;
      ctx.fill();
    }

    // Car marker: a small triangle rotated to match heading. Forward in
    // world space is (-sin h, -cos h) in XZ; the map's screen-space
    // "forward" direction (dsx, dsy) scales that by each axis's own
    // project() factor, and atan2(dsx, -dsy) is the rotation that points a
    // default "up"-pointing triangle along it (canvas rotate() is
    // clockwise since screen Y points down).
    const { sx: carSx, sy: carSy } = this.project(carX, carZ);
    const fx = -Math.sin(heading);
    const fz = -Math.cos(heading);
    const usable = SIZE - PADDING * 2;
    const dsx = fx * (usable / (this.maxX - this.minX));
    const dsy = fz * (usable / this.course.params.length);
    const angle = Math.atan2(dsx, -dsy);

    ctx.save();
    ctx.translate(carSx, carSy);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4, 5);
    ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.fillStyle = "#f2eee6";
    ctx.fill();
    ctx.restore();
  }

  dispose(): void {
    this.canvas.remove();
  }
}
