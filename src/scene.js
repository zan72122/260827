import { makeRng, rand } from './rng.js';
import { offscreen } from './sprites.js';

// ---------------------------------------------------------------------------
// 素材アトリエ(工房)の背景。遠景=棚のある壁、中景=作業台と道具、近景=台の前縁。
// 光は左手前の窓から。遠景は解像度を落として描き、空気遠近で沈ませる。
// すべて種つき乱数なので、汚れや傷は毎回同じ場所にある。
// ---------------------------------------------------------------------------

const WALL = { top: '#3a2f26', mid: '#5b4a3a', low: '#6b5745' };

function noiseWash(g, x0, y0, x1, y1, seed, n, alpha, colors) {
  const rng = makeRng(seed);
  g.globalAlpha = alpha;
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[Math.floor(rng() * colors.length)];
    const w = rand(rng, 1, 5), h = rand(rng, 1, 3);
    g.fillRect(rand(rng, x0, x1), rand(rng, y0, y1), w, h);
  }
  g.globalAlpha = 1;
}

function paintFar(g, L, view) {
  const { x0, y0, x1, y1 } = view;
  const benchY = L.benchTopY;
  // 壁(下に行くほど明るい。窓の光が床から回り込む)
  const wg = g.createLinearGradient(0, y0, 0, benchY);
  wg.addColorStop(0, WALL.top); wg.addColorStop(0.62, WALL.mid); wg.addColorStop(1, WALL.low);
  g.fillStyle = wg;
  g.fillRect(x0, y0, x1 - x0, benchY - y0 + 2);

  // 左の窓からの光だまり(平行四辺形。輪郭はぼかす)
  const lx = L.W * 0.10, lw = L.W * 0.46;
  const lg = g.createLinearGradient(lx, 0, lx + lw, benchY);
  lg.addColorStop(0, 'rgba(226,232,238,0.22)');
  lg.addColorStop(0.5, 'rgba(238,232,208,0.11)');
  lg.addColorStop(1, 'rgba(255,226,176,0)');
  g.save();
  g.beginPath();
  g.moveTo(lx - L.W * 0.3, y0); g.lineTo(lx + lw, y0);
  g.lineTo(lx + lw * 1.5, benchY); g.lineTo(lx - L.W * 0.2, benchY);
  g.closePath(); g.fillStyle = lg; g.fill();
  g.restore();

  // 漆喰のむら・しみ(左右非対称)
  noiseWash(g, x0, y0, x1, benchY, 91, 900, 0.05, ['#2b221a', '#7d6a55', '#8e7a62']);
  const rng = makeRng(404);
  g.globalAlpha = 0.10;
  for (let i = 0; i < 7; i++) {
    const cx = L.W * rand(rng, 0.55, 1.02), cy = benchY * rand(rng, 0.1, 0.85);
    const r = L.W * rand(rng, 0.05, 0.16);
    const sg = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    sg.addColorStop(0, '#2a2018'); sg.addColorStop(1, 'rgba(42,32,24,0)');
    g.fillStyle = sg; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill();
  }
  g.globalAlpha = 1;

  paintWallProps(g, L);
  paintShelf(g, L, L.shelfY, 1.0, true);
  paintShelf(g, L, L.shelfY2, 0.82, false);   // 下の棚は作った作品を並べるので空けておく

  // 空気遠近: 遠景全体をわずかに壁の色へ寄せる
  g.fillStyle = 'rgba(96,80,64,0.20)';
  g.fillRect(x0, y0, x1 - x0, benchY - y0);
}

