import { R, FLOOR, FLOOR_R, BINS } from './particles.js';
import { getSpriteSet, offscreen } from './sprites.js';
import { makeRng, rand, clamp } from './rng.js';

// ---------------------------------------------------------------------------
// スノードーム本体の描画。
// 光源は左上の窓から。ガラスは「広く弱い反射」と「わずかな緑の縁」で表現し、
// 発光する縁取りやネオンは使わない。
// ---------------------------------------------------------------------------

const miniCache = new Map();

function w2s(cx, cy, rad, p) {
  const s = 1 + (p.z / R) * 0.16;          // ゆるい遠近
  const k = (rad / R) * s;
  return { x: cx + p.x * k, y: cy + p.y * k, k, s };
}

// 台座の上の小さな塗装ミニチュア(寸法の基準になり、世界としての手がかりになる)
function miniature(rad, seed) {
  const key = `${Math.round(rad)}|${seed}`;
  if (miniCache.has(key)) return miniCache.get(key);
  const W = Math.ceil(rad * 1.7), H = Math.ceil(rad * 0.95);
  const c = offscreen(W, H);
  const g = c.getContext('2d');
  const rng = makeRng(seed * 31 + 7);
  const u = rad / 100;
  const bx = W * 0.5, by = H * 0.86;

  // 雪の土台(塗装された石膏。真っ白ではなく灰みを含む)
  // 下端は台座の陰に沈ませて、切り紙のような硬い縁を出さない。
  g.beginPath();
  g.moveTo(bx - 62 * u, by + 6 * u);
  g.bezierCurveTo(bx - 52 * u, by - 15 * u, bx - 20 * u, by - 20 * u, bx + 4 * u, by - 17 * u);
  g.bezierCurveTo(bx + 30 * u, by - 14 * u, bx + 54 * u, by - 8 * u, bx + 62 * u, by + 6 * u);
  g.closePath();
  const sg = g.createLinearGradient(bx, by - 22 * u, bx, by + 4 * u);
  sg.addColorStop(0, '#eef1f2');
  sg.addColorStop(0.62, '#ced7db');
  sg.addColorStop(1, '#93a1a8');
  g.fillStyle = sg; g.fill();
  // 手前側の陰(左右対称にはしない)
  g.globalAlpha = 0.20;
  g.beginPath();
  g.moveTo(bx - 62 * u, by + 6 * u);
  g.bezierCurveTo(bx - 30 * u, by - 6 * u, bx + 20 * u, by - 3 * u, bx + 62 * u, by + 6 * u);
  g.lineTo(bx + 62 * u, by + 8 * u); g.lineTo(bx - 62 * u, by + 8 * u);
  g.closePath();
  g.fillStyle = '#3c4750'; g.fill();
  g.globalAlpha = 1;

  // 小屋
  const hx = bx - 20 * u, hy = by - 16 * u, hw = 26 * u, hh = 18 * u;
  g.fillStyle = '#b8a087';
  g.fillRect(hx - hw / 2, hy - hh, hw, hh);
  g.fillStyle = 'rgba(60,44,32,0.22)';
  g.fillRect(hx - hw / 2, hy - hh, hw * 0.34, hh);          // 影側(左右非対称)
  g.beginPath();                                             // 屋根
  g.moveTo(hx - hw * 0.66, hy - hh);
  g.lineTo(hx, hy - hh - 13 * u);
  g.lineTo(hx + hw * 0.66, hy - hh);
  g.closePath();
  g.fillStyle = '#8f5b4a'; g.fill();
  g.fillStyle = 'rgba(238,242,244,0.85)';                    // 屋根の雪
  g.beginPath();
  g.moveTo(hx - hw * 0.66, hy - hh);
  g.lineTo(hx, hy - hh - 13 * u);
  g.lineTo(hx + hw * 0.2, hy - hh - 5 * u);
  g.lineTo(hx - hw * 0.3, hy - hh);
  g.closePath(); g.fill();
  g.fillStyle = '#e8b45e';                                   // 窓のあかり
  g.fillRect(hx - 3 * u, hy - hh * 0.62, 6 * u, 6 * u);
  g.strokeStyle = 'rgba(70,50,34,0.5)'; g.lineWidth = Math.max(0.6, 0.9 * u);
  g.strokeRect(hx - 3 * u, hy - hh * 0.62, 6 * u, 6 * u);

  // もみの木を2本(高さと位置をずらす)
  for (const [tx, th, tw] of [[bx + 20 * u, 34 * u, 18 * u], [bx + 38 * u, 22 * u, 13 * u]]) {
    const ty = by - 12 * u;
    for (let i = 0; i < 3; i++) {
      const t = i / 3;
      g.beginPath();
      g.moveTo(tx, ty - th + t * th * 0.30);
      g.lineTo(tx - tw * (0.5 - t * 0.13), ty - th * (0.44 - t * 0.42));
      g.lineTo(tx + tw * (0.5 - t * 0.13), ty - th * (0.44 - t * 0.42));
      g.closePath();
      g.fillStyle = i === 0 ? '#3f6148' : i === 1 ? '#375840' : '#2f4d38';
      g.fill();
    }
    g.fillStyle = '#6b5138';
    g.fillRect(tx - 1.6 * u, ty - th * 0.06, 3.2 * u, 8 * u);
  }
  // 塗り残しと擦れ(左に寄せる。左右対称の汚れは作らない)
  g.globalAlpha = 0.16;
  for (let i = 0; i < 14; i++) {
    g.fillStyle = i % 2 ? '#6b6055' : '#ffffff';
    g.fillRect(bx + rand(rng, -60, 30) * u, by - rand(rng, 2, 16) * u, rand(rng, 1, 4) * u, rand(rng, 1, 2) * u);
  }
  g.globalAlpha = 1;
  miniCache.set(key, { canvas: c, w: W, h: H });
  return miniCache.get(key);
}

