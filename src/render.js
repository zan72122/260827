import { PARTICLES, LIQUIDS, byId, describe } from './materials.js';
import { Dome } from './particles.js';
import { drawDome, shapeScale } from './dome_render.js';
import { renderStatic, paintLightWash } from './scene.js';
import { getSpriteSet, offscreen } from './sprites.js';
import * as UI from './ui.js';
import { lerp } from './rng.js';

const PAINT_A = { top: '#4d6b58', mid: '#3f5b4a', dark: '#2c4034' };
const PAINT_B = { top: '#6b4f4a', mid: '#5a4139', dark: '#402d27' };

const F = (typeof window !== 'undefined' && window.__flags) || {};
export function render(G) {
  const ctx = G.ctx, W = G.W, H = G.H, dpr = G.dpr, L = G.L;
  const f = G.flags || F;
  ctx._dpr = dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#221a12';
  ctx.fillRect(0, 0, W, H);

  ensureStatic(G);
  if (!f.noStatic) blitStatic(G, G.static.bg);

  // ---- 世界(カメラの中) ----
  G.cam.apply(ctx, W, H, dpr);
  drawSavedOnShelf(G, ctx);

  if (G.compare) {
    drawCompareWorld(G, ctx);
  } else {
    drawBenchItems(G, ctx);
    const off = (G.stage === 'shake' || G.stage === 'watch') ? G.shakeVis : null;
    drawDome(ctx, G.dome, L.domeCx, L.domeCy, L.domeR, {
      lidT: G.lidT, seed: 5, paint: PAINT_A,
      showLid: G.stage === 'close' || G.lidT > 0.02,
      lens: makeLens(G, L.domeCx, L.domeCy),
      shakeOffset: off, tilt: off ? off.x / (L.domeR * 14) : 0,
    });
    drawStream(G, ctx);
    drawHeldVessel(G, ctx);
  }

  // ---- 近景と光 ----
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!f.noNear) blitStatic(G, G.static.near, G.static.nearTop || 0);
  const focus = G.cam.toScreen(L.domeCx, L.domeCy, W, H);
  // 寄っている工程では、画面の下側は視野の外。構図として一定の位置から沈める。
  const scrimY = G.cam.zoom > 1.15
    ? Math.max(H * 0.64, G.cam.toScreen(L.domeCx, L.domeCy + L.domeR * 1.10, W, H).y) : -1;
  if (!f.noOverlay) drawOverlay(G, ctx, focus, scrimY);

  // ---- 画面に貼りつくもの ----
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (G.compare) drawCompareOverlay(G, ctx);
  drawHints(G, ctx);
  layoutButtons(G);
  for (const b of G.buttons) {
    UI.drawButton(ctx, b.x, b.y, b.r, b.icon, {
      active: b.active, press: G.pressed === b.id, disabled: b.disabled,
    });
  }
  if (G.shelfOpen) drawShelfPanel(G, ctx);
  if (G.savedPulse > 0) drawSaveFlash(G, ctx);
}

// ------------------------------------------------------------------ static
function ensureStatic(G) {
  if (!G.staticDirty && G.static) return;
  const cam = G.coverCam || G.cam;
  G.static = renderStatic(G.W, G.H, G.dpr, cam, G.L);
  G.staticCam = { x: cam.x, y: cam.y, zoom: cam.zoom };
  G.staticDirty = false;
}