// 棚と棚のあいだ。道具掛けと、画鋲で留めた覚え書き。
function paintWallProps(g, L) {
  const rng = makeRng(515);
  const y = (L.shelfY + L.shelfY2) / 2;
  // 右側: 細い横木に道具が下がっている(間隔はふぞろい)
  const bx = L.W * 0.60, bw = L.W * 0.34;
  g.fillStyle = '#4a3a28';
  g.fillRect(bx, y - L.H * 0.004, bw, Math.max(2, L.H * 0.006));
  let x = bx + L.W * 0.02;
  const tools = [0.052, 0.038, 0.060, 0.030, 0.045];
  for (const len of tools) {
    const h = L.H * len;
    g.strokeStyle = rng() > 0.5 ? '#9c8f78' : '#8a7248';
    g.lineWidth = L.W * rand(rng, 0.004, 0.009);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + rand(rng, -2, 2), y + h); g.stroke();
    // さじ・へらの先
    g.fillStyle = g.strokeStyle;
    g.beginPath();
    g.ellipse(x, y + h, L.W * rand(rng, 0.006, 0.013), L.H * rand(rng, 0.006, 0.011), 0, 0, 7);
    g.fill();
    g.fillStyle = 'rgba(16,10,6,0.28)';
    g.fillRect(x + L.W * 0.006, y, L.W * 0.004, h);
    x += L.W * rand(rng, 0.045, 0.075);
    if (x > bx + bw) break;
  }
  // 左側: 少し傾いて留めてある紙(素材の走り書き)
  g.save();
  g.translate(L.W * 0.14, y + L.H * 0.012);
  g.rotate(-0.06);
  const pw = L.W * 0.16, ph = L.H * 0.075;
  g.fillStyle = 'rgba(226,214,186,0.80)';
  g.fillRect(-pw / 2, -ph / 2, pw, ph);
  g.fillStyle = 'rgba(30,22,14,0.16)';
  g.fillRect(-pw / 2 + 2, ph / 2, pw, 3);
  g.strokeStyle = 'rgba(96,78,54,0.5)'; g.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.moveTo(-pw * 0.36, -ph * 0.28 + i * ph * 0.19);
    g.lineTo(-pw * 0.36 + pw * rand(rng, 0.30, 0.66), -ph * 0.28 + i * ph * 0.19);
    g.stroke();
  }
  g.beginPath(); g.arc(0, -ph * 0.42, L.W * 0.006, 0, 7);
  g.fillStyle = '#8d5a44'; g.fill();
  g.restore();
}

function shelfJar(g, x, y, h, w, glass, content, seed) {
  const rng = makeRng(seed);
  g.save();
  // ガラス瓶。上ほど明るく、底に向かって暗い。
  const bg = g.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
  bg.addColorStop(0, 'rgba(30,26,22,0.75)');
  bg.addColorStop(0.3, glass);
  bg.addColorStop(0.55, '#ffffff');
  bg.addColorStop(1, 'rgba(34,28,22,0.8)');
  g.globalAlpha = 0.55;
  g.fillStyle = bg;
  g.beginPath();
  g.moveTo(x - w / 2, y);
  g.lineTo(x - w / 2, y - h * 0.82);
  g.lineTo(x - w * 0.28, y - h * 0.95);
  g.lineTo(x + w * 0.28, y - h * 0.95);
  g.lineTo(x + w / 2, y - h * 0.82);
  g.lineTo(x + w / 2, y);
  g.closePath(); g.fill();
  // 中身(下半分)
  g.globalAlpha = 0.85;
  g.fillStyle = content;
  const fh = h * rand(rng, 0.28, 0.6);
  g.fillRect(x - w / 2 + 1, y - fh, w - 2, fh - 1);
  // フタ
  g.globalAlpha = 1;
  g.fillStyle = '#8b7551';
  g.fillRect(x - w * 0.32, y - h * 1.02, w * 0.64, h * 0.09);
  // ラベル(傾き・高さがそれぞれ違う)
  g.save();
  g.translate(x, y - h * rand(rng, 0.40, 0.58));
  g.rotate(rand(rng, -0.05, 0.05));
  g.fillStyle = 'rgba(232,222,198,0.82)';
  g.fillRect(-w * 0.34, -h * 0.10, w * 0.68, h * 0.20);
  g.restore();
  g.restore();
}

