import {
  OBSTACLE_SPACING_END,
  OBSTACLE_SPACING_START,
  ROAD_CURVE_AMPLITUDE_END,
  ROAD_CURVE_AMPLITUDE_START,
  ROAD_CURVE_PERIOD_END,
  ROAD_CURVE_PERIOD_START,
  ROAD_WIDTH_END,
  ROAD_WIDTH_START,
  WORLD_LENGTH,
  WORLD_WIDTH,
} from "./config";

/**
 * Level geometry as a set of pure functions of world-Y, shared by the road
 * renderer, the obstacle placer, and the car's off-road check. The road
 * gets narrower and its curves get tighter/more frequent as you approach
 * the station, so difficulty ramps up smoothly across the drive instead of
 * being flat from start to finish.
 */
export const START_Y = WORLD_LENGTH - 120;
export const FINISH_Y = 140;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 0 at the starting line, 1 at the station. */
export function levelProgress(y: number): number {
  return clamp01((START_Y - y) / (START_Y - FINISH_Y));
}

export function roadWidthAt(y: number): number {
  return lerp(ROAD_WIDTH_START, ROAD_WIDTH_END, levelProgress(y));
}

function roadCurveAmplitudeAt(y: number): number {
  return lerp(ROAD_CURVE_AMPLITUDE_START, ROAD_CURVE_AMPLITUDE_END, levelProgress(y));
}

function roadCurvePeriodAt(y: number): number {
  return lerp(ROAD_CURVE_PERIOD_START, ROAD_CURVE_PERIOD_END, levelProgress(y));
}

export function roadCenterX(y: number): number {
  return WORLD_WIDTH / 2 + Math.sin(y / roadCurvePeriodAt(y)) * roadCurveAmplitudeAt(y);
}

export function obstacleSpacingAt(y: number): number {
  return lerp(OBSTACLE_SPACING_START, OBSTACLE_SPACING_END, levelProgress(y));
}

export function isOnRoad(x: number, y: number): boolean {
  const half = roadWidthAt(y) / 2;
  const cx = roadCenterX(y);
  return x > cx - half && x < cx + half;
}