// 2Dのパン/ズームなので、キャッシュ画像の貼り直しで正確に再投影できる。
// カメラが止まったときだけ描き直して、動いている間は貼り直しで済ませる。
// ガラスと液体ごしの背景。中心のまわりをわずかに拡大するだけで、
// 「中に水が入っている」ことが一目で伝わる(屈折の計算はしない)。
function blitStaticLens(G, img, m, px, py) {
  const ctx = G.ctx, c = G.staticCam, dpr = G.dpr;
  const s = G.cam.zoom / c.zoom;
  const tx = G.W / 2 * (1 - s) + (c.x - G.cam.x) * G.cam.zoom;
  const ty = G.H / 2 * (1 - s) + (c.y - G.cam.y) * G.cam.zoom;
  const k = s * m;
  ctx.setTransform(dpr * k, 0, 0, dpr * k,
    dpr * (tx * m + px * (1 - m)), dpr * (ty * m + py * (1 - m)));
  ctx.drawImage(img, 0, 0, G.W, G.H);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function blitStatic(G, img, top = 0) {
  const ctx = G.ctx, c = G.staticCam, dpr = G.dpr;
  if (top >= G.H) return;
  const s = G.cam.zoom / c.zoom;
  const tx = G.W / 2 * (1 - s) + (c.x - G.cam.x) * G.cam.zoom;
  const ty = G.H / 2 * (1 - s) + (c.y - G.cam.y) * G.cam.zoom;
  ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * tx, dpr * ty);
  if (top > 0) {
    const h = G.H - top;
    ctx.drawImage(img, 0, top * dpr, G.W * dpr, h * dpr, 0, top, G.W, h);
  } else {
    ctx.drawImage(img, 0, 0, G.W, G.H);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ------------------------------------------------------------------- bench
// 机の上には、いま選ぶものだけを出す。
// 粒の瓶と液体のボトルが同じ場所に重なると、何を押せばいいのか分からなくなる。
function drawBenchItems(G, ctx) {
  const L = G.L;
  const showJars = G.stage === 'pick_particle' || G.stage === 'pour_particle';
  const showBottles = G.stage === 'pick_liquid' || G.stage === 'pour_liquid';
  const jars = [...L.jars].sort((a, b) => a.y - b.y);
  for (const j of jars) {
    if (G.jar && G.jar.mat === j.mat) continue;
    if (showBottles && j.hideOnLiquid) continue;      // ボトルの置き場所は空ける
    const sel = G.mat === j.mat && showJars ? 0.18 : 0;
    UI.drawJar(ctx, j.mat, j.x, j.y, j.w, j.h, { lift: sel });
  }
  if (showBottles) {
    for (const b of L.bottles) {
      if (G.jar && G.jar.liq === b.liq) continue;
      UI.drawBottle(ctx, b.liq, b.x, b.y, b.w, b.h, { lift: G.liq === b.liq ? 0.16 : 0 });
    }
  }
}

function drawStream(G, ctx) {
  if (!G.stream.length || !G.mat) return;
  const set = getSpriteSet(G.mat, G.dpr,
    G.mat.size[1] * (G.L.domeR / 100) * shapeScale(G.mat.shape) * 1.9 * G.dpr);
  for (const s of G.stream) {
    const f = set.frames > 1
      ? ((Math.floor((s.rot / 6.283) * set.frames) % set.frames) + set.frames) % set.frames : 0;
    const img = set.variants[s.ci][f];
    ctx.drawImage(img, s.x - s.size / 2, s.y - s.size / 2, s.size, s.size);
  }
}

// 手に持った瓶/ボトルと、注がれている流れ。
function drawHeldVessel(G, ctx) {
  const jar = G.jar;
  if (!jar) return;
  const L = G.L;
  const w = L.domeR * 0.80, h = w * 1.55;
  const t = jar.tilt;
  ctx.save();
  ctx.translate(jar.x - L.domeR * 0.30 * t, jar.y - L.domeR * 0.05 * t);
  ctx.rotate(t * 1.15);
  if (jar.kind === 'jar') UI.drawJar(ctx, jar.mat, 0, 0, w, h, {});
  else UI.drawBottle(ctx, jar.liq, 0, 0, w * 0.92, h * 1.05, {});
  ctx.restore();

  if (jar.kind === 'bottle' && (G.liquidJet || 0) > 0.02) {
    drawLiquidJet(G, ctx, jar);
  }
}

function drawLiquidJet(G, ctx, jar) {
  const L = G.L, liq = jar.liq;
  const mouth = G.jarMouth();
  const endY = L.domeCy - L.domeR * 0.95;
  const thick = liq.id === 'thick' ? 1 : liq.id === 'thin' ? 0.42 : 0.68;
  const wob = liq.id === 'thick' ? 0.25 : 1.0;
  const w0 = L.domeR * 0.055 * (0.7 + thick);
  ctx.save();
  ctx.globalAlpha = 0.85 * Math.min(1, G.liquidJet);
  ctx.beginPath();
  const steps = 10;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = lerp(mouth.y, endY, t);
    const x = lerp(mouth.x, L.domeCx, t * t) + Math.sin(G.time * 7 + t * 5) * L.domeR * 0.012 * wob * (1 - t);
    pts.push([x, y, w0 * (1 - t * 0.45 * (1 - thick * 0.4))]);
  }
  ctx.moveTo(pts[0][0] - pts[0][2], pts[0][1]);
  for (const [x, y, w] of pts) ctx.lineTo(x - w, y);
  for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i][0] + pts[i][2], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = liq.deep.replace(/[\d.]+\)$/, '0.55)');
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fillRect(pts[3][0] - pts[3][2] * 0.5, mouth.y, Math.max(1, w0 * 0.28), endY - mouth.y);
  // とろりは太いしずくがゆっくり落ちる
  if (liq.id === 'thick') {
    const dy = ((G.time * 90) % (endY - mouth.y));
    ctx.beginPath();
    ctx.ellipse(L.domeCx, mouth.y + dy, w0 * 1.5, w0 * 2.1, 0, 0, 7);
    ctx.fillStyle = liq.deep.replace(/[\d.]+\)$/, '0.75)');
    ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------- 保存棚(壁)