function paintShelf(g, L, shelfY, scale, withItems) {
  if (shelfY <= 0) return;
  const rng = makeRng(Math.round(shelfY) + 17);
  const W = L.W;
  const th = L.H * 0.016 * scale;
  // 棚板
  g.fillStyle = '#4a3826';
  g.fillRect(-W * 0.2, shelfY, W * 1.4, th);
  g.fillStyle = 'rgba(255,224,178,0.16)';
  g.fillRect(-W * 0.2, shelfY, W * 1.4, Math.max(1, th * 0.22));
  g.fillStyle = 'rgba(0,0,0,0.30)';
  g.fillRect(-W * 0.2, shelfY + th, W * 1.4, th * 0.5);
  // 受け金具(2か所、等間隔ではない)
  g.fillStyle = '#3b2f26';
  for (const fx of [0.17, 0.74]) {
    g.beginPath();
    g.moveTo(W * fx, shelfY); g.lineTo(W * fx + th * 0.6, shelfY);
    g.lineTo(W * fx, shelfY - th * 3.4); g.closePath(); g.fill();
  }

  if (!withItems) return;
  // 棚の上のもの
  const items = ['jar', 'jar', 'dome', 'jar', 'box', 'jar', 'dome', 'jar', 'tin'];
  const contents = ['#d9c08a', '#e3e8ee', '#d9a7b4', '#c8a06a', '#cfd8dd', '#e0c15e', '#c9b39a', '#b9c8d2'];
  let x = W * 0.03;
  for (let i = 0; i < items.length; i++) {
    const kind = items[i];
    const h = L.H * rand(rng, 0.045, 0.075) * scale;
    const w = h * rand(rng, 0.5, 0.72);
    if (kind === 'jar') {
      shelfJar(g, x + w / 2, shelfY, h, w, '#cfd6d2', contents[i % contents.length], 300 + i * 13);
    } else if (kind === 'dome') {
      const r = h * 0.36;
      g.globalAlpha = 0.72;
      g.beginPath(); g.arc(x + w / 2, shelfY - r * 1.5, r, 0, 7);
      g.fillStyle = 'rgba(214,224,224,0.42)'; g.fill();
      g.strokeStyle = 'rgba(230,238,236,0.35)'; g.lineWidth = 1.2; g.stroke();
      g.beginPath(); g.arc(x + w / 2 - r * 0.3, shelfY - r * 1.8, r * 0.28, 0, 7);
      g.fillStyle = 'rgba(255,255,255,0.30)'; g.fill();
      g.globalAlpha = 1;
      g.fillStyle = '#435c49';
      g.fillRect(x + w / 2 - r * 0.9, shelfY - r * 0.62, r * 1.8, r * 0.62);
    } else if (kind === 'box') {
      g.fillStyle = '#6b543a';
      g.fillRect(x, shelfY - h * 0.7, w * 1.3, h * 0.7);
      g.fillStyle = 'rgba(255,226,180,0.14)';
      g.fillRect(x, shelfY - h * 0.7, w * 1.3, h * 0.08);
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.fillRect(x + w * 1.0, shelfY - h * 0.7, w * 0.3, h * 0.7);
    } else {
      g.fillStyle = '#7d7469';
      g.fillRect(x, shelfY - h * 0.55, w, h * 0.55);
      g.fillStyle = 'rgba(255,255,255,0.10)';
      g.fillRect(x, shelfY - h * 0.55, w * 0.25, h * 0.55);
    }
    // 影
    g.fillStyle = 'rgba(20,14,10,0.28)';
    g.fillRect(x - w * 0.1, shelfY - 1, w * 1.45, Math.max(1, th * 0.35));
    x += w * rand(rng, 1.55, 2.5);
    if (x > W * 1.02) break;
  }
}

