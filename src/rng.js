// Small deterministic PRNG so wear, stains and scatter stay identical across
// redraws (a bench that reshuffles its scratches every frame reads as fake).
export function makeRng(seed = 1) {
  let s = (seed >>> 0) || 1;
  return function rng() {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
export const rand = (r, a, b) => a + r() * (b - a);
export const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const ease = (t) => t * t * (3 - 2 * t);
export const easeOut = (t) => 1 - (1 - t) * (1 - t);
