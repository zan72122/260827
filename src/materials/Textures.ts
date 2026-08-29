import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import { Rng } from '../core/Rng';
import { clamp, lerp, smoothstep } from '../core/math';

/**
 * Procedural texture bakery.
 *
 * Every hero material (bark, sling webbing, galvanised and painted steel, stone
 * paving, cable jacket) is baked once into a canvas at boot. This keeps the
 * build asset-free and, more importantly, lets each surface carry the specific
 * story the brief asks for: vertical bark fissures and strap compression marks,
 * weave direction on the slings, spangle on galvanised steel, joints and wheel
 * paths on the paving.
 */

type Bake = (ctx: CanvasRenderingContext2D, size: number, rng: Rng) => void;

const canvasOf = (size: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable');
  return [canvas, ctx];
};

const bake = (size: number, seed: number, fn: Bake, srgb: boolean): Texture => {
  const [canvas, ctx] = canvasOf(size);
  fn(ctx, size, new Rng(seed));
  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.anisotropy = 4;
  if (srgb) tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
};

/** Tileable value noise, sampled with smooth interpolation. */
class ValueNoise {
  private readonly grid: Float32Array;
  constructor(private readonly n: number, rng: Rng) {
    this.grid = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) this.grid[i] = rng.next();
  }
  at(x: number, y: number): number {
    const n = this.n;
    const fx = x * n;
    const fy = y * n;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = smoothstep(fx - x0);
    const ty = smoothstep(fy - y0);
    const i0 = ((x0 % n) + n) % n;
    const j0 = ((y0 % n) + n) % n;
    const i1 = (i0 + 1) % n;
    const j1 = (j0 + 1) % n;
    const a = this.grid[j0 * n + i0];
    const b = this.grid[j0 * n + i1];
    const c = this.grid[j1 * n + i0];
    const d = this.grid[j1 * n + i1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
  }
  fbm(x: number, y: number, octaves: number, gain = 0.5): number {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = 1;
    for (let o = 0; o < octaves; o++) {
      sum += this.at(x * f, y * f) * amp;
      norm += amp;
      amp *= gain;
      f *= 2;
    }
    return sum / norm;
  }
}

const px = (data: Uint8ClampedArray, i: number, r: number, g: number, b: number) => {
  data[i] = clamp(r, 0, 255);
  data[i + 1] = clamp(g, 0, 255);
  data[i + 2] = clamp(b, 0, 255);
  data[i + 3] = 255;
};

/* ------------------------------------------------------------------ bark -- */

const barkFields = (rng: Rng) => {
  const noise = new ValueNoise(8, rng);
  const fine = new ValueNoise(32, rng);
  /** Height field of the bark: deep vertical fissures, plated ridges. */
  return (x: number, y: number): { h: number; resin: number } => {
    // Fissures run along the trunk (v axis) and wander slowly across it.
    const wander = (noise.fbm(x * 1.4, y * 0.35, 3) - 0.5) * 0.16;
    const ridged = Math.abs(Math.sin((x + wander) * Math.PI * 15));
    const fissure = Math.pow(ridged, 0.45);
    const plates = noise.fbm(x * 4.0, y * 1.6, 4);
    const grain = fine.fbm(x * 6.0, y * 3.0, 3);
    const h = clamp(fissure * 0.62 + plates * 0.26 + grain * 0.12, 0, 1);
    // Resin bleeds sit in a few discrete spots, mostly near the ridges.
    const blobs = noise.fbm(x * 3.0 + 11.3, y * 1.1 + 4.7, 2);
    const resin = clamp((blobs - 0.74) * 5.5, 0, 1) * clamp(h * 1.2, 0, 1);
    return { h, resin };
  };
};

/** Strap compression bands: the transport straps flatten the bark where they bite. */
const strapBands = [0.14, 0.36, 0.58, 0.79];
const strapMark = (v: number): number => {
  let m = 0;
  for (const b of strapBands) {
    const d = Math.abs(v - b);
    m = Math.max(m, clamp(1 - d / 0.02, 0, 1));
  }
  return m;
};

export const bakeBarkColor = (size = 512, seed = 7): Texture =>
  bake(
    size,
    seed,
    (ctx, n, rng) => {
      const field = barkFields(rng);
      const img = ctx.createImageData(n, n);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const u = x / n;
          const v = y / n;
          const { h, resin } = field(u, v);
          // Cool grey-brown conifer bark; fissures go darker and slightly redder.
          const base = lerp(46, 118, h);
          let r = base * 1.06;
          let g = base * 0.94;
          let b = base * 0.8;
          const mark = strapMark(v);
          r = lerp(r, r * 0.72 + 22, mark);
          g = lerp(g, g * 0.72 + 20, mark);
          b = lerp(b, b * 0.74 + 18, mark);
          // Amber resin.
          r = lerp(r, 196, resin);
          g = lerp(g, 150, resin);
          b = lerp(b, 74, resin);
          px(img.data, (y * n + x) * 4, r, g, b);
        }
      }
      ctx.putImageData(img, 0, 0);
    },
    true,
  );