function benchWood(g, L, view) {
  const { x0, x1, y1 } = view;
  const top = L.benchTopY, bottom = Math.max(y1, L.H) + 40;
  const rng = makeRng(77);
  const wg = g.createLinearGradient(0, top, 0, bottom);
  wg.addColorStop(0, '#7b5c3c');
  wg.addColorStop(0.30, '#8d6a44');
  wg.addColorStop(0.75, '#7a5836');
  wg.addColorStop(1, '#5d4229');
  g.fillStyle = wg;
  g.fillRect(x0 - 20, top, (x1 - x0) + 40, bottom - top);

  // 奥の隅の暗がり
  const sg = g.createLinearGradient(0, top, 0, top + L.H * 0.16);
  sg.addColorStop(0, 'rgba(24,16,10,0.55)');
  sg.addColorStop(1, 'rgba(24,16,10,0)');
  g.fillStyle = sg; g.fillRect(x0 - 20, top, (x1 - x0) + 40, L.H * 0.16);

  // 板の継ぎ目(等間隔にしない)
  let y = top + L.H * 0.075;
  while (y < bottom) {
    g.fillStyle = 'rgba(48,32,18,0.55)';
    g.fillRect(x0 - 20, y, (x1 - x0) + 40, Math.max(1, L.H * 0.0035));
    g.fillStyle = 'rgba(255,222,176,0.10)';
    g.fillRect(x0 - 20, y + L.H * 0.0035, (x1 - x0) + 40, Math.max(1, L.H * 0.002));
    y += L.H * rand(rng, 0.105, 0.155);
  }
  // 木目
  g.globalAlpha = 0.12;
  for (let i = 0; i < 190; i++) {
    const gy = rand(rng, top, bottom);
    const gx = rand(rng, x0 - 20, x1);
    const len = rand(rng, L.W * 0.05, L.W * 0.34);
    g.strokeStyle = rng() > 0.5 ? '#4a3018' : '#c49a66';
    g.lineWidth = rand(rng, 0.6, 1.8);
    g.beginPath();
    g.moveTo(gx, gy);
    g.bezierCurveTo(gx + len * 0.33, gy + rand(rng, -3, 3), gx + len * 0.66, gy + rand(rng, -3, 3), gx + len, gy);
    g.stroke();
  }
  g.globalAlpha = 1;
  // 節(2つだけ)
  for (const [nx, ny, nr] of [[L.W * 0.18, top + L.H * 0.20, L.W * 0.018], [L.W * 0.87, top + L.H * 0.30, L.W * 0.012]]) {
    g.save();
    g.translate(nx, ny); g.scale(1, 0.55);
    for (let i = 4; i >= 1; i--) {
      g.beginPath(); g.arc(0, 0, nr * i * 0.42, 0, 7);
      g.strokeStyle = `rgba(52,34,18,${0.10 + i * 0.05})`;
      g.lineWidth = nr * 0.22; g.stroke();
    }
    g.restore();
  }
}

function benchWear(g, L) {
  const rng = makeRng(2024);
  const top = L.benchTopY;
  // 濡れたコップの輪じみ(2つ、大きさも濃さも違う)
  for (const [rx, ry, rr, a] of [
    [L.W * 0.24, top + L.H * 0.115, L.W * 0.085, 0.16],
    [L.W * 0.76, top + L.H * 0.055, L.W * 0.055, 0.10],
  ]) {
    g.save(); g.translate(rx, ry); g.scale(1, 0.34);
    g.beginPath(); g.arc(0, 0, rr, 0, 7);
    g.strokeStyle = `rgba(58,38,20,${a})`; g.lineWidth = rr * 0.16; g.stroke();
    g.beginPath(); g.arc(0, 0, rr * 0.93, 0, 7);
    g.fillStyle = `rgba(60,40,22,${a * 0.35})`; g.fill();
    g.restore();
  }
  // 刃物やスプーンの傷(向きも長さもばらばら、中央右に集中)
  g.globalAlpha = 0.16;
  for (let i = 0; i < 46; i++) {
    const x = L.W * rand(rng, 0.30, 0.95), y = top + L.H * rand(rng, 0.02, 0.30);
    const a = rand(rng, -0.5, 0.5), len = rand(rng, 4, 34);
    g.strokeStyle = rng() > 0.4 ? '#3b2612' : '#d3ab74';
    g.lineWidth = rand(rng, 0.5, 1.3);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
  }
  g.globalAlpha = 1;
  // こぼれたラメと粉(1か所にまとまって散っている)
  const sx = L.W * 0.70, sy = top + L.H * 0.135;
  for (let i = 0; i < 70; i++) {
    const d = Math.pow(rng(), 0.6) * L.W * 0.11;
    const a = rng() * 6.283;
    const x = sx + Math.cos(a) * d, y = sy + Math.sin(a) * d * 0.4;
    g.globalAlpha = rand(rng, 0.25, 0.8);
    g.fillStyle = rng() > 0.35 ? '#e0bb63' : '#f4ead2';
    const s = rand(rng, 0.8, 2.2);
    g.fillRect(x, y, s, s * 0.8);
  }
  g.globalAlpha = 1;
  // インクの染み(ひとつだけ、左寄り)
  g.save(); g.translate(L.W * 0.115, top + L.H * 0.055); g.scale(1, 0.4);
  g.beginPath(); g.arc(0, 0, L.W * 0.02, 0, 7);
  g.fillStyle = 'rgba(40,32,44,0.22)'; g.fill();
  g.restore();
}

