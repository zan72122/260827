/**
 * Deterministic seeded RNG (mulberry32). Every procedural asset in the plaza is
 * built from a fixed seed so the scene is byte-identical between runs and tests.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  /** Signed symmetric jitter in [-amount, amount]. */
  jitter(amount: number): number {
    return (this.next() * 2 - 1) * amount;
  }

  int(loInclusive: number, hiInclusive: number): number {
    return Math.floor(this.range(loInclusive, hiInclusive + 1 - 1e-9));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.min(items.length - 1, Math.floor(this.next() * items.length))];
  }
}
