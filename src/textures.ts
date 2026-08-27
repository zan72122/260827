import * as THREE from 'three';
import { fbm2, mulberry32 } from './util';

function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return { c, g: c.getContext('2d')! };
}

function toTexture(c: HTMLCanvasElement, repeat = 1, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Thick red woven fabric for the sack. Includes weave, mottling,
 *  4 vertical double-stitched seams, rolled-hem shading at top,
 *  and worn (lighter, polished) patches where hands grab near the neck. */
export function sackFabricTexture(): { map: THREE.Texture; bump: THREE.Texture } {
  const S = 1024;
  const { c, g } = makeCanvas(S, S);
  // base velvet red, slightly darker toward bottom (weight/shadow)
  const grad = g.createLinearGradient(0, 0, 0, S);
  grad.addColorStop(0, '#9c2020');
  grad.addColorStop(0.55, '#8e1c1d');
  grad.addColorStop(1, '#6e1516');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const img = g.getImageData(0, 0, S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      // fine weave: two crossing thread frequencies
      const weave = Math.sin(x * 0.9) * 0.5 + Math.sin(y * 0.9) * 0.5;
      // broad mottling like brushed velvet
      const mot = fbm2(x * 0.012, y * 0.012, 4) - 0.5;
      const fiber = fbm2(x * 0.15, y * 0.02, 3) - 0.5; // vertical-ish fiber streaks
      let k = 1 + weave * 0.045 + mot * 0.34 + fiber * 0.12;
      // worn patches near the neck (top 20%): grabbed often -> lighter + desaturated
      const wy = y / S;
      if (wy < 0.24) {
        const wearL = Math.exp(-(((x / S - 0.30) / 0.085) ** 2)) * (1 - wy / 0.24);
        const wearR = Math.exp(-(((x / S - 0.72) / 0.085) ** 2)) * (1 - wy / 0.24);
        const wear = Math.min(1, (wearL + wearR)) * (0.55 + fbm2(x * 0.05, y * 0.05, 3) * 0.45);
        k += wear * 0.35;
        // desaturate a touch
        const r = d[i] * k, gg = d[i + 1] * k, b = d[i + 2] * k;
        const m = (r + gg + b) / 3;
        d[i] = r + (m - r) * wear * 0.4;
        d[i + 1] = gg + (m - gg) * wear * 0.4;
        d[i + 2] = b + (m - b) * wear * 0.4;
        continue;
      }
      d[i] *= k; d[i + 1] *= k; d[i + 2] *= k;
    }
  }
  g.putImageData(img, 0, 0);
  // 4 vertical seams with double stitch rows
  g.globalAlpha = 1;
  for (let s = 0; s < 4; s++) {
    const x = (s / 4) * S + S / 8;
    g.strokeStyle = 'rgba(40,8,8,0.55)';
    g.lineWidth = 5;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, S); g.stroke();
    for (const off of [-7, 7]) {
      g.strokeStyle = 'rgba(255,205,170,0.5)';
      g.lineWidth = 2;
      g.setLineDash([7, 6]);
      g.beginPath(); g.moveTo(x + off, 0); g.lineTo(x + off, S); g.stroke();
      g.setLineDash([]);
    }
  }
  // rolled hem band at the very top: fold shadow + stitch
  const hemG = g.createLinearGradient(0, 0, 0, S * 0.06);
  hemG.addColorStop(0, 'rgba(0,0,0,0.35)');
  hemG.addColorStop(0.6, 'rgba(255,230,200,0.10)');
  hemG.addColorStop(1, 'rgba(0,0,0,0.22)');
  g.fillStyle = hemG;
  g.fillRect(0, 0, S, S * 0.06);
  g.strokeStyle = 'rgba(255,205,170,0.55)';
  g.lineWidth = 2;
  g.setLineDash([6, 5]);
  g.beginPath(); g.moveTo(0, S * 0.055); g.lineTo(S, S * 0.055); g.stroke();
  g.setLineDash([]);

  // bump map: weave + wrinkle
  const { c: bc, g: bg } = makeCanvas(512, 512);
  const bi = bg.createImageData(512, 512);
  for (let y = 0; y < 512; y++) {
    for (let x = 0; x < 512; x++) {
      const i = (y * 512 + x) * 4;
      const v = 128 + (Math.sin(x * 1.8) + Math.sin(y * 1.8)) * 22 + (fbm2(x * 0.03, y * 0.03, 4) - 0.5) * 90;
      bi.data[i] = bi.data[i + 1] = bi.data[i + 2] = v;
      bi.data[i + 3] = 255;
    }
  }
  bg.putImageData(bi, 0, 0);
  return { map: toTexture(c, 1), bump: toTexture(bc, 3, false) };
}

