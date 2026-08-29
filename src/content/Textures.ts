import * as THREE from 'three';
import { Rng } from '../core/rng';
import { ValueNoise, heightToNormal } from '../core/noise';


export function makeCanvas(size: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable');
  return { canvas, ctx };
}

export function canvasTexture(
  canvas: HTMLCanvasElement,
  opts: { srgb?: boolean; repeat?: number; anisotropy?: number } = {},
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  if (opts.repeat) tex.repeat.set(opts.repeat, opts.repeat);
  tex.anisotropy = opts.anisotropy ?? 4;
  tex.needsUpdate = true;
  return tex;
}

export function dataTexture(
  data: Uint8ClampedArray,
  size: number,
  anisotropy: number,
): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array(data), size, size);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

/** Build a tangent-space normal map straight from a height field. */
export function normalTexture(
  height: Float32Array,
  size: number,
  strength: number,
  anisotropy: number,
): THREE.DataTexture {
  return dataTexture(heightToNormal(height, size, size, strength), size, anisotropy);
}

export interface SurfaceMaps {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

const cache = new Map<string, SurfaceMaps>();

function cached(key: string, build: () => SurfaceMaps): SurfaceMaps {
  const hit = cache.get(key);
  if (hit) return hit;
  const made = build();
  cache.set(key, made);
  return made;
}

export function disposeTextureCache(): void {
  for (const maps of cache.values()) {
    maps.map.dispose();
    maps.normalMap.dispose();
    maps.roughnessMap.dispose();
  }
  cache.clear();
}

/* ------------------------------------------------------------------ sponge */

/**
 * Genoise crumb. Pores are drawn as isotropic ellipses in texture space and the
 * cut-face UVs are metric (radius, height), so a pore never smears along the
 * cut direction no matter which of the twelve planes the knife took.
 */
export function spongeCrumb(size: number, anisotropy: number): SurfaceMaps {
  return cached(`sponge:${size}`, () => {
    const { canvas, ctx } = makeCanvas(size);
    const rng = new Rng(0x5170a1);
    const noise = new ValueNoise(0x5170a2, 64);
    const height = new Float32Array(size * size);
    const rough = makeCanvas(size);

    ctx.fillStyle = '#e7cf9e';
    ctx.fillRect(0, 0, size, size);

    // Base tonal drift of the crumb: baked cake is never one flat yellow.
    const img = ctx.getImageData(0, 0, size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;
        const n = noise.fbm(u, v, 6, 5);
        const fine = noise.fbm(u + 3.1, v + 1.7, 26, 3);
        const t = n * 0.7 + fine * 0.3;
        const o = (y * size + x) * 4;
        img.data[o] = 226 + (t - 0.5) * 34;
        img.data[o + 1] = 200 + (t - 0.5) * 36;
        img.data[o + 2] = 150 + (t - 0.5) * 40;
        img.data[o + 3] = 255;
        height[y * size + x] = 0.55 + (t - 0.5) * 0.25;
      }
    }
    ctx.putImageData(img, 0, 0);

    // Pores: a wide size distribution, wrapped at the edges so the map tiles.
    const poreCount = Math.round((size * size) / 900);
    for (let i = 0; i < poreCount; i++) {
      const cx = rng.next() * size;
      const cy = rng.next() * size;
      const big = rng.next();
      const r = (big > 0.94 ? rng.range(5, 11) : rng.range(1.2, 4.4)) * (size / 1024);
      const squash = rng.range(0.75, 1.32);
      const rot = rng.next() * Math.PI;
      for (const [ox, oy] of [
        [0, 0],
        [size, 0],
        [-size, 0],
        [0, size],
        [0, -size],
      ]) {
        ctx.save();
        ctx.translate(cx + ox, cy + oy);
        ctx.rotate(rot);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
        g.addColorStop(0, 'rgba(120,88,44,0.82)');
        g.addColorStop(0.62, 'rgba(163,126,74,0.42)');
        g.addColorStop(1, 'rgba(200,168,110,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(0, 0, r, r * squash, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      // Carve the pore into the height field as a real depression.
      const ri = Math.ceil(r * 1.3);
      for (let dy = -ri; dy <= ri; dy++) {
        for (let dx = -ri; dx <= ri; dx++) {
          const d = Math.hypot(dx, dy / squash) / r;
          if (d > 1) continue;
          const x = (Math.round(cx) + dx + size) % size;
          const y = (Math.round(cy) + dy + size) % size;
          height[y * size + x] -= (1 - d * d) * 0.5;
        }
      }
    }

    // Roughness: pore interiors read drier than the sheared crumb face.
    const rimg = rough.ctx.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      const h = height[i];
      const r = 0.94 - (h - 0.3) * 0.16;
      const c = Math.round(Math.max(0, Math.min(1, r)) * 255);
      rimg.data[i * 4] = c;
      rimg.data[i * 4 + 1] = c;
      rimg.data[i * 4 + 2] = c;
      rimg.data[i * 4 + 3] = 255;
    }
    rough.ctx.putImageData(rimg, 0, 0);

    return {
      map: canvasTexture(canvas, { anisotropy }),
      normalMap: dataTexture(heightToNormal(height, size, size, size / 22), size, anisotropy),
      roughnessMap: canvasTexture(rough.canvas, { srgb: false, anisotropy }),
    };
  });
}

/* ------------------------------------------------------------------- cream */

/**
 * Cut cream. Carries the three things a knife leaves behind: trapped air
 * pockets, the one-directional drag of the blade, and a faint bruise where a
 * strawberry pressed into it before the layer set.
 */
export function creamSection(size: number, anisotropy: number): SurfaceMaps {
  return cached(`creamSection:${size}`, () => {
    const { canvas, ctx } = makeCanvas(size);
    const rough = makeCanvas(size);
    const rng = new Rng(0xc4ea41);
    const noise = new ValueNoise(0xc4ea42, 64);
    const height = new Float32Array(size * size);

    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;
        // The blade goes down through the cake, so its drag runs down the
        // face: streaks vary across the surface, not along it.
        const streak = noise.fbm(u * 5.5, v * 0.16, 9, 3);
        const grain = noise.fbm(u + 5.5, v + 2.2, 34, 3);
        const t = streak * 0.5 + grain * 0.5;
        const o = (y * size + x) * 4;
        // Dairy white: warm, never grey and never paper.
        img.data[o] = 253 + (t - 0.5) * 5;
        img.data[o + 1] = 248 + (t - 0.5) * 7;
        img.data[o + 2] = 236 + (t - 0.5) * 10;
        img.data[o + 3] = 255;
        height[y * size + x] = 0.5 + (streak - 0.5) * 0.22 + (grain - 0.5) * 0.24;
      }
    }
    ctx.putImageData(img, 0, 0);

    // Air pockets left by the piping bag.
    const bubbles = Math.round((size * size) / 2600);
    for (let i = 0; i < bubbles; i++) {
      const cx = rng.next() * size;
      const cy = rng.next() * size;
      const r = rng.range(1.0, 4.6) * (size / 1024);
      const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0, cx, cy, r);
      g.addColorStop(0, 'rgba(224,216,203,0.55)');
      g.addColorStop(0.75, 'rgba(238,232,222,0.30)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      const ri = Math.ceil(r);
      for (let dy = -ri; dy <= ri; dy++) {
        for (let dx = -ri; dx <= ri; dx++) {
          const d = Math.hypot(dx, dy) / r;
          if (d > 1) continue;
          const x = (Math.round(cx) + dx + size) % size;
          const y = (Math.round(cy) + dy + size) % size;
          height[y * size + x] -= (1 - d * d) * 0.42;
        }
      }
    }

    const rimg = rough.ctx.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      const c = Math.round((0.52 + (0.5 - height[i]) * 0.22) * 255);
      rimg.data[i * 4] = c;
      rimg.data[i * 4 + 1] = c;
      rimg.data[i * 4 + 2] = c;
      rimg.data[i * 4 + 3] = 255;
    }
    rough.ctx.putImageData(rimg, 0, 0);

