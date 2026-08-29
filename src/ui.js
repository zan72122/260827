import { getSpriteSet } from './sprites.js';
import { makeRng, rand, clamp } from './rng.js';

// ---------------------------------------------------------------------------
// 触るものはすべて「中身が見える瓶」か「絵の描いてあるボタン」。文字は読まなくてよい。
// ---------------------------------------------------------------------------

// 素材の瓶。中身が実物のスプライトで積まれているので、何が入っているか一目でわかる。
// 中身は毎フレーム描き直すと重いので、一度だけ描いて画像として使い回す。
const vesselCache = new Map();

export function drawJar(ctx, mat, x, y, w, h, opts = {}) {
  const t = opts.lift || 0;
  const dpr = ctx._dpr || 1;
  // 影は生で描く(持ち上がると薄く広がる)
  ctx.save();
  ctx.globalAlpha = 0.42 * (1 - t * 0.45);
  ctx.beginPath();
  ctx.ellipse(x + w * 0.06, y + h * 0.04, w * (0.56 + t * 0.18), h * 0.09, 0, 0, 7);
  ctx.fillStyle = '#1b1109'; ctx.fill();
  ctx.restore();
  const img = cachedVessel('jar', mat, w, h, dpr, () => paintJar(mat, w, h, dpr));
  ctx.drawImage(img.canvas, x + img.ox, y + img.oy - t * h * 0.18, img.w, img.h);
}

function cachedVessel(kind, item, w, h, dpr, make) {
  const key = `${kind}:${item.id}:${Math.round(w)}:${Math.round(h)}:${Math.round(dpr * 10)}`;
  let v = vesselCache.get(key);
  if (!v) { v = make(); vesselCache.set(key, v); }
  return v;
}
export function clearVesselCache() { vesselCache.clear(); }