function drawSavedOnShelf(G, ctx) {
  const L = G.L;
  if (!G.saved.length) return;
  const y = L.shelfY2;
  const r = Math.min(L.W * 0.030, L.H * 0.030);
  const pitch = r * 3.1;
  const start = L.W * 0.06;
  const n = Math.min(G.saved.length, Math.floor((L.W * 0.9) / pitch));
  for (let i = 0; i < n; i++) {
    const rec = G.saved[i];
    const img = thumbFor(G, rec, Math.round(r * 2.9));
    const x = start + i * pitch;
    const pulse = (i === 0 && G.savedPulse > 0) ? 1 + G.savedPulse * 0.12 : 1;
    ctx.save();
    ctx.globalAlpha = 0.94;
    ctx.drawImage(img, x - img.width / 2 * pulse, y - img.height * pulse + r * 0.30,
      img.width * pulse, img.height * pulse);
    ctx.restore();
  }
}

// ドームの内側から呼ばれる。切り抜きは呼び出し側で設定済み。
function makeLens(G, wx, wy) {
  if (!G.static || !G.static.bg) return null;
  return (ctx, level) => {
    const p = G.cam.toScreen(wx, wy, G.W, G.H);
    const m = 1.04 + 0.10 * Math.min(1, level);      // 液が満ちるほど大きく見える
    ctx.save();
    ctx.globalAlpha = 0.92;
    blitStaticLens(G, G.static.bg, m, p.x, p.y);
    ctx.restore();
    G.cam.apply(ctx, G.W, G.H, G.dpr);
  };
}

const thumbCache = new Map();
export function thumbFor(G, rec, size) {
  const key = `${rec.p}|${rec.l}|${size}`;
  if (thumbCache.has(key)) return thumbCache.get(key);
  const mat = byId(PARTICLES, rec.p), liq = byId(LIQUIDS, rec.l);
  const d = new Dome(mat, liq, (rec.p.length * 31 + rec.l.length * 7) || 3);
  d.addParticles(mat.count);
  d.liquidLevel = 1;
  d.shake(0.6, 1);
  for (let i = 0; i < 78; i++) d.update(1 / 30);
  const r = size * 0.42;
  const c = offscreen(Math.ceil(size * G.dpr), Math.ceil(size * 1.16 * G.dpr));
  const g = c.getContext('2d');
  g.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
  g._dpr = G.dpr;
  drawDome(g, d, size / 2, r * 1.06, r, { lidT: 1, seed: 9, paint: PAINT_A });
  thumbCache.set(key, c);
  return c;
}
export function clearThumbs() { thumbCache.clear(); }

