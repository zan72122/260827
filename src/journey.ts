// journeyProgress model — everything is reconstructed deterministically from p in [0,1].

export const SURFACE_Y = 0;
export const DEEP_Y = -60; // visual metres, represents ~300 m of real borehole
export const REAL_DEPTH = 300;
export const DRILL_LEN = 3.5; // sonde length (m), Hans Tausen short configuration
export const DRILL_HALF = DRILL_LEN / 2;
export const CORE_LEN = 1.05; // one run of 98 mm core
// radial scale: real radii ×2.2 for readability, ratios preserved
export const R_CORE = 0.11; // 98mm/2 * 2.2
export const R_BARREL = 0.15;
export const R_HOLE = 0.5; // visual borehole mouth (cutaway convention)
export const R_CABLE = 0.02;

export const P_BREAK_END = 0.1;
export const P_ASCENT_END = 0.9;
export const P_OUT_END = 0.96; // fully out of the hole, hanging on tower

const DEEP_CENTER = DEEP_Y + DRILL_HALF; // -58.25
const TOP_CENTER = -DRILL_HALF; // drill top exactly at surface
const OUT_CENTER = 2.15; // hanging above the hole

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
export function smooth(x: number): number {
  x = clamp01(x);
  return x * x * (3 - 2 * x);
}
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Drill (sonde) centre Y in world metres for a given journeyProgress. */
export function drillCenterY(p: number): number {
  p = clamp01(p);
  if (p <= P_BREAK_END) {
    // cable tightens, core is broken off its base: barely rises
    return DEEP_CENTER + 0.07 * smooth(p / P_BREAK_END);
  }
  if (p <= P_ASCENT_END) {
    const t = (p - P_BREAK_END) / (P_ASCENT_END - P_BREAK_END);
    return lerp(DEEP_CENTER + 0.07, TOP_CENTER, smooth(t));
  }
  if (p <= P_OUT_END) {
    const t = (p - P_ASCENT_END) / (P_OUT_END - P_ASCENT_END);
    return lerp(TOP_CENTER, OUT_CENTER, smooth(t));
  }
  return OUT_CENTER;
}

/** 0..1 strength of the light seen from below, growing while the exit approaches. */
export function exitGlow(p: number): number {
  return smooth((p - 0.7) / 0.2);
}

/** Reveal phase 0..1 (tilt tower, open barrel, expose core). */
export function revealT(p: number): number {
  return clamp01((p - P_OUT_END) / (1 - P_OUT_END));
}

/** Wind / brightness of the outside world blends in near the seam. */
export function surfaceness(p: number): number {
  return smooth((p - 0.82) / 0.1);
}

// Deterministic PRNG for scene construction
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hash1(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
