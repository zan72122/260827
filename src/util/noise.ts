import { Rng } from './rng';

/** Tileable value-noise + cellular noise used for every procedural texture. */
export class Noise {
  private perm: Uint8Array;
  private grad: Float32Array;

  constructor(seed = 7) {
    const rng = new Rng(seed);
    this.perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = rng.int(0, i);
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    this.grad = new Float32Array(512);
    for (let i = 0; i < 512; i++) this.grad[i] = rng.signed();
  }

  private hash(x: number, y: number): number {
    return this.grad[(this.perm[(x & 255) + this.perm[y & 255]] + 0) & 511];
  }

  /** Tiling value noise on a `period` lattice. */
  value(x: number, y: number, period: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const w = (a: number, b: number) => ((a % b) + b) % b;
    const x0 = w(xi, period);
    const x1 = w(xi + 1, period);
    const y0 = w(yi, period);
    const y1 = w(yi + 1, period);
    const n00 = this.hash(x0, y0);
    const n10 = this.hash(x1, y0);
    const n01 = this.hash(x0, y1);
    const n11 = this.hash(x1, y1);
    return (
      (n00 * (1 - u) + n10 * u) * (1 - v) + (n01 * (1 - u) + n11 * u) * v
    );
  }

  fbm(x: number, y: number, period: number, octaves = 4, gain = 0.5, lac = 2): number {
    let a = 1;
    let sum = 0;
    let norm = 0;
    let f = 1;
    for (let i = 0; i < octaves; i++) {
      sum += a * this.value(x * f, y * f, period * f);
      norm += a;
      a *= gain;
      f *= lac;
    }
    return sum / norm;
  }

  /** Tiling cellular noise. Returns { f1, f2, id } with distances normalised by `cells`. */
  cell(x: number, y: number, cells: number): { f1: number; f2: number; id: number } {
    const px = x * cells;
    const py = y * cells;
    const ix = Math.floor(px);
    const iy = Math.floor(py);
    let f1 = 9;
    let f2 = 9;
    let id = 0;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const cx = ix + ox;
        const cy = iy + oy;
        const wx = ((cx % cells) + cells) % cells;
        const wy = ((cy % cells) + cells) % cells;
        const jx = this.hash(wx, wy) * 0.5 + 0.5;
        const jy = this.hash(wx + 37, wy + 11) * 0.5 + 0.5;
        const dx = cx + jx - px;
        const dy = cy + jy - py;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < f1) {
          f2 = f1;
          f1 = d;
          id = wx * 131 + wy * 17;
        } else if (d < f2) {
          f2 = d;
        }
      }
    }
    return { f1, f2, id };
  }
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