// ------------------------------------------------------------------ compare
function drawCompareWorld(G, ctx) {
  const L = G.L, C = L.cmp;
  const pairs = [[G.dome, C.ax, PAINT_A, 'A'], [G.domeB, C.bx, PAINT_B, 'B']];
  for (const [d, x, paint, side] of pairs) {
    if (!d) continue;
    const off = G.activeSide === side ? G.shakeVis : { x: G.shakeVis.x * 0.85, y: G.shakeVis.y * 0.85 };
    drawDome(ctx, d, x, C.cy, C.r, {
      lidT: 1, seed: side === 'A' ? 5 : 12, paint,
      lens: makeLens(G, x, C.cy),
      shakeOffset: off, tilt: off.x / (C.r * 14),
    });
  }
  // 選ばれている側に真鍮の目印(枠ではなく、台座の前に置いた小さな札)
  const ax = G.activeSide === 'B' ? C.bx : C.ax;
  ctx.save();
  ctx.translate(ax, C.cy + C.r * 1.20);
  ctx.beginPath();
  ctx.ellipse(0, 0, C.r * 0.30, C.r * 0.075, 0, 0, 7);
  ctx.fillStyle = 'rgba(226,190,110,0.85)'; ctx.fill();
  ctx.strokeStyle = 'rgba(120,92,44,0.7)'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.restore();
}

function drawCompareOverlay(G, ctx) {
  const L = G.L, C = L.cmp;
  // 下の帯: 素材と液体をすぐ入れ替えられる小さな棚
  const strip = G.compareStrip();
  ctx.save();
  const y0 = strip.y - strip.pitch * 1.30;
  const g = ctx.createLinearGradient(0, y0, 0, L.H);
  g.addColorStop(0, 'rgba(38,26,15,0.0)');
  g.addColorStop(0.35, 'rgba(38,26,15,0.72)');
  g.addColorStop(1, 'rgba(30,20,11,0.88)');
  ctx.fillStyle = g;
  ctx.fillRect(0, y0, L.W, L.H - y0);
  ctx.restore();
  for (const it of strip.jars) UI.drawJar(ctx, it.mat, it.x, it.y, it.w, it.h, {});
  for (const it of strip.bottles) UI.drawBottle(ctx, it.liq, it.x, it.y, it.w, it.h, {});

  // 見た目のことば(文字ではなく記号)
  const pairs = [[G.dome, C.ax], [G.domeB, C.bx]];
  for (const [d, wx] of pairs) {
    if (!d || !d.mat || !d.liq) continue;
    const tags = describe(d.mat, d.liq);
    const s = G.cam.toScreen(wx, C.tagY, G.W, G.H);
    const r = Math.min(G.W * 0.028, 24);
    const total = tags.length;
    tags.forEach((t, i) => {
      UI.drawTag(ctx, t, s.x + (i - (total - 1) / 2) * r * 2.5, s.y, r);
    });
  }
}

// -------------------------------------------------------------------- 保存棚
function drawShelfPanel(G, ctx) {
  const W = G.W, H = G.H;
  ctx.save();
  ctx.fillStyle = 'rgba(16,10,5,0.55)';
  ctx.fillRect(0, 0, W, H);
  const pw = Math.min(W * 0.94, 900), ph = Math.min(H * 0.72, 620);
  const px = (W - pw) / 2, py = (H - ph) / 2;
  // 木の引き出し
  const g = ctx.createLinearGradient(0, py, 0, py + ph);
  g.addColorStop(0, '#7a5c3c'); g.addColorStop(1, '#5b432a');
  ctx.fillStyle = g;
  roundRect(ctx, px, py, pw, ph, 14); ctx.fill();
  ctx.strokeStyle = 'rgba(255,226,180,0.22)'; ctx.lineWidth = 2;
  roundRect(ctx, px + 3, py + 3, pw - 6, ph - 6, 12); ctx.stroke();
  // 中の仕切り板
  const cols = pw > 560 ? 4 : 3;
  const rows = Math.ceil(Math.max(1, MAXV(G.saved.length, cols * 2)) / cols);
  const cw = (pw - 32) / cols, chh = (ph - 40) / Math.max(2, rows);
  G.shelfItems = [];
  for (let i = 0; i < cols * rows; i++) {
    const cx = px + 16 + (i % cols) * cw + cw / 2;
    const cy = py + 24 + Math.floor(i / cols) * chh + chh;
    // 棚板
    if (i % cols === 0) {
      ctx.fillStyle = 'rgba(40,26,14,0.55)';
      ctx.fillRect(px + 10, cy + 2, pw - 20, Math.max(3, chh * 0.045));
    }
    const rec = G.saved[i];
    if (!rec) {
      ctx.save();
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = 'rgba(226,206,166,0.20)'; ctx.lineWidth = 2;
      const es = Math.min(cw * 0.86, chh * 0.90);
      ctx.beginPath();
      ctx.arc(cx, cy - es * 1.16 * 0.62, es * 0.42, 0, 7);
      ctx.stroke();
      ctx.restore();
      continue;
    }
    const size = Math.min(cw * 0.86, chh * 0.90);
    const img = thumbFor(G, rec, Math.round(size));
    const iw = size, ih = size * 1.16;
    ctx.drawImage(img, cx - iw / 2, cy - ih, iw, ih);
    G.shelfItems.push({ rec, x: cx, y: cy, w: iw, h: ih });
  }
  // 閉じるボタン
  const r = Math.min(W, H) * 0.045;
  UI.drawButton(ctx, px + pw - r * 1.1, py + r * 1.1, r, 'close', { press: G.pressed === 'closeShelf' });
  G.buttons = [{ id: 'closeShelf', x: px + pw - r * 1.1, y: py + r * 1.1, r, icon: 'close' }];
  ctx.restore();
}
function MAXV(a, b) { return Math.max(a, b); }

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawSaveFlash(G, ctx) {
  const L = G.L;
  const a = G.savedPulse;
  const s = G.cam.toScreen(L.W * 0.06, L.shelfY2, G.W, G.H);
  ctx.save();
  ctx.globalAlpha = a * 0.9;
  UI.drawHint(ctx, s.x, s.y - L.H * 0.02, Math.min(G.W, G.H) * 0.05, G.time, { hand: false });
  ctx.restore();
}