export const bakeBarkBump = (size = 512, seed = 7): Texture =>
  bake(
    size,
    seed,
    (ctx, n, rng) => {
      const field = barkFields(rng);
      const img = ctx.createImageData(n, n);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const { h } = field(x / n, y / n);
          // Straps press the relief flat.
          const v = lerp(h, h * 0.35 + 0.3, strapMark(y / n)) * 255;
          px(img.data, (y * n + x) * 4, v, v, v);
        }
      }
      ctx.putImageData(img, 0, 0);
    },
    false,
  );

export const bakeBarkRoughness = (size = 256, seed = 9): Texture =>
  bake(
    size,
    seed,
    (ctx, n, rng) => {
      const field = barkFields(rng);
      const img = ctx.createImageData(n, n);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const { h, resin } = field(x / n, y / n);
          // Dry bark is very rough; resin is the only glossy thing on the trunk.
          const rough = lerp(lerp(0.98, 0.82, h), 0.24, resin) * 255;
          px(img.data, (y * n + x) * 4, rough, rough, rough);
        }
      }
      ctx.putImageData(img, 0, 0);
    },
    false,
  );

/** Freshly cut butt end: rings, saw kerf, sap. */
export const bakeCutFace = (size = 256, seed = 21): Texture =>
  bake(
    size,
    seed,
    (ctx, n, rng) => {
      const noise = new ValueNoise(16, rng);
      const img = ctx.createImageData(n, n);
      const c = n / 2;
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const dx = (x - c) / c;
          const dy = (y - c) / c;
          const r = Math.hypot(dx, dy);
          const wobble = (noise.fbm(x / n * 3, y / n * 3, 3) - 0.5) * 0.05;
          const rings = 0.5 + 0.5 * Math.sin((r + wobble) * Math.PI * 46);
          const saw = 0.5 + 0.5 * Math.sin((x / n) * Math.PI * 90 + noise.at(x / n * 4, y / n * 4) * 2);
          const pale = lerp(196, 226, rings) - saw * 12;
          px(img.data, (y * n + x) * 4, pale, pale * 0.9, pale * 0.7);
        }
      }
      ctx.putImageData(img, 0, 0);
    },
    true,
  );

/* ----------------------------------------------------------- sling webbing -- */

/** Polyester round-sling webbing: warp/weft direction reads clearly. */
export const bakeSlingWebbing = (size = 256, seed = 33): Texture =>
  bake(
    size,
    seed,
    (ctx, n, rng) => {
      const dirt = new ValueNoise(8, rng);
      const img = ctx.createImageData(n, n);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const u = x / n;
          const v = y / n;
          // Warp threads run along the sling, weft crosses it: a visible twill.
          const warp = 0.5 + 0.5 * Math.sin(v * Math.PI * 2 * 42);
          const weft = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * 14 + warp * 1.4);
          const weave = warp * 0.55 + weft * 0.45;
          const grime = dirt.fbm(u * 2, v * 2, 3);
          // Duty colour: violet 1t webbing, scuffed grey where it has been dragged.
          let r = lerp(118, 168, weave);
          let g = lerp(78, 118, weave);
          let b = lerp(150, 196, weave);
          const wear = clamp((grime - 0.55) * 2.2, 0, 1);
          r = lerp(r, 132, wear);
          g = lerp(g, 126, wear);
          b = lerp(b, 124, wear);
          px(img.data, (y * n + x) * 4, r, g, b);
        }
      }
      ctx.putImageData(img, 0, 0);
    },
    true,
  );

export const bakeSlingBump = (size = 256, seed = 33): Texture =>
  bake(
    size,
    seed,
    (ctx, n) => {
      const img = ctx.createImageData(n, n);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const warp = 0.5 + 0.5 * Math.sin((y / n) * Math.PI * 2 * 42);
          const weft = 0.5 + 0.5 * Math.sin((x / n) * Math.PI * 2 * 14 + warp * 1.4);
          const v = (warp * 0.6 + weft * 0.4) * 255;
          px(img.data, (y * n + x) * 4, v, v, v);
        }
      }
      ctx.putImageData(img, 0, 0);
    },
    false,
  );

/* ------------------------------------------------------------------ steel -- */

