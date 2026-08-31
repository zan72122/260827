import * as THREE from 'three';

/* ------------------------------------------------------------------ *
 * Small deterministic, tileable value noise. Everything in this file
 * is generated once at start-up; nothing is random per frame.
 * ------------------------------------------------------------------ */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class TileNoise {
  private g: Float32Array;
  constructor(private n: number, seed: number) {
    const rnd = mulberry32(seed);
    this.g = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) this.g[i] = rnd();
  }
  /** x, y in [0,1); wraps seamlessly */
  at(x: number, y: number): number {
    const n = this.n;
    const fx = x * n, fy = y * n;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const i0 = ((x0 % n) + n) % n, j0 = ((y0 % n) + n) % n;
    const i1 = (i0 + 1) % n, j1 = (j0 + 1) % n;
    const a = this.g[j0 * n + i0], b = this.g[j0 * n + i1];
    const c = this.g[j1 * n + i0], d = this.g[j1 * n + i1];
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  }
}

function fbm(noises: TileNoise[], x: number, y: number, sx: number, sy: number): number {
  let v = 0, amp = 0.5, f = 1;
  for (const n of noises) {
    v += amp * n.at(x * sx * f, y * sy * f);
    amp *= 0.5; f *= 2;
  }
  return v * 2; // roughly 0..1
}

function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return { c, ctx: c.getContext('2d', { willReadFrequently: false })! };
}

function toTexture(canvas: HTMLCanvasElement, repeat = 1, srgb = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export interface WoodMaps {
  map: THREE.Texture;
  roughnessMap: THREE.Texture;
  bumpMap: THREE.Texture;
}

/**
 * Linden: very pale, almost white-cream, with fine straight grain.
 * Grain runs along texture U. Contrast is deliberately low — the grain must
 * read as colour, not as relief.
 */
export function makeLindenMaps(seed = 7, size = 1024): WoodMaps {
  const nz = [new TileNoise(16, seed), new TileNoise(32, seed + 1), new TileNoise(64, seed + 2)];
  const fine = [new TileNoise(64, seed + 5), new TileNoise(128, seed + 6)];

  const col = makeCanvas(size, size);
  const rgh = makeCanvas(size, size);
  const bmp = makeCanvas(size, size);
  const ci = col.ctx.createImageData(size, size);
  const ri = rgh.ctx.createImageData(size, size);
  const bi = bmp.ctx.createImageData(size, size);

  // pale linden: creamy white with a faint warm cast
  const light = [224, 208, 176];
  const dark = [180, 152, 111];

  const LINES = 34; // grain lines across the V axis, integer so it tiles

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      // grain wanders very slowly along its own length
      // linden that has grown straight: the grain wanders only slightly
      const warp = (fbm(nz, u, v, 1.0, 0.30) - 0.5) * 0.011
                 + (fbm(fine, u, v, 2.5, 0.8) - 0.5) * 0.0028;
      const phase = (v + warp) * LINES;
      const saw = Math.abs(((phase % 1) + 1) % 1 - 0.5) * 2; // 0..1 triangle
      // thin darker line, wide pale field
      let g = Math.pow(1 - saw, 4.5);
      // vessel speckle, stretched along the grain
      const pore = fbm(fine, u, v, 2.5, 26.0);
      g = g * 0.72 + Math.max(0, pore - 0.62) * 1.5;
      g = Math.min(1, g);

      const i = (y * size + x) * 4;
      for (let k = 0; k < 3; k++) ci.data[i + k] = Math.round(light[k] + (dark[k] - light[k]) * g);
      ci.data[i + 3] = 255;

      // unfinished wood: uniformly matte, a touch rougher on the open grain
      const r = 0.80 + g * 0.10 + (fbm(fine, u, v, 6, 6) - 0.5) * 0.05;
      const rv = Math.round(Math.max(0, Math.min(1, r)) * 255);
      ri.data[i] = ri.data[i + 1] = ri.data[i + 2] = rv; ri.data[i + 3] = 255;

      // relief: only the open pores, and only barely
      const bv = Math.round(255 * (1 - g * 0.55));
      bi.data[i] = bi.data[i + 1] = bi.data[i + 2] = bv; bi.data[i + 3] = 255;
    }
  }
  col.ctx.putImageData(ci, 0, 0);
  rgh.ctx.putImageData(ri, 0, 0);
  bmp.ctx.putImageData(bi, 0, 0);
  return {
    map: toTexture(col.c, 1, true),
    roughnessMap: toTexture(rgh.c),
    bumpMap: toTexture(bmp.c),
  };
}

