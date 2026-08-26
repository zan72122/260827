import * as THREE from 'three';

/**
 * All textures are generated procedurally on canvases: no network fetch,
 * tiny memory, and full control over wear/grime placement (kept asymmetric).
 */

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

function makeTexture(
  w: number,
  h: number,
  draw: Draw,
  opts: { srgb?: boolean; repeat?: [number, number] } = {},
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  if (opts.srgb !== false) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (opts.repeat) tex.repeat.set(opts.repeat[0], opts.repeat[1]);
  tex.anisotropy = 4;
  return tex;
}

// Deterministic pseudo-random (stable visuals & screenshots between runs)
let seed = 1234;
export function rnd(): number {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
}

function noiseSpeckle(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  n: number,
  color: string,
  aMin: number,
  aMax: number,
  sMax = 3,
): void {
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = aMin + rnd() * (aMax - aMin);
    ctx.fillStyle = color;
    const s = 1 + rnd() * sMax;
    ctx.fillRect(rnd() * w, rnd() * h, s, s);
  }
  ctx.globalAlpha = 1;
}

/** Worn soft-shell suitcase fabric: weave, seams, asymmetric scuffs. */
export function bagFabric(): THREE.CanvasTexture {
  return makeTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#1f6f74'; // worn petrol teal
    ctx.fillRect(0, 0, w, h);
    // weave
    for (let y = 0; y < h; y += 3) {
      ctx.fillStyle = y % 6 === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';
      ctx.fillRect(0, y, w, 1);
    }
    for (let x = 0; x < w; x += 3) {
      ctx.fillStyle = x % 6 === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)';
      ctx.fillRect(x, 0, 1, h);
    }
    noiseSpeckle(ctx, w, h, 2600, '#0c3336', 0.05, 0.2, 2);
    noiseSpeckle(ctx, w, h, 1200, '#7fd0cf', 0.03, 0.09, 2);
    // sun-fade patch (one side only — asymmetric wear)
    const g = ctx.createRadialGradient(w * 0.72, h * 0.3, 10, w * 0.72, h * 0.3, 230);
    g.addColorStop(0, 'rgba(210,225,220,0.16)');
    g.addColorStop(1, 'rgba(210,225,220,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // stitched seams
    ctx.strokeStyle = 'rgba(8,40,44,0.85)';
    ctx.lineWidth = 3;
    ctx.setLineDash([7, 5]);
    for (const yy of [h * 0.18, h * 0.82]) {
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(w, yy);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // scuffs near one corner
    for (let i = 0; i < 26; i++) {
      ctx.strokeStyle = `rgba(190,200,195,${0.06 + rnd() * 0.12})`;
      ctx.lineWidth = 1 + rnd() * 2;
      const x0 = w * 0.02 + rnd() * w * 0.22;
      const y0 = h * 0.72 + rnd() * h * 0.26;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + 12 + rnd() * 30, y0 + (rnd() - 0.5) * 10);
      ctx.stroke();
    }
  });
}

/** White paper bag tag with airline-style barcode blocks (no readable text). */
export function tagPaper(): THREE.CanvasTexture {
  return makeTexture(128, 256, (ctx, w, h) => {
    ctx.fillStyle = '#f4f2ec';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e3e0d6';
    ctx.fillRect(0, 0, w, 8);
    ctx.fillRect(0, h - 8, w, 8);
    // barcode
    let x = 12;
    while (x < w - 12) {
      const bw = 2 + Math.floor(rnd() * 5);
      ctx.fillStyle = '#20242a';
      if (rnd() > 0.42) ctx.fillRect(x, 26, bw, 58);
      x += bw + 2;
    }
    // second barcode lower
    x = 12;
    while (x < w - 12) {
      const bw = 2 + Math.floor(rnd() * 4);
      ctx.fillStyle = '#20242a';
      if (rnd() > 0.45) ctx.fillRect(x, h - 92, bw, 44);
      x += bw + 2;
    }
    // airport code-ish blocks (abstract, unreadable)
    ctx.fillStyle = '#2a3038';
    ctx.fillRect(14, 104, 42, 16);
    ctx.fillRect(64, 104, 30, 16);
    ctx.fillStyle = '#c8503c';
    ctx.fillRect(14, 128, 80, 6);
  });
}

