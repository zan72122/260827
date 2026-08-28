import * as THREE from 'three';
import { Rng } from './rng';

/**
 * Every surface in the post office is drawn procedurally: paper fibre, absorbed ink,
 * dull rubber, painted brass, woven canvas, worn wood. No image assets, no network.
 */

export function canvas2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: false });
  if (!ctx) throw new Error('2d context unavailable');
  return [c, ctx];
}

/** Seeded value noise sampled on a lattice, with fbm octaves. */
function makeLattice(size: number, rng: Rng): Float32Array {
  const a = new Float32Array(size * size);
  for (let i = 0; i < a.length; i++) a[i] = rng.next();
  return a;
}

function sampleLattice(a: Float32Array, size: number, x: number, y: number): number {
  const xf = x * size;
  const yf = y * size;
  const x0 = Math.floor(xf);
  const y0 = Math.floor(yf);
  const tx = xf - x0;
  const ty = yf - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const i = (gx: number, gy: number) =>
    a[(((gy % size) + size) % size) * size + (((gx % size) + size) % size)];
  const v00 = i(x0, y0);
  const v10 = i(x0 + 1, y0);
  const v01 = i(x0, y0 + 1);
  const v11 = i(x0 + 1, y0 + 1);
  return (v00 * (1 - sx) + v10 * sx) * (1 - sy) + (v01 * (1 - sx) + v11 * sx) * sy;
}

export function fbm(rng: Rng, octaves = 4, baseSize = 8) {
  const layers: { a: Float32Array; size: number; amp: number }[] = [];
  let amp = 1;
  let size = baseSize;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    layers.push({ a: makeLattice(size, rng), size, amp });
    total += amp;
    amp *= 0.5;
    size *= 2;
  }
  return (x: number, y: number) => {
    let v = 0;
    for (const l of layers) v += sampleLattice(l.a, l.size, x, y) * l.amp;
    return v / total;
  };
}

/** Paper: fibre grain, uneven tone, softened worn corners. Never a flat white card. */
export interface PaperOptions {
  tone?: [number, number, number];
  fibre?: number;
  wear?: number;
  seed?: number;
}

export function paintPaper(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: PaperOptions = {},
): void {
  const rng = new Rng(opts.seed ?? 7);
  const tone = opts.tone ?? [236, 226, 203];
  const fibreAmount = opts.fibre ?? 1;
  const wear = opts.wear ?? 1;

  const cloud = fbm(rng, 4, 4);
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const v = y / h;
      const n = cloud(u * 2.2, v * 2.2);
      const shade = 1 + (n - 0.5) * 0.085;
      const i = (y * w + x) * 4;
      d[i] = Math.min(255, tone[0] * shade);
      d[i + 1] = Math.min(255, tone[1] * shade);
      d[i + 2] = Math.min(255, tone[2] * shade);
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // long fibres pressed into the sheet
  ctx.save();
  ctx.globalAlpha = 0.05 * fibreAmount;
  const fibres = Math.floor((w * h) / 900) * fibreAmount;
  for (let i = 0; i < fibres; i++) {
    const x = rng.range(0, w);
    const y = rng.range(0, h);
    const len = rng.range(3, 16);
    const ang = rng.range(0, Math.PI * 2);
    ctx.strokeStyle = rng.next() > 0.5 ? '#ffffff' : '#8d8367';
    ctx.lineWidth = rng.range(0.5, 1.1);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  }
  ctx.restore();

  // corner + edge wear
  if (wear > 0) {
    ctx.save();
    ctx.globalAlpha = 0.16 * wear;
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, 'rgba(120,105,78,0.5)');
    g.addColorStop(0.35, 'rgba(120,105,78,0)');
    g.addColorStop(0.7, 'rgba(120,105,78,0)');
    g.addColorStop(1, 'rgba(120,105,78,0.45)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.2 * wear;
    ctx.strokeStyle = 'rgba(126,110,82,0.8)';
    ctx.lineWidth = 2.4;
    ctx.strokeRect(1.2, 1.2, w - 2.4, h - 2.4);
    ctx.restore();
  }
}

