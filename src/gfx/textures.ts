import * as THREE from 'three';
import { Rng } from '../core/util';

/**
 * Every map in the game is drawn here at boot. No image downloads: the whole
 * build stays tiny and the wear can be authored by process (where the jig bites,
 * where fingers rub, where the bench scrapes) rather than by tiling a photo.
 */

function canvas(size: number, h = size) {
  const c = document.createElement('canvas');
  c.width = size; c.height = h;
  return { c, g: c.getContext('2d')! };
}

function tex(c: HTMLCanvasElement, srgb: boolean, repeat = 1, aniso = 4): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------------- wood

export function makeWood(size = 1024) {
  const { c, g } = canvas(size);
  const rq = canvas(size);
  const rng = new Rng(7);

  g.fillStyle = '#6a5740';
  g.fillRect(0, 0, size, size);
  rq.g.fillStyle = '#d0d0d0';
  rq.g.fillRect(0, 0, size, size);

  // broad tonal blotches: boards are not one colour
  for (let i = 0; i < 26; i++) {
    const x = rng.range(0, size), y = rng.range(0, size), r = rng.range(size * 0.08, size * 0.34);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    const dark = rng.next() < 0.5;
    grd.addColorStop(0, dark ? 'rgba(48,38,26,0.24)' : 'rgba(132,113,84,0.18)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }

  // grain running along the bench length
  g.lineWidth = 1;
  for (let i = 0; i < 900; i++) {
    const y0 = rng.range(-20, size + 20);
    const amp = rng.range(2, 16);
    const freq = rng.range(0.004, 0.02);
    const ph = rng.range(0, 10);
    const a = rng.range(0.03, 0.16);
    const light = rng.next() < 0.35;
    g.strokeStyle = light ? `rgba(160,140,108,${a})` : `rgba(44,34,22,${a})`;
    g.lineWidth = rng.range(0.6, 2.6);
    g.beginPath();
    for (let x = -10; x <= size + 10; x += 8) {
      const y = y0 + Math.sin(x * freq + ph) * amp + Math.sin(x * freq * 3.1 + ph * 2) * amp * 0.3;
      x === -10 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.stroke();
  }

  // knots
  for (let k = 0; k < 3; k++) {
    const cx = rng.range(size * 0.15, size * 0.85), cy = rng.range(size * 0.15, size * 0.85);
    const rr = rng.range(size * 0.02, size * 0.05);
    for (let i = 12; i > 0; i--) {
      g.strokeStyle = `rgba(26,16,8,${0.05 + i * 0.02})`;
      g.lineWidth = rng.range(1, 3);
      g.beginPath();
      g.ellipse(cx, cy, rr * i * 0.34, rr * i * 0.2, rng.range(0, Math.PI), 0, Math.PI * 2);
      g.stroke();
    }
  }

  // decades of tool scars
  for (let i = 0; i < 240; i++) {
    const x = rng.range(0, size), y = rng.range(0, size);
    const len = rng.range(6, 70), ang = rng.range(0, Math.PI * 2);
    g.strokeStyle = `rgba(24,15,8,${rng.range(0.05, 0.3)})`;
    g.lineWidth = rng.range(0.5, 1.8);
    g.beginPath(); g.moveTo(x, y);
    g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); g.stroke();
    rq.g.strokeStyle = `rgba(255,255,255,${rng.range(0.05, 0.25)})`;
    rq.g.lineWidth = g.lineWidth;
    rq.g.beginPath(); rq.g.moveTo(x, y);
    rq.g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); rq.g.stroke();
  }

  // oil soaked into the wood: darker AND much less rough
  for (let i = 0; i < 11; i++) {
    const x = rng.range(0, size), y = rng.range(0, size), r = rng.range(size * 0.04, size * 0.15);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(34,26,16,0.24)');
    grd.addColorStop(0.65, 'rgba(34,26,16,0.10)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    const grd2 = rq.g.createRadialGradient(x, y, 0, x, y, r);
    grd2.addColorStop(0, 'rgba(120,120,120,0.6)');
    grd2.addColorStop(1, 'rgba(208,208,208,0)');
    rq.g.fillStyle = grd2; rq.g.beginPath(); rq.g.arc(x, y, r, 0, Math.PI * 2); rq.g.fill();
  }

  return {
    map: tex(c, true, 1, 8),
    roughnessMap: tex(rq.c, false, 1, 4),
    bumpMap: tex(c, false, 1, 4),
  };
}

// ------------------------------------------------------------------ metal

export interface MetalMaps {
  map: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
}

/**
 * Tin-plated brass sheet. U runs across the rolling direction, so the roll
 * streaks are horizontal in texture space; that is what makes the highlight
 * stretch the right way when the shell turns.
 */
export function makeSheetMetal(size = 768): MetalMaps {
  const col = canvas(size);
  const rgh = canvas(size);
  const bmp = canvas(size);

  function draw() {
    const rng = new Rng(31);
    const { g } = col, gr = rgh.g, gb = bmp.g;

    g.fillStyle = '#bfa268';
    g.fillRect(0, 0, size, size);
    gr.fillStyle = 'rgb(120,120,120)';
    gr.fillRect(0, 0, size, size);
    gb.fillStyle = '#808080';
    gb.fillRect(0, 0, size, size);

    // slight tin-over-brass mottling
    for (let i = 0; i < 40; i++) {
      const x = rng.range(0, size), y = rng.range(0, size), r = rng.range(size * 0.05, size * 0.3);
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, rng.next() < 0.5 ? 'rgba(226,208,166,0.20)' : 'rgba(139,116,68,0.22)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }

    // rolling direction: long, shallow, strictly parallel streaks
    for (let i = 0; i < 1900; i++) {
      const y = rng.range(0, size);
      const a = rng.range(0.03, 0.15);
      gr.strokeStyle = rng.next() < 0.5
        ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
      gr.lineWidth = rng.range(0.4, 1.9);
      gr.beginPath();
      const x0 = rng.range(-size * 0.3, size), len = rng.range(size * 0.25, size * 1.2);
      gr.moveTo(x0, y); gr.lineTo(x0 + len, y + rng.range(-1.2, 1.2)); gr.stroke();
      if (rng.next() < 0.3) {
        gb.strokeStyle = `rgba(${rng.next() < 0.5 ? '255,255,255' : '0,0,0'},${a * 0.5})`;
        gb.lineWidth = gr.lineWidth;
        gb.beginPath(); gb.moveTo(x0, y); gb.lineTo(x0 + len, y); gb.stroke();
      }
    }

    // random directional scuffs from handling (polishing removes the shallow ones)
    const scuffs = 320;
    for (let i = 0; i < scuffs; i++) {
      const x = rng.range(0, size), y = rng.range(0, size);
      const len = rng.range(4, 46), ang = rng.range(-0.5, 0.5) + (rng.next() < 0.25 ? 1.57 : 0);
      const a = rng.range(0.05, 0.28);
      gr.strokeStyle = `rgba(255,255,255,${a})`;
      gr.lineWidth = rng.range(0.4, 1.3);
      gr.beginPath(); gr.moveTo(x, y);
      gr.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); gr.stroke();
      gb.strokeStyle = `rgba(60,60,60,${a * 0.6})`;
      gb.lineWidth = gr.lineWidth;
      gb.beginPath(); gb.moveTo(x, y);
      gb.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); gb.stroke();
    }

    // punch/blanking marks: little arcs left by the press tooling
    for (let i = 0; i < 26; i++) {
      const x = rng.range(0, size), y = rng.range(0, size), r = rng.range(6, 26);
      gb.strokeStyle = `rgba(48,48,48,${rng.range(0.2, 0.5)})`;
      gb.lineWidth = rng.range(1, 2.6);
      gb.beginPath(); gb.arc(x, y, r, rng.range(0, 6), rng.range(1, 5)); gb.stroke();
      gr.strokeStyle = `rgba(255,255,255,${rng.range(0.1, 0.3)})`;
      gr.lineWidth = gb.lineWidth; gr.beginPath();
      gr.arc(x, y, r, 0, Math.PI * 2); gr.stroke();
    }

    // oil film + a little oxide in the low spots (polish thins it, never clears it)
    const oil = 1;
    for (let i = 0; i < 22; i++) {
      const x = rng.range(0, size), y = rng.range(0, size), r = rng.range(size * 0.04, size * 0.16);
      const grd = gr.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `rgba(200,200,200,${0.35 * oil})`);
      grd.addColorStop(1, 'rgba(200,200,200,0)');
      gr.fillStyle = grd; gr.beginPath(); gr.arc(x, y, r, 0, Math.PI * 2); gr.fill();
      const grd2 = g.createRadialGradient(x, y, 0, x, y, r);
      grd2.addColorStop(0, `rgba(112,92,52,${0.24 * oil})`);
      grd2.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd2; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }

  }

  // the as-blanked state; hand polishing is layered on top of this with a paint
  // mask, so the mill and press marks survive being polished
  draw();
  return {
    map: tex(col.c, true, 1, 8),
    roughnessMap: tex(rgh.c, false, 1, 8),
    bumpMap: tex(bmp.c, false, 1, 4),
  };
}

