import {
  CanvasTexture,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';

/**
 * Every surface texture in the game is generated here at boot.
 *
 * Nothing larger than 512px is produced: the goal is grain, wear and edge
 * information, not photographic detail, and small maps keep the first load on
 * a phone short.
 */

// ---------------------------------------------------------------- noise ----

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class ValueNoise {
  private g: Float32Array;
  private size: number;
  constructor(size: number, seed: number) {
    this.size = size;
    this.g = new Float32Array(size * size);
    const rnd = mulberry(seed);
    for (let i = 0; i < this.g.length; i++) this.g[i] = rnd();
  }
  private at(x: number, y: number): number {
    const s = this.size;
    return this.g[(((y % s) + s) % s) * s + (((x % s) + s) % s)];
  }
  /** tileable bilinear value noise */
  sample(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = this.at(xi, yi);
    const b = this.at(xi + 1, yi);
    const c = this.at(xi, yi + 1);
    const d = this.at(xi + 1, yi + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }
}

export function fbm(
  noises: ValueNoise[],
  x: number,
  y: number,
  base: number,
  octaves: number,
  gain = 0.5,
): number {
  let amp = 1;
  let sum = 0;
  let norm = 0;
  let f = base;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noises[o % noises.length].sample(x * f, y * f);
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / norm;
}

function noiseBank(seed: number, count = 4): ValueNoise[] {
  const out: ValueNoise[] = [];
  for (let i = 0; i < count; i++) out.push(new ValueNoise(64, seed + i * 7919));
  return out;
}

// ------------------------------------------------------------- helpers ----

function makeCanvas(size: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  return { c, ctx };
}

function finish(c: HTMLCanvasElement, srgb: boolean, repeat = 1): Texture {
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(repeat, repeat);
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Height field -> tangent-space normal map, so bumps read under any light. */
function heightToNormal(height: Float32Array, size: number, strength: number): Texture {
  const { c, ctx } = makeCanvas(size);
  const img = ctx.createImageData(size, size);
  const at = (x: number, y: number) =>
    height[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx;
      let ny = -dy;
      const nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      const i = (y * size + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz / l) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return finish(c, false);
}

function grayTexture(size: number, fn: (x: number, y: number) => number, repeat = 1): Texture {
  const { c, ctx } = makeCanvas(size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = Math.max(0, Math.min(1, fn(x / size, y / size))) * 255;
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return finish(c, false, repeat);
}

function colorTexture(
  size: number,
  fn: (x: number, y: number) => [number, number, number],
  repeat = 1,
): Texture {
  const { c, ctx } = makeCanvas(size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = fn(x / size, y / size);
      const i = (y * size + x) * 4;
      img.data[i] = Math.max(0, Math.min(255, r * 255));
      img.data[i + 1] = Math.max(0, Math.min(255, g * 255));
      img.data[i + 2] = Math.max(0, Math.min(255, b * 255));
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return finish(c, true, repeat);
}

// ------------------------------------------------------------- library ----

export interface TextureLibrary {
  leatherColor: Texture;
  leatherNormal: Texture;
  leatherRough: Texture;
  brassColor: Texture;
  brassRough: Texture;
  brassNormal: Texture;
  ironColor: Texture;
  ironRough: Texture;
  woodColor: Texture;
  woodRough: Texture;
  woodNormal: Texture;
  snowColor: Texture;
  snowNormal: Texture;
  snowRough: Texture;
  plasterColor: Texture;
  barkColor: Texture;
  flake: Texture;
  puff: Texture;
  shadowBlob: Texture;
}

let cached: TextureLibrary | null = null;

export function buildTextures(): TextureLibrary {
  if (cached) return cached;

  // -- leather: pores, a coarse grain direction, creases and oiled patches --
  const ln = noiseBank(1201);
  const lsize = 512;
  const leatherHeight = new Float32Array(lsize * lsize);
  for (let y = 0; y < lsize; y++) {
    for (let x = 0; x < lsize; x++) {
      const u = x / lsize;
      const v = y / lsize;
      const pores = fbm(ln, u, v, 34, 4, 0.55);
      const grain = fbm(ln, u * 1.7, v * 0.35, 12, 3, 0.6);
      // Bend creases run across the strap, tightening where it curves.
      const crease = Math.pow(Math.abs(Math.sin((v + fbm(ln, u, v, 5, 2) * 0.35) * Math.PI * 9)), 6);
      leatherHeight[y * lsize + x] = pores * 0.55 + grain * 0.3 - crease * 0.28;
    }
  }
  const leatherNormal = heightToNormal(leatherHeight, lsize, 2.6);
  const leatherColor = colorTexture(lsize, (u, v) => {
    const h = leatherHeight[Math.floor(v * lsize) * lsize + Math.floor(u * lsize)];
    const oil = fbm(ln, u * 0.9, v * 0.9, 3.2, 3);
    // Warm, slightly reddish harness leather, darker where oil has soaked in.
    const base = 0.5 + h * 0.42 - oil * 0.2;
    const wear = fbm(ln, u * 2.1, v * 0.8, 7, 3);
    const light = base + wear * 0.12;
    // Values are written in sRGB and decoded to linear on upload, so the
    // albedo has to be authored at the brightness a photo of the strap has.
    return [0.3 + light * 0.24, 0.18 + light * 0.17, 0.115 + light * 0.11];
  });
  const leatherRough = grayTexture(256, (u, v) => {
    const h = fbm(ln, u, v, 22, 3);
    const oil = fbm(ln, u * 0.9, v * 0.9, 3.2, 3);
    return 0.86 - oil * 0.3 + h * 0.1;
  });

  // -- brass: cast body, punch marks, slit soot, oxidation in the crevices --
  const bn = noiseBank(4409);
  const bsize = 256;
  const brassHeight = new Float32Array(bsize * bsize);
  for (let y = 0; y < bsize; y++) {
    for (let x = 0; x < bsize; x++) {
      const u = x / bsize;
      const v = y / bsize;
      const cast = fbm(bn, u, v, 26, 4, 0.5) * 0.4;
      // Sparse hammer / punch dents left by forming the shell, plus the
      // shallow ring the stamping die left around the crown.
      let dents = 0;
      for (const [dx, dy, k, w] of [
        [0.31, 0.44, 22, 1],
        [0.68, 0.7, 27, 0.85],
        [0.82, 0.2, 33, 0.7],
        [0.18, 0.78, 30, 0.65],
        [0.52, 0.16, 36, 0.5],
      ] as Array<[number, number, number, number]>) {
        dents += Math.max(0, 1 - Math.hypot(u - dx, v - dy) * k) ** 2 * w;
      }
      brassHeight[y * bsize + x] = cast - dents * 0.85;
    }
  }
  const brassNormal = heightToNormal(brassHeight, bsize, 1.5);
  const brassColor = colorTexture(bsize, (u, v) => {
    const ox = fbm(bn, u * 1.3, v * 1.3, 5.5, 4);
    const dirt = fbm(bn, u, v, 17, 3);
    // Aged yellow brass: green-brown oxide in the low spots, brighter where a
    // hand or a strap has kept rubbing it.
    const polish = Math.max(0, fbm(bn, u * 0.7, v * 2.4, 2.4, 2) - 0.42) * 1.9;
    // Yellow brass: bright where a hand or a strap keeps rubbing it, green
    // and brown where the oxide has settled into the low spots.
    const r = 0.88 - ox * 0.26 + polish * 0.1;
    const g = 0.72 - ox * 0.2 + polish * 0.11;
    const b = 0.36 - ox * 0.1 + polish * 0.1;
    const d = 1 - dirt * 0.14;
    return [r * d, g * d, b * d];
  });
  const brassRough = grayTexture(bsize, (u, v) => {
    const ox = fbm(bn, u * 1.3, v * 1.3, 5.5, 4);
    const polish = Math.max(0, fbm(bn, u * 0.7, v * 2.4, 2.4, 2) - 0.42) * 1.9;
    // Never a mirror: even the polished patches keep some tooth.
    return Math.min(1, 0.42 + ox * 0.42 - polish * 0.16);
  });

  // -- iron: forged buckle stock, dark, matte, faintly pitted --------------
  const inz = noiseBank(7717);
  const ironColor = colorTexture(128, (u, v) => {
    const n = fbm(inz, u, v, 14, 3);
    const rust = Math.max(0, fbm(inz, u * 1.6, v * 1.6, 4, 3) - 0.55) * 1.6;
    const g = 0.36 + n * 0.2;
    return [g + rust * 0.14, g + rust * 0.04, g * 0.96];
  });
  const ironRough = grayTexture(128, (u, v) => 0.52 + fbm(inz, u, v, 14, 3) * 0.32);

  // -- old barn timber: rings, splits, worn end grain --------------------
  const wn = noiseBank(3301);
  const wsize = 256;
  const woodHeight = new Float32Array(wsize * wsize);
  for (let y = 0; y < wsize; y++) {
    for (let x = 0; x < wsize; x++) {
      const u = x / wsize;
      const v = y / wsize;
      const warp = fbm(wn, u, v, 3.5, 3) * 0.28;
      const rings = Math.sin((v * 13 + warp * 8) * Math.PI * 2) * 0.5 + 0.5;
      const fiber = fbm(wn, u * 0.3, v * 6, 20, 3);
      woodHeight[y * wsize + x] = rings * 0.5 + fiber * 0.5;
    }
  }
  const woodNormal = heightToNormal(woodHeight, wsize, 1.4);
  const woodColor = colorTexture(wsize, (u, v) => {
    const h = woodHeight[Math.floor(v * wsize) * wsize + Math.floor(u * wsize)];
    const t = 0.55 + h * 0.5;
    return [0.22 + t * 0.34, 0.165 + t * 0.26, 0.125 + t * 0.19];
  });
  const woodRough = grayTexture(wsize, (u, v) => {
    const h = woodHeight[Math.floor(v * wsize) * wsize + Math.floor(u * wsize)];
    return 0.72 + h * 0.2;
  });

  // -- snow: fine sparkle-free grain with wind ripples and a crust --------
  const sn = noiseBank(9931);
  const ssize = 256;
  const snowHeight = new Float32Array(ssize * ssize);
  for (let y = 0; y < ssize; y++) {
    for (let x = 0; x < ssize; x++) {
      const u = x / ssize;
      const v = y / ssize;
      const grain = fbm(sn, u, v, 40, 3, 0.5);
      const drift = fbm(sn, u * 0.6, v, 4, 3);
      const ripple = Math.sin((u * 6 + drift * 3) * Math.PI * 2) * 0.5 + 0.5;
      snowHeight[y * ssize + x] = grain * 0.55 + ripple * drift * 0.45;
    }
  }
  const snowNormal = heightToNormal(snowHeight, ssize, 1.15);
  const snowColor = colorTexture(ssize, (u, v) => {
    const h = snowHeight[Math.floor(v * ssize) * ssize + Math.floor(u * ssize)];
    // Snow is white, not blue. The blue comes from the sky light, in the shader.
    const t = 0.9 + h * 0.1;
    return [t, t, t * 0.995];
  });
  const snowRough = grayTexture(ssize, (u, v) => 0.62 + fbm(sn, u, v, 30, 3) * 0.3);

  // -- lime-washed plaster for the tack room wall ------------------------
  const pn = noiseBank(5501);
  const plasterColor = colorTexture(128, (u, v) => {
    const n = fbm(pn, u, v, 8, 4);
    const t = 0.5 + n * 0.26;
    return [t, t * 0.95, t * 0.87];
  });

  // -- winter bark -------------------------------------------------------
  const kn = noiseBank(2207);
  const barkColor = colorTexture(64, (u, v) => {
    const n = fbm(kn, u * 0.4, v * 3.2, 12, 3);
    const t = 0.3 + n * 0.28;
    return [t, t * 0.92, t * 0.86];
  });

  // -- sprites -----------------------------------------------------------
  const flake = (() => {
    const { c, ctx } = makeCanvas(32);
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    const t = new CanvasTexture(c);
    t.needsUpdate = true;
    return t;
  })();

  const puff = (() => {
    const size = 64;
    const { c, ctx } = makeCanvas(size);
    const img = ctx.createImageData(size, size);
    const nn = noiseBank(8123);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;
        const d = Math.hypot(u - 0.5, v - 0.5) * 2;
        const n = fbm(nn, u, v, 5, 3);
        const a = Math.max(0, 1 - d / (0.55 + n * 0.5)) ** 1.6 * (0.55 + n * 0.6);
        const i = (y * size + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.min(255, a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    const t = new CanvasTexture(c);
    t.needsUpdate = true;
    return t;
  })();

  const shadowBlob = (() => {
    const { c, ctx } = makeCanvas(64);
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.24)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const t = new CanvasTexture(c);
    t.needsUpdate = true;
    return t;
  })();

  cached = {
    leatherColor,
    leatherNormal,
    leatherRough,
    brassColor,
    brassRough,
    brassNormal,
    ironColor,
    ironRough,
    woodColor,
    woodRough,
    woodNormal,
    snowColor,
    snowNormal,
    snowRough,
    plasterColor,
    barkColor,
    flake,
    puff,
    shadowBlob,
  };
  return cached;
}
