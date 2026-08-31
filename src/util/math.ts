import * as THREE from 'three';

export const TAU = Math.PI * 2;

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const smoothstep = (t: number): number => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

export const easeInOut = (t: number): number => {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

export const easeOut = (t: number): number => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

/** Wrap an angle difference into (-PI, PI]. */
export const wrapAngle = (a: number): number => {
  let x = a;
  while (x > Math.PI) x -= TAU;
  while (x <= -Math.PI) x += TAU;
  return x;
};

/** Frame-rate independent exponential approach. */
export const damp = (current: number, target: number, lambda: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

export const dampVec = (
  current: THREE.Vector3,
  target: THREE.Vector3,
  lambda: number,
  dt: number,
): void => {
  const t = 1 - Math.exp(-lambda * dt);
  current.lerp(target, t);
};

/**
 * Small deterministic PRNG (mulberry32). Everything procedural in the project
 * seeds from this so a reload reproduces the same worktop, the same scuffs and
 * the same crumb.
 */
export function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cheap value noise on a ring, used for the uneven side coat of the cake. */
export function ringNoise(theta: number, seed: number, harmonics = 5): number {
  const rnd = makeRandom(seed);
  let sum = 0;
  let amp = 1;
  let total = 0;
  for (let h = 1; h <= harmonics; h++) {
    const phase = rnd() * TAU;
    sum += Math.sin(theta * h + phase) * amp;
    total += amp;
    amp *= 0.62;
  }
  return sum / total;
}