/** Hot-dip galvanised: spangle crystals, zinc grey, faint white bloom. */
export const bakeGalvanised = (size = 256, seed = 51): Texture =>
  bake(
    size,
    seed,
    (ctx, n, rng) => {
      const cells = 22;
      const pts: Array<[number, number, number]> = [];
      for (let i = 0; i < cells * cells * 0.5; i++) {
        pts.push([rng.next(), rng.next(), rng.range(0.55, 1)]);
      }
      const bloom = new ValueNoise(6, rng);
      const img = ctx.createImageData(n, n);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const u = x / n;
          const v = y / n;
          let best = 1e9;
          let bright = 0.7;
          for (const [px0, py0, b] of pts) {
            let dx = Math.abs(u - px0);
            let dy = Math.abs(v - py0);
            dx = Math.min(dx, 1 - dx);
            dy = Math.min(dy, 1 - dy);
            const d = dx * dx + dy * dy;
            if (d < best) {
              best = d;
              bright = b;
            }
          }
          const spangle = lerp(0.78, 1.0, bright) - Math.sqrt(best) * 0.5;
          const white = clamp((bloom.fbm(u * 3, v * 3, 3) - 0.62) * 2.4, 0, 1);
          const base = 150 * spangle;
          px(img.data, (y * n + x) * 4, lerp(base, 205, white), lerp(base * 1.01, 206, white), lerp(base * 1.05, 208, white));
        }
      }
      ctx.putImageData(img, 0, 0);
    },
    true,
  );

/** Machine enamel over steel: roller texture, chips at edges, grease film. */
export const bakePaintedSteel = (r0: number, g0: number, b0: number, size = 256, seed = 61): Texture =>
  bake(
    size,
    seed,
    (ctx, n, rng) => {
      const grime = new ValueNoise(8, rng);
      const chips = new ValueNoise(24, rng);
      const img = ctx.createImageData(n, n);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const u = x / n;
          const v = y / n;
          const shade = 0.86 + grime.fbm(u * 3, v * 3, 3) * 0.24;
          let r = r0 * shade;
          let g = g0 * shade;
          let b = b0 * shade;
          const chip = clamp((chips.fbm(u * 5, v * 5, 2) - 0.78) * 6, 0, 1);
          r = lerp(r, 92, chip);
          g = lerp(g, 88, chip);
          b = lerp(b, 84, chip);
          const film = clamp((grime.fbm(u * 1.5 + 3, v * 1.5, 4) - 0.6) * 2, 0, 1) * 0.45;
          r = lerp(r, 58, film);
          g = lerp(g, 56, film);
          b = lerp(b, 52, film);
          px(img.data, (y * n + x) * 4, r, g, b);
        }
      }
      ctx.putImageData(img, 0, 0);
    },
    true,
  );

/* ------------------------------------------------------------ stone paving -- */

/**
 * Granite sett paving. Joints, per-stone tone variation, a worn walking lane
 * and rain darkening near the joints. One tile covers 4x4 setts.
 */
export const bakePaving = (size = 512, seed = 71): Texture =>
  bake(
    size,
    seed,
    (ctx, n, rng) => {
      const grain = new ValueNoise(32, rng);
      const wear = new ValueNoise(4, rng);
      const tones = new Float32Array(64);
      for (let i = 0; i < tones.length; i++) tones[i] = rng.range(0.82, 1.14);
      const cells = 4;
      const img = ctx.createImageData(n, n);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const u = x / n;
          const v = y / n;
          const row = Math.floor(v * cells);
          // Running bond: alternate rows shift by half a stone.
          const shifted = u + (row % 2 === 0 ? 0 : 0.5 / cells);
          const col = Math.floor(((shifted % 1) + 1) % 1 * cells);
          const fu = ((shifted * cells) % 1 + 1) % 1;
          const fv = (v * cells) % 1;
          const jointU = Math.min(fu, 1 - fu);
          const jointV = Math.min(fv, 1 - fv);
          const joint = clamp(Math.min(jointU, jointV) / 0.055, 0, 1);
          const tone = tones[(row * cells + col) % tones.length];
          const speck = grain.fbm(u * 8, v * 8, 3);
          let base = lerp(96, 132, speck) * tone;
          // Walking lane: a diagonal band of polished, slightly darker stone.
          const lane = clamp(1 - Math.abs((u + v) - 1.0) / 0.32, 0, 1) * wear.fbm(u * 2, v * 2, 2);
          base = lerp(base, base * 0.9 + 6, lane * 0.7);
          // Joint sand, darkened by rain run-off.
          const jr = lerp(58, base, smoothstep(joint));
          px(img.data, (y * n + x) * 4, jr, jr * 1.0, jr * 0.98);
        }
      }
      ctx.putImageData(img, 0, 0);
    },
    true,
  );

