import * as THREE from 'three';
import { hash2 } from './math';

type Ctx = CanvasRenderingContext2D;

function makeCanvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

function toTexture(c: HTMLCanvasElement, repeatX = 1, repeatY = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 4;
  return t;
}

/** Scatter irregular blotches. */
function blotches(
  ctx: Ctx,
  w: number,
  h: number,
  n: number,
  rMin: number,
  rMax: number,
  color: () => string
): void {
  for (let i = 0; i < n; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const r = rMin + Math.random() * (rMax - rMin);
    ctx.fillStyle = color();
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.5 + Math.random() * 0.8), Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
}

function grain(ctx: Ctx, w: number, h: number, n: number, alpha: number): void {
  for (let i = 0; i < n; i++) {
    const v = Math.floor(Math.random() * 90);
    const light = Math.random() > 0.5;
    ctx.fillStyle = light
      ? `rgba(255,255,255,${alpha * Math.random()})`
      : `rgba(${v},${v},${v},${alpha * Math.random()})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

/** Forged steel for the wrecking ball: dark iron, dents, rust patches, one worn bright band. */
export function steelBallTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(512, 256);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#4a4a4e');
  g.addColorStop(0.5, '#3d3c40');
  g.addColorStop(1, '#333236');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 256);
  // mottled forged surface
  blotches(ctx, 512, 256, 260, 3, 16, () => `rgba(${20 + (Math.random() * 30) | 0},${20 + (Math.random() * 28) | 0},${22 + (Math.random() * 26) | 0},0.25)`);
  blotches(ctx, 512, 256, 140, 2, 10, () => `rgba(120,122,128,${0.06 + Math.random() * 0.1})`);
  // rust patches, concentrated toward the lower half (weathering pools low)
  for (let i = 0; i < 60; i++) {
    const y = 120 + Math.random() * 130;
    const x = Math.random() * 512;
    const r = 4 + Math.random() * 22;
    ctx.fillStyle = `rgba(${110 + (Math.random() * 40) | 0},${55 + (Math.random() * 25) | 0},${28 + (Math.random() * 14) | 0},${0.1 + Math.random() * 0.22})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.7, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // worn bright metal band around the equator (the contact zone)
  for (let i = 0; i < 90; i++) {
    const y = 116 + (Math.random() - 0.5) * 44;
    const x = Math.random() * 512;
    ctx.fillStyle = `rgba(${160 + (Math.random() * 60) | 0},${162 + (Math.random() * 58) | 0},${168 + (Math.random() * 55) | 0},${0.10 + Math.random() * 0.20})`;
    ctx.beginPath();
    ctx.ellipse(x, y, 6 + Math.random() * 26, 3 + Math.random() * 7, (Math.random() - 0.5) * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // dents: dark ellipse with light rim below
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * 512;
    const y = 40 + Math.random() * 180;
    const r = 5 + Math.random() * 12;
    ctx.fillStyle = 'rgba(18,18,20,0.4)';
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(190,190,196,0.22)';
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.55, r * 0.9, r * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  grain(ctx, 512, 256, 2200, 0.05);
  return toTexture(c);
}

/** Brick face: warm clay with per-brick tone shifts handled by instance colors; this is a single-brick face. */
export function brickFaceTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(128, 64);
  ctx.fillStyle = '#9e5540';
  ctx.fillRect(0, 0, 128, 64);
  blotches(ctx, 128, 64, 70, 2, 9, () => `rgba(${120 + (Math.random() * 60) | 0},${60 + (Math.random() * 30) | 0},${40 + (Math.random() * 22) | 0},${0.15 + Math.random() * 0.25})`);
  blotches(ctx, 128, 64, 30, 1, 5, () => `rgba(60,32,24,${0.1 + Math.random() * 0.2})`);
  grain(ctx, 128, 64, 500, 0.07);
  // fired edge darkening
  ctx.strokeStyle = 'rgba(60,30,22,0.5)';
  ctx.lineWidth = 3;
  ctx.strokeRect(1, 1, 126, 62);
  return toTexture(c);
}

/** Hollow concrete block outer shell. */
export function blockFaceTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(128, 128);
  ctx.fillStyle = '#9a968e';
  ctx.fillRect(0, 0, 128, 128);
  blotches(ctx, 128, 128, 90, 2, 10, () => `rgba(${120 + (Math.random() * 40) | 0},${118 + (Math.random() * 38) | 0},${112 + (Math.random() * 36) | 0},${0.12 + Math.random() * 0.2})`);
  blotches(ctx, 128, 128, 50, 1, 5, () => `rgba(70,68,64,${0.08 + Math.random() * 0.18})`);
  grain(ctx, 128, 128, 900, 0.09);
  // faint mortar smears
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = 'rgba(200,196,186,0.12)';
    ctx.fillRect(Math.random() * 128, Math.random() * 128, 20 + Math.random() * 40, 3 + Math.random() * 5);
  }
  return toTexture(c);
}