/** Small worn travel sticker (sun over sea). */
export function sticker(): THREE.CanvasTexture {
  const t = makeTexture(128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#e8a33d';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 56, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f6d98a';
    ctx.beginPath();
    ctx.arc(w / 2, h * 0.4, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2d6f8e';
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.68, 44, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    // worn edge nick
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(w * 0.82, h * 0.22, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Conveyor belt rubber: matte, direction-of-travel wear streaks, dust. */
export function beltRubber(): THREE.CanvasTexture {
  return makeTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#22252a';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      ctx.strokeStyle = `rgba(255,255,255,${0.015 + rnd() * 0.045})`;
      ctx.lineWidth = 1 + rnd() * 2;
      const y = rnd() * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y + (rnd() - 0.5) * 6);
      ctx.stroke();
    }
    noiseSpeckle(ctx, w, h, 900, '#8a8578', 0.03, 0.1, 2);
    // belt seam (one per tile)
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, h * 0.48, w, 3);
    ctx.fillStyle = 'rgba(160,160,160,0.18)';
    ctx.fillRect(0, h * 0.48 + 3, w, 1);
  }, { repeat: [1, 1] });
}

/** Polished terminal floor tiles. */
export function terminalFloor(): THREE.CanvasTexture {
  return makeTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#cfd4d6';
    ctx.fillRect(0, 0, w, h);
    const tile = 128;
    for (let y = 0; y < h; y += tile)
      for (let x = 0; x < w; x += tile) {
        ctx.fillStyle = `rgba(${180 + rnd() * 30},${185 + rnd() * 30},${190 + rnd() * 25},0.5)`;
        ctx.fillRect(x, y, tile, tile);
      }
    ctx.strokeStyle = 'rgba(120,128,132,0.8)';
    ctx.lineWidth = 2;
    for (let y = 0; y <= h; y += tile) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    for (let x = 0; x <= w; x += tile) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    noiseSpeckle(ctx, w, h, 700, '#9aa2a6', 0.05, 0.12, 2);
  });
}

/** Sort-hall concrete: dusty, wheel-track wear (off-center). */
export function concrete(dark = false): THREE.CanvasTexture {
  return makeTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = dark ? '#565a5e' : '#8b8e90';
    ctx.fillRect(0, 0, w, h);
    noiseSpeckle(ctx, w, h, 3200, '#3c4044', 0.04, 0.14, 3);
    noiseSpeckle(ctx, w, h, 1600, '#b8babc', 0.03, 0.09, 2);
    // saw joints
    ctx.strokeStyle = 'rgba(40,44,48,0.5)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.33);
    ctx.lineTo(w, h * 0.33);
    ctx.moveTo(w * 0.6, 0);
    ctx.lineTo(w * 0.6, h);
    ctx.stroke();
    // off-center wear track
    const g = ctx.createLinearGradient(0, h * 0.55, 0, h * 0.8);
    g.addColorStop(0, 'rgba(50,52,54,0)');
    g.addColorStop(0.5, 'rgba(50,52,54,0.28)');
    g.addColorStop(1, 'rgba(50,52,54,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, h * 0.5, w, h * 0.35);
  });
}

/** Outdoor apron concrete with expansion joints and tyre scrub. */
export function apron(): THREE.CanvasTexture {
  return makeTexture(1024, 1024, (ctx, w, h) => {
    ctx.fillStyle = '#9d9fa0';
    ctx.fillRect(0, 0, w, h);
    noiseSpeckle(ctx, w, h, 5200, '#7d7f80', 0.05, 0.14, 3);
    noiseSpeckle(ctx, w, h, 2000, '#c2c3c4', 0.04, 0.1, 2);
    const slab = 256;
    ctx.strokeStyle = 'rgba(52,54,56,0.75)';
    ctx.lineWidth = 4;
    for (let y = 0; y <= h; y += slab) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    for (let x = 0; x <= w; x += slab) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    // tyre scrub arcs (asymmetric)
    for (let i = 0; i < 6; i++) {
      ctx.strokeStyle = `rgba(40,40,42,${0.03 + rnd() * 0.05})`;
      ctx.lineWidth = 8 + rnd() * 14;
      ctx.beginPath();
      const cx = rnd() * w;
      const cy = rnd() * h;
      ctx.arc(cx, cy, 120 + rnd() * 260, rnd() * 3, rnd() * 3 + 1.2);
      ctx.stroke();
    }
    // oil drip patch
    ctx.fillStyle = 'rgba(30,30,34,0.25)';
    ctx.beginPath();
    ctx.ellipse(w * 0.31, h * 0.62, 40, 26, 0.4, 0, Math.PI * 2);
    ctx.fill();
  });
}