// 光と影は形がなだらかなので 1/4 の大きさで作り、引き伸ばして重ねる。
// 全画面のグラデーションを毎フレーム計算するより、はるかに軽い。
let overlayKey = '', overlayCanvas = null;
function drawOverlay(G, ctx, focus, scrimY) {
  const W = G.W, H = G.H;
  const q = 4;
  const key = `${Math.round(focus.x / 12)}|${Math.round(focus.y / 12)}|${Math.round(scrimY / 12)}|${W}|${H}`;
  if (key !== overlayKey) {
    if (!overlayCanvas) overlayCanvas = offscreen(1, 1);
    const cw = Math.max(2, Math.ceil(W / q)), ch = Math.max(2, Math.ceil(H / q));
    if (overlayCanvas.width !== cw || overlayCanvas.height !== ch) {
      overlayCanvas.width = cw; overlayCanvas.height = ch;
    }
    const g = overlayCanvas.getContext('2d');
    g.setTransform(1 / q, 0, 0, 1 / q, 0, 0);
    g.clearRect(0, 0, W, H);
    if (scrimY >= 0) {
      const g2 = g.createLinearGradient(0, scrimY, 0, H);
      g2.addColorStop(0, 'rgba(24,15,7,0)');
      g2.addColorStop(0.45, 'rgba(24,15,7,0.62)');
      g2.addColorStop(1, 'rgba(20,12,6,0.86)');
      g.fillStyle = g2;
      g.fillRect(0, scrimY, W, H - scrimY);
    }
    paintLightWash(g, W, H, focus);
    overlayKey = key;
  }
  ctx.drawImage(overlayCanvas, 0, 0, W, H);
}

