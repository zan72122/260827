// Small math / random / animation helpers shared across the game.

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function remap(v: number, a0: number, a1: number, b0: number, b1: number): number {
  return b0 + (b1 - b0) * clamp01((v - a0) / (a1 - a0));
}

// Framerate-independent exponential smoothing toward a target.
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function easeInOut(t: number): number {
  return t * t * (3 - 2 * t);
}

export function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

export function easeIn(t: number): number {
  return t * t;
}

export function easeOutBack(t: number): number {
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export function easeOutElastic(t: number): number {
  const c4 = (2 * Math.PI) / 3;
  if (t === 0 || t === 1) return t;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
}

// Mulberry32 seeded RNG — deterministic per-house variation.
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;

export function rr(rng: Rng, a: number, b: number): number {
  return a + (b - a) * rng();
}

// Cheap value noise for texture generation (not perf critical, build-time only).
export function makeNoise2D(rng: Rng): (x: number, y: number) => number {
  const size = 64;
  const grid: number[] = [];
  for (let i = 0; i < size * size; i++) grid.push(rng());
  const g = (x: number, y: number) =>
    grid[((y % size) + size) % size * size + (((x % size) + size) % size)];
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const sx = easeInOut(xf), sy = easeInOut(yf);
    const a = lerp(g(xi, yi), g(xi + 1, yi), sx);
    const b = lerp(g(xi, yi + 1), g(xi + 1, yi + 1), sx);
    return lerp(a, b, sy);
  };
}

export function fbm(noise: (x: number, y: number) => number, x: number, y: number, oct = 4): number {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    v += amp * noise(x * f, y * f);
    amp *= 0.5;
    f *= 2;
  }
  return v;
}

// ------- tiny tween/timeline system -------

export interface Tween {
  update(dt: number): boolean; // returns true while alive
}

export class Timeline {
  private items: { start: number; dur: number; fn: (t: number) => void; done?: () => void; fired: boolean; finished: boolean }[] = [];
  private calls: { at: number; fn: () => void; fired: boolean }[] = [];
  time = 0;
  private len = 0;
  private onComplete: (() => void) | null = null;
  private completed = false;

  add(start: number, dur: number, fn: (t: number) => void, done?: () => void): this {
    this.items.push({ start, dur, fn, done, fired: false, finished: false });
    this.len = Math.max(this.len, start + dur);
    return this;
  }

  call(at: number, fn: () => void): this {
    this.calls.push({ at, fn, fired: false });
    this.len = Math.max(this.len, at);
    return this;
  }

  then(fn: () => void): this {
    this.onComplete = fn;
    return this;
  }

  get duration(): number {
    return this.len;
  }

  update(dt: number): boolean {
    this.time += dt;
    for (const c of this.calls) {
      if (!c.fired && this.time >= c.at) {
        c.fired = true;
        c.fn();
      }
    }
    for (const it of this.items) {
      if (this.time >= it.start && !it.finished) {
        it.fired = true;
        const t = it.dur <= 0 ? 1 : clamp01((this.time - it.start) / it.dur);
        it.fn(t);
        if (t >= 1) {
          it.finished = true;
          if (it.done) it.done();
        }
      }
    }
    if (this.time >= this.len && !this.completed) {
      this.completed = true;
      if (this.onComplete) this.onComplete();
    }
    return this.time < this.len;
  }
}