/** Interior of the sack: same weave reading but darker, with faint
 *  light leaking through the weave (used for tunnel + cavern walls). */
export function sackInteriorTexture(): THREE.Texture {
  const S = 1024;
  const { c, g } = makeCanvas(S, S);
  g.fillStyle = '#3a0d0f';
  g.fillRect(0, 0, S, S);
  const img = g.getImageData(0, 0, S, S);
  const d = img.data;
  const rand = mulberry32(77);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const weave = Math.sin(x * 0.7) * 0.5 + Math.sin(y * 0.7) * 0.5;
      const mot = fbm2(x * 0.008, y * 0.008, 4) - 0.5;
      const fold = Math.sin(x * 0.02 + fbm2(x * 0.01, y * 0.004, 3) * 6) * 0.5;
      const k = 1 + weave * 0.10 + mot * 0.5 + fold * 0.28;
      d[i] *= k; d[i + 1] *= k * 0.95; d[i + 2] *= k * 0.95;
    }
  }
  g.putImageData(img, 0, 0);
  // pinpoints of light escaping through the weave — reads as first "stars"
  for (let n = 0; n < 340; n++) {
    const x = rand() * S, y = rand() * S;
    const r = 0.6 + rand() * 1.6;
    const a = 0.12 + rand() * 0.5;
    const gr = g.createRadialGradient(x, y, 0, x, y, r * 3);
    gr.addColorStop(0, `rgba(255,236,200,${a})`);
    gr.addColorStop(1, 'rgba(255,236,200,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, r * 3, 0, 7); g.fill();
  }
  return toTexture(c, 1);
}

const texCache = new Map<string, THREE.Texture>();

/** Wrapping paper variants (cached — shared across presents & bench rolls). */
export function wrapPaperTexture(kind: 'horse' | 'plush' | 'wheel'): THREE.Texture {
  const hit = texCache.get(`wrap-${kind}`);
  if (hit) return hit;
  const S = 512;
  const { c, g } = makeCanvas(S, S);
  if (kind === 'horse') {
    g.fillStyle = '#d8b23a'; // warm gold
    g.fillRect(0, 0, S, S);
    g.fillStyle = '#c39a26';
    for (let i = 0; i < 8; i++) g.fillRect(i * 64, 0, 30, S); // wide stripes
    g.fillStyle = 'rgba(255,244,214,0.65)';
    for (let y = 32; y < S; y += 64)
      for (let x = 46; x < S; x += 64) { g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); }
  } else if (kind === 'plush') {
    g.fillStyle = '#7fae72'; // soft green
    g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(240,248,235,0.8)';
    const rand = mulberry32(5);
    for (let n = 0; n < 60; n++) {
      const x = rand() * S, y = rand() * S, r = 7 + rand() * 6;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
  } else {
    g.fillStyle = '#4a6f9c'; // blue
    g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(235,240,250,0.75)';
    g.lineWidth = 7;
    for (let i = -8; i < 16; i++) {
      g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64 + S, S); g.stroke();
    }
  }
  // paper grain + crease lines (folded then unrolled paper look)
  const img = g.getImageData(0, 0, S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const grain = (fbm2(x * 0.09, y * 0.09, 3) - 0.5) * 0.07;
      // a few long soft creases — fresh paper, not crumpled
      const cr1 = Math.exp(-(((x + y * 0.3 - 300) % 512 / 5) ** 2) * 0.25) * 0.05;
      const cr2 = Math.exp(-(((y - x * 0.15 - 120) % 512 / 4) ** 2) * 0.25) * 0.04;
      const k = 1 + grain - cr1 + cr2 * 0.5;
      d[i] *= k; d[i + 1] *= k; d[i + 2] *= k;
    }
  }
  g.putImageData(img, 0, 0);
  const t = toTexture(c, 1);
  texCache.set(`wrap-${kind}`, t);
  return t;
}