// 形ごとの見かけの大きさ。スプライトの絵は本体より余白があるので形で係数が違う。
export function shapeScale(shape) {
  return shape === 'dot' ? 2.0
    : shape === 'grain' ? 1.8
    : shape === 'shard' ? 2.0
    : shape === 'bubble' ? 1.85
    : 1.35;
}

// 画面に出る最大の大きさ(端末画素)。ここからスプライトの解像度を決める。
function spriteTarget(m, rad, dpr) {
  return m.size[1] * (rad / R) * shapeScale(m.shape) * 1.9 * dpr;
}

// 積もったもののかたち。素材ごとに稜線が違う(すなは急な山、こなゆきは平ら)。
function drawPile(ctx, dome, cx, cy, rad) {
  const m = dome.mat;
  if (!m) return;
  const prof = dome.pileProfile();
  let any = 0;
  for (let i = 0; i < BINS; i++) any = Math.max(any, prof[i]);
  if (any < 0.25) return;
  const k = rad / R;
  const fr = FLOOR_R * k, fy = cy + FLOOR * k;
  ctx.save();
  ctx.beginPath();
  // 上の稜線
  for (let i = 0; i < BINS; i++) {
    const t = (i + 0.5) / BINS * 2 - 1;
    const x = cx + t * fr;
    const y = fy - (prof[i] * 1.7 + 1.8) * k;
    if (i === 0) { ctx.moveTo(cx - fr, fy); ctx.lineTo(x, y); }
    else ctx.lineTo(x, y);
  }
  ctx.lineTo(cx + fr, fy);
  // 手前のふち(床の楕円に沿う)
  ctx.ellipse(cx, fy, fr, fr * 0.26, 0, 0, Math.PI);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, fy - (any * 1.7 + 1.8) * k, 0, fy + fr * 0.26);
  g.addColorStop(0, m.colors[0]);
  g.addColorStop(0.55, m.colors[1] || m.colors[0]);
  g.addColorStop(1, m.colors[2] || m.colors[0]);
  ctx.globalAlpha = 0.88;
  ctx.fillStyle = g; ctx.fill();
  // 稜線の陰
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = '#2b3238';
  ctx.beginPath();
  ctx.ellipse(cx, fy + fr * 0.16, fr * 0.92, fr * 0.13, 0, 0, Math.PI);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawParticles(ctx, dome, cx, cy, rad, back) {
  const m = dome.mat;
  if (!m || !dome.list.length) return;
  const dpr = ctx._dpr || 1;
  const set = getSpriteSet(m, dpr, spriteTarget(m, rad, dpr));
  const trail = dome.liq ? dome.liq.trail : 0;
  const S = set.size;
  const order = dome._order || (dome._order = []);
  if (order.length !== dome.list.length) {
    order.length = 0;
    for (let i = 0; i < dome.list.length; i++) order.push(i);
  }
  if (!back) order.sort((a, b) => dome.list[a].z - dome.list[b].z);

  for (let i = 0; i < order.length; i++) {
    const p = dome.list[order[i]];
    if (back ? p.z >= 0 : p.z < 0) continue;
    const pos = w2s(cx, cy, rad, p);
    const px = pos.x, py = pos.y;
    const size = p.size * pos.k * shapeScale(m.shape);
    if (size < 0.35) continue;
    const half = size / 2;
    if (px < cx - rad - size || px > cx + rad + size) continue;

    const frame = set.frames > 1
      ? ((Math.floor((p.rot / (Math.PI * 2)) * set.frames) % set.frames) + set.frames) % set.frames
      : 0;
    const img = set.variants[p.ci][frame];

    const depth = clamp(0.5 + p.z / (R * 2), 0, 1);
    ctx.globalAlpha = back ? 0.62 + depth * 0.30 : 0.86 + depth * 0.14;

    // とろりでは軌跡がわずかに残り、動きが粘って見える
    if (trail > 0 && !p.rest) {
      const sp = Math.hypot(p.vx, p.vy, p.vz);
      if (sp > 22) {
        const q = w2s(cx, cy, rad, { x: p.px, y: p.py, z: p.pz });
        ctx.globalAlpha *= 1;
        const a = ctx.globalAlpha;
        ctx.globalAlpha = a * trail * 0.5;
        ctx.drawImage(img, q.x - half, q.y - half, size, size);
        ctx.globalAlpha = a;
      }
    }

    ctx.drawImage(img, px - half, py - half, size, size);

    // 反射のきらめき。金ラメは強く速く、雪はごく弱く。
    if (set.flash && m.sparkle > 0.15) {
      const t = Math.sin(p.rot * 2.6 + p.flashPhase + dome.time * (p.rest ? 0.8 : 2.2));
      const f = Math.pow(Math.max(0, t), m.shape === 'shard' ? 5 : 9) * m.sparkle * (back ? 0.45 : 1);
      if (f > 0.06) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.min(0.70, f);
        const fs = size * (1.05 + f * 0.28);
        ctx.drawImage(set.flash[p.ci][frame], px - fs / 2, py - fs / 2, fs, fs);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  }
  ctx.globalAlpha = 1;
}

function glassBody(ctx, cx, cy, rad, liq) {
  // ガラス越しの内側。奥ほど暗く、下に机の反射光が回り込む。
  const g = ctx.createRadialGradient(cx - rad * 0.36, cy - rad * 0.46, rad * 0.05, cx, cy, rad);
  g.addColorStop(0, 'rgba(238,244,242,0.20)');
  g.addColorStop(0.50, 'rgba(150,166,168,0.08)');
  g.addColorStop(0.86, 'rgba(44,50,52,0.34)');
  g.addColorStop(1, 'rgba(26,30,32,0.46)');
  ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 7); ctx.fillStyle = g; ctx.fill();
}