/** Woven canvas for the mail bags: thick threads, dirt at the bottom. */
export function canvasWeaveTexture(size = 512, seed = 3, tint: [number, number, number] = [176, 160, 128]): THREE.CanvasTexture {
  const [c, ctx] = canvas2d(size, size);
  const rng = new Rng(seed);
  ctx.fillStyle = `rgb(${tint[0]},${tint[1]},${tint[2]})`;
  ctx.fillRect(0, 0, size, size);

  const pitch = size / 46;
  for (let i = 0; i < size / pitch + 1; i++) {
    const p = i * pitch;
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = `rgba(${tint[0] * 0.78 | 0},${tint[1] * 0.78 | 0},${tint[2] * 0.76 | 0},1)`;
    ctx.fillRect(p, 0, pitch * 0.42, size);
    ctx.fillRect(0, p, size, pitch * 0.42);
    ctx.globalAlpha = 0.34;
    ctx.fillStyle = 'rgba(255,248,232,1)';
    ctx.fillRect(p + pitch * 0.45, 0, pitch * 0.16, size);
    ctx.fillRect(0, p + pitch * 0.45, size, pitch * 0.16);
  }
  ctx.globalAlpha = 1;

  // slubs and irregular threads
  for (let i = 0; i < 220; i++) {
    ctx.globalAlpha = rng.range(0.05, 0.2);
    ctx.fillStyle = rng.next() > 0.5 ? '#6d6247' : '#d8ccb0';
    ctx.fillRect(rng.range(0, size), rng.range(0, size), rng.range(2, 12), rng.range(1.5, 3));
  }

  // ground-in dirt near the bottom (bags stand on the floor)
  const g = ctx.createLinearGradient(0, size * 0.62, 0, size);
  g.addColorStop(0, 'rgba(60,50,38,0)');
  g.addColorStop(1, 'rgba(52,43,32,0.42)');
  ctx.globalAlpha = 1;
  ctx.fillStyle = g;
  ctx.fillRect(0, size * 0.62, size, size * 0.38);

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Worn wooden counter: grain along one axis, ink stains, polish where hands rest. */
export function woodTexture(size = 512, seed = 11): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const [c, ctx] = canvas2d(size, size);
  const rng = new Rng(seed);
  const grain = fbm(rng, 4, 5);

  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      // stretched along U -> conduits run one way
      const n = grain(u, v * 9);
      const rings = Math.sin((v * 26 + n * 5) * Math.PI) * 0.5 + 0.5;
      const k = 0.62 + rings * 0.22 + (n - 0.5) * 0.25;
      const i = (y * size + x) * 4;
      d[i] = Math.min(255, 100 * k + 22);
      d[i + 1] = Math.min(255, 76 * k + 16);
      d[i + 2] = Math.min(255, 54 * k + 12);
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // long conduits scored along the grain
  ctx.globalAlpha = 0.1;
  ctx.strokeStyle = '#3a2a1a';
  for (let i = 0; i < 90; i++) {
    const y = rng.range(0, size);
    ctx.lineWidth = rng.range(0.6, 2.2);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(size * 0.3, y + rng.range(-4, 4), size * 0.7, y + rng.range(-4, 4), size, y + rng.range(-3, 3));
    ctx.stroke();
  }

  // ink marks left by years of postmarking
  for (let i = 0; i < 7; i++) {
    ctx.globalAlpha = rng.range(0.04, 0.1);
    ctx.fillStyle = '#2c3346';
    ctx.beginPath();
    ctx.ellipse(rng.range(0, size), rng.range(0, size), rng.range(3, 11), rng.range(2, 8), rng.range(0, 3), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const [bc, bctx] = canvas2d(size, size);
  bctx.drawImage(c, 0, 0);
  bctx.globalCompositeOperation = 'saturation';
  bctx.fillStyle = '#808080';
  bctx.fillRect(0, 0, size, size);

  const map = new THREE.CanvasTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const bump = new THREE.CanvasTexture(bc);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  return { map, bump };
}

/** Dull rubber die face: matte speckle plus caked ink. */
export function rubberTexture(size = 256, seed = 19): THREE.CanvasTexture {
  const [c, ctx] = canvas2d(size, size);
  const rng = new Rng(seed);
  ctx.fillStyle = '#3a3733';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 2600; i++) {
    ctx.globalAlpha = rng.range(0.03, 0.14);
    ctx.fillStyle = rng.next() > 0.5 ? '#59544d' : '#211f1c';
    ctx.fillRect(rng.range(0, size), rng.range(0, size), rng.range(1, 3), rng.range(1, 3));
  }
  ctx.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Painted / brushed brass roughness variation for the press. */
export function metalRoughnessTexture(size = 256, seed = 23, base = 0.42): THREE.CanvasTexture {
  const [c, ctx] = canvas2d(size, size);
  const rng = new Rng(seed);
  const n = fbm(rng, 3, 6);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const brushed = n(x / size * 0.4, y / size * 7);
      const v = Math.max(0, Math.min(1, base + (brushed - 0.5) * 0.5));
      const i = (y * size + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = v * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Rubber belt: dull, dusted with paper lint. */
export function beltTexture(size = 256, seed = 29): { map: THREE.CanvasTexture; rough: THREE.CanvasTexture } {
  const [c, ctx] = canvas2d(size, size);
  const rng = new Rng(seed);
  ctx.fillStyle = '#26262a';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < size; i += 8) {
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#101013';
    ctx.fillRect(0, i, size, 3);
  }
  for (let i = 0; i < 1400; i++) {
    ctx.globalAlpha = rng.range(0.03, 0.13);
    ctx.fillStyle = '#c9bfa6';
    ctx.fillRect(rng.range(0, size), rng.range(0, size), rng.range(1, 2.6), rng.range(1, 2.2));
  }
  ctx.globalAlpha = 1;
  const map = new THREE.CanvasTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  const rough = metalRoughnessTexture(size, seed + 1, 0.82);
  return { map, rough };
}

/** Soft round snow sprite. */
export function snowSprite(size = 32): THREE.CanvasTexture {
  const [c, ctx] = canvas2d(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.45, 'rgba(226,238,255,0.5)');
  g.addColorStop(1, 'rgba(226,238,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