export const bakePavingBump = (size = 512, seed = 71): Texture =>
  bake(
    size,
    seed,
    (ctx, n, rng) => {
      const grain = new ValueNoise(32, rng);
      const img = ctx.createImageData(n, n);
      const cells = 4;
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const u = x / n;
          const v = y / n;
          const row = Math.floor(v * cells);
          const shifted = u + (row % 2 === 0 ? 0 : 0.5 / cells);
          const fu = ((shifted * cells) % 1 + 1) % 1;
          const fv = (v * cells) % 1;
          const joint = clamp(Math.min(Math.min(fu, 1 - fu), Math.min(fv, 1 - fv)) / 0.055, 0, 1);
          const h = (smoothstep(joint) * 0.82 + grain.fbm(u * 10, v * 10, 3) * 0.18) * 255;
          px(img.data, (y * n + x) * 4, h, h, h);
        }
      }
      ctx.putImageData(img, 0, 0);
    },
    false,
  );

export const bakePavingRoughness = (size = 256, seed = 73): Texture =>
  bake(
    size,
    seed,
    (ctx, n, rng) => {
      const wet = new ValueNoise(6, rng);
      const img = ctx.createImageData(n, n);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const u = x / n;
          const v = y / n;
          // Damp patches near the joints stay glossier than the dry field.
          const w = clamp((wet.fbm(u * 2.5, v * 2.5, 4) - 0.45) * 1.7, 0, 1);
          const rough = lerp(0.94, 0.42, w) * 255;
          px(img.data, (y * n + x) * 4, rough, rough, rough);
        }
      }
      ctx.putImageData(img, 0, 0);
    },
    false,
  );

/* ----------------------------------------------------------- cable jacket -- */

/** Rubber cable jacket: extrusion lines along the run, matte, faintly dusty. */
export const bakeCableJacket = (size = 128, seed = 91): Texture =>
  bake(
    size,
    seed,
    (ctx, n, rng) => {
      const dust = new ValueNoise(8, rng);
      const img = ctx.createImageData(n, n);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const u = x / n;
          const v = y / n;
          const rib = 0.5 + 0.5 * Math.sin(v * Math.PI * 2 * 9);
          const d = dust.fbm(u * 4, v * 4, 3);
          const base = lerp(26, 44, rib) + d * 14;
          px(img.data, (y * n + x) * 4, base, base * 1.02, base * 1.06);
        }
      }
      ctx.putImageData(img, 0, 0);
    },
    true,
  );

/** Welded mesh fence panel: dark wire grid on a light frame, read at distance. */
export const bakeFencePanel = (size = 128, seed = 111): Texture =>
  bake(
    size,
    seed,
    (ctx, n, rng) => {
      const grime = new ValueNoise(6, rng);
      const img = ctx.createImageData(n, n);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const u = x / n;
          const v = y / n;
          const gx = Math.abs(((u * 10) % 1) - 0.5) * 2;
          const gy = Math.abs(((v * 5) % 1) - 0.5) * 2;
          const wire = clamp(1 - Math.min(gx, gy) / 0.16, 0, 1);
          const g = grime.fbm(u * 3, v * 3, 3);
          // Between the wires you mostly see whatever is behind: kept dark so
          // the fence never turns into a white parapet.
          const base = lerp(38, 150, wire) * (0.85 + g * 0.3);
          px(img.data, (y * n + x) * 4, base, base * 1.01, base * 1.03);
        }
      }
      ctx.putImageData(img, 0, 0);
    },
    true,
  );

/** Building facade strip: floor bands, mullions, dark windows to light later. */
export const bakeFacade = (size = 256, seed = 101): Texture =>
  bake(
    size,
    seed,
    (ctx, n, rng) => {
      const grime = new ValueNoise(8, rng);
      const img = ctx.createImageData(n, n);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const u = x / n;
          const v = y / n;
          const floorV = (v * 8) % 1;
          const bayU = (u * 6) % 1;
          const window = floorV > 0.18 && floorV < 0.82 && bayU > 0.2 && bayU < 0.8;
          const g = grime.fbm(u * 3, v * 3, 3);
          let r: number;
          let gg: number;
          let b: number;
          if (window) {
            r = 26 + g * 10;
            gg = 30 + g * 10;
            b = 38 + g * 12;
          } else {
            const stone = lerp(96, 128, g);
            r = stone;
            gg = stone * 0.98;
            b = stone * 0.93;
          }
          px(img.data, (y * n + x) * 4, r, gg, b);
        }
      }
      ctx.putImageData(img, 0, 0);
    },
    true,
  );
