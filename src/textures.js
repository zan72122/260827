/**
 * textures.js
 * すべてのテクスチャを手続き的に生成する。
 * ここで作る 2D キャンバスは「材質のためのデータ」であり、
 * 画面上の見た目そのものは 100% WebGL の立体メッシュで作る。
 * (板画像で立体を偽装しない / normal map は微細な繊維感だけに使う)
 */
import * as THREE from 'three';

const cache = new Map();

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function tex(c, { repeat = 1, srgb = false, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/* ---------- ノイズ ---------- */

// 値ノイズ (格子 + 補間) 。fbm で紙の繊維・木目・インクのムラに使う。
function makeValueNoise(seed = 1) {
  const perm = new Uint8Array(512);
  let s = seed * 9301 + 49297;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  for (let i = 0; i < 256; i++) perm[i] = Math.floor(rnd() * 256);
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const fade = t => t * t * (3 - 2 * t);
  const at = (x, y) => perm[(perm[x & 255] + (y & 255)) & 511] / 255;
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = fade(xf), v = fade(yf);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
}

function fbm(noise, x, y, oct = 4, lac = 2.1, gain = 0.5) {
  let f = 1, a = 0.5, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) { sum += a * noise(x * f, y * f); norm += a; f *= lac; a *= gain; }
  return sum / norm;
}

/* ---------- ハイトマップ -> ノーマルマップ ---------- */

export function normalFromHeight(src, strength = 2.0) {
  const w = src.width, h = src.height;
  const sctx = src.getContext('2d');
  const sd = sctx.getImageData(0, 0, w, h).data;
  const out = canvas(w, h);
  const octx = out.getContext('2d');
  const od = octx.createImageData(w, h);
  const L = (x, y) => {
    const xi = (x + w) % w, yi = (y + h) % h;
    const i = (yi * w + xi) * 4;
    return (sd[i] * 0.299 + sd[i + 1] * 0.587 + sd[i + 2] * 0.114) / 255;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (L(x + 1, y) - L(x - 1, y)) * strength;
      const dy = (L(x, y + 1) - L(x, y - 1)) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * w + x) * 4;
      od.data[i] = (nx * 0.5 + 0.5) * 255;
      od.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      od.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      od.data[i + 3] = 255;
    }
  }
  octx.putImageData(od, 0, 0);
  return out;
}

/* ---------- 紙 (封筒) ---------- */

// 紙の繊維ハイト。粗さマップとノーマルマップの元になる。
function paperFiberCanvas(w, h, seed = 3) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const n1 = makeValueNoise(seed), n2 = makeValueNoise(seed + 11);
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // 縦横に伸びた繊維 + 細かい粒
      const fx = fbm(n1, x * 0.42, y * 0.035, 3);
      const fy = fbm(n2, x * 0.03, y * 0.44, 3);
      const grain = fbm(n1, x * 0.16, y * 0.16, 4);
      let v = 0.5 + (fx - 0.5) * 0.33 + (fy - 0.5) * 0.33 + (grain - 0.5) * 0.5;
      v = Math.min(1, Math.max(0, v));
      const i = (y * w + x) * 4;
      const g = v * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = g;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// 航空便封筒の表面。赤青のストライプ縁・宛名罫・PAR AVION ラベル(文字なし)。