// ------------------------------------------------------------------ buttons
function layoutButtons(G) {
  if (G.shelfOpen) return;               // パネル側で自分のボタンを置く
  const W = G.W, H = G.H, L = G.L;
  const btns = [];
  const m = Math.min(W, H) * 0.075;
  const rs = Math.min(W, H) * 0.048;
  btns.push({ id: 'sound', x: W - m * 0.85, y: m * 0.85, r: rs, icon: G.muted ? 'mute' : 'sound' });
  btns.push({ id: 'shelf', x: W - m * 0.85, y: m * 0.85 + rs * 2.5, r: rs, icon: 'shelf' });

  if (G.compare) {
    const C = L.cmp;
    const cx = W / 2;
    const s = G.cam.toScreen(L.W / 2, C.cy, W, H);
    const rb = Math.min(W * 0.055, 46);
    btns.push({ id: 'shake', x: cx, y: s.y - rb * 0.2, r: rb * 1.15, icon: 'shake' });
    btns.push({ id: 'save', x: cx, y: s.y + rb * 2.1, r: rb * 0.82, icon: 'save' });
    btns.push({ id: 'compare', x: cx, y: s.y - rb * 2.5, r: rb * 0.82, icon: 'single', active: true });
  } else if (G.stage === 'watch' || G.stage === 'shake') {
    const by = H - Math.max(52, H * 0.105);
    const rb = Math.min(W * 0.105, H * 0.075, 52);
    const sp = Math.min(W * 0.27, rb * 3.1);
    btns.push({ id: 'shake', x: W / 2, y: by, r: rb * 1.12, icon: 'shake' });
    btns.push({ id: 'new', x: W / 2 - sp, y: by, r: rb * 0.78, icon: 'new' });
    btns.push({ id: 'save', x: W / 2 + sp, y: by, r: rb * 0.78, icon: 'save' });
    if (L.wide) btns.push({ id: 'compare', x: W - m * 0.85, y: by, r: rb * 0.82, icon: 'compare' });
  } else if (G.stage !== 'pick_particle') {
    btns.push({ id: 'new', x: m * 0.85, y: m * 0.85, r: rs, icon: 'new' });
  }
  G.buttons = btns;
}

// -------------------------------------------------------------------- hints
function drawHints(G, ctx) {
  const L = G.L, W = G.W, H = G.H, t = G.time;
  if (G.shelfOpen) return;
  const ring = (wx, wy, r, opts) => {
    const s = G.cam.toScreen(wx, wy, W, H);
    UI.drawHint(ctx, s.x, s.y, r * G.cam.zoom, t, opts);
  };

  if (G.stage === 'pick_particle') {
    // 一定時間ごとに別の瓶を指す。「ここを触ると変わる」とだけ伝える。
    const idx = ((Math.floor(t / 2.4) % L.jars.length) + L.jars.length) % L.jars.length;
    const j = L.jars[idx];
    ring(j.x, j.y - j.h * 0.45, j.w * 0.62);
  } else if (G.stage === 'pour_particle' || G.stage === 'pour_liquid') {
    if (!G.pouring && G.jar) {
      const s = G.cam.toScreen(G.jar.x, G.jar.y - L.domeR * 0.2, W, H);
      UI.drawHint(ctx, s.x, s.y, L.domeR * 0.45 * G.cam.zoom, t);
      // 押しつづける合図(輪が内側に縮んでいく)
      const p = (t * 0.9) % 1;
      ctx.save();
      ctx.beginPath();
      ctx.arc(s.x, s.y, L.domeR * 0.45 * G.cam.zoom * (1.35 - p * 0.55), 0, 7);
      ctx.strokeStyle = `rgba(255,236,190,${0.5 * (1 - p)})`;
      ctx.lineWidth = 3; ctx.stroke();
      ctx.restore();
    }
  } else if (G.stage === 'pick_liquid') {
    const idx = ((Math.floor(t / 2.2) % L.bottles.length) + L.bottles.length) % L.bottles.length;
    const b = L.bottles[idx];
    ring(b.x, b.y - b.h * 0.5, b.w * 0.7);
  } else if (G.stage === 'close') {
    if (!G.closing) ring(L.domeCx, L.domeCy - L.domeR * 1.55, L.domeR * 0.34);
  } else if (G.stage === 'shake') {
    if (G.dome.energy < 0.35 && !G.dragging) {
      const s = G.cam.toScreen(L.domeCx, L.domeCy + L.domeR * 1.35, W, H);
      UI.drawSwipeHint(ctx, s.x, s.y, Math.min(W * 0.6, L.domeR * 2.6 * G.cam.zoom), t);
    }
  } else if (G.stage === 'watch') {
    if (G.stageT > 3.6 && G.dome.energy < 0.05) {
      const b = G.buttons.find((x) => x.id === 'shake');
      if (b) UI.drawHint(ctx, b.x, b.y, b.r * 1.25, t, { hand: false });
    }
  } else if (G.compare) {
    if (G.dome.energy < 0.2 && !G.dragging && G.stageT > 2.5) {
      const b = G.buttons.find((x) => x.id === 'shake');
      if (b) UI.drawHint(ctx, b.x, b.y, b.r * 1.25, t, { hand: false });
    }
  }
}