/** Satin ribbon texture with woven sheen (cached). */
export function ribbonTexture(color: string, hi: string): THREE.Texture {
  const hit = texCache.get(`ribbon-${color}`);
  if (hit) return hit;
  const S = 256;
  const { c, g } = makeCanvas(S, S);
  g.fillStyle = color; g.fillRect(0, 0, S, S);
  // satin sheen: soft horizontal highlight bands
  for (let y = 0; y < S; y++) {
    const s = Math.pow(Math.max(0, Math.sin(y * 0.05)), 3) * 0.5;
    g.fillStyle = `rgba(255,255,255,${s * 0.35})`;
    g.fillRect(0, y, S, 1);
  }
  // edge stitching
  g.fillStyle = hi;
  g.fillRect(0, 0, S, 6); g.fillRect(0, S - 6, S, 6);
  const t = toTexture(c, 1);
  texCache.set(`ribbon-${color}`, t);
  return t;
}

/** Wood planks for floor / bench. */
export function woodTexture(base = '#7a5233', dark = '#5d3d24', plankW = 128): THREE.Texture {
  const S = 512;
  const { c, g } = makeCanvas(S, S);
  g.fillStyle = base; g.fillRect(0, 0, S, S);
  const img = g.getImageData(0, 0, S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const ring = Math.sin(x * 0.05 + fbm2(x * 0.01, y * 0.03, 3) * 9) * 0.5 + 0.5;
      const k = 0.82 + ring * 0.22 + (fbm2(x * 0.2, y * 0.05, 3) - 0.5) * 0.12;
      d[i] *= k; d[i + 1] *= k; d[i + 2] *= k;
    }
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = dark; g.lineWidth = 3;
  for (let x = 0; x <= S; x += plankW) {
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, S); g.stroke();
  }
  return toTexture(c, 1);
}

/** Plaster / timber wall. */
export function wallTexture(): THREE.Texture {
  const S = 512;
  const { c, g } = makeCanvas(S, S);
  g.fillStyle = '#5c4736'; g.fillRect(0, 0, S, S);
  const img = g.getImageData(0, 0, S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    const k = 0.9 + (fbm2(x * 0.02, y * 0.02, 4) - 0.5) * 0.3;
    d[i] *= k; d[i + 1] *= k; d[i + 2] *= k;
  }
  g.putImageData(img, 0, 0);
  // horizontal timber lines
  g.strokeStyle = 'rgba(30,20,12,0.5)'; g.lineWidth = 4;
  for (let y = 0; y <= S; y += 100) { g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); }
  return toTexture(c, 1);
}

/** Quilted padded patch for storage-bay platforms (tufted fabric). */
export function quiltTexture(): THREE.Texture {
  const S = 512;
  const { c, g } = makeCanvas(S, S);
  g.fillStyle = '#6d1a1e'; g.fillRect(0, 0, S, S);
  const cell = 64;
  for (let y = 0; y < S; y += cell) {
    for (let x = 0; x < S; x += cell) {
      const gr = g.createRadialGradient(x + cell / 2, y + cell / 2, 4, x + cell / 2, y + cell / 2, cell * 0.72);
      gr.addColorStop(0, 'rgba(255,200,160,0.30)');
      gr.addColorStop(1, 'rgba(20,4,6,0.42)');
      g.fillStyle = gr;
      g.fillRect(x, y, cell, cell);
    }
  }
  // diagonal stitch lines
  g.strokeStyle = 'rgba(255,215,175,0.5)'; g.lineWidth = 2; g.setLineDash([5, 5]);
  for (let i = -8; i < 16; i++) {
    g.beginPath(); g.moveTo(i * cell, 0); g.lineTo(i * cell + S, S); g.stroke();
    g.beginPath(); g.moveTo(i * cell + S, 0); g.lineTo(i * cell, S); g.stroke();
  }
  g.setLineDash([]);
  return toTexture(c, 1);
}