    return {
      map: canvasTexture(canvas, { anisotropy }),
      normalMap: dataTexture(heightToNormal(height, size, size, size / 30), size, anisotropy),
      roughnessMap: canvasTexture(rough.canvas, { srgb: false, anisotropy }),
    };
  });
}

/** Piped / spread cream seen from outside: soft swirl, no plastic sheen. */
export function creamSurface(size: number, anisotropy: number): SurfaceMaps {
  return cached(`creamSurface:${size}`, () => {
    const { canvas, ctx } = makeCanvas(size);
    const rough = makeCanvas(size);
    const noise = new ValueNoise(0x51ee11, 64);
    const height = new Float32Array(size * size);
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;
        const swirl = noise.fbm(u + Math.sin(v * 6.28) * 0.05, v, 7, 4);
        const fine = noise.fbm(u * 1.3 + 9, v * 1.3 + 4, 30, 3);
        const t = swirl * 0.72 + fine * 0.28;
        const o = (y * size + x) * 4;
        img.data[o] = 253 + (t - 0.5) * 5;
        img.data[o + 1] = 250 + (t - 0.5) * 7;
        img.data[o + 2] = 243 + (t - 0.5) * 10;
        img.data[o + 3] = 255;
        height[y * size + x] = t;
      }
    }
    ctx.putImageData(img, 0, 0);
    const rimg = rough.ctx.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      const c = Math.round((0.58 + (height[i] - 0.5) * 0.16) * 255);
      rimg.data[i * 4] = c;
      rimg.data[i * 4 + 1] = c;
      rimg.data[i * 4 + 2] = c;
      rimg.data[i * 4 + 3] = 255;
    }
    rough.ctx.putImageData(rimg, 0, 0);
    return {
      map: canvasTexture(canvas, { anisotropy }),
      normalMap: dataTexture(heightToNormal(height, size, size, size / 46), size, anisotropy),
      roughnessMap: canvasTexture(rough.canvas, { srgb: false, anisotropy }),
    };
  });
}

