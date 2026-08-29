import { makeRng, rand, lerp } from './rng.js';

// 粒子はあらかじめ小さなキャンバスに描いておき、毎フレームは drawImage だけ。
// 回転はフレーム差し替えで表現する(モバイルでの安定動作を優先)。
const FRAMES = 12;
const cache = new Map();

function offscreen(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (v) => Math.max(0, Math.min(255, Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt))));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

// 輪郭をわずかに崩す。完全な対称形はCG臭さの元。
function wobblyPath(ctx, pts, rng, jitter) {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    const jx = x + (rng() - 0.5) * jitter;
    const jy = y + (rng() - 0.5) * jitter;
    if (i === 0) ctx.moveTo(jx, jy); else ctx.lineTo(jx, jy);
  }
  ctx.closePath();
}

function drawFlake(ctx, S, color, rng) {
  const R = S * 0.46;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.translate(S / 2, S / 2);
  const arms = 6;
  const armLen = [];
  for (let i = 0; i < arms; i++) armLen.push(rand(rng, 0.82, 1.0));
  for (let i = 0; i < arms; i++) {
    const a = (i / arms) * Math.PI * 2 + rand(rng, -0.05, 0.05);
    const L = R * armLen[i];
    ctx.lineWidth = S * 0.085;
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * L, Math.sin(a) * L); ctx.stroke();
    // 枝
    for (const t of [0.42, 0.68]) {
      const bx = Math.cos(a) * L * t, by = Math.sin(a) * L * t;
      const bl = L * (0.3 - t * 0.16);
      ctx.lineWidth = S * 0.055;
      for (const s of [-1, 1]) {
        const ba = a + s * 0.9;
        ctx.beginPath(); ctx.moveTo(bx, by);
        ctx.lineTo(bx + Math.cos(ba) * bl, by + Math.sin(ba) * bl); ctx.stroke();
      }
    }
  }
  ctx.beginPath(); ctx.arc(0, 0, S * 0.055, 0, 7); ctx.fillStyle = color; ctx.fill();
}

function drawStar(ctx, S, color, rng) {
  const R = S * 0.45, r = R * 0.44;
  ctx.translate(S / 2, S / 2);
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rad = i % 2 ? r : R;
    pts.push([Math.cos(a) * rad, Math.sin(a) * rad]);
  }
  wobblyPath(ctx, pts, rng, S * 0.035);
  const g = ctx.createLinearGradient(-R, -R, R, R);
  g.addColorStop(0, shade(color, 0.30));
  g.addColorStop(0.55, color);
  g.addColorStop(1, shade(color, -0.30));
  ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = S * 0.03; ctx.strokeStyle = shade(color, -0.35); ctx.stroke();
}

function drawPetal(ctx, S, color, rng) {
  ctx.translate(S / 2, S / 2);
  const w = S * 0.28, h = S * 0.46;
  ctx.beginPath();
  ctx.moveTo(0, -h);
  ctx.bezierCurveTo(w * 1.25, -h * 0.5, w * 0.95, h * 0.62, 0, h);
  ctx.bezierCurveTo(-w * 0.95, h * 0.62, -w * 1.15, -h * 0.45, 0, -h);
  const g = ctx.createLinearGradient(-w, -h, w * 0.6, h);
  g.addColorStop(0, shade(color, 0.34));
  g.addColorStop(0.5, color);
  g.addColorStop(1, shade(color, -0.24));
  ctx.fillStyle = g; ctx.fill();
  // 葉脈
  ctx.strokeStyle = shade(color, -0.18);
  ctx.globalAlpha = 0.5; ctx.lineWidth = S * 0.018;
  ctx.beginPath(); ctx.moveTo(0, -h * 0.82); ctx.quadraticCurveTo(w * 0.16, 0, 0, h * 0.88); ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawHeart(ctx, S, color, rng) {
  ctx.translate(S / 2, S / 2 + S * 0.03);
  const w = S * 0.42, h = S * 0.40;
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.bezierCurveTo(-w * 1.35, -h * 0.15, -w * 0.62, -h * 1.32, 0, -h * 0.45);
  ctx.bezierCurveTo(w * 0.62, -h * 1.32, w * 1.35, -h * 0.15, 0, h);
  const g = ctx.createLinearGradient(-w * 0.6, -h, w * 0.4, h);
  g.addColorStop(0, shade(color, 0.26));
  g.addColorStop(0.6, color);
  g.addColorStop(1, shade(color, -0.28));
  ctx.fillStyle = g; ctx.fill();
  // 砂糖のようなざらつき(つるつるのプラスチックにしない)
  ctx.globalAlpha = 0.16;
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = i % 3 ? '#ffffff' : '#000000';
    ctx.fillRect(rand(rng, -w, w), rand(rng, -h, h), S * 0.03, S * 0.03);
  }
  ctx.globalAlpha = 1;
}

function drawBubble(ctx, S) {
  const R = S * 0.44;
  ctx.translate(S / 2, S / 2);
  const g = ctx.createRadialGradient(-R * 0.25, -R * 0.3, R * 0.05, 0, 0, R);
  g.addColorStop(0, 'rgba(255,255,255,0.24)');
  g.addColorStop(0.66, 'rgba(226,240,248,0.10)');
  g.addColorStop(0.88, 'rgba(238,248,252,0.72)');   // 泡のふち
  g.addColorStop(0.97, 'rgba(214,232,242,0.34)');
  g.addColorStop(1, 'rgba(200,222,234,0)');
  ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.fillStyle = g; ctx.fill();
  ctx.beginPath();
  ctx.ellipse(-R * 0.32, -R * 0.34, R * 0.26, R * 0.17, -0.7, 0, 7);
  ctx.fillStyle = 'rgba(255,255,255,0.88)'; ctx.fill();
  ctx.beginPath();
  ctx.arc(R * 0.30, R * 0.36, R * 0.12, 0, 7);
  ctx.fillStyle = 'rgba(255,255,255,0.38)'; ctx.fill();
}