function paintJar(mat, w, h, dpr) {
  const ox = -w * 0.62, oy = -h * 1.06;
  const iw = w * 1.24, ih = h * 1.20;
  const c = document.createElement('canvas');
  c.width = Math.ceil(iw * dpr); c.height = Math.ceil(ih * dpr);
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx._dpr = dpr;
  ctx.translate(-ox, -oy);
  const big0 = ['flake', 'star', 'petal', 'heart', 'bubble'].includes(mat.shape);
  const set = getSpriteSet(mat, dpr, w * (big0 ? 0.26 : 0.14) * 1.3 * dpr);
  const rng = makeRng(mat.id.length * 137 + 11);
  ctx.save();

  const bw = w * 0.82, bh = h * 0.86;
  const left = -bw / 2, top = -bh;

  // ガラス本体
  ctx.beginPath();
  ctx.moveTo(left, 0);
  ctx.lineTo(left, top + bh * 0.16);
  ctx.quadraticCurveTo(left, top + bh * 0.05, left + bw * 0.20, top + bh * 0.02);
  ctx.lineTo(left + bw * 0.80, top + bh * 0.02);
  ctx.quadraticCurveTo(left + bw, top + bh * 0.05, left + bw, top + bh * 0.16);
  ctx.lineTo(left + bw, 0);
  ctx.closePath();
  const gg = ctx.createLinearGradient(left, 0, left + bw, 0);
  gg.addColorStop(0, 'rgba(96,104,104,0.75)');
  gg.addColorStop(0.20, mat.jar.glass);
  gg.addColorStop(0.44, '#ffffff');
  gg.addColorStop(0.78, mat.jar.glass);
  gg.addColorStop(1, 'rgba(80,86,86,0.8)');
  ctx.globalAlpha = 0.62; ctx.fillStyle = gg; ctx.fill();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = 'rgba(28,26,24,0.9)'; ctx.lineWidth = Math.max(1, w * 0.012);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // 中身。実際の粒スプライトを積む(色だけの塊にしない)
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(left + 1, 0);
  ctx.lineTo(left + 1, -bh * 0.60);
  ctx.quadraticCurveTo(left + bw * 0.5, -bh * 0.80, left + bw - 1, -bh * 0.58);
  ctx.lineTo(left + bw - 1, 0);
  ctx.closePath();
  ctx.clip();
  const big = ['flake', 'star', 'petal', 'heart', 'bubble'].includes(mat.shape);
  const psz = big ? w * 0.20 : w * 0.10;
  const n = big ? 26 : 90;
  for (let i = 0; i < n; i++) {
    const px = rand(rng, left + psz * 0.4, left + bw - psz * 0.4);
    const py = -Math.pow(rng(), 1.25) * bh * 0.74;
    const f = set.frames > 1 ? Math.floor(rng() * set.frames) : 0;
    const img = set.variants[Math.floor(rng() * set.variants.length)][f];
    const s = psz * rand(rng, 0.8, 1.25);
    ctx.globalAlpha = 0.55 + rng() * 0.45;
    ctx.drawImage(img, px - s / 2, py - s / 2, s, s);
  }
  ctx.globalAlpha = 1;
  // 中身の底の影
  const cg = ctx.createLinearGradient(0, -bh * 0.78, 0, 0);
  cg.addColorStop(0, 'rgba(0,0,0,0)'); cg.addColorStop(0.55, 'rgba(28,22,16,0.10)');
  cg.addColorStop(1, 'rgba(26,20,14,0.50)');
  ctx.fillStyle = cg; ctx.fillRect(left, -bh * 0.80, bw, bh * 0.80);
  ctx.restore();

  // ガラスの映り込み(左に広く、右にほそく)
  ctx.globalAlpha = 0.20;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(left + bw * 0.12, top + bh * 0.12);
  ctx.lineTo(left + bw * 0.26, top + bh * 0.10);
  ctx.lineTo(left + bw * 0.20, -bh * 0.10);
  ctx.lineTo(left + bw * 0.08, -bh * 0.08);
  ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 0.10;
  ctx.fillRect(left + bw * 0.86, top + bh * 0.14, bw * 0.05, bh * 0.72);
  ctx.globalAlpha = 1;

  // ふた(コルクと金具)
  ctx.fillStyle = mat.jar.cap;
  ctx.fillRect(left + bw * 0.12, top - bh * 0.09, bw * 0.76, bh * 0.11);
  ctx.fillStyle = 'rgba(255,240,214,0.22)';
  ctx.fillRect(left + bw * 0.12, top - bh * 0.09, bw * 0.76, bh * 0.025);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(left + bw * 0.12, top + bh * 0.005, bw * 0.76, bh * 0.018);

  // ラベル(少し傾いて貼られ、角が擦れている)
  ctx.save();
  ctx.translate(0, -bh * 0.13);
  ctx.rotate(-0.035);
  const lw = bw * 0.64, lh = bh * 0.19;
  ctx.fillStyle = mat.jar.label;
  ctx.fillRect(-lw / 2, -lh / 2, lw, lh);
  ctx.strokeStyle = 'rgba(110,88,60,0.45)'; ctx.lineWidth = 1;
  ctx.strokeRect(-lw / 2, -lh / 2, lw, lh);
  // ラベルの絵=素材の色の点(文字は書かない)
  ctx.fillStyle = mat.swatch;
  ctx.beginPath(); ctx.arc(-lw * 0.30, 0, lh * 0.30, 0, 7); ctx.fill();
  ctx.globalAlpha = 0.40; ctx.fillStyle = '#8a7452';
  for (let i = 0; i < 2; i++) ctx.fillRect(-lw * 0.10, -lh * 0.18 + i * lh * 0.26, lw * (0.34 - i * 0.10), 1.5);
  ctx.globalAlpha = 0.5; ctx.fillStyle = '#c8b48c';
  ctx.fillRect(lw * 0.34, -lh / 2, lw * 0.16, lh * 0.3);   // めくれ(片側だけ)
  ctx.globalAlpha = 1;
  ctx.restore();
  ctx.restore();
  return { canvas: c, ox, oy, w: iw, h: ih };
}

// 液体の瓶。とろみの差を「注ぎ口のしずく」と「傾けた液面」で見せる。
export function drawBottle(ctx, liq, x, y, w, h, opts = {}) {
  const t = opts.lift || 0;
  const dpr = ctx._dpr || 1;
  ctx.save();
  ctx.globalAlpha = 0.40 * (1 - t * 0.4);
  ctx.beginPath();
  ctx.ellipse(x + w * 0.05, y + h * 0.03, w * 0.5, h * 0.075, 0, 0, 7);
  ctx.fillStyle = '#1b1109'; ctx.fill();
  ctx.restore();
  const img = cachedVessel('bottle', liq, w, h, dpr, () => paintBottle(liq, w, h, dpr));
  ctx.drawImage(img.canvas, x + img.ox, y + img.oy - t * h * 0.16, img.w, img.h);
}