/** Poured concrete panel surface with aggregate and formwork lines. */
export function concreteTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = '#a3a19b';
  ctx.fillRect(0, 0, 256, 256);
  blotches(ctx, 256, 256, 160, 3, 18, () => `rgba(${130 + (Math.random() * 40) | 0},${128 + (Math.random() * 38) | 0},${122 + (Math.random() * 36) | 0},${0.1 + Math.random() * 0.16})`);
  blotches(ctx, 256, 256, 90, 1, 4, () => `rgba(72,70,66,${0.1 + Math.random() * 0.2})`);
  // water staining running down
  for (let i = 0; i < 12; i++) {
    const x = Math.random() * 256;
    const w = 4 + Math.random() * 14;
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, 'rgba(90,88,84,0.16)');
    grad.addColorStop(1, 'rgba(90,88,84,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, Math.random() * 60, w, 150 + Math.random() * 100);
  }
  // formwork tie holes
  for (let gx = 0; gx < 2; gx++) {
    for (let gy = 0; gy < 2; gy++) {
      ctx.fillStyle = 'rgba(70,68,64,0.22)';
      ctx.beginPath();
      ctx.arc(64 + gx * 128, 64 + gy * 128, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  grain(ctx, 256, 256, 1600, 0.06);
  return toTexture(c);
}

/** Rough fracture surface (shared by broken faces of debris). */
export function fractureTexture(base: string): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(64, 64);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 64, 64);
  blotches(ctx, 64, 64, 60, 1, 6, () => `rgba(40,36,32,${0.1 + Math.random() * 0.3})`);
  grain(ctx, 64, 64, 400, 0.15);
  return toTexture(c);
}