/** Older, darker, used bench top: same grain family, worked surface. */
export function makeBenchMaps(seed = 21, size = 1024): WoodMaps {
  const nz = [new TileNoise(16, seed), new TileNoise(32, seed + 1), new TileNoise(64, seed + 2)];
  const fine = [new TileNoise(64, seed + 5), new TileNoise(128, seed + 6)];
  const blot = [new TileNoise(8, seed + 9), new TileNoise(16, seed + 10)];

  const col = makeCanvas(size, size);
  const rgh = makeCanvas(size, size);
  const bmp = makeCanvas(size, size);
  const ci = col.ctx.createImageData(size, size);
  const ri = rgh.ctx.createImageData(size, size);
  const bi = bmp.ctx.createImageData(size, size);

  const light = [138, 106, 72];
  const dark = [78, 55, 34];
  const LINES = 18;

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const warp = (fbm(nz, u, v, 1.0, 0.4) - 0.5) * 0.09;
      const phase = (v + warp) * LINES;
      const saw = Math.abs(((phase % 1) + 1) % 1 - 0.5) * 2;
      let g = Math.pow(1 - saw, 2.2) * 0.8;
      // stains and worn patches — irregular, never mirrored
      const stain = Math.max(0, fbm(blot, u, v, 1.0, 1.0) - 0.52) * 2.2;
      const scuff = Math.max(0, fbm(fine, u, v, 8.0, 0.7) - 0.60) * 1.6;
      g = Math.min(1, g + stain * 0.6);

      const i = (y * size + x) * 4;
      for (let k = 0; k < 3; k++) {
        const base = light[k] + (dark[k] - light[k]) * g;
        ci.data[i + k] = Math.round(Math.max(0, Math.min(255, base + scuff * 26)));
      }
      ci.data[i + 3] = 255;

      const r = 0.86 - scuff * 0.30 + stain * 0.05;
      const rv = Math.round(Math.max(0.25, Math.min(1, r)) * 255);
      ri.data[i] = ri.data[i + 1] = ri.data[i + 2] = rv; ri.data[i + 3] = 255;

      const bv = Math.round(255 * (1 - g * 0.5 - scuff * 0.2));
      bi.data[i] = bi.data[i + 1] = bi.data[i + 2] = Math.max(0, bv); bi.data[i + 3] = 255;
    }
  }
  col.ctx.putImageData(ci, 0, 0);
  rgh.ctx.putImageData(ri, 0, 0);
  bmp.ctx.putImageData(bi, 0, 0);
  return {
    map: toTexture(col.c, 1, true),
    roughnessMap: toTexture(rgh.c),
    bumpMap: toTexture(bmp.c),
  };
}

export interface SteelMaps { roughnessMap: THREE.Texture; bumpMap: THREE.Texture; }

/**
 * Worked steel: fine scratches that all run the same way — the direction the
 * tool is sharpened and used in. Texture U is that direction.
 */
export function makeSteelMaps(seed = 33, size = 512): SteelMaps {
  const long = [new TileNoise(128, seed), new TileNoise(256, seed + 1)];
  const patch = [new TileNoise(8, seed + 3), new TileNoise(16, seed + 4)];
  const rgh = makeCanvas(size, size);
  const bmp = makeCanvas(size, size);
  const ri = rgh.ctx.createImageData(size, size);
  const bi = bmp.ctx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      // scratches: high frequency across, very low along -> streaks
      const s = fbm(long, u, v, 0.6, 30.0);
      const streak = Math.max(0, Math.abs(s - 0.5) * 2 - 0.62) * 1.1;
      const wear = fbm(patch, u, v, 1, 1);
      const i = (y * size + x) * 4;
      const r = 0.17 + streak * 0.22 + wear * 0.10;
      const rv = Math.round(Math.max(0, Math.min(1, r)) * 255);
      ri.data[i] = ri.data[i + 1] = ri.data[i + 2] = rv; ri.data[i + 3] = 255;
      const bv = Math.round(255 * (0.5 + (s - 0.5) * 0.22));
      bi.data[i] = bi.data[i + 1] = bi.data[i + 2] = bv; bi.data[i + 3] = 255;
    }
  }
  rgh.ctx.putImageData(ri, 0, 0);
  bmp.ctx.putImageData(bi, 0, 0);
  return { roughnessMap: toTexture(rgh.c), bumpMap: toTexture(bmp.c) };
}

/** Plain plaster / painted wall for the back of the room. */
export function makeWallMap(seed = 51, size = 512): THREE.Texture {
  const nz = [new TileNoise(8, seed), new TileNoise(32, seed + 1), new TileNoise(64, seed + 2)];
  const { c, ctx } = makeCanvas(size, size);
  const im = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const g = fbm(nz, x / size, y / size, 1, 1);
      const i = (y * size + x) * 4;
      im.data[i] = Math.round(150 + g * 26);
      im.data[i + 1] = Math.round(142 + g * 26);
      im.data[i + 2] = Math.round(129 + g * 24);
      im.data[i + 3] = 255;
    }
  }
  ctx.putImageData(im, 0, 0);
  return toTexture(c, 1, true);
}