// 台座の上面。ここが暗いと、しずんだ粒がまったく見えなくなる。
function domeFloor(ctx, cx, cy, rad, seed) {
  const fy = cy + FLOOR * (rad / R);
  const fr = FLOOR_R * (rad / R);
  const rng = makeRng(seed * 53 + 11);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, fy, fr, fr * 0.26, 0, 0, 7);
  // ミニチュアの雪と同じ塗り。手前は台座のふちの陰に入る。
  const g = ctx.createLinearGradient(0, fy - fr * 0.26, 0, fy + fr * 0.26);
  g.addColorStop(0, '#dde3e2');
  g.addColorStop(0.5, '#c2ccce');
  g.addColorStop(1, '#9aa6ab');
  ctx.fillStyle = g; ctx.fill();
  // 塗りのむら(左右対称にしない)
  ctx.clip();
  ctx.globalAlpha = 0.10;
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = i % 3 ? '#7d8a90' : '#ffffff';
    ctx.fillRect(cx + rand(rng, -fr, fr * 0.7), fy + rand(rng, -fr * 0.28, fr * 0.28),
      rand(rng, 2, 9) * (rad / 100), rand(rng, 1, 3) * (rad / 100));
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  // ガラスと接するふち
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, fy, fr, fr * 0.26, 0, 0, 7);
  ctx.strokeStyle = 'rgba(60,72,78,0.26)';
  ctx.lineWidth = Math.max(1, rad * 0.012);
  ctx.stroke();
  ctx.restore();
}