/** hard, dark, slightly polished tool steel for jig and die */
export function makeToolSteel(size = 512) {
  const col = canvas(size), rgh = canvas(size);
  const rng = new Rng(91);
  col.g.fillStyle = '#8b9199'; col.g.fillRect(0, 0, size, size);
  rgh.g.fillStyle = '#8a8a8a'; rgh.g.fillRect(0, 0, size, size);
  for (let i = 0; i < 700; i++) {
    const y = rng.range(0, size);
    rgh.g.strokeStyle = `rgba(${rng.next() < 0.5 ? '255,255,255' : '0,0,0'},${rng.range(0.03, 0.14)})`;
    rgh.g.lineWidth = rng.range(0.4, 1.8);
    rgh.g.beginPath(); rgh.g.moveTo(rng.range(-100, size), y);
    rgh.g.lineTo(rng.range(0, size + 100), y); rgh.g.stroke();
  }
  for (let i = 0; i < 90; i++) {
    const x = rng.range(0, size), y = rng.range(0, size), r = rng.range(size * 0.02, size * 0.12);
    const grd = col.g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, rng.next() < 0.6 ? 'rgba(58,62,68,0.30)' : 'rgba(178,184,192,0.22)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    col.g.fillStyle = grd; col.g.beginPath(); col.g.arc(x, y, r, 0, Math.PI * 2); col.g.fill();
  }
  return { map: tex(col.c, true, 1, 4), roughnessMap: tex(rgh.c, false, 1, 4) };
}