function envelopeFaceCanvas(w = 1024, h = 512) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');

  // 下地 (わずかに温かい白)
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#f6f1e6');
  g.addColorStop(0.5, '#fbf7ee');
  g.addColorStop(1, '#f2ecdf');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

  // 繊維の色ムラ
  const fiber = paperFiberCanvas(w >> 1, h >> 1, 7);
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(fiber, 0, 0, w, h);
  ctx.restore();

  // 航空便ストライプ (斜め赤青)
  const band = Math.round(h * 0.055);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.rect(band, band, w - band * 2, h - band * 2);
  ctx.clip('evenodd');
  const step = band * 1.25;
  ctx.lineWidth = step * 0.52;
  for (let i = -h; i < w + h; i += step) {
    const isRed = Math.floor(i / step) % 2 === 0;
    ctx.strokeStyle = isRed ? 'rgba(186,44,45,0.92)' : 'rgba(35,63,140,0.92)';
    ctx.beginPath();
    ctx.moveTo(i, -10);
    ctx.lineTo(i - h - 20, h + 10);
    ctx.stroke();
  }
  ctx.restore();

  // PAR AVION 風ラベル (文字を使わない抽象ラベル)
  ctx.save();
  const lx = w * 0.055, ly = h * 0.13, lw = w * 0.16, lh = h * 0.115;
  ctx.fillStyle = 'rgba(37,74,155,0.93)';
  ctx.beginPath(); ctx.roundRect(lx, ly, lw, lh, 4); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(lx + lw * 0.1, ly + lh * (0.22 + i * 0.24), lw * (0.68 - i * 0.16), lh * 0.10);
  }
  // 小さな飛行機マーク
  ctx.translate(lx + lw * 0.82, ly + lh * 0.5);
  ctx.rotate(-0.25);
  ctx.beginPath();
  ctx.moveTo(-10, 0); ctx.lineTo(8, -2.5); ctx.lineTo(10, 0); ctx.lineTo(8, 2.5); ctx.closePath();
  ctx.moveTo(0, 0); ctx.lineTo(-4, -8); ctx.lineTo(2, -1); ctx.closePath();
  ctx.moveTo(0, 0); ctx.lineTo(-4, 8); ctx.lineTo(2, 1); ctx.closePath();
  ctx.fill();
  ctx.restore();

  // 宛名の罫 (抽象的な淡いダッシュ)
  ctx.save();
  ctx.strokeStyle = 'rgba(120,120,130,0.20)';
  ctx.lineWidth = 2.4;
  ctx.setLineDash([26, 16]);
  for (let i = 0; i < 4; i++) {
    const y = h * (0.52 + i * 0.093);
    ctx.beginPath();
    ctx.moveTo(w * 0.30, y);
    ctx.lineTo(w * (0.30 + [0.44, 0.40, 0.34, 0.24][i]), y);
    ctx.stroke();
  }
  ctx.restore();

  // 封かん部のうっすらした折り目 (下辺)
  ctx.save();
  ctx.strokeStyle = 'rgba(150,142,125,0.28)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.985); ctx.lineTo(w, h * 0.985);
  ctx.stroke();
  ctx.restore();

  return c;
}

export function envelopeMaterials() {
  if (cache.has('env')) return cache.get('env');
  const face = envelopeFaceCanvas();
  const fiber = paperFiberCanvas(512, 256, 5);
  const nrm = normalFromHeight(fiber, 1.1);

  const map = tex(face, { srgb: true, aniso: 8 });
  const normalMap = tex(nrm, { repeat: 1 });
  const roughMap = tex(fiber);

  const top = new THREE.MeshStandardMaterial({
    map, normalMap, roughnessMap: roughMap,
    normalScale: new THREE.Vector2(0.35, 0.35),
    roughness: 0.94, metalness: 0.0,
  });
  const edgeFiber = paperFiberCanvas(128, 128, 21);
  const edge = new THREE.MeshStandardMaterial({
    color: 0xeee7d8, roughness: 0.98, metalness: 0.0,
    normalMap: tex(normalFromHeight(edgeFiber, 1.6), { repeat: 3 }),
    normalScale: new THREE.Vector2(0.5, 0.5),
  });
  const back = new THREE.MeshStandardMaterial({ color: 0xf1ebdd, roughness: 0.96, metalness: 0.0 });
  const out = { top, edge, back };
  cache.set('env', out);
  return out;
}

/* ---------- 切手 ---------- */

