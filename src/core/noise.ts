/** Tileable value-noise field used by every procedural texture in the project. */
export class NoiseField {
  private readonly perm: Uint8Array;

  constructor(seed: number) {
    this.perm = new Uint8Array(512);
    let s = seed >>> 0 || 7;
    const base = new Uint8Array(256);
    for (let i = 0; i < 256; i++) base[i] = i;
    for (let i = 255; i > 0; i--) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const j = s % (i + 1);
      const t = base[i];
      base[i] = base[j];
      base[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = base[i & 255];
  }

  private hash(x: number, y: number): number {
    return this.perm[(this.perm[x & 255] + y) & 255] / 255;
  }

  /** Value noise on an integer lattice with period `period` (keeps textures seamless). */
  value(x: number, y: number, period: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const p = (n: number) => ((n % period) + period) % period;
    const x0 = p(xi);
    const x1 = p(xi + 1);
    const y0 = p(yi);
    const y1 = p(yi + 1);
    const a = this.hash(x0, y0);
    const b = this.hash(x1, y0);
    const c = this.hash(x0, y1);
    const d = this.hash(x1, y1);
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  }

  fbm(x: number, y: number, period: number, octaves = 4, gain = 0.5): number {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = 1;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.value(x * f, y * f, period * f);
      norm += amp;
      amp *= gain;
      f *= 2;
    }
    return sum / norm;
  }

  /** Distance to the nearest jittered cell point, in cell units (Worley F1). */
  cell(x: number, y: number, period: number): { d: number; id: number } {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    let best = 9;
    let id = 0;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const cx = (((xi + i) % period) + period) % period;
        const cy = (((yi + j) % period) + period) % period;
        const px = xi + i + this.hash(cx, cy);
        const py = yi + j + this.hash(cx + 37, cy + 11);
        const dx = px - x;
        const dy = py - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < best) {
          best = d;
          id = (cx * 131 + cy * 57) % 997;
        }
      }
    }
    return { d: best, id };
  }
}