/** Round soft sprite for stars / dust. */
export function starSpriteTexture(): THREE.Texture {
  const S = 64;
  const { c, g } = makeCanvas(S, S);
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,250,235,1)');
  gr.addColorStop(0.25, 'rgba(255,240,205,0.85)');
  gr.addColorStop(0.6, 'rgba(255,220,170,0.25)');
  gr.addColorStop(1, 'rgba(255,220,170,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** White fur band for the sack rim (compressed, clumped). */
export function furTexture(): THREE.Texture {
  const S = 512, H = 128;
  const c = document.createElement('canvas');
  c.width = S; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ece6da'; g.fillRect(0, 0, S, H);
  const rand = mulberry32(9);
  // clumped strands, flattened directionality
  for (let n = 0; n < 2600; n++) {
    const x = rand() * S;
    const clump = Math.sin(x * 0.08) * 0.5 + 0.5; // clump bands
    const y0 = rand() * H;
    const len = 8 + rand() * 22 * (0.5 + clump * 0.5);
    const ang = (rand() - 0.5) * 0.9 + Math.sin(x * 0.05) * 0.4;
    const b = 218 + rand() * 37;
    g.strokeStyle = `rgba(${b},${b - 8},${b - 22},${0.25 + rand() * 0.4})`;
    g.lineWidth = 1 + rand();
    g.beginPath();
    g.moveTo(x, y0);
    g.lineTo(x + Math.sin(ang) * len, y0 + Math.cos(ang) * len);
    g.stroke();
  }
  // compression shadow at center of band
  const sh = g.createLinearGradient(0, 0, 0, H);
  sh.addColorStop(0, 'rgba(60,45,35,0.25)');
  sh.addColorStop(0.5, 'rgba(60,45,35,0)');
  sh.addColorStop(1, 'rgba(60,45,35,0.35)');
  g.fillStyle = sh; g.fillRect(0, 0, S, H);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(4, 1);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Night window view: dark blue sky, snow, distant hills. */
export function windowTexture(): THREE.Texture {
  const W = 256, H = 320;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#101b33');
  sky.addColorStop(0.7, '#22355c');
  sky.addColorStop(1, '#31486e');
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  const rand = mulberry32(3);
  g.fillStyle = 'rgba(255,255,255,0.9)';
  for (let n = 0; n < 40; n++) {
    g.beginPath(); g.arc(rand() * W, rand() * H * 0.6, rand() * 1.4 + 0.4, 0, 7); g.fill();
  }
  // snow hills
  g.fillStyle = '#b8c8de';
  g.beginPath();
  g.moveTo(0, H * 0.78);
  for (let x = 0; x <= W; x += 16) g.lineTo(x, H * 0.78 + Math.sin(x * 0.04) * 12);
  g.lineTo(W, H); g.lineTo(0, H); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Kraft paper for rolls and tags (cached). */
export function kraftTexture(): THREE.Texture {
  const hit = texCache.get('kraft');
  if (hit) return hit;
  const S = 256;
  const { c, g } = makeCanvas(S, S);
  g.fillStyle = '#b08d5f'; g.fillRect(0, 0, S, S);
  const img = g.getImageData(0, 0, S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    const k = 0.92 + (fbm2(x * 0.15, y * 0.15, 3) - 0.5) * 0.16;
    d[i] *= k; d[i + 1] *= k; d[i + 2] *= k;
  }
  g.putImageData(img, 0, 0);
  const t = toTexture(c, 1);
  texCache.set('kraft', t);
  return t;
}