/** Gravel yard ground. */
export function gravelTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(512, 512);
  ctx.fillStyle = '#8b8478';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 5200; i++) {
    const v = 100 + Math.random() * 90;
    const warm = Math.random() * 20;
    ctx.fillStyle = `rgba(${(v + warm) | 0},${(v + warm * 0.6) | 0},${(v - 8) | 0},${0.5 + Math.random() * 0.5})`;
    const r = 1 + Math.random() * 3.4;
    ctx.beginPath();
    ctx.ellipse(Math.random() * 512, Math.random() * 512, r, r * (0.6 + Math.random() * 0.5), Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // tire ruts and stains
  for (let i = 0; i < 6; i++) {
    ctx.strokeStyle = `rgba(70,66,60,${0.10 + Math.random() * 0.10})`;
    ctx.lineWidth = 10 + Math.random() * 16;
    ctx.beginPath();
    const y = Math.random() * 512;
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(170, y + (Math.random() - 0.5) * 120, 340, y + (Math.random() - 0.5) * 120, 512, y + (Math.random() - 0.5) * 80);
    ctx.stroke();
  }
  blotches(ctx, 512, 512, 26, 8, 40, () => `rgba(96,90,80,${0.12 + Math.random() * 0.12})`);
  return toTexture(c, 6, 6);
}

/**
 * Worn machine paint. Wear is painted asymmetrically along given "hot zones"
 * (u,v in 0..1, radius) so left/right are never mirror images.
 */
export function wornPaintTexture(
  baseColor: string,
  wearZones: Array<{ u: number; v: number; r: number }>
): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, 256, 256);
  blotches(ctx, 256, 256, 60, 4, 20, () => `rgba(0,0,0,${0.03 + Math.random() * 0.06})`);
  // dirt streaks running down
  for (let i = 0; i < 14; i++) {
    const x = Math.random() * 256;
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, 'rgba(60,52,40,0.14)');
    grad.addColorStop(1, 'rgba(60,52,40,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, Math.random() * 100, 3 + Math.random() * 8, 100 + Math.random() * 156);
  }
  for (const z of wearZones) {
    const cx = z.u * 256;
    const cy = z.v * 256;
    const R = z.r * 256;
    // chipped paint down to primer / bare metal
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * R;
      const x = cx + Math.cos(a) * d;
      const y = cy + Math.sin(a) * d * 0.8;
      const r = 2 + Math.random() * 7;
      const bare = Math.random() > 0.45;
      ctx.fillStyle = bare
        ? `rgba(${140 + (Math.random() * 50) | 0},${140 + (Math.random() * 48) | 0},${146 + (Math.random() * 44) | 0},0.8)`
        : `rgba(${120 + (Math.random() * 30) | 0},${62 + (Math.random() * 20) | 0},${30 + (Math.random() * 14) | 0},0.75)`; // rust primer
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (0.4 + Math.random() * 0.6), Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    // rust bleeding downward from the wear zone
    ctx.fillStyle = 'rgba(122,66,32,0.18)';
    ctx.fillRect(cx - R * 0.4, cy, R * 0.8, R * 1.4);
  }
  grain(ctx, 256, 256, 900, 0.05);
  return toTexture(c);
}

/** Chain-link fence with alpha. */
export function fenceTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(128, 128);
  ctx.clearRect(0, 0, 128, 128);
  ctx.strokeStyle = 'rgba(150,152,156,0.95)';
  ctx.lineWidth = 2.4;
  const step = 16;
  for (let i = -8; i < 18; i++) {
    ctx.beginPath();
    ctx.moveTo(i * step, -8);
    ctx.lineTo(i * step + 136, 136);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(i * step + 136, -8);
    ctx.lineTo(i * step, 136);
    ctx.stroke();
  }
  const t = toTexture(c, 6, 2);
  return t;
}

/** Old faded mural revealed behind the wall: sun over hills, hand-painted and weathered. */
export function muralTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(512, 320);
  // old plaster base
  ctx.fillStyle = '#b8a98d';
  ctx.fillRect(0, 0, 512, 320);
  blotches(ctx, 512, 320, 120, 4, 22, () => `rgba(${150 + (Math.random() * 40) | 0},${138 + (Math.random() * 34) | 0},${112 + (Math.random() * 30) | 0},${0.15 + Math.random() * 0.2})`);
  // faded painted sky band
  ctx.fillStyle = 'rgba(110,150,170,0.45)';
  ctx.fillRect(0, 0, 512, 150);
  // big sun
  ctx.fillStyle = 'rgba(214,150,60,0.75)';
  ctx.beginPath();
  ctx.arc(150, 96, 56, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(214,150,60,0.55)';
  ctx.lineWidth = 8;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(150 + Math.cos(a) * 70, 96 + Math.sin(a) * 70);
    ctx.lineTo(150 + Math.cos(a) * 92, 96 + Math.sin(a) * 92);
    ctx.stroke();
  }
  // hills
  ctx.fillStyle = 'rgba(96,130,84,0.6)';
  ctx.beginPath();
  ctx.moveTo(0, 210);
  ctx.quadraticCurveTo(130, 130, 280, 205);
  ctx.quadraticCurveTo(400, 150, 512, 200);
  ctx.lineTo(512, 320);
  ctx.lineTo(0, 320);
  ctx.fill();
  // little painted birds
  ctx.strokeStyle = 'rgba(70,70,80,0.6)';
  ctx.lineWidth = 4;
  for (let i = 0; i < 4; i++) {
    const x = 260 + i * 55 + Math.random() * 20;
    const y = 60 + Math.random() * 50;
    ctx.beginPath();
    ctx.arc(x - 8, y, 9, Math.PI * 1.1, Math.PI * 1.9);
    ctx.arc(x + 8, y, 9, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
  }
  // weathering: plaster loss patches showing masonry beneath
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 320;
    ctx.fillStyle = `rgba(${140 + (Math.random() * 20) | 0},${120 + (Math.random() * 18) | 0},${96 + (Math.random() * 16) | 0},${0.3 + Math.random() * 0.4})`;
    ctx.beginPath();
    const r = 6 + Math.random() * 26;
    ctx.moveTo(x + r, y);
    for (let k = 1; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      const rr = r * (0.6 + Math.random() * 0.7);
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }
  grain(ctx, 512, 320, 1400, 0.06);
  return toTexture(c);
}