function liquidBody(ctx, dome, cx, cy, rad) {
  const L = dome.liq;
  if (!L || dome.liquidLevel <= 0.01) return;
  const topY = cy + (FLOOR - (FLOOR + R * 0.90) * dome.liquidLevel) * (rad / R);
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, rad * 0.995, 0, 7); ctx.clip();
  ctx.beginPath();
  ctx.rect(cx - rad, topY, rad * 2, cy + rad - topY);
  ctx.fillStyle = L.tint; ctx.fill();
  // 底に向かって濃くなる(液の厚みで奥が沈む)
  const g = ctx.createLinearGradient(0, topY, 0, cy + FLOOR * (rad / R));
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, L.deep);
  ctx.fillStyle = g; ctx.fill();
  ctx.restore();
}

function liquidSurface(ctx, dome, cx, cy, rad) {
  const L = dome.liq;
  if (!L || dome.liquidLevel <= 0.02 || dome.liquidLevel > 0.985) return;
  const topY = cy + (FLOOR - (FLOOR + R * 0.90) * dome.liquidLevel) * (rad / R);
  const dy = topY - cy;
  const rr = Math.sqrt(Math.max(0, rad * rad - dy * dy));
  if (rr < 2) return;
  ctx.save();
  ctx.beginPath(); ctx.ellipse(cx, topY, rr, rr * 0.20, 0, 0, 7);
  ctx.fillStyle = 'rgba(255,255,255,0.16)'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.32)'; ctx.lineWidth = Math.max(1, rad * 0.012);
  ctx.stroke();
  ctx.restore();
}

function fizzField(ctx, dome, cx, cy, rad) {
  if (!dome.liq || !dome.liq.fizz || dome.liquidLevel < 0.2) return;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, rad * 0.98, 0, 7); ctx.clip();
  for (const b of dome.fizzBubbles) {
    const pos = w2s(cx, cy, rad, b);
    const r = b.r * pos.k;
    ctx.beginPath(); ctx.arc(pos.x, pos.y, r, 0, 7);
    ctx.fillStyle = 'rgba(255,255,255,0.30)'; ctx.fill();
    ctx.beginPath(); ctx.arc(pos.x - r * 0.3, pos.y - r * 0.3, r * 0.4, 0, 7);
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fill();
  }
  ctx.restore();
}

