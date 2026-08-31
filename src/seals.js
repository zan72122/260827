// 風景印風のオリジナル意匠。線画マスク（白＝インクが乗る）として描き、
// 印面テクスチャにも印影デカールにも同じ絵を使う。
import { makeCanvas, rng } from './textures.js';

export const INKS = [
  { id: 'yama',   hex: '#2c7a55', rgb: [44, 122, 85],   name: 'やま' },
  { id: 'umi',    hex: '#1f5da8', rgb: [31, 93, 168],   name: 'うみ' },
  { id: 'sakura', hex: '#d24a78', rgb: [210, 74, 120],  name: 'さくら' },
  { id: 'hoshi',  hex: '#7748b0', rgb: [119, 72, 176],  name: 'ほし' },
];

// ---------- 描画ヘルパ ----------
function star(x, cx, cy, r, points = 5, inner = 0.42, rot = -Math.PI / 2) {
  x.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const rad = i % 2 === 0 ? r : r * inner;
    const a = rot + (i * Math.PI) / points;
    const px = cx + Math.cos(a) * rad, py = cy + Math.sin(a) * rad;
    i === 0 ? x.moveTo(px, py) : x.lineTo(px, py);
  }
  x.closePath();
}

function petal(x, cx, cy, r, a) {
  // 先が割れた桜の花びら
  const dx = Math.cos(a), dy = Math.sin(a);
  const px = cx + dx * r, py = cy + dy * r;
  const nx = -dy, ny = dx;
  x.beginPath();
  x.moveTo(cx, cy);
  x.quadraticCurveTo(cx + dx * r * 0.55 + nx * r * 0.52, cy + dy * r * 0.55 + ny * r * 0.52,
    px + nx * r * 0.14, py + ny * r * 0.14);
  x.quadraticCurveTo(px - dx * r * 0.16, py - dy * r * 0.16, px - nx * r * 0.14, py - ny * r * 0.14);
  x.quadraticCurveTo(cx + dx * r * 0.55 - nx * r * 0.52, cy + dy * r * 0.55 - ny * r * 0.52, cx, cy);
  x.closePath();
}

function blossom(x, cx, cy, r, lw) {
  for (let i = 0; i < 5; i++) {
    petal(x, cx, cy, r, -Math.PI / 2 + (i * Math.PI * 2) / 5);
    x.lineWidth = lw;
    x.stroke();
  }
  x.beginPath(); x.arc(cx, cy, r * 0.17, 0, Math.PI * 2); x.fill();
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI * 2) / 6 + 0.3;
    x.beginPath();
    x.arc(cx + Math.cos(a) * r * 0.36, cy + Math.sin(a) * r * 0.36, r * 0.055, 0, Math.PI * 2);
    x.fill();
  }
}

function dotRing(x, cx, cy, r, count, dot) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    x.beginPath();
    x.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, dot, 0, Math.PI * 2);
    x.fill();
  }
}

function hatch(x, x0, y0, x1, y1, step, lw) {
  x.lineWidth = lw;
  for (let px = x0; px < x1; px += step) {
    x.beginPath();
    x.moveTo(px, y0);
    x.lineTo(px - (y1 - y0) * 0.45, y1);
    x.stroke();
  }
}

function scallopPath(x, cx, cy, r, lobes, depth) {
  x.beginPath();
  const steps = lobes * 26;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2 - Math.PI / 2;
    const rr = r * (1 - depth + depth * Math.abs(Math.cos((a * lobes) / 2)));
    const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
    i === 0 ? x.moveTo(px, py) : x.lineTo(px, py);
  }
  x.closePath();
}