/* ------------------------------------------------------------------ props */

/** Brushed stainless: fine unidirectional roughness, no coloured banding. */
export function brushedSteel(size: number, anisotropy: number): SurfaceMaps {
  return cached(`steel:${size}`, () => {
    const { canvas, ctx } = makeCanvas(size);
    const rough = makeCanvas(size);
    const noise = new ValueNoise(0x57ee13, 64);
    const height = new Float32Array(size * size);
    ctx.fillStyle = '#9ea3a6';
    ctx.fillRect(0, 0, size, size);
    const rimg = rough.ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;
        const brush = noise.fbm(u * 0.05, v * 22, 20, 2);
        const i = y * size + x;
        height[i] = 0.5 + (brush - 0.5) * 0.4;
        const c = Math.round((0.20 + brush * 0.20) * 255);
        rimg.data[i * 4] = c;
        rimg.data[i * 4 + 1] = c;
        rimg.data[i * 4 + 2] = c;
        rimg.data[i * 4 + 3] = 255;
      }
    }
    rough.ctx.putImageData(rimg, 0, 0);
    return {
      map: canvasTexture(canvas, { anisotropy }),
      normalMap: dataTexture(heightToNormal(height, size, size, size / 120), size, anisotropy),
      roughnessMap: canvasTexture(rough.canvas, { srgb: false, anisotropy }),
    };
  });
}

/** Worn maple bench top for the mid ground. */
export function benchWood(size: number, anisotropy: number): SurfaceMaps {
  return cached(`wood:${size}`, () => {
    const { canvas, ctx } = makeCanvas(size);
    const rough = makeCanvas(size);
    const noise = new ValueNoise(0x0d0d11, 64);
    const height = new Float32Array(size * size);
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;
        const warp = noise.fbm(u, v, 3, 4) * 0.26;
        const rings = Math.abs(Math.sin((v + warp) * Math.PI * 9)) ** 1.6;
        const fibre = noise.fbm(u * 0.3 + 2, v * 9 + 1, 26, 2);
        const blotch = noise.fbm(u * 0.7 + 6, v * 0.7 + 3, 5, 3);
        const t = rings * 0.34 + fibre * 0.3 + blotch * 0.36;
        const o = (y * size + x) * 4;
        img.data[o] = 172 - t * 46;
        img.data[o + 1] = 138 - t * 42;
        img.data[o + 2] = 102 - t * 36;
        img.data[o + 3] = 255;
        height[y * size + x] = 0.5 + (t - 0.5) * 0.3;
      }
    }
    ctx.putImageData(img, 0, 0);
    const rimg = rough.ctx.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      const c = Math.round((0.68 + (height[i] - 0.5) * 0.2) * 255);
      rimg.data[i * 4] = c;
      rimg.data[i * 4 + 1] = c;
      rimg.data[i * 4 + 2] = c;
      rimg.data[i * 4 + 3] = 255;
    }
    rough.ctx.putImageData(rimg, 0, 0);
    return {
      map: canvasTexture(canvas, { anisotropy }),
      normalMap: dataTexture(heightToNormal(height, size, size, size / 90), size, anisotropy),
      roughnessMap: canvasTexture(rough.canvas, { srgb: false, anisotropy }),
    };
  });
}