function drawFunnel(g, x, y, s) {
  // 真鍮のじょうご。使い込んで縁が黒ずんでいる。
  g.save(); g.translate(x, y);
  g.beginPath();
  g.moveTo(-s, -s * 0.9); g.lineTo(s, -s * 0.9);
  g.lineTo(s * 0.16, s * 0.12); g.lineTo(s * 0.16, s * 0.75);
  g.lineTo(-s * 0.16, s * 0.75); g.lineTo(-s * 0.16, s * 0.12);
  g.closePath();
  const bg = g.createLinearGradient(-s, 0, s, 0);
  bg.addColorStop(0, '#6d5730'); bg.addColorStop(0.35, '#c3a463');
  bg.addColorStop(0.55, '#e8d29a'); bg.addColorStop(1, '#5f4b2a');
  g.fillStyle = bg; g.fill();
  g.beginPath(); g.ellipse(0, -s * 0.9, s, s * 0.22, 0, 0, 7);
  g.fillStyle = '#d9c286'; g.fill();
  g.beginPath(); g.ellipse(0, -s * 0.9, s * 0.82, s * 0.16, 0, 0, 7);
  g.fillStyle = '#4a3a20'; g.fill();
  g.globalAlpha = 0.25; g.fillStyle = '#2e2416';
  g.beginPath(); g.ellipse(s * 0.45, -s * 0.55, s * 0.3, s * 0.18, 0.3, 0, 7); g.fill();
  g.globalAlpha = 1;
  g.fillStyle = 'rgba(20,14,8,0.35)';
  g.beginPath(); g.ellipse(0, s * 0.8, s * 0.55, s * 0.12, 0, 0, 7); g.fill();
  g.restore();
}

function drawSpoon(g, x, y, s, a) {
  g.save(); g.translate(x, y); g.rotate(a);
  g.fillStyle = 'rgba(20,14,8,0.30)';
  g.beginPath(); g.ellipse(s * 0.2, s * 0.16, s * 1.0, s * 0.16, 0, 0, 7); g.fill();
  g.strokeStyle = '#9a7b4c'; g.lineWidth = s * 0.15; g.lineCap = 'round';
  g.beginPath(); g.moveTo(-s * 0.1, 0); g.lineTo(s * 1.15, -s * 0.06); g.stroke();
  g.beginPath(); g.ellipse(-s * 0.38, 0, s * 0.36, s * 0.24, 0.1, 0, 7);
  const bg = g.createLinearGradient(-s * 0.7, -s * 0.2, 0, s * 0.2);
  bg.addColorStop(0, '#b9925c'); bg.addColorStop(0.6, '#e2c68d'); bg.addColorStop(1, '#8a6c3f');
  g.fillStyle = bg; g.fill();
  g.beginPath(); g.ellipse(-s * 0.38, 0, s * 0.26, s * 0.15, 0.1, 0, 7);
  g.fillStyle = 'rgba(60,44,24,0.35)'; g.fill();
  g.restore();
}

