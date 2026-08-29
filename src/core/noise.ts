import { Rng } from './rng';

/** Tileable value noise. Used by every procedural texture so that crumb, cream
 *  and skin detail wrap without visible seams on the cake's curved surfaces. */
export class ValueNoise {
  private readonly size: number;
  private readonly grid: Float32Array;

  constructor(seed: number, size = 64) {
    this.size = size;
    this.grid = new Float32Array(size * size);
    const rng = new Rng(seed);
    for (let i = 0; i < this.grid.length; i++) this.grid[i] = rng.next();
  }

  private at(ix: number, iy: number): number {
    const n = this.size;
    return this.grid[(((iy % n) + n) % n) * n + (((ix % n) + n) % n)];
  }

  /** x, y in grid units. */
  sample(x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = this.at(ix, iy);
    const b = this.at(ix + 1, iy);
    const c = this.at(ix, iy + 1);
    const d = this.at(ix + 1, iy + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }

  /** Fractal sum in [0,1]; `freq` is in grid cells across the unit square. */
  fbm(u: number, v: number, freq: number, octaves = 4, gain = 0.5): number {
    let amp = 1;
    let sum = 0;
    let norm = 0;
    let f = freq;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.sample(u * f, v * f);
      norm += amp;
      amp *= gain;
      f *= 2;
    }
    return sum / norm;
  }
}

/** Derive a tangent-space normal map from a luminance height field. */
export function heightToNormal(
  height: Float32Array,
  w: number,
  h: number,
  strength: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  const idx = (x: number, y: number) => ((y + h) % h) * w + ((x + w) % w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (height[idx(x + 1, y)] - height[idx(x - 1, y)]) * strength;
      const dy = (height[idx(x, y + 1)] - height[idx(x, y - 1)]) * strength;
      let nx = -dx;
      let ny = -dy;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      const o = (y * w + x) * 4;
      out[o] = (nx * 0.5 + 0.5) * 255;
      out[o + 1] = (ny * 0.5 + 0.5) * 255;
      out[o + 2] = (nz / len) * 0.5 * 255 + 127.5;
      out[o + 3] = 255;
    }
  }
  return out;
}