function drawGrain(ctx, S, color, rng) {
  ctx.translate(S / 2, S / 2);
  const pts = [];
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rad = S * rand(rng, 0.24, 0.42);
    pts.push([Math.cos(a) * rad, Math.sin(a) * rad]);
  }
  wobblyPath(ctx, pts, rng, S * 0.05);
  const g = ctx.createLinearGradient(-S * 0.3, -S * 0.3, S * 0.3, S * 0.3);
  g.addColorStop(0, shade(color, 0.28));
  g.addColorStop(1, shade(color, -0.30));
  ctx.fillStyle = g; ctx.fill();
}

function drawDot(ctx, S, color) {
  const R = S * 0.42;
  ctx.translate(S / 2, S / 2);
  const g = ctx.createRadialGradient(-R * 0.2, -R * 0.25, 0, 0, 0, R);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.45, color);
  g.addColorStop(1, 'rgba(214,226,240,0)');
  ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.fillStyle = g; ctx.fill();
}

// ラメは「向き」で見え方が変わる薄片。フレームごとに幅と明るさが変わり、
// これが回転中のチカチカした瞬きになる。
function drawShard(ctx, S, color, frame, rng) {
  const a = (frame / FRAMES) * Math.PI * 2;
  const face = Math.abs(Math.cos(a));           // 面がこちらを向く度合い
  const w = S * (0.10 + 0.34 * face);
  const h = S * 0.40;
  ctx.translate(S / 2, S / 2);
  ctx.rotate(rand(rng, -0.5, 0.5));
  const pts = [[-w, -h * 0.72], [w * 0.86, -h], [w, h * 0.66], [-w * 0.8, h]];
  wobblyPath(ctx, pts, rng, S * 0.04);
  const g = ctx.createLinearGradient(-w, -h, w, h);
  g.addColorStop(0, shade(color, -0.35));
  g.addColorStop(lerp(0.30, 0.55, face), shade(color, 0.08 + face * 0.30));
  g.addColorStop(1, shade(color, -0.45));
  ctx.fillStyle = g; ctx.fill();
  if (face > 0.80) {                             // 面が正対した一瞬だけ反射する
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (face - 0.80) / 0.20 * 0.62;
    ctx.fillStyle = '#ffeec0'; ctx.fill();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

function buildFrame(shape, color, S, frame, seed) {
  const c = offscreen(S, S);
  const ctx = c.getContext('2d');
  const rng = makeRng(seed + frame * 977);
  ctx.save();
  if (shape === 'shard') {
    drawShard(ctx, S, color, frame, rng);
  } else {
    const rot = (frame / FRAMES) * Math.PI * 2;
    ctx.translate(S / 2, S / 2); ctx.rotate(rot); ctx.translate(-S / 2, -S / 2);
    if (shape === 'flake') drawFlake(ctx, S, color, rng);
    else if (shape === 'star') drawStar(ctx, S, color, rng);
    else if (shape === 'petal') drawPetal(ctx, S, color, rng);
    else if (shape === 'heart') drawHeart(ctx, S, color, rng);
    else if (shape === 'bubble') drawBubble(ctx, S);
    else if (shape === 'grain') drawGrain(ctx, S, color, rng);
    else drawDot(ctx, S, color);
  }
  ctx.restore();
  return c;
}

// 反射の閃き用。素材の形のまま白く光らせる。
function buildFlash(base, S) {
  const c = offscreen(S, S);
  const ctx = c.getContext('2d');
  ctx.drawImage(base, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = 'rgba(255,246,220,0.85)';
  ctx.fillRect(0, 0, S, S);
  return c;
}

// 実際に描かれる大きさに合わせてスプライトを作る。
// 必要より大きな絵を毎フレーム縮小すると、それだけで描画が重くなる。
const BUCKETS = [12, 16, 24, 32, 48, 64, 96];
function bucket(px) {
  for (const b of BUCKETS) if (px <= b) return b;
  return BUCKETS[BUCKETS.length - 1];
}

// 素材ごとに [色バリエーション][回転フレーム] のスプライト表を作る。
export function getSpriteSet(mat, dpr = 1, targetPx = 0) {
  const big = ['flake', 'star', 'petal', 'heart', 'bubble'].includes(mat.shape);
  const S = targetPx > 0
    ? bucket(Math.ceil(targetPx))
    : Math.round((big ? 46 : 22) * Math.min(2, Math.max(1, dpr)));
  const key = `${mat.id}@${S}`;
  if (cache.has(key)) return cache.get(key);
  const rotating = mat.shape !== 'dot' && mat.shape !== 'bubble';
  const frames = rotating ? FRAMES : 1;
  const variants = mat.colors.map((color, ci) => {
    const list = [];
    for (let f = 0; f < frames; f++) list.push(buildFrame(mat.shape, color, S, f, 4211 + ci * 131 + mat.id.length * 17));
    return list;
  });
  const flash = mat.sparkle > 0.2
    ? variants.map((list) => list.map((img) => buildFlash(img, S)))
    : null;
  const set = { size: S, frames, variants, flash, spriteScale: big ? 1.0 : 1.0 };
  cache.set(key, set);
  return set;
}

export function clearSpriteCache() { cache.clear(); }
export { offscreen, shade };
