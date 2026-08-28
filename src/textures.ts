import * as THREE from 'three';

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

function texFrom(c: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Deterministic value noise so nothing changes between reloads. */
function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
function fbm(x: number, y: number, oct = 4): number {
  let s = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f, y * f);
    a *= 0.5;
    f *= 2;
  }
  return s;
}

/** v = 0 dorsal ridge, v = 0.5 belly, v = 1 dorsal ridge (wrap-around body UV). */
function dorsalness(v: number): number {
  const d = Math.abs(v - 0.5) * 2; // 0 belly .. 1 back
  return d;
}

/** Scale-row height field, only legible in close-up. */
function scaleField(u: number, v: number): number {
  const rows = 34;
  const cols = 84;
  const sy = v * rows;
  const rowIndex = Math.floor(sy);
  const offset = (rowIndex % 2) * 0.5;
  const sx = u * cols + offset + Math.sin(v * 9.0) * 0.35;
  const fy = sy - Math.floor(sy);
  const fx = sx - Math.floor(sx);
  const dx = fx - 0.5;
  const dy = fy - 0.5;
  const r = Math.sqrt(dx * dx * 0.62 + dy * dy);
  const lip = Math.max(0, 1 - Math.abs(r - 0.34) / 0.2);
  const body = Math.max(0, 0.5 - r) * 0.55;
  return lip * 0.65 + body;
}

export interface FishMaps {
  map: THREE.Texture;
  roughnessMap: THREE.Texture;
  normalMap: THREE.Texture;
}

/** Countershaded body: dark blue-green back, pale flank, near-white belly.
 *  No painted per-individual dirt — individuals differ by form and light angle. */
export function makeFishMaps(size = 1024): FishMaps {
  const W = size;
  const H = size / 2;
  const [albedoC, aCtx] = makeCanvas(W, H);
  const albedo = aCtx.createImageData(W, H);
  const [roughC, rCtx] = makeCanvas(W, H);
  const rough = rCtx.createImageData(W, H);
  const height = new Float32Array(W * H);

  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    const d = dorsalness(v);
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      const i = (y * W + x) * 4;

      // vertical (back-to-belly) tonal ramp
      const t = Math.pow(Math.max(0, (d - 0.08) / 0.92), 1.05);
      let r = 0.92 - 0.87 * t;
      let g = 0.94 - 0.79 * t;
      let b = 0.94 - 0.66 * t;
      // back is desaturated green-blue, not saturated teal
      r -= t * 0.055;
      g += t * 0.02;

      // gill cover + head shading
      const headMask = Math.max(0, 1 - u / 0.16);
      r -= headMask * 0.06;
      g -= headMask * 0.05;
      b -= headMask * 0.035;
      const gill = Math.exp(-Math.pow((u - 0.185) / 0.012, 2)) * (1 - d * 0.35);
      r -= gill * 0.1;
      g -= gill * 0.1;
      b -= gill * 0.09;

      // lateral line: faint, slightly arched over the pectoral region
      const lineV = 0.5 + (0.5 - 0.5 * 0.62) * (v > 0.5 ? 1 : -1);
      const arch = 0.028 * Math.exp(-Math.pow((u - 0.3) / 0.18, 2));
      const dl = Math.abs(v - (v > 0.5 ? lineV + arch : lineV - arch));
      const ll = Math.exp(-Math.pow(dl / 0.012, 2)) * Math.min(1, Math.max(0, (u - 0.16) / 0.1));
      r -= ll * 0.085;
      g -= ll * 0.075;
      b -= ll * 0.06;

      // caudal peduncle darkens slightly
      const tail = Math.max(0, (u - 0.82) / 0.18);
      r -= tail * 0.1;
      g -= tail * 0.09;
      b -= tail * 0.075;

      // scales carry most of their signal in roughness, a whisper in albedo
      const sc = scaleField(u, v);
      const grain = fbm(u * 34, v * 17, 3) - 0.5;
      const scAlb = (sc - 0.3) * 0.022 * (0.35 + d * 0.65);
      r += scAlb + grain * 0.012;
      g += scAlb + grain * 0.012;
      b += scAlb + grain * 0.012;

      height[y * W + x] = sc + grain * 0.25;

      albedo.data[i] = Math.max(0, Math.min(255, r * 255));
      albedo.data[i + 1] = Math.max(0, Math.min(255, g * 255));
      albedo.data[i + 2] = Math.max(0, Math.min(255, b * 255));
      albedo.data[i + 3] = 255;

      // wet flank is smoother than the back; scale lips catch light
      let ro = 0.34 - 0.13 * (1 - d) + 0.1 * d;
      ro -= sc * 0.1;
      ro += (fbm(u * 60, v * 30, 3) - 0.5) * 0.07;
      ro = Math.max(0.06, Math.min(0.72, ro));
      const rv = ro * 255;
      rough.data[i] = rv;
      rough.data[i + 1] = rv;
      rough.data[i + 2] = rv;
      rough.data[i + 3] = 255;
    }
  }
  aCtx.putImageData(albedo, 0, 0);
  rCtx.putImageData(rough, 0, 0);

  // normal map from the scale height field
  const [normC, nCtx] = makeCanvas(W, H);
  const norm = nCtx.createImageData(W, H);
  const strength = 2.1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const l = height[y * W + ((x - 1 + W) % W)];
      const r = height[y * W + ((x + 1) % W)];
      const u2 = height[((y - 1 + H) % H) * W + x];
      const d2 = height[((y + 1) % H) * W + x];
      let nx = (l - r) * strength;
      let ny = (u2 - d2) * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      const i = (y * W + x) * 4;
      norm.data[i] = (nx * 0.5 + 0.5) * 255;
      norm.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      norm.data[i + 2] = (nz / len) * 255;
      norm.data[i + 3] = 255;
    }
  }
  nCtx.putImageData(norm, 0, 0);

  return {
    map: texFrom(albedoC, true),
    roughnessMap: texFrom(roughC, false),
    normalMap: texFrom(normC, false),
  };
}

