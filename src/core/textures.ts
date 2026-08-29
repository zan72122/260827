/**
 * Every surface map is generated procedurally at boot: no binary assets, but the
 * maps are authored (bark scales follow the trunk, wear follows contact edges,
 * dirt follows drainage) rather than being uniform noise.
 */
import * as THREE from 'three';
import { clamp, fbm2, lerp, noise2, ridge2, smoothstep } from './rand';

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2d context unavailable');
  return [c, ctx];
}

function toTexture(canvas: HTMLCanvasElement, srgb: boolean, aniso: number): THREE.Texture {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

/** Sobel height -> tangent-space normal map. */
function normalFromHeight(height: Float32Array, size: number, strength: number): HTMLCanvasElement {
  const [canvas, ctx] = makeCanvas(size);
  const img = ctx.createImageData(size, size);
  const at = (x: number, y: number) =>
    height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx =
        at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy =
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nx = -dx * strength;
      let ny = -dy * strength;
      const nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv;
      ny *= inv;
      const i = (y * size + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * inv * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function writeRGB(
  size: number,
  fn: (x: number, y: number, out: [number, number, number]) => void,
): HTMLCanvasElement {
  const [canvas, ctx] = makeCanvas(size);
  const img = ctx.createImageData(size, size);
  const out: [number, number, number] = [0, 0, 0];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      fn(x, y, out);
      const i = (y * size + x) * 4;
      img.data[i] = clamp(out[0], 0, 1) * 255;
      img.data[i + 1] = clamp(out[1], 0, 1) * 255;
      img.data[i + 2] = clamp(out[2], 0, 1) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export interface SurfaceMaps {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

/**
 * Fir bark: long vertical scale plates split by deep fissures, resin blisters,
 * grey lichen wash on the weather side. V runs along the trunk.
 */
export function makeBarkMaps(size = 512, aniso = 4): SurfaceMaps {
  const h = new Float32Array(size * size);
  const plateW = 6.5; // plates across the circumference
  const plateH = 2.4; // stretched along the trunk
  const fissure = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * plateW;
      const v = (y / size) * plateH;
      // Plate cells wander sideways as they climb.
      const wander = (fbm2(u * 0.9, v * 2.4, 11, 8, 3) - 0.5) * 0.55;
      const cellU = u + wander;
      const seamU = Math.abs((cellU % 1) - 0.5) * 2; // 0 centre .. 1 seam
      const seamV = Math.abs(((v * 3.1 + noise2(cellU * 3, v * 1.5, 23, 16) * 1.4) % 1) - 0.5) * 2;
      const crack =
        smoothstep(0.62, 1.0, seamU) * 0.85 + smoothstep(0.78, 1.0, seamV) * 0.5;
      const grain = ridge2(u * 3.2, v * 26, 41, 32, 3) * 0.32;
      const rough = fbm2(u * 9, v * 34, 67, 64, 4) * 0.22;
      const height = 0.62 + grain * 0.5 + rough - crack * 0.72;
      const i = y * size + x;
      h[i] = clamp(height, 0, 1);
      fissure[i] = clamp(crack, 0, 1);
    }
  }

  const map = writeRGB(size, (x, y, out) => {
    const i = y * size + x;
    const height = h[i];
    const crack = fissure[i];
    const u = (x / size) * plateW;
    const v = (y / size) * plateH;
    // Base bark: warm grey-brown, darker deep in the fissures.
    const tone = 0.34 + height * 0.42;
    let r = 0.31 * tone + 0.1;
    let g = 0.255 * tone + 0.078;
    let b = 0.2 * tone + 0.058;
    const shade = 1 - crack * 0.72;
    r *= shade;
    g *= shade;
    b *= shade;
    // Lichen wash sits on flat, upward faces only.
    const lichen = smoothstep(0.55, 0.95, fbm2(u * 1.6, v * 1.9, 91, 16, 3)) * (1 - crack) * 0.5;
    r = lerp(r, 0.46, lichen * 0.7);
    g = lerp(g, 0.5, lichen * 0.75);
    b = lerp(b, 0.42, lichen * 0.6);
    // Resin blisters: small amber beads near plate centres.
    const rb = fbm2(u * 7.5 + 3, v * 7.5, 133, 64, 2);
    const resin = smoothstep(0.86, 0.96, rb) * (1 - crack);
    r = lerp(r, 0.62, resin);
    g = lerp(g, 0.44, resin);
    b = lerp(b, 0.16, resin);
    out[0] = r;
    out[1] = g;
    out[2] = b;
  });

  const roughness = writeRGB(size, (x, y, out) => {
    const i = y * size + x;
    const u = (x / size) * plateW;
    const v = (y / size) * plateH;
    const resin = smoothstep(0.86, 0.96, fbm2(u * 7.5 + 3, v * 7.5, 133, 64, 2));
    const r = clamp(0.96 - fissure[i] * 0.06 - resin * 0.5 - h[i] * 0.08, 0.3, 1);
    out[0] = out[1] = out[2] = r;
  });

  return {
    map: toTexture(map, true, aniso),
    normalMap: toTexture(normalFromHeight(h, size, 3.4), false, aniso),
    roughnessMap: toTexture(roughness, false, aniso),
  };
}

/** Fresh chainsaw cut at the butt of the trunk: rings, rays, saw chatter. */
export function makeCutFaceMap(size = 256): THREE.Texture {
  const canvas = writeRGB(size, (x, y, out) => {
    const dx = x / size - 0.5;
    const dy = y / size - 0.5;
    const r = Math.hypot(dx, dy) * 2;
    const a = Math.atan2(dy, dx);
    const wobble = fbm2(Math.cos(a) * 2.5, Math.sin(a) * 2.5, 7, 8, 3) * 0.06;
    const rings = Math.sin((r + wobble) * 78) * 0.5 + 0.5;
    const late = smoothstep(0.45, 0.9, rings);
    const rays = smoothstep(0.72, 1, Math.abs(Math.sin(a * 46 + r * 3)));
    const chatter = fbm2(x / size * 40, y / size * 3, 19, 64, 2) * 0.1;
    let base = 0.78 - late * 0.2 - rays * 0.06 + chatter;
    base *= 1 - smoothstep(0.86, 1.0, r) * 0.35; // darker toward the bark edge
    out[0] = base * 0.86;
    out[1] = base * 0.71;
    out[2] = base * 0.5;
  });
  const t = toTexture(canvas, true, 2);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/**
 * Yard ground detail: wet compacted soil with crushed stone. Kept neutral —
 * puddles, ruts and litter are placed by vertex colour on the ground mesh so
 * that the dirt follows drainage and traffic, not a uniform tile.
 */
export function makeGroundMaps(size = 512, aniso = 8): SurfaceMaps {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const stones = ridge2(u * 26, v * 26, 5, 32, 3);
      const soil = fbm2(u * 9, v * 9, 61, 16, 4);
      h[y * size + x] = clamp(soil * 0.55 + smoothstep(0.62, 0.98, stones) * 0.35, 0, 1);
    }
  }
  const map = writeRGB(size, (x, y, out) => {
    const u = x / size;
    const v = y / size;
    const height = h[y * size + x];
    const stone = smoothstep(0.5, 0.95, ridge2(u * 26, v * 26, 5, 32, 3));
    const soil = fbm2(u * 7, v * 7, 61, 16, 4);
    let r = lerp(0.155, 0.225, soil);
    let g = lerp(0.133, 0.19, soil);
    let b = lerp(0.113, 0.155, soil);
    // crushed stone reads cooler and lighter
    r = lerp(r, 0.34, stone * 0.7);
    g = lerp(g, 0.342, stone * 0.7);
    b = lerp(b, 0.338, stone * 0.7);
    const dark = 1 - (1 - height) * 0.35;
    out[0] = r * dark;
    out[1] = g * dark;
    out[2] = b * dark;
  });
  const rough = writeRGB(size, (x, y, out) => {
    const v = clamp(0.99 - h[y * size + x] * 0.18, 0.55, 1);
    out[0] = out[1] = out[2] = v;
  });
  return {
    map: toTexture(map, true, aniso),
    normalMap: toTexture(normalFromHeight(h, size, 2.1), false, aniso),
    roughnessMap: toTexture(rough, false, aniso),
  };
}

/**
 * Machine enamel: sprayed steel with orange peel, weld-seam ripple left to the
 * geometry, and grime that runs downward from bolt lines.
 */
export function makePaintMaps(
  color: THREE.ColorRepresentation,
  size = 512,
  aniso = 4,
): SurfaceMaps {
  // The canvas is sampled as sRGB, so the enamel colour is written in sRGB —
  // converting it to linear here would darken every machine twice over.
  const base = new THREE.Color(color);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const peel = fbm2(u * 46, v * 46, 3, 64, 3);
      const chip = smoothstep(0.88, 0.98, fbm2(u * 15, v * 15, 29, 32, 3));
      h[y * size + x] = clamp(0.6 + peel * 0.25 - chip * 0.55, 0, 1);
    }
  }
  const map = writeRGB(size, (x, y, out) => {
    const u = x / size;
    const v = y / size;
    const peel = fbm2(u * 46, v * 46, 3, 64, 3);
    const chip = smoothstep(0.88, 0.98, fbm2(u * 15, v * 15, 29, 32, 3));
    // grime streaks run down (v+)
    const streak = smoothstep(0.6, 1, fbm2(u * 30, v * 2.2, 77, 32, 3)) * smoothstep(0.1, 0.9, v);
    let r = base.r * (0.9 + peel * 0.2);
    let g = base.g * (0.9 + peel * 0.2);
    let b = base.b * (0.9 + peel * 0.2);
    r = lerp(r, 0.1, chip * 0.75);
    g = lerp(g, 0.095, chip * 0.75);
    b = lerp(b, 0.09, chip * 0.75);
    const grime = streak * 0.22;
    out[0] = lerp(r, 0.16, grime);
    out[1] = lerp(g, 0.14, grime);
    out[2] = lerp(b, 0.12, grime);
  });
  const rough = writeRGB(size, (x, y, out) => {
    const u = x / size;
    const v = y / size;
    const chip = smoothstep(0.88, 0.98, fbm2(u * 15, v * 15, 29, 32, 3));
    const streak = smoothstep(0.6, 1, fbm2(u * 30, v * 2.2, 77, 32, 3)) * smoothstep(0.1, 0.9, v);
    out[0] = out[1] = out[2] = clamp(0.44 + chip * 0.4 + streak * 0.22, 0.3, 1);
  });
  return {
    map: toTexture(map, true, aniso),
    normalMap: toTexture(normalFromHeight(h, size, 1.5), false, aniso),
    roughnessMap: toTexture(rough, false, aniso),
  };
}

