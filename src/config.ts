// Internal render resolution - deliberately low so pixels stay chunky and
// readable even after Phaser's FIT scale mode stretches the canvas up to
// fill a phone or desktop window (pixelArt:true keeps sampling nearest-
// neighbour, so this is the actual "art size", not just a perf knob).
export const GAME_WIDTH = 256;
export const GAME_HEIGHT = 144;

export const WORLD_WIDTH = 640;
// Total driving distance of this demo level, in world pixels.
export const WORLD_LENGTH = 5200;

// The road widens/narrows and curves more sharply as you approach the
// station, so difficulty ramps up over the length of the level instead of
// being flat from start to finish.
export const ROAD_WIDTH_START = 210;
export const ROAD_WIDTH_END = 150;
export const ROAD_CURVE_AMPLITUDE_START = 90;
export const ROAD_CURVE_AMPLITUDE_END = 170;
export const ROAD_CURVE_PERIOD_START = 1100;
export const ROAD_CURVE_PERIOD_END = 620;

// Car physics tuning (arcade drift model with slip-angle grip loss).
export const CAR_ACCEL = 420;
export const CAR_REVERSE_ACCEL = 220;
export const CAR_MAX_SPEED = 340;
export const CAR_REVERSE_MAX_SPEED = 140;
export const CAR_TURN_RATE = 3.1; // rad/sec at full steering + full speed
export const CAR_MIN_TURN_SPEED_RATIO = 0.22; // steering still works at low speed
export const CAR_BASE_GRIP = 8.5; // lateral speed bleed-off rate, on tarmac
export const CAR_OFFROAD_GRIP = 2.4; // much less grip off the asphalt
export const CAR_HANDBRAKE_GRIP = 1.1;
export const CAR_NATURAL_DRAG = 0.994;
export const CAR_OFFROAD_DRAG = 0.975; // extra rolling resistance on grass/dirt
export const DRIFT_SLIP_RATIO = 0.34; // |lateral|/|forward| above this counts as "drifting"
export const DRIFT_KICK = 1.8; // rad/sec instant yaw kick when handbrake tapped while turning

export const FUEL_MAX = 100;
export const FUEL_DRAIN_PER_WORLD_PX = (FUEL_MAX / WORLD_LENGTH) * 1.15;
export const FUEL_IDLE_DRAIN = 0.6; // per second, even when stopped (engine running)

export const DAMAGE_MAX = 100;

// Obstacles get denser the closer you are to the station.
export const OBSTACLE_SPACING_START = 320;
export const OBSTACLE_SPACING_END = 170;

export const OBSTACLE_TYPES = ["deer", "bottle", "pothole"] as const;
export type ObstacleType = (typeof OBSTACLE_TYPES)[number];
