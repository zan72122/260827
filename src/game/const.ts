// World layout and shared constants.
// Y is up. The sea surface sits at WATER_Y; the snow-covered ice top is ~y=0.
// The route runs roughly from -Z (start) to +Z (port).

export const WATER_Y = -0.6;
export const ICE_TOP_Y = 0;

// Ice field extents (metres)
export const FIELD_MIN_X = -230;
export const FIELD_MAX_X = 230;
export const FIELD_MIN_Z = -260;
export const FIELD_MAX_Z = 300;
export const FIELD_W = FIELD_MAX_X - FIELD_MIN_X;
export const FIELD_L = FIELD_MAX_Z - FIELD_MIN_Z;

// Fictional mid-size icebreaker "Hokuto" — dimensions grounded in real
// coastal/patrol icebreakers (spoon bow, wide beam, moderate draft).
export const IB_LENGTH = 46;
export const IB_BEAM = 11;
export const IB_DRAFT = 4.0;

// Supply coaster
export const SUPPLY_LENGTH = 26;
export const SUPPLY_BEAM = 7;

// Channel carved through the ice: a bit wider than the beam.
export const CHANNEL_HALF = IB_BEAM * 0.92;

// Manoeuvring
export const MIN_TURN_RADIUS = 55;
export const IB_BASE_SPEED = 11.5; // m/s (gameplay speed)
export const SUPPLY_SPEED = 9.0;

// Key world points
export const START = { x: 0, z: -172 };
export const START_HEADING = 0; // radians; forward = (sin h, 0, cos h) => +Z
export const PORT_DOCK = { x: 16, z: 208 };      // berth position (supply ship stops here)
export const PORT_APPROACH = { x: 12, z: 168 };  // where auto-routes converge
export const IB_HOLDING = { x: -56, z: 248 };    // icebreaker waits here, clear of the berth

// Obstacles the route bends around (islet + a seal hauled out on a floe)
export interface Obstacle { x: number; z: number; r: number }
export const OBSTACLES: Obstacle[] = [
  { x: -62, z: 26, r: 26 },   // rocky islet
  { x: 55, z: -62, r: 15 },   // seal floe
];

// Deterministic RNG (mulberry32)
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
