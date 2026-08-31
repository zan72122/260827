import * as THREE from 'three';
import { makeRandom, TAU, clamp } from '../util/math';

/**
 * Every texture in the game is generated here at start-up. Nothing is fetched
 * at runtime, so there is no external API, no hot-linked image and nothing to
 * attribute beyond this file.
 *
 * These are only used for detail that is genuinely sub-millimetre: the grain of
 * buttercream, wear on steel, crumb speckle. Silhouettes, petal edges, the rim
 * of the tip and the cut face of the sponge are real geometry.
 */

type Ctx = CanvasRenderingContext2D;

function canvas(size: number): { c: HTMLCanvasElement; g: Ctx } {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d', { willReadFrequently: false });
  if (!g) throw new Error('2D canvas unavailable');
  return { c, g };
}

function finish(c: HTMLCanvasElement, srgb: boolean, repeat = 1): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** Tileable value noise rendered straight into an ImageData buffer. */
function valueNoiseField(size: number, cells: number, seed: number): Float32Array {
  const rnd = makeRandom(seed);
  const grid = new Float32Array(cells * cells);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();
  const out = new Float32Array(size * size);
  const fade = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    const gy = (y / size) * cells;
    const y0 = Math.floor(gy) % cells;
    const y1 = (y0 + 1) % cells;
    const ty = fade(gy - Math.floor(gy));
    for (let x = 0; x < size; x++) {
      const gx = (x / size) * cells;
      const x0 = Math.floor(gx) % cells;
      const x1 = (x0 + 1) % cells;
      const tx = fade(gx - Math.floor(gx));
      const a = grid[y0 * cells + x0];
      const b = grid[y0 * cells + x1];
      const c = grid[y1 * cells + x0];
      const d = grid[y1 * cells + x1];
      out[y * size + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    }
  }
  return out;
}