function glassHighlights(ctx, cx, cy, rad, seed = 3) {
  const rng = makeRng(seed);
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 7); ctx.clip();

  // 窓の反射。細い光の帯ではなく、広くて弱い面の反射。
  ctx.globalAlpha = 0.17;
  ctx.beginPath();
  ctx.moveTo(cx - rad * 0.72, cy - rad * 0.30);
  ctx.quadraticCurveTo(cx - rad * 0.62, cy - rad * 0.84, cx - rad * 0.16, cy - rad * 0.86);
  ctx.quadraticCurveTo(cx - rad * 0.34, cy - rad * 0.52, cx - rad * 0.40, cy - rad * 0.16);
  ctx.closePath();
  ctx.fillStyle = '#f4f8f6'; ctx.fill();

  // 机からの照り返し(右下、さらに弱い)
  ctx.globalAlpha = 0.10;
  ctx.beginPath();
  ctx.ellipse(cx + rad * 0.42, cy + rad * 0.52, rad * 0.34, rad * 0.15, -0.6, 0, 7);
  ctx.fillStyle = '#f0e0c4'; ctx.fill();

  // 指紋(片側だけ。左右対称の汚れは作らない)
  ctx.globalAlpha = 0.055;
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 5; i++) {
    const a = rand(rng, 0.2, 0.9), d = rand(rng, 0.45, 0.8);
    ctx.beginPath();
    ctx.ellipse(cx + Math.cos(a) * rad * d, cy + Math.sin(a) * rad * d * 0.8,
      rad * 0.07, rad * 0.10, a, 0, 7);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // ガラスの縁。厚みのぶんだけ暗く、わずかに緑を含む。
  ctx.beginPath(); ctx.arc(cx, cy, rad * 0.985, 0, 7);
  ctx.strokeStyle = 'rgba(150,176,164,0.34)';
  ctx.lineWidth = Math.max(1.2, rad * 0.035); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, rad * 0.955, 0, 7);
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = Math.max(1, rad * 0.016); ctx.stroke();
}