export interface FinMaps {
  map: THREE.Texture;
  alphaMap: THREE.Texture;
}

/** Fin membrane with rays; margin is ragged, never a clean rounded plate. */
export function makeFinMaps(size = 512): FinMaps {
  const W = size;
  const H = size;
  const [c, ctx] = makeCanvas(W, H);
  const img = ctx.createImageData(W, H);
  const [ac, actx] = makeCanvas(W, H);
  const alpha = actx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1); // 0 = base, 1 = margin
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      const i = (y * W + x) * 4;
      const rays = Math.abs(Math.sin(u * Math.PI * 13 + v * 0.7));
      const ray = Math.pow(rays, 3.2);
      const base = 0.62 - v * 0.22;
      const l = base + ray * 0.2 * (1 - v * 0.4);
      img.data[i] = Math.min(255, l * 238);
      img.data[i + 1] = Math.min(255, l * 244);
      img.data[i + 2] = Math.min(255, l * 246);
      img.data[i + 3] = 255;

      // ragged margin follows the ray tips
      const notch = 0.045 * (1 - ray) + fbm(u * 22, 3.1, 2) * 0.05;
      let a = 1 - Math.max(0, (v - (0.94 - notch)) / 0.09);
      a *= 0.55 + 0.45 * ray;
      a = Math.max(0, Math.min(1, a)) * (0.72 + 0.28 * (1 - v));
      const av = a * 255;
      alpha.data[i] = av;
      alpha.data[i + 1] = av;
      alpha.data[i + 2] = av;
      alpha.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  actx.putImageData(alpha, 0, 0);
  const map = texFrom(c, true);
  const alphaMap = texFrom(ac, false);
  map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  alphaMap.wrapS = alphaMap.wrapT = THREE.ClampToEdgeWrapping;
  return { map, alphaMap };
}

/** Painted marine ply deck. Wear only where feet and gear actually go. */
export function makeDeckMaps(size = 1024): { map: THREE.Texture; roughnessMap: THREE.Texture } {
  const W = size;
  const H = size;
  const [c, ctx] = makeCanvas(W, H);
  const img = ctx.createImageData(W, H);
  const [rc, rctx] = makeCanvas(W, H);
  const rg = rctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      const i = (y * W + x) * 4;
      const grain = fbm(u * 8, v * 90, 4);
      const plank = Math.abs(((v * 7) % 1) - 0.5);
      const seam = Math.max(0, 1 - plank / 0.035);
      let l = 0.215 + grain * 0.062 - seam * 0.115;

      // slight polish where feet actually travel, aligned with the planking
      const path = Math.exp(-Math.pow((v - 0.5) / 0.22, 2));
      const hatch = 0;
      l += path * 0.02 * (0.4 + grain);

      img.data[i] = l * 255 * 1.0;
      img.data[i + 1] = l * 255 * 1.02;
      img.data[i + 2] = l * 255 * 1.06;
      img.data[i + 3] = 255;

      let ro = 0.82 - path * 0.16 - hatch * 0.34 + (grain - 0.5) * 0.12;
      ro = Math.max(0.12, Math.min(0.95, ro));
      rg.data[i] = ro * 255;
      rg.data[i + 1] = ro * 255;
      rg.data[i + 2] = ro * 255;
      rg.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  rctx.putImageData(rg, 0, 0);
  return { map: texFrom(c, true), roughnessMap: texFrom(rc, false) };
}