// ---------- 意匠本体 ----------
// すべて白（不透明度つき）で描く＝インクマスク。
const DESIGNS = {
  // 山と朝日：清々しい高原の風景印
  yama(x, cx, cy, R) {
    const lw = R * 0.052;
    x.strokeStyle = '#fff'; x.fillStyle = '#fff';
    x.lineCap = 'round'; x.lineJoin = 'round';
    x.lineWidth = lw; x.beginPath(); x.arc(cx, cy, R * 0.965, 0, Math.PI * 2); x.stroke();
    x.lineWidth = lw * 0.42; x.beginPath(); x.arc(cx, cy, R * 0.855, 0, Math.PI * 2); x.stroke();

    x.save();
    x.beginPath(); x.arc(cx, cy, R * 0.825, 0, Math.PI * 2); x.clip();

    // 朝日
    const sx = cx + R * 0.40, sy = cy - R * 0.40, sr = R * 0.155;
    x.beginPath(); x.arc(sx, sy, sr, 0, Math.PI * 2); x.fill();
    x.lineWidth = lw * 0.5;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      x.beginPath();
      x.moveTo(sx + Math.cos(a) * sr * 1.45, sy + Math.sin(a) * sr * 1.45);
      x.lineTo(sx + Math.cos(a) * sr * 2.0, sy + Math.sin(a) * sr * 2.0);
      x.stroke();
    }
    // 奥の峰（輪郭のみ）
    x.lineWidth = lw * 0.6;
    x.beginPath();
    x.moveTo(cx - R, cy + R * 0.12);
    x.lineTo(cx - R * 0.40, cy - R * 0.44);
    x.lineTo(cx - R * 0.06, cy - R * 0.02);
    x.lineTo(cx + R * 0.24, cy - R * 0.30);
    x.lineTo(cx + R, cy + R * 0.24);
    x.stroke();
    // 主峰（塗り＋雪）
    x.beginPath();
    x.moveTo(cx - R * 0.98, cy + R * 0.46);
    x.lineTo(cx - R * 0.30, cy - R * 0.60);
    x.lineTo(cx + R * 0.12, cy - R * 0.04);
    x.lineTo(cx + R * 0.34, cy - R * 0.26);
    x.lineTo(cx + R * 0.98, cy + R * 0.46);
    x.closePath();
    x.save(); x.clip();
    x.globalAlpha = 1;
    x.fillRect(cx - R, cy + R * 0.06, R * 2, R * 0.6); // 山の下半分をベタ
    // 稜線のハッチ
    hatch(x, cx - R * 0.9, cy - R * 0.6, cx + R * 0.4, cy + R * 0.08, R * 0.075, lw * 0.34);
    x.restore();
    x.lineWidth = lw * 0.72;
    x.beginPath();
    x.moveTo(cx - R * 0.98, cy + R * 0.46);
    x.lineTo(cx - R * 0.30, cy - R * 0.60);
    x.lineTo(cx + R * 0.12, cy - R * 0.04);
    x.lineTo(cx + R * 0.34, cy - R * 0.26);
    x.lineTo(cx + R * 0.98, cy + R * 0.46);
    x.stroke();
    // 雪冠
    x.beginPath();
    x.moveTo(cx - R * 0.30, cy - R * 0.60);
    x.lineTo(cx - R * 0.13, cy - R * 0.34);
    x.lineTo(cx - R * 0.22, cy - R * 0.28);
    x.lineTo(cx - R * 0.32, cy - R * 0.36);
    x.lineTo(cx - R * 0.42, cy - R * 0.27);
    x.lineTo(cx - R * 0.49, cy - R * 0.36);
    x.closePath(); x.fill();
    // 手前の木立
    for (let i = 0; i < 5; i++) {
      const tx = cx - R * 0.72 + i * R * 0.36 + (i % 2) * R * 0.06;
      const ty = cy + R * 0.62 + (i % 2) * R * 0.05;
      const th = R * (0.26 + (i % 3) * 0.05);
      x.beginPath();
      x.moveTo(tx, ty - th); x.lineTo(tx + th * 0.42, ty); x.lineTo(tx - th * 0.42, ty);
      x.closePath(); x.fill();
      x.lineWidth = lw * 0.4;
      x.beginPath(); x.moveTo(tx, ty); x.lineTo(tx, ty + th * 0.2); x.stroke();
    }
    // 地面の線
    x.lineWidth = lw * 0.45;
    x.beginPath(); x.moveTo(cx - R, cy + R * 0.86); x.lineTo(cx + R, cy + R * 0.80); x.stroke();
    x.restore();

    // 飾りの点
    dotRing(x, cx, cy, R * 0.905, 34, R * 0.017);
  },

  // 海と灯台：波と鴎
  umi(x, cx, cy, R) {
    const lw = R * 0.052;
    x.strokeStyle = '#fff'; x.fillStyle = '#fff';
    x.lineCap = 'round'; x.lineJoin = 'round';
    x.lineWidth = lw; x.beginPath(); x.arc(cx, cy, R * 0.965, 0, Math.PI * 2); x.stroke();
    x.lineWidth = lw * 0.34; x.beginPath(); x.arc(cx, cy, R * 0.88, 0, Math.PI * 2); x.stroke();
    x.lineWidth = lw * 0.34; x.beginPath(); x.arc(cx, cy, R * 0.845, 0, Math.PI * 2); x.stroke();

    x.save();
    x.beginPath(); x.arc(cx, cy, R * 0.82, 0, Math.PI * 2); x.clip();

    // 灯台（右）
    const bx = cx + R * 0.34, by = cy + R * 0.42, th = R * 1.02, tw = R * 0.20;
    x.beginPath();
    x.moveTo(bx - tw, by);
    x.lineTo(bx - tw * 0.60, by - th);
    x.lineTo(bx + tw * 0.60, by - th);
    x.lineTo(bx + tw, by);
    x.closePath();
    x.lineWidth = lw * 0.66; x.stroke();
    // 縞
    x.save();
    x.beginPath();
    x.moveTo(bx - tw, by); x.lineTo(bx - tw * 0.60, by - th);
    x.lineTo(bx + tw * 0.60, by - th); x.lineTo(bx + tw, by); x.closePath(); x.clip();
    for (let i = 0; i < 3; i++) {
      x.fillRect(bx - tw * 1.2, by - th * (0.24 + i * 0.30), tw * 2.4, th * 0.15);
    }
    x.restore();
    // 灯室
    x.lineWidth = lw * 0.55;
    x.strokeRect(bx - tw * 0.78, by - th * 1.20, tw * 1.56, th * 0.20);
    x.beginPath();
    x.moveTo(bx - tw * 0.92, by - th * 1.20);
    x.lineTo(bx, by - th * 1.44);
    x.lineTo(bx + tw * 0.92, by - th * 1.20);
    x.closePath(); x.fill();
    x.beginPath(); x.arc(bx, by - th * 1.10, tw * 0.30, 0, Math.PI * 2); x.fill();
    // 光
    x.lineWidth = lw * 0.42;
    for (let i = 0; i < 3; i++) {
      const a = -0.55 - i * 0.30;
      x.beginPath();
      x.moveTo(bx - tw * 1.1, by - th * 1.10);
      x.lineTo(bx - tw * 1.1 - Math.cos(a) * R * 0.62, by - th * 1.10 + Math.sin(a) * R * 0.62);
      x.stroke();
    }
    // 鴎
    x.lineWidth = lw * 0.42;
    const gulls = [[-0.52, -0.52, 0.15], [-0.20, -0.68, 0.11], [-0.66, -0.24, 0.09]];
    for (const [gx, gy, gs] of gulls) {
      const px = cx + R * gx, py = cy + R * gy, s = R * gs;
      x.beginPath();
      x.moveTo(px - s, py);
      x.quadraticCurveTo(px - s * 0.5, py - s * 0.62, px, py - s * 0.06);
      x.quadraticCurveTo(px + s * 0.5, py - s * 0.62, px + s, py);
      x.stroke();
    }
    // 岩
    x.beginPath();
    x.moveTo(cx - R * 0.98, cy + R * 0.50);
    x.lineTo(cx - R * 0.70, cy + R * 0.20);
    x.lineTo(cx - R * 0.46, cy + R * 0.44);
    x.lineTo(cx - R * 0.30, cy + R * 0.30);
    x.lineTo(cx - R * 0.12, cy + R * 0.52);
    x.closePath(); x.fill();
    // 波（下半分）
    x.lineWidth = lw * 0.5;
    for (let row = 0; row < 5; row++) {
      const y = cy + R * (0.46 + row * 0.15);
      const amp = R * (0.045 + row * 0.012);
      x.beginPath();
      for (let px = cx - R; px <= cx + R; px += R * 0.05) {
        const yy = y + Math.sin((px - cx) * (7.5 / R) + row * 1.3) * amp;
        px === cx - R ? x.moveTo(px, yy) : x.lineTo(px, yy);
      }
      x.stroke();
      if (row % 2 === 0) {
        for (let k = 0; k < 4; k++) {
          const px = cx - R * 0.8 + k * R * 0.52 + row * R * 0.1;
          x.beginPath();
          x.arc(px, y + amp * 1.5, R * 0.045, Math.PI * 0.9, Math.PI * 2.1);
          x.stroke();
        }
      }
    }
    x.restore();
    dotRing(x, cx, cy, R * 0.912, 40, R * 0.014);
  },

  // 桜：花形の縁取り
  sakura(x, cx, cy, R) {
    const lw = R * 0.05;
    x.strokeStyle = '#fff'; x.fillStyle = '#fff';
    x.lineCap = 'round'; x.lineJoin = 'round';
    x.lineWidth = lw * 1.05;
    scallopPath(x, cx, cy, R * 0.985, 10, 0.075); x.stroke();
    x.lineWidth = lw * 0.36;
    scallopPath(x, cx, cy, R * 0.875, 10, 0.075); x.stroke();

    x.save();
    scallopPath(x, cx, cy, R * 0.845, 10, 0.075); x.clip();

    // 遠景の丘
    x.lineWidth = lw * 0.5;
    x.beginPath();
    x.moveTo(cx - R, cy + R * 0.42);
    x.quadraticCurveTo(cx - R * 0.45, cy + R * 0.10, cx + R * 0.05, cy + R * 0.40);
    x.quadraticCurveTo(cx + R * 0.5, cy + R * 0.62, cx + R, cy + R * 0.34);
    x.stroke();
    x.beginPath();
    x.moveTo(cx - R, cy + R * 0.70);
    x.quadraticCurveTo(cx - R * 0.2, cy + R * 0.44, cx + R, cy + R * 0.66);
    x.lineTo(cx + R, cy + R * 1.2); x.lineTo(cx - R, cy + R * 1.2);
    x.closePath(); x.fill();

    // 幹と枝
    x.lineWidth = lw * 0.9;
    x.beginPath();
    x.moveTo(cx - R * 0.72, cy + R * 0.80);
    x.quadraticCurveTo(cx - R * 0.60, cy + R * 0.20, cx - R * 0.40, cy - R * 0.10);
    x.stroke();
    x.lineWidth = lw * 0.55;
    x.beginPath();
    x.moveTo(cx - R * 0.56, cy + R * 0.34);
    x.quadraticCurveTo(cx - R * 0.20, cy + R * 0.16, cx + R * 0.10, cy - R * 0.16);
    x.stroke();
    x.beginPath();
    x.moveTo(cx - R * 0.50, cy + R * 0.10);
    x.quadraticCurveTo(cx - R * 0.66, cy - R * 0.16, cx - R * 0.80, cy - R * 0.34);
    x.stroke();

    // 大きな花
    blossom(x, cx + R * 0.26, cy - R * 0.30, R * 0.40, lw * 0.62);
    blossom(x, cx - R * 0.34, cy - R * 0.46, R * 0.27, lw * 0.55);
    blossom(x, cx + R * 0.58, cy + R * 0.16, R * 0.22, lw * 0.5);
    blossom(x, cx - R * 0.70, cy - R * 0.02, R * 0.17, lw * 0.45);
    // 舞う花びら
    const r = rng(4);
    for (let i = 0; i < 7; i++) {
      const px = cx + (r() - 0.5) * R * 1.7;
      const py = cy + (r() - 0.5) * R * 1.6;
      x.save(); x.translate(px, py); x.rotate(r() * Math.PI * 2);
      petal(x, 0, 0, R * 0.10, 0); x.fill();
      x.restore();
    }
    x.restore();
    dotRing(x, cx, cy, R * 0.925, 30, R * 0.016);
  },

  // 星と月：夜の郵便局
  hoshi(x, cx, cy, R) {
    const lw = R * 0.052;
    x.strokeStyle = '#fff'; x.fillStyle = '#fff';
    x.lineCap = 'round'; x.lineJoin = 'round';
    x.lineWidth = lw; x.beginPath(); x.arc(cx, cy, R * 0.965, 0, Math.PI * 2); x.stroke();
    x.lineWidth = lw * 0.4; x.beginPath(); x.arc(cx, cy, R * 0.86, 0, Math.PI * 2); x.stroke();

    x.save();
    x.beginPath(); x.arc(cx, cy, R * 0.83, 0, Math.PI * 2); x.clip();

    // 三日月
    const mx = cx + R * 0.40, my = cy - R * 0.44, mr = R * 0.30;
    x.beginPath();
    x.moveTo(mx + mr, my);
    x.arc(mx, my, mr, 0, Math.PI * 2);
    const hx = mx + mr * 0.52, hy = my - mr * 0.30, hr = mr * 0.92;
    x.moveTo(hx + hr, hy);
    x.arc(hx, hy, hr, 0, Math.PI * 2);
    x.fill('evenodd');

    // 星
    const stars = [[-0.52, -0.56, 0.15], [-0.16, -0.66, 0.10], [-0.74, -0.20, 0.08],
                   [0.02, -0.30, 0.07], [-0.34, -0.24, 0.055], [0.66, -0.12, 0.075]];
    for (const [sx, sy, ss] of stars) {
      star(x, cx + R * sx, cy + R * sy, R * ss); x.fill();
    }
    x.lineWidth = lw * 0.32;
    for (let i = 0; i < 5; i++) {
      const a = i * 1.7, rr = R * (0.35 + (i % 3) * 0.18);
      const px = cx + Math.cos(a + 2) * rr, py = cy - Math.abs(Math.sin(a)) * rr * 0.8;
      x.beginPath(); x.moveTo(px - R * 0.05, py); x.lineTo(px + R * 0.05, py); x.stroke();
      x.beginPath(); x.moveTo(px, py - R * 0.05); x.lineTo(px, py + R * 0.05); x.stroke();
    }

    // 丘とちいさな町
    x.beginPath();
    x.moveTo(cx - R * 1.1, cy + R * 0.70);
    x.quadraticCurveTo(cx - R * 0.3, cy + R * 0.30, cx + R * 1.1, cy + R * 0.64);
    x.lineTo(cx + R * 1.1, cy + R * 1.2); x.lineTo(cx - R * 1.1, cy + R * 1.2);
    x.closePath(); x.fill();

    x.lineWidth = lw * 0.5;
    // 家3軒
    const houses = [[-0.56, 0.42, 0.19], [-0.16, 0.34, 0.15], [0.36, 0.40, 0.17]];
    for (const [hx, hy, hs] of houses) {
      const px = cx + R * hx, py = cy + R * hy, s = R * hs;
      x.beginPath();
      x.moveTo(px - s, py); x.lineTo(px - s, py - s * 0.9);
      x.lineTo(px, py - s * 1.6); x.lineTo(px + s, py - s * 0.9);
      x.lineTo(px + s, py); x.closePath();
      x.stroke();
      x.fillRect(px - s * 0.34, py - s * 0.62, s * 0.68, s * 0.62);
    }
    // 木
    const tx = cx + R * 0.76, ty = cy + R * 0.42;
    x.beginPath(); x.arc(tx, ty - R * 0.22, R * 0.16, 0, Math.PI * 2); x.fill();
    x.lineWidth = lw * 0.5;
    x.beginPath(); x.moveTo(tx, ty - R * 0.10); x.lineTo(tx, ty + R * 0.06); x.stroke();
    x.restore();

    dotRing(x, cx, cy, R * 0.905, 36, R * 0.015);
  },
};