// 台座。塗装した木。角が一か所だけ欠けている。
function drawBase(ctx, cx, cy, rad, seed, paint) {
  const rng = makeRng(seed * 17 + 5);
  const bw = rad * 0.86, bh = rad * 0.24;
  const topY = cy + rad * 0.80;
  const ry = bw * 0.21;

  ctx.save();
  // 接地影(接点がいちばん濃い)
  const sg = ctx.createRadialGradient(cx, topY + bh, rad * 0.06, cx, topY + bh, bw * 1.25);
  sg.addColorStop(0, 'rgba(28,18,10,0.55)');
  sg.addColorStop(0.45, 'rgba(30,20,12,0.26)');
  sg.addColorStop(1, 'rgba(30,20,12,0)');
  ctx.beginPath(); ctx.ellipse(cx + rad * 0.12, topY + bh * 0.96, bw * 1.30, bh * 0.62, 0, 0, 7);
  ctx.fillStyle = sg; ctx.fill();

  // 側面
  ctx.beginPath();
  ctx.moveTo(cx - bw, topY);
  ctx.lineTo(cx - bw, topY + bh);
  ctx.ellipse(cx, topY + bh, bw, ry, 0, Math.PI, 0, true);
  ctx.lineTo(cx + bw, topY);
  ctx.closePath();
  const g = ctx.createLinearGradient(cx - bw, 0, cx + bw, 0);
  g.addColorStop(0, paint.dark); g.addColorStop(0.42, paint.mid); g.addColorStop(1, paint.dark);
  ctx.fillStyle = g; ctx.fill();

  // 上面
  ctx.beginPath(); ctx.ellipse(cx, topY, bw, ry, 0, 0, 7);
  ctx.fillStyle = paint.top; ctx.fill();

  // 面取りのすり減り(光が乗るのは上の縁だけ)
  ctx.beginPath(); ctx.ellipse(cx, topY, bw, ry, 0, Math.PI * 1.08, Math.PI * 1.95);
  ctx.strokeStyle = 'rgba(255,242,220,0.22)'; ctx.lineWidth = Math.max(1, rad * 0.02); ctx.stroke();

  // 塗装の欠け(1か所だけ、右下)
  ctx.beginPath();
  const cxx = cx + bw * 0.62, cyy = topY + bh * 0.62;
  ctx.moveTo(cxx, cyy);
  ctx.lineTo(cxx + rad * 0.07, cyy + rad * 0.02);
  ctx.lineTo(cxx + rad * 0.05, cyy + rad * 0.07);
  ctx.lineTo(cxx - rad * 0.01, cyy + rad * 0.05);
  ctx.closePath();
  ctx.fillStyle = 'rgba(160,124,80,0.75)'; ctx.fill();

  // 使い込んだ擦れ
  ctx.globalAlpha = 0.14;
  for (let i = 0; i < 16; i++) {
    ctx.fillStyle = i % 3 ? '#000000' : '#ffffff';
    const x = cx + rand(rng, -bw * 0.92, bw * 0.92);
    const y = topY + rand(rng, bh * 0.08, bh * 0.92);
    ctx.fillRect(x, y, rand(rng, 1, rad * 0.09), Math.max(1, rad * 0.012));
  }
  ctx.globalAlpha = 1;

  // 小さなラベル(少し傾いて貼ってある)
  ctx.save();
  ctx.translate(cx - bw * 0.30, topY + bh * 0.40);
  ctx.rotate(-0.05);
  ctx.globalAlpha = 0.88;
  ctx.fillStyle = '#e6dcc2';
  ctx.fillRect(0, 0, bw * 0.42, bh * 0.26);
  ctx.strokeStyle = 'rgba(120,98,68,0.45)'; ctx.lineWidth = 1; ctx.strokeRect(0, 0, bw * 0.42, bh * 0.26);
  ctx.fillStyle = 'rgba(110,88,60,0.5)';
  for (let i = 0; i < 2; i++) ctx.fillRect(bw * 0.04, bh * (0.07 + i * 0.09), bw * (0.30 - i * 0.11), Math.max(1, bh * 0.035));
  ctx.globalAlpha = 1;
  ctx.restore();
  ctx.restore();
  return { topY, bw, bh };
}

// フタ(真鍮のつまみ)。lidT=0 で持ち上がっていて、1 で閉じている。
function drawLid(ctx, cx, cy, rad, lidT) {
  const neckR = rad * 0.30;
  const lift = (1 - lidT) * rad * 0.26;
  const y = cy - rad * 0.955 - lift;
  ctx.save();
  ctx.translate(cx, y);
  // つば
  const g = ctx.createLinearGradient(-neckR, 0, neckR, 0);
  g.addColorStop(0, '#7d6540'); g.addColorStop(0.35, '#c8a86a');
  g.addColorStop(0.62, '#efdaa8'); g.addColorStop(1, '#6f5936');
  ctx.beginPath();
  ctx.ellipse(0, 0, neckR * 1.12, neckR * 0.34, 0, 0, 7);
  ctx.fillStyle = g; ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-neckR * 1.12, 0); ctx.lineTo(-neckR * 0.95, -neckR * 0.42);
  ctx.lineTo(neckR * 0.95, -neckR * 0.42); ctx.lineTo(neckR * 1.12, 0);
  ctx.closePath(); ctx.fillStyle = g; ctx.fill();
  // つまみ
  ctx.beginPath();
  ctx.ellipse(0, -neckR * 0.52, neckR * 0.34, neckR * 0.30, 0, 0, 7);
  ctx.fillStyle = '#d8bd80'; ctx.fill();
  ctx.beginPath();
  ctx.ellipse(-neckR * 0.10, -neckR * 0.60, neckR * 0.13, neckR * 0.10, -0.5, 0, 7);
  ctx.fillStyle = 'rgba(255,248,224,0.7)'; ctx.fill();
  // 使い込んだ黒ずみ(片側)
  ctx.globalAlpha = 0.20;
  ctx.beginPath(); ctx.ellipse(neckR * 0.55, 0, neckR * 0.35, neckR * 0.16, 0, 0, 7);
  ctx.fillStyle = '#3a2c18'; ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();
}