function postageCanvas(w = 320, h = 400) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f7f2e4'; ctx.fillRect(0, 0, w, h);

  const m = w * 0.075;
  // 空
  const sky = ctx.createLinearGradient(0, m, 0, h * 0.72);
  sky.addColorStop(0, '#7fc4e8');
  sky.addColorStop(1, '#dff0f6');
  ctx.fillStyle = sky;
  ctx.fillRect(m, m, w - m * 2, h * 0.72 - m);

  // 遠くの山
  ctx.fillStyle = '#5b7fa8';
  ctx.beginPath();
  ctx.moveTo(m, h * 0.72);
  ctx.lineTo(w * 0.34, h * 0.40);
  ctx.lineTo(w * 0.52, h * 0.72);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#3f5f83';
  ctx.beginPath();
  ctx.moveTo(w * 0.40, h * 0.72);
  ctx.lineTo(w * 0.68, h * 0.34);
  ctx.lineTo(w - m, h * 0.72);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#f2f7fb';
  ctx.beginPath();
  ctx.moveTo(w * 0.60, h * 0.44);
  ctx.lineTo(w * 0.68, h * 0.34);
  ctx.lineTo(w * 0.76, h * 0.44);
  ctx.lineTo(w * 0.70, h * 0.42);
  ctx.lineTo(w * 0.66, h * 0.46);
  ctx.closePath(); ctx.fill();

  // 海
  const sea = ctx.createLinearGradient(0, h * 0.72, 0, h - m);
  sea.addColorStop(0, '#2f6ea8');
  sea.addColorStop(1, '#1b4b7a');
  ctx.fillStyle = sea;
  ctx.fillRect(m, h * 0.72, w - m * 2, h - m - h * 0.72);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 5; i++) {
    const y = h * (0.76 + i * 0.045);
    ctx.beginPath();
    ctx.moveTo(m + 8, y);
    for (let x = m + 8; x < w - m - 8; x += 10) ctx.lineTo(x, y + Math.sin(x * 0.22 + i) * 2.4);
    ctx.stroke();
  }

  // 飛行機
  ctx.save();
  ctx.translate(w * 0.34, h * 0.24);
  ctx.rotate(-0.22);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#2b3a55'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, 0, 34, 8, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(4, 0); ctx.lineTo(-10, -20); ctx.lineTo(10, -3); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(4, 0); ctx.lineTo(-10, 20); ctx.lineTo(10, 3); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();

  // 額面まわりの装飾 (文字を使わない図形)
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath(); ctx.arc(w * 0.80, h * 0.86, w * 0.10, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#b8332f'; ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = '#b8332f';
  ctx.beginPath(); ctx.arc(w * 0.80, h * 0.86, w * 0.045, 0, Math.PI * 2); ctx.fill();

  // 内枠
  ctx.strokeStyle = 'rgba(60,60,70,0.5)';
  ctx.lineWidth = 3;
  ctx.strokeRect(m * 0.55, m * 0.55, w - m * 1.1, h - m * 1.1);

  // 印刷の粒状感
  const fiber = paperFiberCanvas(w >> 1, h >> 1, 33);
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(fiber, 0, 0, w, h);
  ctx.restore();
  return c;
}

export function postageMaterials() {
  if (cache.has('postage')) return cache.get('postage');
  const face = postageCanvas();
  const fiber = paperFiberCanvas(256, 256, 13);
  const front = new THREE.MeshStandardMaterial({
    map: tex(face, { srgb: true, aniso: 8 }),
    roughness: 0.62, metalness: 0.0,
    normalMap: tex(normalFromHeight(fiber, 0.9)),
    normalScale: new THREE.Vector2(0.28, 0.28),
  });
  const side = new THREE.MeshStandardMaterial({ color: 0xf3ecdc, roughness: 0.98 });
  const out = { front, side };
  cache.set('postage', out);
  return out;
}

/* ---------- 消印のデザイン (印影 / 印面 共通) ---------- */

/**
 * kind: 'special' = 特別日付印 (小型記念印風) / 'normal' = 普通日付印 (和文日付印風)
 * mirror: 印面用 (ゴム面は左右反転)
 */