function paintBottle(liq, w, h, dpr) {
  const ox = -w * 0.62, oy = -h * 1.02;
  const iw = w * 1.35, ih = h * 1.14;
  const c = document.createElement('canvas');
  c.width = Math.ceil(iw * dpr); c.height = Math.ceil(ih * dpr);
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(-ox, -oy);
  ctx.save();

  const bw = w * 0.66, bh = h * 0.70, neck = h * 0.22;
  const left = -bw / 2, top = -bh;
  ctx.beginPath();
  ctx.moveTo(left, 0);
  ctx.lineTo(left, top + bh * 0.22);
  ctx.quadraticCurveTo(left, top, left + bw * 0.34, top - neck * 0.30);
  ctx.lineTo(left + bw * 0.34, top - neck);
  ctx.lineTo(left + bw * 0.66, top - neck);
  ctx.lineTo(left + bw * 0.66, top - neck * 0.30);
  ctx.quadraticCurveTo(left + bw, top, left + bw, top + bh * 0.22);
  ctx.lineTo(left + bw, 0);
  ctx.closePath();
  ctx.save();
  ctx.strokeStyle = 'rgba(28,26,24,0.75)'; ctx.lineWidth = Math.max(1, w * 0.014);
  ctx.stroke();
  ctx.clip();
  const gg = ctx.createLinearGradient(left, 0, left + bw, 0);
  gg.addColorStop(0, 'rgba(46,44,40,0.6)');
  gg.addColorStop(0.28, liq.bottle);
  gg.addColorStop(0.5, '#ffffff');
  gg.addColorStop(0.82, liq.bottle);
  gg.addColorStop(1, 'rgba(40,38,34,0.62)');
  ctx.globalAlpha = 0.45; ctx.fillStyle = gg; ctx.fillRect(left, top - neck, bw, bh + neck);
  ctx.globalAlpha = 1;
  // 中の液(液面は少し傾いている)
  const lv = -bh * 0.58;
  ctx.beginPath();
  ctx.moveTo(left, lv + h * 0.012);
  ctx.lineTo(left + bw, lv - h * 0.012);
  ctx.lineTo(left + bw, 0); ctx.lineTo(left, 0); ctx.closePath();
  ctx.fillStyle = liq.tint.replace(/[\d.]+\)$/, '0.95)');
  ctx.fill();
  ctx.fillStyle = liq.deep.replace(/[\d.]+\)$/, '0.5)');
  ctx.fillRect(left, -bh * 0.18, bw, bh * 0.18);
  if (liq.fizz) {
    const rng = makeRng(31);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (let i = 0; i < 12; i++) {
      const bx = rand(rng, left + 2, left + bw - 2), by = rand(rng, lv + 2, -2);
      ctx.beginPath(); ctx.arc(bx, by, rand(rng, 0.8, 2.0), 0, 7); ctx.fill();
    }
  }
  ctx.restore();
  ctx.globalAlpha = 0.22; ctx.fillStyle = '#ffffff';
  ctx.fillRect(left + bw * 0.14, top + bh * 0.06, bw * 0.10, bh * 0.66);
  ctx.globalAlpha = 1;
  // コルク
  ctx.fillStyle = liq.cork;
  ctx.fillRect(left + bw * 0.30, top - neck - h * 0.055, bw * 0.40, h * 0.062);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(left + bw * 0.30, top - neck - h * 0.008, bw * 0.40, h * 0.010);

  // とろみの合図(絵だけで伝える)
  ctx.save();
  ctx.translate(bw * 0.86, -bh * 0.42);
  ctx.fillStyle = liq.deep.replace(/[\d.]+\)$/, '0.85)');
  if (liq.id === 'thick') {
    ctx.beginPath();
    ctx.moveTo(0, -h * 0.03);
    ctx.bezierCurveTo(h * 0.035, h * 0.02, h * 0.030, h * 0.075, 0, h * 0.075);
    ctx.bezierCurveTo(-h * 0.030, h * 0.075, -h * 0.035, h * 0.02, 0, -h * 0.03);
    ctx.fill();
  } else if (liq.id === 'thin') {
    for (let i = 0; i < 3; i++) ctx.fillRect(-h * 0.02 + i * h * 0.022, -h * 0.02 + i * h * 0.01, h * 0.008, h * 0.055);
  } else if (liq.id === 'fizz') {
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(Math.sin(i * 2) * h * 0.018, h * 0.05 - i * h * 0.022, h * (0.011 - i * 0.0015), 0, 7);
      ctx.fill();
    }
  } else {
    for (let i = 0; i < 2; i++) ctx.fillRect(-h * 0.008 + i * h * 0.026, -h * 0.01, h * 0.010, h * 0.05);
  }
  ctx.restore();
  ctx.restore();
  return { canvas: c, ox, oy, w: iw, h: ih };
}