// インクの色と意匠を対にする（やま=緑 / うみ=青 / さくら=桃 / ほし=紫）
export const SEAL_KINDS = ['yama', 'umi', 'sakura', 'hoshi'];

/** 白い線画マスクを生成（透明背景）。R は外周半径ピクセル。 */
export function makeSealMask(kind, size = 512, R = size * 0.39) {
  const c = makeCanvas(size);
  const x = c.getContext('2d');
  x.clearRect(0, 0, size, size);
  x.save();
  (DESIGNS[kind] || DESIGNS.yama)(x, size / 2, size / 2, R);
  x.restore();
  return c;
}

// ---------- 切手の図案 ----------
const STAMP_ART = [
  // ねこ
  (x, S) => {
    bg(x, S, '#fdeee2', '#f7d3bb');
    const cx = S * 0.5, cy = S * 0.55, r = S * 0.19;
    x.fillStyle = '#f0a35e';
    x.beginPath();
    x.moveTo(cx - r * 0.95, cy - r * 0.5); x.lineTo(cx - r * 1.15, cy - r * 1.35);
    x.lineTo(cx - r * 0.30, cy - r * 0.95); x.closePath(); x.fill();
    x.beginPath();
    x.moveTo(cx + r * 0.95, cy - r * 0.5); x.lineTo(cx + r * 1.15, cy - r * 1.35);
    x.lineTo(cx + r * 0.30, cy - r * 0.95); x.closePath(); x.fill();
    x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#6b4430';
    x.beginPath(); x.arc(cx - r * 0.36, cy - r * 0.1, r * 0.1, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.arc(cx + r * 0.36, cy - r * 0.1, r * 0.1, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#6b4430'; x.lineWidth = S * 0.012; x.lineCap = 'round';
    x.beginPath(); x.arc(cx, cy + r * 0.18, r * 0.22, 0.25 * Math.PI, 0.75 * Math.PI); x.stroke();
    x.fillStyle = '#e2748a';
    x.beginPath(); x.arc(cx, cy + r * 0.12, r * 0.09, 0, Math.PI * 2); x.fill();
    dots(x, S, '#e9b48c');
  },
  // ちょうちょ
  (x, S) => {
    bg(x, S, '#eaf3fb', '#c9e0f2');
    const cx = S * 0.5, cy = S * 0.52, r = S * 0.20;
    x.fillStyle = '#8fb8e8';
    for (const s of [-1, 1]) {
      x.beginPath();
      x.ellipse(cx + s * r * 0.62, cy - r * 0.34, r * 0.62, r * 0.48, s * 0.5, 0, Math.PI * 2);
      x.fill();
      x.beginPath();
      x.ellipse(cx + s * r * 0.52, cy + r * 0.40, r * 0.46, r * 0.36, -s * 0.4, 0, Math.PI * 2);
      x.fill();
    }
    x.fillStyle = '#f4c9d8';
    for (const s of [-1, 1]) {
      x.beginPath();
      x.ellipse(cx + s * r * 0.66, cy - r * 0.36, r * 0.30, r * 0.22, s * 0.5, 0, Math.PI * 2);
      x.fill();
    }
    x.fillStyle = '#5d6f88';
    x.beginPath(); x.ellipse(cx, cy, r * 0.13, r * 0.62, 0, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#5d6f88'; x.lineWidth = S * 0.012; x.lineCap = 'round';
    x.beginPath(); x.moveTo(cx, cy - r * 0.6);
    x.quadraticCurveTo(cx - r * 0.35, cy - r * 1.05, cx - r * 0.5, cy - r * 0.8); x.stroke();
    x.beginPath(); x.moveTo(cx, cy - r * 0.6);
    x.quadraticCurveTo(cx + r * 0.35, cy - r * 1.05, cx + r * 0.5, cy - r * 0.8); x.stroke();
    dots(x, S, '#a9c9e8');
  },
  // ふね
  (x, S) => {
    bg(x, S, '#eef7f0', '#c9e6d2');
    const cx = S * 0.5, cy = S * 0.60, r = S * 0.21;
    x.fillStyle = '#f2f6f8';
    x.beginPath();
    x.moveTo(cx, cy - r * 1.5); x.lineTo(cx, cy - r * 0.15);
    x.lineTo(cx - r * 0.85, cy - r * 0.15); x.closePath(); x.fill();
    x.fillStyle = '#eb8f8f';
    x.beginPath();
    x.moveTo(cx + r * 0.10, cy - r * 1.35); x.lineTo(cx + r * 0.10, cy - r * 0.15);
    x.lineTo(cx + r * 0.80, cy - r * 0.15); x.closePath(); x.fill();
    x.fillStyle = '#c98a54';
    x.beginPath();
    x.moveTo(cx - r * 1.05, cy - r * 0.06); x.lineTo(cx + r * 1.05, cy - r * 0.06);
    x.lineTo(cx + r * 0.72, cy + r * 0.42); x.lineTo(cx - r * 0.72, cy + r * 0.42);
    x.closePath(); x.fill();
    x.strokeStyle = '#7fb6cf'; x.lineWidth = S * 0.016; x.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const y = cy + r * (0.62 + i * 0.26);
      x.beginPath();
      for (let px = S * 0.18; px <= S * 0.82; px += S * 0.04) {
        const yy = y + Math.sin(px * 0.09 + i) * S * 0.014;
        px === S * 0.18 ? x.moveTo(px, yy) : x.lineTo(px, yy);
      }
      x.stroke();
    }
    dots(x, S, '#a5d2b6');
  },
  // おはな
  (x, S) => {
    bg(x, S, '#fdf0f6', '#f6cfe2');
    const cx = S * 0.5, cy = S * 0.53, r = S * 0.17;
    x.fillStyle = '#e885ab';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      x.beginPath();
      x.ellipse(cx + Math.cos(a) * r * 0.72, cy + Math.sin(a) * r * 0.72,
        r * 0.46, r * 0.32, a, 0, Math.PI * 2);
      x.fill();
    }
    x.fillStyle = '#f7d774';
    x.beginPath(); x.arc(cx, cy, r * 0.36, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#8cbf83'; x.lineWidth = S * 0.022; x.lineCap = 'round';
    x.beginPath(); x.moveTo(cx, cy + r * 1.1); x.lineTo(cx, cy + r * 2.2); x.stroke();
    x.fillStyle = '#8cbf83';
    x.beginPath(); x.ellipse(cx - r * 0.42, cy + r * 1.62, r * 0.38, r * 0.18, -0.5, 0, Math.PI * 2); x.fill();
    dots(x, S, '#eeaecb');
  },
];

function bg(x, S, c1, c2) {
  const g = x.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, c1); g.addColorStop(1, c2);
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  // 内枠
  x.strokeStyle = 'rgba(255,255,255,0.85)';
  x.lineWidth = S * 0.035;
  x.strokeRect(S * 0.085, S * 0.085, S * 0.83, S * 0.83);
  x.strokeStyle = 'rgba(120,95,80,0.28)';
  x.lineWidth = S * 0.010;
  x.strokeRect(S * 0.115, S * 0.115, S * 0.77, S * 0.77);
}

function dots(x, S, hex) {
  x.fillStyle = hex;
  const r = rng(19);
  for (let i = 0; i < 14; i++) {
    const px = S * (0.15 + r() * 0.7), py = S * (0.15 + r() * 0.72);
    x.globalAlpha = 0.5 + r() * 0.4;
    x.beginPath(); x.arc(px, py, S * (0.008 + r() * 0.012), 0, Math.PI * 2); x.fill();
  }
  x.globalAlpha = 1;
}

export function stampArtCanvas(index, size = 256) {
  const c = makeCanvas(size);
  const x = c.getContext('2d');
  STAMP_ART[index % STAMP_ART.length](x, size);
  return c;
}
export const STAMP_ART_COUNT = STAMP_ART.length;