function drawCloth(g, x, y, w, h) {
  // たたんだ麻布。角がわずかに崩れている。
  g.save();
  g.translate(x, y); g.rotate(-0.04);
  g.fillStyle = 'rgba(20,14,8,0.30)';
  g.beginPath(); g.ellipse(0, h * 0.5, w * 0.62, h * 0.22, 0, 0, 7); g.fill();
  const cg = g.createLinearGradient(0, -h * 0.5, 0, h * 0.5);
  cg.addColorStop(0, '#b6a583'); cg.addColorStop(1, '#87775f');
  g.fillStyle = cg;
  g.beginPath();
  g.moveTo(-w * 0.5, -h * 0.42);
  g.quadraticCurveTo(0, -h * 0.58, w * 0.5, -h * 0.38);
  g.lineTo(w * 0.46, h * 0.42);
  g.quadraticCurveTo(0, h * 0.55, -w * 0.5, h * 0.36);
  g.closePath(); g.fill();
  g.strokeStyle = 'rgba(90,76,56,0.45)'; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(-w * 0.48, -h * 0.02); g.quadraticCurveTo(0, h * 0.08, w * 0.47, -h * 0.06); g.stroke();
  g.strokeStyle = 'rgba(150,72,60,0.5)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(-w * 0.36, -h * 0.46); g.lineTo(-w * 0.36, h * 0.42); g.stroke();
  g.globalAlpha = 0.10; g.fillStyle = '#5a4a34';
  g.beginPath(); g.ellipse(w * 0.2, h * 0.1, w * 0.14, h * 0.16, 0.3, 0, 7); g.fill();
  g.globalAlpha = 1;
  g.restore();
}

function paintMid(g, L, view) {
  benchWood(g, L, view);
  benchWear(g, L);
  const top = L.benchTopY;
  drawFunnel(g, L.W * 0.10, top + L.H * 0.075, L.W * 0.042);
  drawSpoon(g, L.W * 0.185, top + L.H * 0.052, L.W * 0.05, 0.30);
  drawCloth(g, L.W * 0.865, top + L.H * 0.10, L.W * 0.20, L.H * 0.055);
  // 奥に置かれた見本のドーム(小さく、少しかすんでいる)
  g.globalAlpha = 0.9;
  for (const [fx, fs] of [[0.075, 0.030], [0.925, 0.024]]) {
    const r = L.W * fs, cx = L.W * fx, cy = top + L.H * 0.028;
    g.fillStyle = 'rgba(20,14,8,0.35)';
    g.beginPath(); g.ellipse(cx, cy + r * 1.5, r * 1.3, r * 0.32, 0, 0, 7); g.fill();
    g.beginPath(); g.arc(cx, cy, r, 0, 7);
    g.fillStyle = 'rgba(206,218,216,0.30)'; g.fill();
    g.strokeStyle = 'rgba(226,236,232,0.30)'; g.lineWidth = 1.4; g.stroke();
    g.beginPath(); g.arc(cx - r * 0.32, cy - r * 0.34, r * 0.26, 0, 7);
    g.fillStyle = 'rgba(255,255,255,0.28)'; g.fill();
    g.fillStyle = '#40563f';
    g.beginPath(); g.ellipse(cx, cy + r * 0.95, r * 1.05, r * 0.3, 0, 0, 7); g.fill();
    g.fillRect(cx - r * 1.05, cy + r * 0.62, r * 2.1, r * 0.36);
  }
  g.globalAlpha = 1;
}

function paintNear(g, L, view) {
  const y = L.nearY;
  const { x0, x1 } = view;
  if (y > view.y1) return;
  // 台の前縁。手前なので暗く、わずかにぼける(半解像度で描くため)。
  const eg = g.createLinearGradient(0, y, 0, L.H + 60);
  eg.addColorStop(0, 'rgba(46,30,16,0.0)');
  eg.addColorStop(0.22, 'rgba(46,30,16,0.85)');
  eg.addColorStop(1, '#2a1c10');
  g.fillStyle = eg;
  g.fillRect(x0 - 20, y, (x1 - x0) + 40, L.H + 80 - y);
  g.fillStyle = 'rgba(255,214,160,0.10)';
  g.fillRect(x0 - 20, y + (L.H - y) * 0.20, (x1 - x0) + 40, Math.max(1, L.H * 0.004));

  // 画面のすみに写り込む道具(全体は見えない)
  const rng = makeRng(9);
  g.save();
  g.translate(x0 + (x1 - x0) * 0.08, L.H + L.H * 0.02);
  g.rotate(-0.55);
  g.strokeStyle = '#8e8577'; g.lineWidth = L.H * 0.012; g.lineCap = 'round';
  g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -L.H * 0.10); g.stroke();
  g.strokeStyle = '#7c7466';
  g.beginPath(); g.moveTo(L.H * 0.012, 0); g.lineTo(L.H * 0.006, -L.H * 0.10); g.stroke();
  g.restore();
  // 落ちた粒(手前に少しだけ)
  for (let i = 0; i < 22; i++) {
    g.globalAlpha = rand(rng, 0.2, 0.6);
    g.fillStyle = rng() > 0.5 ? '#e6c477' : '#efe4cf';
    g.fillRect(x0 + rand(rng, 0, x1 - x0), y + rand(rng, (L.H - y) * 0.15, (L.H - y) * 0.9), rand(rng, 1.5, 3.5), 2);
  }
  g.globalAlpha = 1;
}