// くび(注ぎ口)。ふたが開いているときだけ見える。
function drawNeck(ctx, cx, cy, rad) {
  const neckR = rad * 0.30;
  const y = cy - rad * 0.955;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, y, neckR, neckR * 0.30, 0, 0, 7);
  ctx.fillStyle = 'rgba(24,30,30,0.45)'; ctx.fill();
  ctx.strokeStyle = 'rgba(198,214,206,0.55)';
  ctx.lineWidth = Math.max(1.4, rad * 0.028); ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx, y - rad * 0.012, neckR * 0.92, neckR * 0.26, 0, Math.PI * 1.05, Math.PI * 1.9);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = Math.max(1, rad * 0.014); ctx.stroke();
  ctx.restore();
}

export function drawDome(ctx, dome, cx, cy, rad, opts = {}) {
  const lidT = opts.lidT === undefined ? 1 : opts.lidT;
  const seed = opts.seed || 1;
  const paint = opts.paint || { top: '#4d6b58', mid: '#3f5b4a', dark: '#2c4034' };

  ctx.save();
  if (opts.shakeOffset) ctx.translate(opts.shakeOffset.x, opts.shakeOffset.y);
  if (opts.tilt) {
    ctx.translate(cx, cy + rad); ctx.rotate(opts.tilt); ctx.translate(-cx, -(cy + rad));
  }

  glassBody(ctx, cx, cy, rad);

  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, rad * 0.985, 0, 7); ctx.clip();

  if (opts.lens) opts.lens(ctx, dome.liquidLevel);
  liquidBody(ctx, dome, cx, cy, rad);
  domeFloor(ctx, cx, cy, rad, seed);
  drawParticles(ctx, dome, cx, cy, rad, true);

  // 奥の粒は液体の厚みのぶんだけ沈んで見える(空気遠近)
  if (dome.liquidLevel > 0.1) {
    ctx.fillStyle = dome.liq.tint;
    ctx.globalAlpha = 0.62; ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
    ctx.globalAlpha = 1;
  }

  // ミニチュアは床の上、粒子の前後の境目に置く
  // ミニチュアは床の奥側に置く。手前は積もっていく粒のために空けておく。
  const mini = miniature(rad, seed);
  const mk = 0.60;
  const mw = mini.w * mk, mh = mini.h * mk;
  ctx.drawImage(mini.canvas, cx - mw / 2 - rad * 0.05,
    cy + (FLOOR - 5) * (rad / R) - mh, mw, mh);

  drawPile(ctx, dome, cx, cy, rad);
  drawParticles(ctx, dome, cx, cy, rad, false);
  fizzField(ctx, dome, cx, cy, rad);
  liquidSurface(ctx, dome, cx, cy, rad);
  ctx.restore();

  glassHighlights(ctx, cx, cy, rad, seed);
  if (lidT < 0.98) {
    drawNeck(ctx, cx, cy, rad);
    // 浮いているふたの影。どこへ降りるのかが分かる。
    ctx.save();
    ctx.globalAlpha = 0.22 * (1 - lidT);
    ctx.beginPath();
    ctx.ellipse(cx + rad * 0.03, cy - rad * 0.93, rad * 0.26, rad * 0.07, 0, 0, 7);
    ctx.fillStyle = '#1d1408'; ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  // 台座は球の手前。影も一緒に。
  const base = drawBase(ctx, cx, cy, rad, seed, paint);
  if (opts.showLid !== false) {
    ctx.save();
    if (opts.shakeOffset) ctx.translate(opts.shakeOffset.x, opts.shakeOffset.y);
    drawLid(ctx, cx, cy, rad, lidT);
    ctx.restore();
  }
  return base;
}

export { miniature };