function fbm(size: number, seed: number, octaves = 4, base = 4): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const field = valueNoiseField(size, base << o, seed + o * 977);
    for (let i = 0; i < out.length; i++) out[i] += field[i] * amp;
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/** Turn a height field into a tangent-space normal map. */
function heightToNormal(height: Float32Array, size: number, strength: number): THREE.CanvasTexture {
  const { c, g } = canvas(size);
  const img = g.createImageData(size, size);
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx;
      let ny = -dy;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      const o = (y * size + x) * 4;
      img.data[o] = (nx * 0.5 + 0.5) * 255;
      img.data[o + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[o + 2] = (nz / len) * 0.5 * 255 + 127.5;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return finish(c, false);
}

function grayFromField(field: Float32Array, size: number, lo: number, hi: number): THREE.CanvasTexture {
  const { c, g } = canvas(size);
  const img = g.createImageData(size, size);
  for (let i = 0; i < field.length; i++) {
    const v = clamp(lo + (hi - lo) * field[i], 0, 1) * 255;
    const o = i * 4;
    img.data[o] = v;
    img.data[o + 1] = v;
    img.data[o + 2] = v;
    img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return finish(c, false);
}

export interface TextureLibrary {
  creamNormal: THREE.Texture;
  creamRough: THREE.Texture;
  steelRough: THREE.Texture;
  steelNormal: THREE.Texture;
  paperColor: THREE.Texture;
  paperNormal: THREE.Texture;
  porcelainRough: THREE.Texture;
  spongeColor: THREE.Texture;
  spongeNormal: THREE.Texture;
  crustColor: THREE.Texture;
  woodColor: THREE.Texture;
  woodRough: THREE.Texture;
  stoneColor: THREE.Texture;
  stoneRough: THREE.Texture;
  clothColor: THREE.Texture;
  clothNormal: THREE.Texture;
  skinColor: THREE.Texture;
  skinNormal: THREE.Texture;
  dispose(): void;
}

export function buildTextures(): TextureLibrary {
  const S = 512;

  // ---- buttercream: fine, slightly greasy grain with a faint piped striation
  const creamField = fbm(S, 1201, 5, 16);
  const creamNormal = heightToNormal(creamField, S, 1.4);
  const creamRough = grayFromField(creamField, S, 0.34, 0.5);

  // ---- stainless: directional scuffing, the kind a used tip actually carries
  const steel = (() => {
    const size = 512;
    const { c, g } = canvas(size);
    g.fillStyle = '#b4b4b4';
    g.fillRect(0, 0, size, size);
    const rnd = makeRandom(88123);
    // circumferential polishing marks
    for (let i = 0; i < 900; i++) {
      const y = rnd() * size;
      const w = 20 + rnd() * 300;
      const x = rnd() * size;
      const a = 0.02 + rnd() * 0.06;
      g.strokeStyle = rnd() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(90,90,90,${a})`;
      g.lineWidth = 0.6 + rnd() * 1.4;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + w, y + (rnd() - 0.5) * 2);
      g.stroke();
    }
    // a handful of deeper scratches near the working end (top of the map)
    for (let i = 0; i < 40; i++) {
      const y = rnd() * size * 0.35;
      const x = rnd() * size;
      const w = 6 + rnd() * 60;
      g.strokeStyle = `rgba(70,70,70,${0.1 + rnd() * 0.16})`;
      g.lineWidth = 0.8 + rnd() * 1.1;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + w, y + (rnd() - 0.5) * 5);
      g.stroke();
    }
    return c;
  })();
  const steelRough = finish(steel, false);
  const steelNormal = heightToNormal(fbm(256, 5511, 3, 64), 256, 0.35);

  // ---- parchment: soft fibre, warm white
  const paperField = fbm(S, 3301, 4, 24);
  const paperColor = (() => {
    const { c, g } = canvas(S);
    const img = g.createImageData(S, S);
    for (let i = 0; i < paperField.length; i++) {
      const v = 0.9 + paperField[i] * 0.1;
      const o = i * 4;
      img.data[o] = clamp(v * 0.99, 0, 1) * 255;
      img.data[o + 1] = clamp(v * 0.965, 0, 1) * 255;
      img.data[o + 2] = clamp(v * 0.915, 0, 1) * 255;
      img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return finish(c, true);
  })();
  const paperNormal = heightToNormal(paperField, S, 0.5);

  const porcelainRough = grayFromField(fbm(256, 771, 3, 8), 256, 0.05, 0.11);

  // ---- sponge: open crumb. Bubbles as texture, the cut face itself as geometry.
  const spongeSize = 512;
  const spongeHeight = new Float32Array(spongeSize * spongeSize);
  const spongeCanvas = canvas(spongeSize);
  {
    const { g } = spongeCanvas;
    g.fillStyle = '#f0dcaf';
    g.fillRect(0, 0, spongeSize, spongeSize);
    const rnd = makeRandom(4242);
    const base = fbm(spongeSize, 9001, 4, 20);
    const img = g.getImageData(0, 0, spongeSize, spongeSize);
    for (let i = 0; i < base.length; i++) {
      const v = 0.86 + base[i] * 0.24;
      const o = i * 4;
      img.data[o] = clamp(0.94 * v, 0, 1) * 255;
      img.data[o + 1] = clamp(0.85 * v, 0, 1) * 255;
      img.data[o + 2] = clamp(0.66 * v, 0, 1) * 255;
      spongeHeight[i] = base[i] * 0.25;
    }
    g.putImageData(img, 0, 0);
    // air bubbles: darker inside, a slight highlight on the lower rim
    for (let i = 0; i < 1400; i++) {
      const x = rnd() * spongeSize;
      const y = rnd() * spongeSize;
      const r = 1.2 + Math.pow(rnd(), 2.4) * 9;
      const grad = g.createRadialGradient(x, y - r * 0.2, r * 0.1, x, y, r);
      grad.addColorStop(0, 'rgba(150,116,72,0.55)');
      grad.addColorStop(0.75, 'rgba(190,158,110,0.28)');
      grad.addColorStop(1, 'rgba(240,220,178,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
      // stamp the same hole into the height field
      const ri = Math.ceil(r);
      const cx = Math.round(x);
      const cy = Math.round(y);
      for (let dy = -ri; dy <= ri; dy++) {
        for (let dx = -ri; dx <= ri; dx++) {
          const d = Math.hypot(dx, dy);
          if (d > r) continue;
          const px = ((cx + dx) % spongeSize + spongeSize) % spongeSize;
          const py = ((cy + dy) % spongeSize + spongeSize) % spongeSize;
          spongeHeight[py * spongeSize + px] -= (1 - d / r) * 0.55;
        }
      }
    }
  }
  const spongeColor = finish(spongeCanvas.c, true);
  const spongeNormal = heightToNormal(spongeHeight, spongeSize, 2.2);

  // ---- baked crust, for the very top edge of the sponge under the icing
  const crustColor = (() => {
    const { c, g } = canvas(256);
    const f = fbm(256, 1717, 4, 12);
    const img = g.createImageData(256, 256);
    for (let i = 0; i < f.length; i++) {
      const v = 0.72 + f[i] * 0.36;
      const o = i * 4;
      img.data[o] = clamp(0.78 * v, 0, 1) * 255;
      img.data[o + 1] = clamp(0.6 * v, 0, 1) * 255;
      img.data[o + 2] = clamp(0.4 * v, 0, 1) * 255;
      img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return finish(c, true);
  })();

  // ---- beech worktop for the pastry bench
  const wood = (() => {
    const size = 512;
    const { c, g } = canvas(size);
    const rnd = makeRandom(60601);
    g.fillStyle = '#c8a276';
    g.fillRect(0, 0, size, size);
    const wobble = fbm(size, 4404, 3, 6);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const w = wobble[y * size + x];
        const grain = Math.sin((y * 0.42 + w * 34) * 0.6) * 0.5 + 0.5;
        const v = 0.86 + grain * 0.18 + (rnd() - 0.5) * 0.045;
        g.fillStyle = `rgb(${clamp(0.8 * v, 0, 1) * 255 | 0},${clamp(0.64 * v, 0, 1) * 255 | 0},${
          clamp(0.46 * v, 0, 1) * 255 | 0
        })`;
        g.fillRect(x, y, 1, 1);
      }
    }
    return c;
  })();
  const woodColor = finish(wood, true);
  const woodRough = grayFromField(fbm(256, 4405, 3, 10), 256, 0.42, 0.62);

  // ---- pale stone for the decorating bench top
  const stoneField = fbm(S, 8080, 5, 6);
  const stoneColor = (() => {
    const { c, g } = canvas(S);
    const img = g.createImageData(S, S);
    const speck = makeRandom(9099);
    for (let i = 0; i < stoneField.length; i++) {
      let v = 0.66 + stoneField[i] * 0.18;
      if (speck() > 0.994) v -= 0.14;
      const o = i * 4;
      img.data[o] = clamp(v * 0.97, 0, 1) * 255;
      img.data[o + 1] = clamp(v * 0.955, 0, 1) * 255;
      img.data[o + 2] = clamp(v * 0.93, 0, 1) * 255;
      img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return finish(c, true);
  })();
  const stoneRough = grayFromField(stoneField, S, 0.3, 0.46);

  // ---- linen tablecloth
  const clothHeight = (() => {
    const size = 256;
    const out = new Float32Array(size * size);
    const soft = fbm(size, 2211, 3, 8);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const weave = (Math.sin(x * 1.6) + Math.sin(y * 1.6)) * 0.12;
        out[y * size + x] = soft[y * size + x] * 0.5 + weave + 0.5;
      }
    }
    return out;
  })();
  const clothColor = grayFromField(clothHeight, 256, 0.86, 1.0);
  clothColor.colorSpace = THREE.SRGBColorSpace;
  const clothNormal = heightToNormal(clothHeight, 256, 1.1);

  // ---- skin, for the hands: pores plus faint knuckle creasing
  const skinField = fbm(256, 6161, 4, 40);
  const skinColor = (() => {
    const { c, g } = canvas(256);
    const img = g.createImageData(256, 256);
    for (let i = 0; i < skinField.length; i++) {
      const v = 0.93 + skinField[i] * 0.14;
      const o = i * 4;
      img.data[o] = clamp(0.86 * v, 0, 1) * 255;
      img.data[o + 1] = clamp(0.68 * v, 0, 1) * 255;
      img.data[o + 2] = clamp(0.60 * v, 0, 1) * 255;
      img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return finish(c, true);
  })();
  const skinNormal = heightToNormal(skinField, 256, 0.55);

  const all: THREE.Texture[] = [
    creamNormal, creamRough, steelRough, steelNormal, paperColor, paperNormal,
    porcelainRough, spongeColor, spongeNormal, crustColor, woodColor, woodRough,
    stoneColor, stoneRough, clothColor, clothNormal, skinColor, skinNormal,
  ];

  return {
    creamNormal, creamRough, steelRough, steelNormal, paperColor, paperNormal,
    porcelainRough, spongeColor, spongeNormal, crustColor, woodColor, woodRough,
    stoneColor, stoneRough, clothColor, clothNormal, skinColor, skinNormal,
    dispose() {
      for (const t of all) t.dispose();
    },
  };
}