// カメラ変換のもとで静的レイヤをキャッシュする。
// 遠景と近景は半解像度で描いてから拡大し、安いぼけを作る(過剰にはぼかさない)。
export function renderStatic(W, H, dpr, cam, L) {
  const bg = offscreen(Math.ceil(W * dpr), Math.ceil(H * dpr));
  const near = offscreen(Math.ceil(W * dpr), Math.ceil(H * dpr));
  const half = offscreen(Math.ceil(W * dpr * 0.5), Math.ceil(H * dpr * 0.5));

  const view = {
    x0: cam.x - W / 2 / cam.zoom, y0: cam.y - H / 2 / cam.zoom,
    x1: cam.x + W / 2 / cam.zoom, y1: cam.y + H / 2 / cam.zoom,
  };
  const apply = (g, scale) => {
    g.setTransform(dpr * scale * cam.zoom, 0, 0, dpr * scale * cam.zoom,
      dpr * scale * (W / 2 - cam.x * cam.zoom), dpr * scale * (H / 2 - cam.y * cam.zoom));
  };

  // 遠景(半解像度 → 拡大でやわらかく)
  let g = half.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, half.width, half.height);
  apply(g, 0.5);
  paintFar(g, L, view);
  const bgc = bg.getContext('2d');
  bgc.setTransform(1, 0, 0, 1, 0, 0);
  bgc.imageSmoothingEnabled = true;
  bgc.drawImage(half, 0, 0, bg.width, bg.height);

  // 中景(等倍でくっきり)
  apply(bgc, 1);
  paintMid(bgc, L, view);

  // 近景(半解像度)
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, half.width, half.height);
  apply(g, 0.5);
  paintNear(g, L, view);
  const nc = near.getContext('2d');
  nc.setTransform(1, 0, 0, 1, 0, 0);
  nc.clearRect(0, 0, near.width, near.height);
  nc.imageSmoothingEnabled = true;
  nc.drawImage(half, 0, 0, near.width, near.height);

  // 近景は画面下の帯だけ。全画面を貼り直さずに済むよう、上端を覚えておく。
  const nearTop = (L.nearY - cam.y) * cam.zoom + H / 2 - Math.max(24, H * 0.04);
  return { bg, near, nearTop: Math.max(0, nearTop) };
}

// 仕上げの光と周辺減光。ドームの周りだけがわずかに明るい。
let washKey = '', washGrad = null;
export function paintLightWash(ctx, W, H, focus) {
  const fx = Math.round(focus.x / 8) * 8, fy = Math.round(focus.y / 8) * 8;
  const key = `${fx}|${fy}|${W}|${H}`;
  if (key !== washKey) {
    washGrad = ctx.createRadialGradient(fx, fy, Math.min(W, H) * 0.10,
      fx, fy, Math.max(W, H) * 0.80);
    washGrad.addColorStop(0, 'rgba(255,232,190,0.06)');
    washGrad.addColorStop(0.45, 'rgba(0,0,0,0)');
    washGrad.addColorStop(1, 'rgba(18,10,4,0.42)');
    washKey = key;
  }
  ctx.fillStyle = washGrad;
  ctx.fillRect(0, 0, W, H);
}