export function stampDesignCanvas(kind, { size = 256, color = '#b02c26', mirror = false } = {}) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const R = size * 0.46, cx = size / 2, cy = size / 2;
  ctx.save();
  if (mirror) { ctx.translate(size, 0); ctx.scale(-1, 1); }
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  if (kind === 'special') {
    // 外側の二重円 + 花弁状のスカラップ
    ctx.lineWidth = size * 0.030;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = size * 0.014;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.90, 0, Math.PI * 2); ctx.stroke();
    // 花弁
    const petals = 16;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2;
      const px = cx + Math.cos(a) * R * 0.955, py = cy + Math.sin(a) * R * 0.955;
      ctx.beginPath(); ctx.arc(px, py, size * 0.016, 0, Math.PI * 2); ctx.fill();
    }
    // 中央: 飛行機 + 山 + 波 (遠くへ行く手紙のモチーフ)
    ctx.save();
    ctx.translate(cx, cy * 1.03);
    ctx.lineWidth = size * 0.020;
    // 山
    ctx.beginPath();
    ctx.moveTo(-R * 0.58, R * 0.30);
    ctx.lineTo(-R * 0.16, -R * 0.16);
    ctx.lineTo(R * 0.26, R * 0.30);
    ctx.stroke();
    // 波
    for (let i = 0; i < 2; i++) {
      const y = R * (0.44 + i * 0.18);
      ctx.beginPath();
      for (let x = -R * 0.62; x <= R * 0.62; x += 3) {
        const yy = y + Math.sin(x * 0.09 + i * 1.6) * R * 0.05;
        x === -R * 0.62 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    // 飛行機
    ctx.save();
    ctx.translate(R * 0.30, -R * 0.36);
    ctx.rotate(-0.3);
    ctx.beginPath();
    ctx.ellipse(0, 0, R * 0.30, R * 0.075, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(R * 0.04, 0); ctx.lineTo(-R * 0.12, -R * 0.20); ctx.lineTo(R * 0.10, -R * 0.02); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(R * 0.04, 0); ctx.lineTo(-R * 0.12, R * 0.20); ctx.lineTo(R * 0.10, R * 0.02); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.restore();
    // 上部の日付ダッシュ
    ctx.save();
    ctx.translate(cx, cy);
    ctx.lineWidth = size * 0.026;
    for (let i = -3; i <= 3; i++) {
      const a = -Math.PI / 2 + i * 0.155;
      const r0 = R * 0.66, r1 = R * 0.78;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.stroke();
    }
    ctx.restore();
  } else {
    // 和文日付印風: 二重丸 + 中央に横三段
    ctx.lineWidth = size * 0.034;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = size * 0.016;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.86, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = size * 0.020;
    // 上下の区切り線
    for (const s of [-1, 1]) {
      const y = cy + s * R * 0.30;
      const half = Math.sqrt(Math.max(0, (R * 0.86) ** 2 - (R * 0.30) ** 2));
      ctx.beginPath(); ctx.moveTo(cx - half, y); ctx.lineTo(cx + half, y); ctx.stroke();
    }
    // 三段のブロック (局名 / 日付 / 時刻 を抽象化)
    const rows = [
      { y: -R * 0.52, n: 4, w: 0.115 },
      { y: 0, n: 5, w: 0.105 },
      { y: R * 0.52, n: 3, w: 0.115 },
    ];
    for (const row of rows) {
      const total = row.n * R * row.w * 2 + (row.n - 1) * R * 0.045;
      let x = cx - total / 2;
      for (let i = 0; i < row.n; i++) {
        const bw = R * row.w * 2, bh = R * 0.20;
        ctx.fillRect(x, cy + row.y - bh / 2, bw, bh);
        x += bw + R * 0.045;
      }
    }
  }
  ctx.restore();
  return c;
}

/** 印影テクスチャ: かすれ・濃淡・にじみ入り (アルファ付き) */
export function impressionTexture(kind, seed = 1) {
  const size = 320;
  const base = stampDesignCanvas(kind, {
    size,
    color: kind === 'special' ? '#a8251f' : '#1d2334',
  });
  const c = canvas(size, size);
  const ctx = c.getContext('2d');

  // にじみ: わずかにぼかした版を薄く敷く
  ctx.save();
  ctx.globalAlpha = 0.30;
  ctx.filter = 'blur(2.4px)';
  ctx.drawImage(base, 0, 0);
  ctx.restore();
  ctx.filter = 'none';
  ctx.drawImage(base, 0, 0);

  // 濃淡: インクの乗りムラ (押し圧の偏り)
  const n = makeValueNoise(seed * 7 + 1);
  const dens = canvas(size, size);
  const dctx = dens.getContext('2d');
  const img = dctx.createImageData(size, size);
  const ax = (Math.random() - 0.5) * 0.7, ay = (Math.random() - 0.5) * 0.7;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size - 0.5, v = y / size - 0.5;
      let m = fbm(n, x * 0.055, y * 0.055, 4);
      // 押し圧の傾き (片側が薄くなる)
      m -= (u * ax + v * ay) * 0.55;
      // 細かいかすれ
      m -= fbm(n, x * 0.42, y * 0.42, 2) * 0.16;
      const a = Math.min(1, Math.max(0, (m - 0.16) * 3.4));
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 0;
      img.data[i + 3] = (1 - a) * 235; // 抜く量
    }
  }
  dctx.putImageData(img, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.globalAlpha = 0.85;
  ctx.drawImage(dens, 0, 0);
  ctx.restore();

  const t = tex(c, { srgb: true, aniso: 8 });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** 印面 (ゴム面) の材質: 反転デザイン + インクの艶 */
export function rubberFaceMaterial(kind) {
  const size = 256;
  const design = stampDesignCanvas(kind, {
    size, mirror: true,
    color: kind === 'special' ? '#8e1c17' : '#141a2a',
  });
  const col = canvas(size, size);
  const cctx = col.getContext('2d');
  cctx.fillStyle = kind === 'special' ? '#5a3330' : '#31333c';
  cctx.fillRect(0, 0, size, size);
  cctx.drawImage(design, 0, 0);

  // インクが乗った部分は艶あり (roughness を下げる)
  const rough = canvas(size, size);
  const rctx = rough.getContext('2d');
  rctx.fillStyle = '#e8e8e8'; rctx.fillRect(0, 0, size, size);
  rctx.save();
  rctx.globalCompositeOperation = 'source-over';
  rctx.filter = 'blur(1px)';
  rctx.globalAlpha = 1;
  // デザイン部分を暗く = つるつる
  const tmp = canvas(size, size);
  const tctx = tmp.getContext('2d');
  tctx.drawImage(design, 0, 0);
  tctx.globalCompositeOperation = 'source-in';
  tctx.fillStyle = '#3a3a3a'; tctx.fillRect(0, 0, size, size);
  rctx.drawImage(tmp, 0, 0);
  rctx.restore();

  return new THREE.MeshStandardMaterial({
    map: tex(col, { srgb: true, aniso: 8 }),
    roughnessMap: tex(rough),
    // 彫刻された凹凸 (輪郭自体はメッシュで作り、ここは微細なレリーフのみ)
    normalMap: tex(normalFromHeight(col, 2.6)),
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughness: 1.0, metalness: 0.0,
  });
}

/* ---------- 木材 ---------- */

function woodCanvas(w, h, { light = '#c08a4e', dark = '#7d4f24', rings = 7, seed = 2, streak = 1 } = {}) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const n = makeValueNoise(seed);
  const img = ctx.createImageData(w, h);
  const lc = parseInt(light.slice(1), 16), dc = parseInt(dark.slice(1), 16);
  const lr = lc >> 16 & 255, lg = lc >> 8 & 255, lb = lc & 255;
  const dr = dc >> 16 & 255, dg = dc >> 8 & 255, db = dc & 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const warp = fbm(n, x * 0.012, y * 0.05, 4) * 2.2;
      const v = (y / h) * rings + warp;
      let t = Math.abs(Math.sin(v * Math.PI));
      t = Math.pow(t, 0.6);
      t = t * 0.7 + fbm(n, x * 0.6 * streak, y * 0.03, 3) * 0.3;
      const i = (y * w + x) * 4;
      img.data[i] = dr + (lr - dr) * t;
      img.data[i + 1] = dg + (lg - dg) * t;
      img.data[i + 2] = db + (lb - db) * t;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function woodMaterial(opts = {}) {
  const {
    size = 512, repeat = 1, roughness = 0.55, clear = 0,
    ...w
  } = opts;
  const c = woodCanvas(size, size, w);
  const m = new THREE.MeshStandardMaterial({
    map: tex(c, { srgb: true, repeat, aniso: 8 }),
    roughnessMap: tex(c, { repeat }),
    normalMap: tex(normalFromHeight(c, 0.7), { repeat }),
    normalScale: new THREE.Vector2(0.35, 0.35),
    roughness, metalness: 0.0,
  });
  return m;
}

/* ---------- デスク / 布 / フェルト ---------- */

export function deskMaterial() {
  if (cache.has('desk')) return cache.get('desk');
  const c = woodCanvas(512, 512, { light: '#9c6a3c', dark: '#5c3617', rings: 4, seed: 9, streak: 1.4 });
  const m = new THREE.MeshStandardMaterial({
    map: tex(c, { srgb: true, repeat: 2, aniso: 8 }),
    roughnessMap: tex(c, { repeat: 2 }),
    normalMap: tex(normalFromHeight(c, 0.8), { repeat: 2 }),
    normalScale: new THREE.Vector2(0.4, 0.4),
    roughness: 0.62, metalness: 0.0,
  });
  cache.set('desk', m);
  return m;
}

export function feltMaterial(color = 0x1f3a2b) {
  const size = 256;
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const n = makeValueNoise(41);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = fbm(n, x * 0.75, y * 0.75, 3);
      const g = 90 + v * 120;
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = g;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return new THREE.MeshStandardMaterial({
    color,
    roughnessMap: tex(c, { repeat: 3 }),
    normalMap: tex(normalFromHeight(c, 1.6), { repeat: 3 }),
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughness: 0.95, metalness: 0.0,
  });
}

/** 光の軌跡用の柔らかい丸グラデーション */
export function glowTexture(inner = 'rgba(255,240,200,1)', outer = 'rgba(255,200,120,0)') {
  const size = 128;
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.45, 'rgba(255,225,160,0.55)');
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = tex(c, { srgb: true });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