/** Twisted wire-rope stripes, tiled around the rope cylinder. */
export function ropeTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(64, 64);
  ctx.fillStyle = '#5b5b60';
  ctx.fillRect(0, 0, 64, 64);
  ctx.lineWidth = 5;
  for (let i = -4; i < 12; i++) {
    const shade = 90 + ((i * 37) % 50);
    ctx.strokeStyle = `rgb(${shade},${shade},${shade + 4})`;
    ctx.beginPath();
    ctx.moveTo(i * 10 - 20, 70);
    ctx.lineTo(i * 10 + 20, -6);
    ctx.stroke();
  }
  // grease darkening
  blotches(ctx, 64, 64, 20, 2, 8, () => `rgba(30,28,26,${0.15 + Math.random() * 0.2})`);
  const t = toTexture(c, 1, 14);
  return t;
}

/** Radial crack pattern decal (alpha) for concrete impacts. */
export function crackDecalTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(256, 256);
  ctx.clearRect(0, 0, 256, 256);
  const cx = 128;
  const cy = 128;
  const branches = 7 + ((Math.random() * 3) | 0);
  for (let b = 0; b < branches; b++) {
    let a = (b / branches) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    let x = cx;
    let y = cy;
    let wdt = 4.5;
    const segs = 8 + ((Math.random() * 5) | 0);
    for (let s = 0; s < segs; s++) {
      const len = 8 + Math.random() * 16;
      const nx = x + Math.cos(a) * len;
      const ny = y + Math.sin(a) * len;
      ctx.strokeStyle = `rgba(45,42,40,${0.42 - s * 0.04})`;
      ctx.lineWidth = Math.max(0.6, wdt);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      // occasional side twig
      if (Math.random() > 0.65) {
        const ta = a + (Math.random() - 0.5) * 1.6;
        ctx.lineWidth = Math.max(0.5, wdt * 0.5);
        ctx.beginPath();
        ctx.moveTo(nx, ny);
        ctx.lineTo(nx + Math.cos(ta) * len * 0.7, ny + Math.sin(ta) * len * 0.7);
        ctx.stroke();
      }
      x = nx;
      y = ny;
      a += (Math.random() - 0.5) * 0.7;
      wdt *= 0.82;
    }
  }
  // crushed center
  ctx.fillStyle = 'rgba(50,47,44,0.3)';
  ctx.beginPath();
  ctx.arc(cx, cy, 12 + Math.random() * 7, 0, Math.PI * 2);
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Soft round dust sprite. */
export function dustSpriteTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.42)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}

/** Simple sky gradient as scene background. */
export function skyTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(16, 256);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#7da3cd');
  g.addColorStop(0.45, '#a8c2d9');
  g.addColorStop(0.72, '#cdd8d9');
  g.addColorStop(1, '#d8d4c4');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Per-cell tone variation helper for instanced walls. */
export function cellTone(col: number, row: number, base: THREE.Color, spread: number): THREE.Color {
  const h = hash2(col * 3.7 + 1.1, row * 7.3 + 2.9);
  const h2 = hash2(col * 9.1 + 5.7, row * 2.3 + 8.1);
  const c = base.clone();
  c.offsetHSL((h - 0.5) * 0.03, (h2 - 0.5) * 0.08, (h - 0.5) * spread);
  return c;
}