/** Fuselage skin: panel lines, rivet rows, belly grime handled by geometry gradient. */
export function fuselage(): THREE.CanvasTexture {
  return makeTexture(1024, 512, (ctx, w, h) => {
    ctx.fillStyle = '#e8eaec';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(130,138,146,0.55)';
    ctx.lineWidth = 2;
    for (let x = 0; x < w; x += 128) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (const y of [h * 0.22, h * 0.52, h * 0.78]) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    // rivet rows
    ctx.fillStyle = 'rgba(120,126,132,0.5)';
    for (let x = 0; x < w; x += 128)
      for (let y = 8; y < h; y += 14) {
        ctx.fillRect(x + 4, y, 2, 2);
        ctx.fillRect(x + 122, y, 2, 2);
      }
    noiseSpeckle(ctx, w, h, 900, '#c9ccd0', 0.05, 0.1, 2);
  }, { repeat: [4, 1] });
}

/** Galvanized steel (guards, chutes). */
export function galvanized(): THREE.CanvasTexture {
  return makeTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#aeb4b8';
    ctx.fillRect(0, 0, w, h);
    // spangle
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `rgba(${200 + rnd() * 40},${205 + rnd() * 35},${210 + rnd() * 30},${0.12 + rnd() * 0.15})`;
      ctx.beginPath();
      const x = rnd() * w;
      const y = rnd() * h;
      ctx.moveTo(x, y);
      for (let k = 0; k < 5; k++) ctx.lineTo(x + (rnd() - 0.5) * 40, y + (rnd() - 0.5) * 40);
      ctx.closePath();
      ctx.fill();
    }
    noiseSpeckle(ctx, w, h, 500, '#7c8286', 0.05, 0.14, 2);
  });
}

/** Yellow/black chevron for genuinely hazardous edges only. */
export function hazard(): THREE.CanvasTexture {
  return makeTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#e0b421';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#232323';
    for (let i = -2; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 32, 0);
      ctx.lineTo(i * 32 + 32, 0);
      ctx.lineTo(i * 32 - 32 + 32, h);
      ctx.lineTo(i * 32 - 32, h);
      ctx.closePath();
      if (i % 2 === 0) ctx.fill();
    }
    noiseSpeckle(ctx, w, h, 260, '#5a5140', 0.08, 0.2, 3);
  }, { repeat: [4, 1] });
}

/** Flow-direction chevron sign (shape only, no text). */
export function chevronSign(): THREE.CanvasTexture {
  const t = makeTexture(256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#2c5d34';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#dfe8df';
    for (let i = 0; i < 3; i++) {
      const x = 34 + i * 72;
      ctx.beginPath();
      ctx.moveTo(x, 22);
      ctx.lineTo(x + 40, h / 2);
      ctx.lineTo(x, h - 22);
      ctx.lineTo(x + 16, h - 22);
      ctx.lineTo(x + 56, h / 2);
      ctx.lineTo(x + 16, 22);
      ctx.closePath();
      ctx.fill();
    }
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Sky: soft gradient with a few cumulus blobs. */
export function sky(): THREE.CanvasTexture {
  const t = makeTexture(1024, 512, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#5f9fd8');
    g.addColorStop(0.55, '#a8cbe8');
    g.addColorStop(0.8, '#dbe8ef');
    g.addColorStop(1, '#e8ecee');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 14; i++) {
      const x = rnd() * w;
      const y = h * (0.3 + rnd() * 0.35);
      const r = 30 + rnd() * 80;
      const cg = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
      cg.addColorStop(0, 'rgba(255,255,255,0.85)');
      cg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.6, r * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Departure-board-like abstract panel (colored blocks, unreadable). */
export function fidsPanel(): THREE.CanvasTexture {
  const t = makeTexture(256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#101418';
    ctx.fillRect(0, 0, w, h);
    for (let r = 0; r < 6; r++) {
      const y = 12 + r * 18;
      ctx.fillStyle = '#d8c34a';
      ctx.fillRect(10, y, 30 + rnd() * 20, 8);
      ctx.fillStyle = '#cfd6dc';
      ctx.fillRect(80, y, 60 + rnd() * 60, 8);
      ctx.fillStyle = rnd() > 0.5 ? '#59b26a' : '#cfd6dc';
      ctx.fillRect(210, y, 34, 8);
    }
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
