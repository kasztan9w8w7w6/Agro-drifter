/**
 * Road geometry as pure functions of world-Z, ported from the 2D
 * prototype's `level.ts` (curve/width/difficulty ramp) onto the 3D XZ
 * plane. Progress runs from `length` (start, spawn point) down to `0`
 * (the station) along -Z, matching the car's Three.js forward convention.
 * The road narrows and curves more sharply as progress increases, so
 * difficulty ramps smoothly across the drive instead of being flat.
 */

export interface RoadParams {
  length: number;
  widthStart: number;
  widthEnd: number;
  curveAmplitudeStart: number;
  curveAmplitudeEnd: number;
  curvePeriodStart: number;
  curvePeriodEnd: number;
}

export const DEFAULT_ROAD_PARAMS: RoadParams = {
  length: 900,
  widthStart: 14,
  widthEnd: 9,
  curveAmplitudeStart: 10,
  curveAmplitudeEnd: 22,
  curvePeriodStart: 140,
  curvePeriodEnd: 70,
};

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class RoadCourse {
  constructor(readonly params: RoadParams = DEFAULT_ROAD_PARAMS) {}

  /** 0 at the start (z = length), 1 at the station (z = 0). */
  progressAt(z: number): number {
    return clamp01((this.params.length - z) / this.params.length);
  }

  widthAt(z: number): number {
    const p = this.params;
    return lerp(p.widthStart, p.widthEnd, this.progressAt(z));
  }

  private curveAmplitudeAt(z: number): number {
    const p = this.params;
    return lerp(p.curveAmplitudeStart, p.curveAmplitudeEnd, this.progressAt(z));
  }

  private curvePeriodAt(z: number): number {
    const p = this.params;
    return lerp(p.curvePeriodStart, p.curvePeriodEnd, this.progressAt(z));
  }

  centerXAt(z: number): number {
    return Math.sin(z / this.curvePeriodAt(z)) * this.curveAmplitudeAt(z);
  }

  isOnRoad(x: number, z: number): boolean {
    const half = this.widthAt(z) / 2;
    const cx = this.centerXAt(z);
    return x > cx - half && x < cx + half;
  }
}