// 木と真鍮の丸ボタン。中の絵は彫り込みで表す。
export function drawButton(ctx, x, y, r, icon, opts = {}) {
  const on = opts.active, dim = opts.disabled;
  ctx.save();
  ctx.translate(x, y);
  if (opts.press) ctx.translate(0, r * 0.05);
  ctx.globalAlpha = dim ? 0.35 : 1;
  ctx.beginPath(); ctx.ellipse(r * 0.06, r * 0.16, r * 0.98, r * 0.30, 0, 0, 7);
  ctx.fillStyle = 'rgba(18,12,6,0.42)'; ctx.fill();
  const g = ctx.createLinearGradient(-r, -r, r * 0.5, r);
  if (on) { g.addColorStop(0, '#e8cf95'); g.addColorStop(0.55, '#c9a862'); g.addColorStop(1, '#8e7038'); }
  else { g.addColorStop(0, '#8b7148'); g.addColorStop(0.5, '#6f5a39'); g.addColorStop(1, '#4d3e28'); }
  ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fillStyle = g; ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0, r * 0.97, 0, 7);
  ctx.strokeStyle = 'rgba(255,238,206,0.28)'; ctx.lineWidth = Math.max(1, r * 0.05); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, r * 0.06, r * 0.9, 0.35, 2.5);
  ctx.strokeStyle = 'rgba(30,20,10,0.30)'; ctx.lineWidth = Math.max(1, r * 0.07); ctx.stroke();
  ctx.strokeStyle = on ? '#3f3016' : '#efe0bd';
  ctx.fillStyle = on ? '#3f3016' : '#efe0bd';
  ctx.lineWidth = Math.max(1.6, r * 0.11);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  drawIcon(ctx, icon, r * 0.52);
  ctx.restore();
}