/** Bare, polished steel where the tree rubs: the only place wear is allowed. */
export function makeWearMaps(size = 256, aniso = 4): SurfaceMaps {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      h[y * size + x] = clamp(0.5 + (fbm2(u * 90, v * 6, 13, 128, 2) - 0.5) * 0.9, 0, 1);
    }
  }
  const map = writeRGB(size, (x, y, out) => {
    const u = x / size;
    const v = y / size;
    const scratch = fbm2(u * 90, v * 6, 13, 128, 2);
    const t = 0.44 + scratch * 0.3;
    out[0] = t;
    out[1] = t * 0.99;
    out[2] = t * 0.97;
  });
  const rough = writeRGB(size, (x, y, out) => {
    const u = x / size;
    const v = y / size;
    out[0] = out[1] = out[2] = clamp(0.25 + fbm2(u * 90, v * 6, 13, 128, 2) * 0.3, 0.15, 0.7);
  });
  return {
    map: toTexture(map, true, aniso),
    normalMap: toTexture(normalFromHeight(h, size, 0.9), false, aniso),
    roughnessMap: toTexture(rough, false, aniso),
  };
}

/** Feed-roller rubber: dull, slightly compressed, scored by needles. */
export function makeRubberMaps(size = 256, aniso = 4): SurfaceMaps {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const rib = Math.sin(u * Math.PI * 2 * 18) * 0.5 + 0.5;
      const score = smoothstep(0.72, 1, fbm2(u * 14, v * 60, 31, 32, 2));
      h[y * size + x] = clamp(0.55 + rib * 0.2 - score * 0.4, 0, 1);
    }
  }
  const map = writeRGB(size, (x, y, out) => {
    const u = x / size;
    const v = y / size;
    const score = smoothstep(0.72, 1, fbm2(u * 14, v * 60, 31, 32, 2));
    const dust = fbm2(u * 8, v * 8, 53, 16, 3) * 0.06;
    const t = 0.052 + dust + score * 0.05;
    out[0] = t;
    out[1] = t * 0.98;
    out[2] = t * 0.95;
  });
  const rough = writeRGB(size, (x, y, out) => {
    const u = x / size;
    const v = y / size;
    out[0] = out[1] = out[2] = clamp(0.82 + fbm2(u * 20, v * 20, 71, 32, 2) * 0.16, 0.6, 1);
  });
  return {
    map: toTexture(map, true, aniso),
    normalMap: toTexture(normalFromHeight(h, size, 1.6), false, aniso),
    roughnessMap: toTexture(rough, false, aniso),
  };
}