/** Moulded rubber grip: diamond knurl, polished flat where a thumb rests. */
export function makeGripMaps(size = 512): { map: THREE.Texture; roughnessMap: THREE.Texture; normalMap: THREE.Texture } {
  const W = size;
  const H = size;
  const [c, ctx] = makeCanvas(W, H);
  const img = ctx.createImageData(W, H);
  const [rc, rctx] = makeCanvas(W, H);
  const rg = rctx.createImageData(W, H);
  const height = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      const i = (y * W + x) * 4;
      const knurl =
        Math.abs(Math.sin((u + v) * Math.PI * 26)) * Math.abs(Math.sin((u - v) * Math.PI * 26));
      const worn = Math.exp(-Math.pow((Math.hypot(u - 0.5, v - 0.52) - 0.0) / 0.26, 2));
      const k = knurl * (1 - worn * 0.85);
      height[y * W + x] = k;
      const l = 0.085 + k * 0.05 + worn * 0.02 + fbm(u * 40, v * 40, 2) * 0.012;
      img.data[i] = l * 255;
      img.data[i + 1] = l * 258;
      img.data[i + 2] = l * 262;
      img.data[i + 3] = 255;
      const ro = Math.max(0.2, Math.min(0.98, 0.92 - worn * 0.42 - k * 0.06));
      rg.data[i] = ro * 255;
      rg.data[i + 1] = ro * 255;
      rg.data[i + 2] = ro * 255;
      rg.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  rctx.putImageData(rg, 0, 0);

  const [nc, nctx] = makeCanvas(W, H);
  const nm = nctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const l = height[y * W + ((x - 1 + W) % W)];
      const r = height[y * W + ((x + 1) % W)];
      const u2 = height[((y - 1 + H) % H) * W + x];
      const d2 = height[((y + 1) % H) * W + x];
      let nx = (l - r) * 1.6;
      let ny = (u2 - d2) * 1.6;
      const len = Math.hypot(nx, ny, 1);
      nx /= len;
      ny /= len;
      const i = (y * W + x) * 4;
      nm.data[i] = (nx * 0.5 + 0.5) * 255;
      nm.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      nm.data[i + 2] = (1 / len) * 255;
      nm.data[i + 3] = 255;
    }
  }
  nctx.putImageData(nm, 0, 0);
  return { map: texFrom(c, true), roughnessMap: texFrom(rc, false), normalMap: texFrom(nc, false) };
}

/** Distant shoreline / lake haze seen through the cabin windows. Low detail on purpose. */
export function makeLakeBackdrop(w = 512, h = 256): THREE.Texture {
  const [c, ctx] = makeCanvas(w, h);
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.62);
  sky.addColorStop(0, '#8a9cab');
  sky.addColorStop(0.7, '#b3bfc6');
  sky.addColorStop(1, '#c6ccce');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h * 0.62);

  ctx.fillStyle = 'rgba(96,110,112,0.55)';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.6);
  for (let x = 0; x <= w; x += 8) {
    const t = x / w;
    const y = h * (0.6 - 0.055 * (fbm(t * 5, 0.5, 3) - 0.2) - 0.03 * Math.sin(t * 7.2));
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h * 0.62);
  ctx.lineTo(0, h * 0.62);
  ctx.closePath();
  ctx.fill();

  const water = ctx.createLinearGradient(0, h * 0.62, 0, h);
  water.addColorStop(0, '#6d7d88');
  water.addColorStop(1, '#38454f');
  ctx.fillStyle = water;
  ctx.fillRect(0, h * 0.62, w, h * 0.38);
  for (let i = 0; i < 260; i++) {
    const y = h * (0.63 + Math.pow(Math.random(), 1.6) * 0.36);
    const x = Math.random() * w;
    const len = 4 + Math.random() * 26;
    ctx.strokeStyle = `rgba(210,220,226,${0.03 + Math.random() * 0.08})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y);
    ctx.stroke();
  }
  const t = texFrom(c, true);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
