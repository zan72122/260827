import * as THREE from 'three';

// Small procedural canvas textures. Everything is generated once at startup
// and cached; no external assets.

let seedState = 12345;
export function setSeed(s) { seedState = s >>> 0 || 1; }
export function rand() {
  // xorshift32
  seedState ^= seedState << 13; seedState >>>= 0;
  seedState ^= seedState >> 17;
  seedState ^= seedState << 5; seedState >>>= 0;
  return (seedState >>> 0) / 4294967296;
}

function canvasTexture(size, draw, opts = {}) {
  const c = document.createElement('canvas');
  c.width = opts.w || size; c.height = opts.h || size;
  const ctx = c.getContext('2d');
  draw(ctx, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = opts.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  tex.colorSpace = opts.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function woodTexture(tone = [122, 92, 62], plank = true) {
  return canvasTexture(512, (ctx, w, h) => {
    ctx.fillStyle = `rgb(${tone[0]},${tone[1]},${tone[2]})`;
    ctx.fillRect(0, 0, w, h);
    const plankW = plank ? w / 4 : w;
    for (let p = 0; p < (plank ? 4 : 1); p++) {
      const px = p * plankW;
      const shade = (rand() - 0.5) * 26;
      ctx.fillStyle = `rgba(${tone[0] + shade | 0},${tone[1] + shade | 0},${tone[2] + shade | 0},0.6)`;
      ctx.fillRect(px, 0, plankW, h);
      // grain lines
      for (let i = 0; i < 26; i++) {
        const gx = px + rand() * plankW;
        const wob = 6 + rand() * 10;
        ctx.strokeStyle = `rgba(40,26,14,${0.05 + rand() * 0.1})`;
        ctx.lineWidth = 0.6 + rand() * 1.6;
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        for (let y = 0; y <= h; y += 32) {
          ctx.lineTo(gx + Math.sin(y * 0.02 + i) * wob * 0.3 + (rand() - 0.5) * 3, y);
        }
        ctx.stroke();
      }
      if (plank) {
        ctx.fillStyle = 'rgba(25,15,8,0.55)';
        ctx.fillRect(px + plankW - 2, 0, 2, h);
      }
    }
    // knots
    for (let i = 0; i < 5; i++) {
      const kx = rand() * w, ky = rand() * h, kr = 4 + rand() * 8;
      const g = ctx.createRadialGradient(kx, ky, 1, kx, ky, kr);
      g.addColorStop(0, 'rgba(45,28,15,0.7)');
      g.addColorStop(1, 'rgba(45,28,15,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(kx, ky, kr, 0, 7); ctx.fill();
    }
  });
}

export function feltTexture() {
  return canvasTexture(256, (ctx, w, h) => {
    ctx.fillStyle = 'rgb(42,74,58)';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      const v = 34 + rand() * 52;
      ctx.fillStyle = `rgba(${v * 0.7 | 0},${v | 0},${v * 0.82 | 0},0.35)`;
      ctx.fillRect(rand() * w, rand() * h, 1, 1);
    }
    // light wear in the middle where panes are slid around
    const g = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.6);
    g.addColorStop(0, 'rgba(255,255,255,0.06)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

export function plasterTexture() {
  return canvasTexture(256, (ctx, w, h) => {
    ctx.fillStyle = 'rgb(214,204,188)';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const v = 195 + rand() * 34;
      ctx.fillStyle = `rgba(${v | 0},${v - 8 | 0},${v - 22 | 0},0.25)`;
      ctx.fillRect(rand() * w, rand() * h, 2, 2);
    }
    // faint uneven staining low on the wall (asymmetric)
    const g = ctx.createLinearGradient(0, h * 0.65, 0, h);
    g.addColorStop(0, 'rgba(120,105,84,0)');
    g.addColorStop(1, 'rgba(120,105,84,0.16)');
    ctx.fillStyle = g;
    ctx.fillRect(0, h * 0.6, w, h * 0.4);
  });
}

export function concreteFloorTexture() {
  return canvasTexture(512, (ctx, w, h) => {
    ctx.fillStyle = 'rgb(148,142,132)';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 14000; i++) {
      const v = 118 + rand() * 56;
      ctx.fillStyle = `rgba(${v | 0},${v - 4 | 0},${v - 10 | 0},0.3)`;
      ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2);
    }
    // hairline cracks
    for (let i = 0; i < 4; i++) {
      let x = rand() * w, y = rand() * h;
      ctx.strokeStyle = 'rgba(80,76,70,0.35)';
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let s = 0; s < 14; s++) {
        x += (rand() - 0.5) * 40; y += (rand() - 0.5) * 40;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
}

// Localized dust / fine cullet patch used near the rack and under the bench.
export function dustPatchTexture() {
  return canvasTexture(256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const g = ctx.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(210,205,196,0.5)');
    g.addColorStop(0.7, 'rgba(210,205,196,0.18)');
    g.addColorStop(1, 'rgba(210,205,196,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 320; i++) {
      const a = rand() * Math.PI * 2, r = Math.pow(rand(), 0.6) * w * 0.46;
      const x = w / 2 + Math.cos(a) * r, y = h / 2 + Math.sin(a) * r * 0.8;
      ctx.fillStyle = `rgba(232,230,224,${0.2 + rand() * 0.5})`;
      ctx.fillRect(x, y, 1 + rand(), 1 + rand());
    }
  }, { clamp: true });
}

// Subtle smudges / fingerprints / wipe marks -> roughness map for the glass faces.
export function glassRoughnessMap() {
  return canvasTexture(256, (ctx, w, h) => {
    ctx.fillStyle = 'rgb(20,20,20)'; // base: very smooth
    ctx.fillRect(0, 0, w, h);
    // wipe arcs
    for (let i = 0; i < 5; i++) {
      ctx.strokeStyle = `rgba(70,70,70,${0.12 + rand() * 0.12})`;
      ctx.lineWidth = 8 + rand() * 16;
      ctx.beginPath();
      const cx = rand() * w, cy = rand() * h, r = 40 + rand() * 90;
      const a0 = rand() * Math.PI * 2;
      ctx.arc(cx, cy, r, a0, a0 + 1.2 + rand());
      ctx.stroke();
    }
    // fingerprint-ish blobs
    for (let i = 0; i < 7; i++) {
      const x = rand() * w, y = rand() * h, r = 5 + rand() * 9;
      const g = ctx.createRadialGradient(x, y, 1, x, y, r);
      g.addColorStop(0, 'rgba(95,95,95,0.5)');
      g.addColorStop(1, 'rgba(95,95,95,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    }
    // dust specks
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(120,120,120,${0.2 + rand() * 0.4})`;
      ctx.fillRect(rand() * w, rand() * h, 1, 1);
    }
  }, { linear: true });
}

// Fine sparkle/rough structure for the fractured cut face.
export function cutFaceRoughnessMap() {
  return canvasTexture(128, (ctx, w, h) => {
    ctx.fillStyle = 'rgb(70,70,70)';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2400; i++) {
      const v = 30 + rand() * 150;
      ctx.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`;
      ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1);
    }
    // horizontal conchoidal ripple bands (wake lines from the running crack)
    for (let i = 0; i < 10; i++) {
      const y = rand() * h;
      ctx.fillStyle = `rgba(${140 + rand() * 60 | 0},140,140,0.25)`;
      ctx.fillRect(0, y, w, 1 + rand() * 2);
    }
  }, { linear: true });
}

// Soft round sprite for hint dots / press ring glow.
export function softDotTexture() {
  return canvasTexture(64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, { clamp: true });
}

// Contact shadow blob under the sheet.
export function contactShadowTexture() {
  return canvasTexture(128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, w * 0.1, w / 2, h / 2, w * 0.5);
    g.addColorStop(0, 'rgba(0,0,0,0.42)');
    g.addColorStop(0.75, 'rgba(0,0,0,0.18)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, { clamp: true });
}

// Colored light pool: silhouette of a cut piece, blurred, tinted.
export function lightPoolTexture(poly, colorCss) {
  return canvasTexture(256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const p of poly) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const sw = maxX - minX || 1, sh = maxY - minY || 1;
    const scale = Math.min((w * 0.62) / sw, (h * 0.62) / sh);
    const ox = w / 2 - (minX + sw / 2) * scale;
    const oy = h / 2 - (minY + sh / 2) * scale;
    ctx.filter = 'blur(7px)';
    ctx.fillStyle = colorCss;
    ctx.beginPath();
    poly.forEach((p, i) => {
      const x = ox + p.x * scale, y = oy + p.y * scale;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
    // brighter core
    ctx.filter = 'blur(3px)';
    ctx.globalAlpha = 0.55;
    ctx.fill();
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
  }, { clamp: true });
}

// Silver sparkle strip for the score line.
export function scoreSparkleTexture() {
  return canvasTexture(256, (ctx, w, h) => {
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.clearRect(0, 0, w, h);
    for (let x = 0; x < w; x++) {
      const v = 175 + rand() * 80;
      const a = 0.5 + rand() * 0.5;
      ctx.fillStyle = `rgba(${v | 0},${v | 0},${v + 8 | 0},${a})`;
      const yj = (rand() - 0.5) * 2;
      ctx.fillRect(x, h * 0.32 + yj, 1, h * 0.36 + (rand() - 0.5) * 6);
    }
  }, { clamp: false, w: 256, h: 16 });
}
