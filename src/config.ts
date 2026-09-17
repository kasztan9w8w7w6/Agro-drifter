export const GAME_WIDTH = 480;
export const GAME_HEIGHT = 270;

export const WORLD_WIDTH = 640;
// Total driving distance of this demo level, in world pixels.
export const WORLD_LENGTH = 5200;

export const ROAD_WIDTH = 200;
export const ROAD_CURVE_AMPLITUDE = 140;
export const ROAD_CURVE_PERIOD = 900;

// Car physics tuning (arcade drift model).
export const CAR_ACCEL = 420;
export const CAR_REVERSE_ACCEL = 220;
export const CAR_MAX_SPEED = 340;
export const CAR_REVERSE_MAX_SPEED = 140;
export const CAR_TURN_RATE = 2.6; // radians/sec at full steering, scaled by speed
export const CAR_BASE_GRIP = 7.5; // how fast lateral (slip) velocity bleeds off
export const CAR_HANDBRAKE_GRIP = 1.2;
export const CAR_NATURAL_DRAG = 0.994;

export const FUEL_MAX = 100;
export const FUEL_DRAIN_PER_WORLD_PX = FUEL_MAX / WORLD_LENGTH * 1.15;
export const FUEL_IDLE_DRAIN = 0.6; // per second, even when stopped (engine running)

export const DAMAGE_MAX = 100;

export const OBSTACLE_TYPES = ["deer", "bottle", "pothole"] as const;
export type ObstacleType = (typeof OBSTACLE_TYPES)[number];
