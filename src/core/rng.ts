/** Deterministic, seedable PRNG (mulberry32). No global state. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Uniform in [a, b). */
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  /** Symmetric noise in [-m, m). */
  sym(m: number): number {
    return this.range(-m, m);
  }
  fork(salt: number): Rng {
    return new Rng((this.s ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0);
  }
}