export function drawIcon(ctx, icon, s) {
  ctx.save();
  if (icon === 'shake') {
    ctx.beginPath(); ctx.arc(0, -s * 0.12, s * 0.56, 0, 7); ctx.stroke();
    ctx.fillRect(-s * 0.62, s * 0.44, s * 1.24, s * 0.3);
    for (const d of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(d * s * 1.0, -s * 0.12, s * 0.42, -0.9 + (d < 0 ? Math.PI : 0), 0.9 + (d < 0 ? Math.PI : 0));
      ctx.stroke();
    }
  } else if (icon === 'save') {
    ctx.strokeRect(-s * 0.8, -s * 0.55, s * 1.6, s * 1.15);
    ctx.beginPath(); ctx.moveTo(-s * 0.8, s * 0.05); ctx.lineTo(s * 0.8, s * 0.05); ctx.stroke();
    ctx.beginPath(); ctx.arc(-s * 0.34, -s * 0.2, s * 0.26, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.arc(s * 0.34, -s * 0.2, s * 0.26, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, s * 0.34, s * 0.22, 0, 7); ctx.stroke();
  } else if (icon === 'new') {
    ctx.beginPath(); ctx.arc(0, 0, s * 0.66, 0.7, 5.6); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(s * 0.30, -s * 0.72); ctx.lineTo(s * 0.66, -s * 0.40);
    ctx.lineTo(s * 0.18, -s * 0.22); ctx.closePath(); ctx.fill();
  } else if (icon === 'compare') {
    for (const d of [-1, 1]) {
      ctx.beginPath(); ctx.arc(d * s * 0.46, -s * 0.12, s * 0.40, 0, 7); ctx.stroke();
      ctx.fillRect(d * s * 0.46 - s * 0.44, s * 0.34, s * 0.88, s * 0.22);
    }
  } else if (icon === 'single') {
    ctx.beginPath(); ctx.arc(0, -s * 0.12, s * 0.58, 0, 7); ctx.stroke();
    ctx.fillRect(-s * 0.64, s * 0.46, s * 1.28, s * 0.26);
  } else if (icon === 'back') {
    ctx.beginPath();
    ctx.moveTo(s * 0.5, -s * 0.6); ctx.lineTo(-s * 0.4, 0); ctx.lineTo(s * 0.5, s * 0.6);
    ctx.stroke();
  } else if (icon === 'shelf') {
    ctx.strokeRect(-s * 0.82, -s * 0.7, s * 1.64, s * 1.4);
    ctx.beginPath(); ctx.moveTo(-s * 0.82, 0); ctx.lineTo(s * 0.82, 0); ctx.stroke();
    ctx.beginPath(); ctx.arc(-s * 0.36, -s * 0.32, s * 0.22, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.arc(s * 0.30, -s * 0.32, s * 0.22, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.arc(-s * 0.30, s * 0.36, s * 0.22, 0, 7); ctx.stroke();
  } else if (icon === 'close') {
    ctx.beginPath();
    ctx.moveTo(-s * 0.55, -s * 0.55); ctx.lineTo(s * 0.55, s * 0.55);
    ctx.moveTo(s * 0.55, -s * 0.55); ctx.lineTo(-s * 0.55, s * 0.55);
    ctx.stroke();
  } else if (icon === 'sound' || icon === 'mute') {
    ctx.beginPath();
    ctx.moveTo(-s * 0.6, -s * 0.22); ctx.lineTo(-s * 0.2, -s * 0.22);
    ctx.lineTo(s * 0.16, -s * 0.62); ctx.lineTo(s * 0.16, s * 0.62);
    ctx.lineTo(-s * 0.2, s * 0.22); ctx.lineTo(-s * 0.6, s * 0.22);
    ctx.closePath(); ctx.fill();
    if (icon === 'sound') {
      ctx.beginPath(); ctx.arc(s * 0.2, 0, s * 0.45, -0.9, 0.9); ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(s * 0.42, -s * 0.32); ctx.lineTo(s * 0.86, s * 0.32);
      ctx.moveTo(s * 0.86, -s * 0.32); ctx.lineTo(s * 0.42, s * 0.32);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// 比較モードの「見た目のことば」。文字ではなく記号で伝える。
export function drawTag(ctx, tag, x, y, r, color = '#f0e2c4') {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath(); ctx.arc(0, 0, r, 0, 7);
  ctx.fillStyle = 'rgba(38,26,14,0.72)'; ctx.fill();
  ctx.strokeStyle = 'rgba(226,206,166,0.42)'; ctx.lineWidth = Math.max(1, r * 0.08); ctx.stroke();
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.4, r * 0.13); ctx.lineCap = 'round';
  const s = r * 0.62;
  if (tag === 'sparkle') {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI;
      ctx.beginPath();
      ctx.moveTo(-Math.cos(a) * s, -Math.sin(a) * s);
      ctx.lineTo(Math.cos(a) * s, Math.sin(a) * s); ctx.stroke();
    }
  } else if (tag === 'slow') {
    ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(0, s * 0.4); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-s * 0.5, s * 0.2); ctx.lineTo(0, s * 0.85); ctx.lineTo(s * 0.5, s * 0.2);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(-s * 0.75, -s * 0.5, r * 0.10, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(s * 0.75, 0, r * 0.10, 0, 7); ctx.fill();
  } else if (tag === 'fast') {
    ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(0, s * 0.4); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-s * 0.5, s * 0.2); ctx.lineTo(0, s * 0.9); ctx.lineTo(s * 0.5, s * 0.2);
    ctx.stroke();
    ctx.lineWidth = Math.max(1, r * 0.09);
    ctx.beginPath(); ctx.moveTo(-s * 0.72, -s * 0.7); ctx.lineTo(-s * 0.72, s * 0.1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s * 0.72, -s * 0.7); ctx.lineTo(s * 0.72, s * 0.1); ctx.stroke();
  } else if (tag === 'rise') {
    ctx.beginPath(); ctx.moveTo(0, s); ctx.lineTo(0, -s * 0.4); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-s * 0.5, -s * 0.2); ctx.lineTo(0, -s * 0.9); ctx.lineTo(s * 0.5, -s * 0.2);
    ctx.stroke();
  } else if (tag === 'flutter') {
    ctx.beginPath();
    ctx.moveTo(-s, -s * 0.5);
    ctx.bezierCurveTo(-s * 0.2, -s, s * 0.2, 0, s, -s * 0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-s, s * 0.5);
    ctx.bezierCurveTo(-s * 0.2, 0, s * 0.2, s, s, s * 0.5);
    ctx.stroke();
  } else if (tag === 'pile') {
    ctx.beginPath();
    ctx.moveTo(-s, s * 0.6);
    ctx.quadraticCurveTo(0, -s * 0.9, s, s * 0.6);
    ctx.closePath(); ctx.fill();
  } else if (tag === 'fizz') {
    for (const [bx, by, br] of [[-s * 0.5, s * 0.4, 0.26], [0, -s * 0.1, 0.32], [s * 0.5, s * 0.5, 0.2], [s * 0.2, -s * 0.7, 0.18]]) {
      ctx.beginPath(); ctx.arc(bx, by, r * br, 0, 7); ctx.stroke();
    }
  } else if (tag === 'soft') {
    ctx.beginPath();
    ctx.arc(-s * 0.35, s * 0.1, r * 0.30, 0, 7);
    ctx.arc(s * 0.15, s * 0.0, r * 0.36, 0, 7);
    ctx.arc(s * 0.5, s * 0.2, r * 0.24, 0, 7);
    ctx.fill();
  }
  ctx.restore();
}

// 次に触る場所を示す輪と指。文章では説明しない。
export function drawHint(ctx, x, y, r, time, opts = {}) {
  const pulse = (Math.sin(time * 3.0) + 1) / 2;
  ctx.save();
  ctx.translate(x, y);
  for (let i = 0; i < 2; i++) {
    const t = ((time * 0.85 + i * 0.5) % 1);
    ctx.beginPath();
    ctx.arc(0, 0, r * (0.6 + t * 0.75), 0, 7);
    ctx.strokeStyle = `rgba(255,232,176,${(1 - t) * 0.55})`;
    ctx.lineWidth = Math.max(1.5, r * 0.07);
    ctx.stroke();
  }
  if (opts.hand !== false) {
    const bob = Math.sin(time * 3.0) * r * 0.10;
    ctx.save();
    ctx.translate(r * 0.42, r * 0.62 + bob);
    ctx.rotate(-0.25);
    const s = r * 0.42;
    ctx.beginPath();
    ctx.moveTo(0, -s * 1.15);
    ctx.quadraticCurveTo(s * 0.42, -s * 1.1, s * 0.42, -s * 0.35);
    ctx.quadraticCurveTo(s * 0.95, -s * 0.30, s * 0.92, s * 0.30);
    ctx.quadraticCurveTo(s * 0.86, s * 1.25, s * 0.10, s * 1.28);
    ctx.quadraticCurveTo(-s * 0.72, s * 1.25, -s * 0.72, s * 0.28);
    ctx.quadraticCurveTo(-s * 0.70, -s * 0.22, -s * 0.30, -s * 0.30);
    ctx.quadraticCurveTo(-s * 0.34, -s * 1.05, 0, -s * 1.15);
    ctx.closePath();
    ctx.fillStyle = `rgba(250,236,206,${0.72 + pulse * 0.20})`;
    ctx.fill();
    ctx.strokeStyle = 'rgba(90,66,40,0.55)';
    ctx.lineWidth = Math.max(1, s * 0.10); ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

// 左右のふり方を教える矢印(ふる工程だけで出す)
export function drawSwipeHint(ctx, x, y, w, time) {
  const t = (time * 0.8) % 1;
  const dir = Math.floor(time * 0.8) % 2 ? -1 : 1;
  const px = x + Math.sin(t * Math.PI) * w * 0.5 * dir;
  ctx.save();
  ctx.globalAlpha = Math.sin(t * Math.PI) * 0.9;
  ctx.strokeStyle = 'rgba(255,234,186,0.9)';
  ctx.lineWidth = Math.max(2, w * 0.02); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x - w * 0.42, y); ctx.lineTo(x + w * 0.42, y); ctx.stroke();
  for (const d of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x + d * w * 0.42 - d * w * 0.09, y - w * 0.055);
    ctx.lineTo(x + d * w * 0.42, y);
    ctx.lineTo(x + d * w * 0.42 - d * w * 0.09, y + w * 0.055);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  drawHint(ctx, px, y, w * 0.11, time, { hand: true });
  ctx.restore();
}