/** the little cast pellet: dark, pitted, never shiny */
export function makePellet(size = 256) {
  const col = canvas(size), rgh = canvas(size);
  const rng = new Rng(5);
  col.g.fillStyle = '#1b1c1e'; col.g.fillRect(0, 0, size, size);
  rgh.g.fillStyle = '#a8a8a8'; rgh.g.fillRect(0, 0, size, size);
  for (let i = 0; i < 500; i++) {
    const x = rng.range(0, size), y = rng.range(0, size), r = rng.range(0.6, 4.5);
    col.g.fillStyle = `rgba(${rng.next() < 0.5 ? '8,8,9' : '58,58,62'},${rng.range(0.1, 0.55)})`;
    col.g.beginPath(); col.g.arc(x, y, r, 0, Math.PI * 2); col.g.fill();
    rgh.g.fillStyle = `rgba(255,255,255,${rng.range(0.05, 0.3)})`;
    rgh.g.beginPath(); rgh.g.arc(x, y, r, 0, Math.PI * 2); rgh.g.fill();
  }
  return { map: tex(col.c, true, 1, 2), roughnessMap: tex(rgh.c, false, 1, 2) };
}

/** plaster back wall of the workshop */
export function makeWall(size = 512) {
  const { c, g } = canvas(size);
  const rng = new Rng(17);
  g.fillStyle = '#4a4640'; g.fillRect(0, 0, size, size);
  for (let i = 0; i < 260; i++) {
    const x = rng.range(0, size), y = rng.range(0, size), r = rng.range(size * 0.02, size * 0.2);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, rng.next() < 0.5 ? 'rgba(28,26,23,0.16)' : 'rgba(96,92,84,0.14)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  return { map: tex(c, true, 1, 2) };
}

/** braided leather cord */
export function makeLeather(size = 256) {
  const { c, g } = canvas(size);
  const rng = new Rng(23);
  g.fillStyle = '#4a3122'; g.fillRect(0, 0, size, size);
  for (let i = 0; i < 60; i++) {
    g.strokeStyle = `rgba(${rng.next() < 0.5 ? '26,16,10' : '110,78,50'},${rng.range(0.1, 0.4)})`;
    g.lineWidth = rng.range(2, 9);
    g.beginPath();
    const y = rng.range(0, size);
    g.moveTo(0, y); g.bezierCurveTo(size * 0.3, y + rng.range(-30, 30), size * 0.7, y + rng.range(-30, 30), size, y);
    g.stroke();
  }
  return { map: tex(c, true, 1, 2) };
}
