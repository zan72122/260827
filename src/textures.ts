// Procedural canvas textures. All generated once at load time (and on house
// regeneration) — no external assets, works offline and on mobile Safari.
import * as THREE from 'three';
import { Rng, makeNoise2D, fbm, clamp01, lerp, makeRng } from './util';

function canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  draw(ctx);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${h}, ${s}%, ${l}%)`;
}

export interface BrickParams {
  hue: number;        // base hue
  sat: number;
  light: number;
  sootTop: number;    // 0..1 how sooty near v=0 (top of texture)
  sootBottom: number;
  seed: number;
}

// Brick wall with realistic-ish coursing, per-brick tint variation, mortar,
// and asymmetric soot staining (heavier streaks, never stamp-like).
export function brickTexture(p: BrickParams, w = 512, h = 512): THREE.CanvasTexture {
  const rng = makeRng(p.seed);
  const noise = makeNoise2D(makeRng(p.seed + 7));
  return canvasTex(w, h, (ctx) => {
    // mortar base
    ctx.fillStyle = hsl(p.hue + 6, Math.max(4, p.sat * 0.25), 58);
    ctx.fillRect(0, 0, w, h);
    // mortar grain
    for (let i = 0; i < 2600; i++) {
      const x = rng() * w, y = rng() * h;
      ctx.fillStyle = `rgba(${30 + rng() * 40}, ${28 + rng() * 36}, ${26 + rng() * 34}, ${0.05 + rng() * 0.08})`;
      ctx.fillRect(x, y, 1 + rng() * 2, 1 + rng() * 2);
    }
    const rows = 10;
    const bh = h / rows;
    const bw = bh * 2.15;
    const mortar = Math.max(2, h * 0.012);
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * bw * 0.5;
      for (let cx = -1; cx < w / bw + 1; cx++) {
        const x0 = cx * bw + off + mortar / 2;
        const y0 = r * bh + mortar / 2;
        const bwv = bw - mortar;
        const bhv = bh - mortar;
        const dl = (rng() - 0.5) * 9 + (noise(cx * 0.8, r * 0.8) - 0.5) * 14;
        const dh = (rng() - 0.5) * 10;
        ctx.fillStyle = hsl(p.hue + dh, p.sat + (rng() - 0.5) * 8, p.light + dl);
        // slightly irregular brick outline (hand-laid feel, not rounded stamps)
        const jx = (rng() - 0.5) * 2, jy = (rng() - 0.5) * 2;
        ctx.fillRect(x0 + jx, y0 + jy, bwv, bhv);
        // top edge highlight / bottom shadow to fake relief
        ctx.fillStyle = 'rgba(255,235,220,0.10)';
        ctx.fillRect(x0 + jx, y0 + jy, bwv, 2);
        ctx.fillStyle = 'rgba(20,10,8,0.22)';
        ctx.fillRect(x0 + jx, y0 + jy + bhv - 2.5, bwv, 2.5);
        // per-brick blemishes
        const nb = Math.floor(rng() * 4);
        for (let b = 0; b < nb; b++) {
          ctx.fillStyle = `rgba(${20 + rng() * 30},${14 + rng() * 20},${12 + rng() * 16},${0.05 + rng() * 0.12})`;
          const px = x0 + rng() * bwv, py = y0 + rng() * bhv;
          ctx.beginPath();
          ctx.ellipse(px, py, 2 + rng() * 8, 1.5 + rng() * 5, rng() * Math.PI, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    // large-scale fbm tonal variation (heat / weather patches)
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
      const v = y / h;
      const soot = lerp(p.sootTop, p.sootBottom, v);
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const n = fbm(noise, x / 90, y / 90, 3);
        const tone = 0.82 + n * 0.36;
        // vertical soot streaks: column-noise so stains run in irregular stripes
        const streak = fbm(noise, x / 34, v * 2.2, 3);
        const sootAmt = clamp01(soot * (0.4 + streak * 0.9)) * 0.85;
        const k = tone * (1 - sootAmt);
        d[i] = d[i] * k;
        d[i + 1] = d[i + 1] * k * (1 - sootAmt * 0.15);
        d[i + 2] = d[i + 2] * k * (1 - sootAmt * 0.2);
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

// Moonlit snow: blue-grey, subtle drift shading, restrained sparkle.
export function snowTexture(seed: number, w = 512, h = 512): THREE.CanvasTexture {
  const rng = makeRng(seed);
  const noise = makeNoise2D(makeRng(seed + 3));
  return canvasTex(w, h, (ctx) => {
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const n = fbm(noise, x / 60, y / 60, 4);
        const n2 = fbm(noise, x / 14, y / 14, 2);
        const l = 168 + n * 46 + n2 * 16;
        d[i] = l * 0.86;
        d[i + 1] = l * 0.92;
        d[i + 2] = Math.min(255, l * 1.06);
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // restrained sparkle: a few brighter grains only
    for (let i = 0; i < 130; i++) {
      const x = rng() * w, y = rng() * h;
      ctx.fillStyle = `rgba(235, 242, 255, ${0.25 + rng() * 0.4})`;
      ctx.fillRect(x, y, 1.4, 1.4);
    }
  });
}

// Red coat cloth: woven grain, seams, gravity wrinkles, local wear.
export function coatTexture(seed: number, w = 512, h = 512): THREE.CanvasTexture {
  const rng = makeRng(seed);
  const noise = makeNoise2D(makeRng(seed + 11));
  return canvasTex(w, h, (ctx) => {
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const weave = ((x % 3) === 0 ? 0.05 : 0) + ((y % 3) === 0 ? 0.04 : 0);
        const n = fbm(noise, x / 70, y / 70, 4);
        // horizontal-ish wrinkle bands (gravity folds), softly irregular
        const wr = Math.sin(y / 26 + fbm(noise, x / 48, y / 120, 3) * 7.0);
        const shade = 0.72 + n * 0.3 + wr * 0.1 - weave;
        d[i] = 172 * shade;
        d[i + 1] = 30 * shade;
        d[i + 2] = 34 * shade;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // seams: double stitch lines
    ctx.strokeStyle = 'rgba(96, 10, 14, 0.55)';
    ctx.lineWidth = 2;
    for (const sx of [w * 0.24, w * 0.76]) {
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      for (let y = 0; y <= h; y += 8) {
        ctx.lineTo(sx + Math.sin(y / 40) * 3 + (rng() - 0.5) * 1.5, y);
      }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(230, 120, 110, 0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx + 3, 0);
      for (let y = 0; y <= h; y += 8) ctx.lineTo(sx + 3 + Math.sin(y / 40) * 3, y);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(96, 10, 14, 0.55)';
      ctx.lineWidth = 2;
    }
    // local wear patches (asymmetric)
    for (let i = 0; i < 7; i++) {
      const x = rng() * w, y = rng() * h;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 24 + rng() * 40);
      g.addColorStop(0, `rgba(210, 120, 110, ${0.06 + rng() * 0.1})`);
      g.addColorStop(1, 'rgba(210, 120, 110, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    // faint soot smudges near hem area (bottom of texture)
    for (let i = 0; i < 5; i++) {
      const x = rng() * w, y = h * (0.75 + rng() * 0.25);
      const g = ctx.createRadialGradient(x, y, 0, x, y, 20 + rng() * 30);
      g.addColorStop(0, `rgba(20, 16, 14, ${0.10 + rng() * 0.12})`);
      g.addColorStop(1, 'rgba(20, 16, 14, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  });
}

// White fur trim: compressed tufts, directional strands, slight grime.
export function furTexture(seed: number, w = 256, h = 256): THREE.CanvasTexture {
  const rng = makeRng(seed);
  const noise = makeNoise2D(makeRng(seed + 5));
  return canvasTex(w, h, (ctx) => {
    ctx.fillStyle = '#cfc9bd';
    ctx.fillRect(0, 0, w, h);
    // tuft clumps: darker roots, lighter tips
    for (let i = 0; i < 2400; i++) {
      const x = rng() * w, y = rng() * h;
      const len = 4 + rng() * 9;
      const a = -Math.PI / 2 + (rng() - 0.5) * 1.1 + (noise(x / 40, y / 40) - 0.5) * 1.4;
      const lum = 200 + rng() * 55;
      ctx.strokeStyle = `rgba(${lum}, ${lum - 4}, ${lum - 14}, ${0.16 + rng() * 0.2})`;
      ctx.lineWidth = 0.8 + rng() * 0.9;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.stroke();
    }
    // shadowed clump seams
    for (let i = 0; i < 26; i++) {
      const x = rng() * w;
      ctx.strokeStyle = `rgba(90, 84, 74, ${0.10 + rng() * 0.1})`;
      ctx.lineWidth = 2 + rng() * 3;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + 10, h * 0.3, x - 10, h * 0.6, x + (rng() - 0.5) * 20, h);
      ctx.stroke();
    }
    // slight grime, uneven
    for (let i = 0; i < 8; i++) {
      const x = rng() * w, y = rng() * h;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 14 + rng() * 26);
      g.addColorStop(0, `rgba(70, 60, 48, ${0.05 + rng() * 0.09})`);
      g.addColorStop(1, 'rgba(70, 60, 48, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  });
}

// Velvet / heavy cloth sack: deep red-brown, sheen bands, patched wear.
export function sackTexture(seed: number, w = 512, h = 512): THREE.CanvasTexture {
  const rng = makeRng(seed);
  const noise = makeNoise2D(makeRng(seed + 17));
  return canvasTex(w, h, (ctx) => {
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const n = fbm(noise, x / 80, y / 80, 4);
        const nap = fbm(noise, x / 8, y / 8, 2) * 0.12;
        const sheen = Math.sin((x + y * 0.4) / 60 + n * 5) * 0.06;
        const shade = 0.62 + n * 0.3 + nap + sheen;
        d[i] = 118 * shade;
        d[i + 1] = 52 * shade;
        d[i + 2] = 40 * shade;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // rough patch + stitches
    const px = w * (0.55 + rng() * 0.2), py = h * (0.5 + rng() * 0.25);
    ctx.fillStyle = 'rgba(84, 44, 30, 0.85)';
    ctx.fillRect(px, py, 70, 54);
    ctx.strokeStyle = 'rgba(220, 190, 150, 0.6)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.strokeRect(px + 4, py + 4, 62, 46);
    ctx.setLineDash([]);
    // bottom grime from rooftops
    const g = ctx.createLinearGradient(0, h * 0.7, 0, h);
    g.addColorStop(0, 'rgba(18, 14, 12, 0)');
    g.addColorStop(1, 'rgba(18, 14, 12, 0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

export function woodTexture(seed: number, hue = 26, w = 512, h = 256): THREE.CanvasTexture {
  const rng = makeRng(seed);
  const noise = makeNoise2D(makeRng(seed + 23));
  return canvasTex(w, h, (ctx) => {
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const grain = fbm(noise, x / 160, y / 9, 4);
        const rings = Math.sin(grain * 22 + x / 30) * 0.5 + 0.5;
        const l = 0.34 + grain * 0.3 + rings * 0.12;
        d[i] = 150 * l * (1 + hue / 100);
        d[i + 1] = 96 * l;
        d[i + 2] = 58 * l;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    for (let i = 0; i < 5; i++) {
      const x = rng() * w, y = rng() * h;
      ctx.fillStyle = 'rgba(40, 22, 12, 0.5)';
      ctx.beginPath();
      ctx.ellipse(x, y, 3 + rng() * 4, 2 + rng() * 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

export function wallpaperTexture(seed: number, hue: number, w = 512, h = 512): THREE.CanvasTexture {
  const rng = makeRng(seed);
  const noise = makeNoise2D(makeRng(seed + 31));
  return canvasTex(w, h, (ctx) => {
    ctx.fillStyle = hsl(hue, 22, 56);
    ctx.fillRect(0, 0, w, h);
    // subtle vertical stripe + faint motif rows
    for (let x = 0; x < w; x += 64) {
      ctx.fillStyle = 'rgba(255, 250, 235, 0.06)';
      ctx.fillRect(x, 0, 26, h);
    }
    ctx.fillStyle = 'rgba(60, 46, 40, 0.10)';
    for (let y = 32; y < h; y += 96) {
      for (let x = 32; x < w; x += 64) {
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.arc(x, y + 9, 3.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // age tint
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const n = fbm(noise, x / 120, y / 120, 3);
        const k = 0.86 + n * 0.2;
        d[i] *= k; d[i + 1] *= k; d[i + 2] *= k * 0.98;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

export function knitTexture(seed: number, hue: number, w = 256, h = 256): THREE.CanvasTexture {
  const noise = makeNoise2D(makeRng(seed + 41));
  return canvasTex(w, h, (ctx) => {
    ctx.fillStyle = hsl(hue, 52, 40);
    ctx.fillRect(0, 0, w, h);
    // knit V rows
    for (let y = 0; y < h; y += 10) {
      for (let x = 0; x < w; x += 8) {
        const n = noise(x / 30, y / 30);
        ctx.strokeStyle = `hsla(${hue}, 55%, ${30 + n * 26}%, 0.8)`;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 4, y + 7);
        ctx.lineTo(x + 8, y);
        ctx.stroke();
      }
    }
  });
}

export function skinTexture(seed: number, w = 128, h = 128): THREE.CanvasTexture {
  const noise = makeNoise2D(makeRng(seed + 51));
  return canvasTex(w, h, (ctx) => {
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const n = fbm(noise, x / 26, y / 26, 3);
        d[i] = 226 * (0.9 + n * 0.16);
        d[i + 1] = 176 * (0.88 + n * 0.16);
        d[i + 2] = 152 * (0.86 + n * 0.16);
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

// Floor rug: worn oval-ish woven pattern.
export function rugTexture(seed: number, hue: number, w = 256, h = 256): THREE.CanvasTexture {
  const rng = makeRng(seed);
  return canvasTex(w, h, (ctx) => {
    ctx.fillStyle = hsl(hue, 34, 34);
    ctx.fillRect(0, 0, w, h);
    for (let r = 0; r < 7; r++) {
      ctx.strokeStyle = hsl(hue + r * 14, 32, 30 + r * 4);
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, w * 0.44 - r * 15, h * 0.42 - r * 14, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.03 + rng() * 0.05})`;
      ctx.fillRect(rng() * w, rng() * h, 2, 2);
    }
  });
}