/** Sealed concrete floor for the covered delivery hall. */
export function makeConcreteMaps(size = 512, aniso = 8): SurfaceMaps {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const pit = smoothstep(0.86, 1, fbm2(u * 40, v * 40, 17, 64, 3));
      h[y * size + x] = clamp(0.7 + fbm2(u * 6, v * 6, 3, 8, 4) * 0.2 - pit * 0.5, 0, 1);
    }
  }
  const map = writeRGB(size, (x, y, out) => {
    const u = x / size;
    const v = y / size;
    const mottle = fbm2(u * 5, v * 5, 3, 8, 4);
    const pit = smoothstep(0.86, 1, fbm2(u * 40, v * 40, 17, 64, 3));
    const t = 0.185 + mottle * 0.07 - pit * 0.05;
    out[0] = t * 1.03;
    out[1] = t;
    out[2] = t * 0.95;
  });
  const rough = writeRGB(size, (x, y, out) => {
    const u = x / size;
    const v = y / size;
    out[0] = out[1] = out[2] = clamp(0.5 + fbm2(u * 12, v * 12, 9, 16, 3) * 0.35, 0.35, 0.95);
  });
  return {
    map: toTexture(map, true, aniso),
    normalMap: toTexture(normalFromHeight(h, size, 0.8), false, aniso),
    roughnessMap: toTexture(rough, false, aniso),
  };
}

/** Overcast winter sky used as the scene background (vertical gradient + haze). */
export function makeSkyTexture(top: string, horizon: string, ground: string): THREE.Texture {
  const W = 512;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, top);
  grad.addColorStop(0.56, horizon);
  grad.addColorStop(0.62, horizon);
  grad.addColorStop(1, ground);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  // flat winter cloud banding: enough to keep the sky from reading as paper
  const img = ctx.getImageData(0, 0, W, H);
  for (let y = 0; y < H * 0.56; y++) {
    const v = y / (H * 0.56);
    const band = fbm2((y / H) * 9, 0, 21, 16, 3);
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const cloud =
        smoothstep(0.44, 0.78, fbm2(u * 7, v * 3.4 + 2, 13, 8, 4) * 0.7 + band * 0.4) *
        smoothstep(0.02, 0.5, v) *
        (1 - smoothstep(0.7, 1, v));
      const i = (y * W + x) * 4;
      const k = 1 + cloud * 0.16;
      const d = 1 - cloud * 0.05;
      img.data[i] = clamp(img.data[i] * k * d, 0, 255);
      img.data[i + 1] = clamp(img.data[i + 1] * k * d, 0, 255);
      img.data[i + 2] = clamp(img.data[i + 2] * k, 0, 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
