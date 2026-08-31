// 印影づくり。かすれ・濃淡・にじみ・手押しのゆらぎを毎回すこしずつ変える。
import * as THREE from './three.js';
import { makeCanvas, speckleCanvas, texFromCanvas } from './textures.js';
import { makeSealMask } from './seals.js';

const IMP = 512;          // 印影テクスチャの一辺
const SEAL_R = IMP * 0.385; // 印面の外周（周囲ににじみ用の余白を残す）

const maskCache = new Map();
const speckles = [];
let work = null, work2 = null;

function ensure() {
  if (!work) { work = makeCanvas(IMP); work2 = makeCanvas(IMP); }
  if (speckles.length === 0) {
    for (let i = 0; i < 3; i++) speckles.push(speckleCanvas(512, 3 + i * 17));
  }
}

export function sealMaskFor(kind) {
  if (!maskCache.has(kind)) maskCache.set(kind, makeSealMask(kind, IMP, SEAL_R));
  return maskCache.get(kind);
}

/**
 * 1回ぶんの印影を描く。
 * inkLevel が低いほどかすれ、押し込みの傾きで濃淡が偏る。
 */
export function renderImpression(canvas, kind, rgb, inkLevel = 1, seed = Math.random()) {
  ensure();
  const mask = sealMaskFor(kind);
  const r = mulberry(seed);
  const w = work.getContext('2d');
  const o = canvas.getContext('2d');

  // 1) 手押しのゆらぎ（わずかな回転・伸び・ずれ）
  w.setTransform(1, 0, 0, 1, 0, 0);
  w.clearRect(0, 0, IMP, IMP);
  w.save();
  w.translate(IMP / 2 + (r() - 0.5) * 6, IMP / 2 + (r() - 0.5) * 6);
  w.rotate((r() - 0.5) * 0.10);
  w.scale(1 + (r() - 0.5) * 0.035, 1 + (r() - 0.5) * 0.035);
  w.transform(1, (r() - 0.5) * 0.02, (r() - 0.5) * 0.02, 1, 0, 0);
  w.drawImage(mask, -IMP / 2, -IMP / 2);
  w.restore();

  // 2) かすれ（インクが少ないほど強い）
  const dry = THREE.MathUtils.clamp(0.28 + (1 - inkLevel) * 0.50, 0, 0.74);
  w.globalCompositeOperation = 'destination-out';
  const sp = speckles[Math.floor(r() * speckles.length)];
  w.save();
  w.globalAlpha = dry;
  w.translate(IMP / 2, IMP / 2);
  w.rotate(r() * Math.PI * 2);
  const s = 1.0 + r() * 0.5;
  w.scale(s, s);
  w.drawImage(sp, -IMP / 2, -IMP / 2, IMP, IMP);
  w.restore();

  // 3) 押し込みの濃淡（片側が薄くなる）
  const ga = r() * Math.PI * 2;
  const gx = Math.cos(ga) * IMP * 0.5, gy = Math.sin(ga) * IMP * 0.5;
  const grad = w.createLinearGradient(IMP / 2 - gx, IMP / 2 - gy, IMP / 2 + gx, IMP / 2 + gy);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, `rgba(0,0,0,${0.18 + r() * 0.26})`);
  w.globalAlpha = 1;
  w.fillStyle = grad;
  w.fillRect(0, 0, IMP, IMP);
  // 中心はしっかり乗る
  const cg = w.createRadialGradient(IMP / 2, IMP / 2, 0, IMP / 2, IMP / 2, IMP * 0.5);
  cg.addColorStop(0, 'rgba(0,0,0,0)');
  cg.addColorStop(0.72, 'rgba(0,0,0,0)');
  cg.addColorStop(1, 'rgba(0,0,0,0.35)');
  w.fillStyle = cg;
  w.fillRect(0, 0, IMP, IMP);

  // 4) インクの色を入れる
  w.globalCompositeOperation = 'source-in';
  w.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  w.fillRect(0, 0, IMP, IMP);
  w.globalCompositeOperation = 'source-over';

  // 5) 紙へ：まず染み込み（ぼかした下地）、次に本体
  o.setTransform(1, 0, 0, 1, 0, 0);
  o.clearRect(0, 0, IMP, IMP);
  o.globalAlpha = 0.055 + inkLevel * 0.035;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const d = 2.4 + (i % 3) * 1.7;
    o.drawImage(work, Math.cos(a) * d, Math.sin(a) * d);
  }
  o.globalAlpha = 0.10;
  o.save();
  o.translate(IMP / 2, IMP / 2); o.scale(1.018, 1.018);
  o.drawImage(work, -IMP / 2, -IMP / 2);
  o.restore();

  o.globalAlpha = 0.78 + inkLevel * 0.17;
  o.drawImage(work, 0, 0);

  // 6) 飛沫（紙にわずかな点が散る）
  o.globalAlpha = 1;
  o.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.5)`;
  const n = 5 + Math.floor(r() * 9);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    const rad = SEAL_R * (0.98 + r() * 0.22);
    o.globalAlpha = 0.10 + r() * 0.35;
    o.beginPath();
    o.arc(IMP / 2 + Math.cos(a) * rad, IMP / 2 + Math.sin(a) * rad, 0.8 + r() * 2.6, 0, Math.PI * 2);
    o.fill();
  }
  o.globalAlpha = 1;
  return canvas;
}

export function newImpressionCanvas() {
  return makeCanvas(IMP);
}

/** 印影テクスチャの一辺（cm）＝ 印面直径 3.6cm を SEAL_R に合わせた大きさ */
export const IMPRESSION_PLANE = 3.6 * (IMP / (SEAL_R * 2));

// ---------- 印面（ゴム）のテクスチャ ----------
const DIE = 512;
const dieBumpCache = new Map();
const dieMaskCache = new Map();

function dieMask(kind, S) {
  const key = kind + '@' + S;
  if (!dieMaskCache.has(key)) dieMaskCache.set(key, makeSealMask(kind, S, S * 0.5 * 0.985));
  return dieMaskCache.get(key);
}

/** 凸部＝意匠。ぼかした山でゴムの盛り上がりを作る。 */
export function dieBumpTexture(kind) {
  if (dieBumpCache.has(kind)) return dieBumpCache.get(kind);
  const mask = dieMask(kind, DIE);
  const c = makeCanvas(DIE);
  const x = c.getContext('2d');
  x.fillStyle = '#4a4a4a';
  x.fillRect(0, 0, DIE, DIE);
  // 裾野（ぼかしを多重描画で代用）
  x.globalAlpha = 0.07;
  x.fillStyle = '#fff';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    x.save();
    x.translate(DIE / 2, DIE / 2);
    x.scale(1.012, 1.012);
    x.translate(-DIE / 2 + Math.cos(a) * 3.2, -DIE / 2 + Math.sin(a) * 3.2);
    x.drawImage(mask, 0, 0);
    x.restore();
  }
  x.globalAlpha = 1;
  x.drawImage(mask, 0, 0);
  const t = texFromCanvas(c, { aniso: 8 });
  dieBumpCache.set(kind, t);
  return t;
}

/** 印面のカラーマップ。インクの色と残量で見た目が変わる（濡れ具合の手掛かり）。 */
export function paintDieFace(canvas, kind, rgb, inkLevel) {
  const x = canvas.getContext('2d');
  const S = canvas.width;
  const mask = dieMask(kind, S);
  x.setTransform(1, 0, 0, 1, 0, 0);
  // 生ゴムの地（凹んだところ＝彫り取った部分。暗くして意匠を際立たせる）
  x.fillStyle = '#3a211d';
  x.fillRect(0, 0, S, S);
  const g = x.createRadialGradient(S * 0.38, S * 0.34, 0, S / 2, S / 2, S * 0.62);
  g.addColorStop(0, 'rgba(255,214,190,0.14)');
  g.addColorStop(1, 'rgba(10,4,3,0.40)');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  // 凸部＝残したゴム＋そこに乗ったインク
  x.save();
  x.globalCompositeOperation = 'source-over';
  const tmp = maskTint(mask, 'rgba(196,138,120,1)');
  x.drawImage(tmp, 0, 0);
  const ink = maskTint(mask, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},1)`);
  x.globalAlpha = 0.42 + 0.55 * inkLevel;
  x.drawImage(ink, 0, 0);
  x.restore();
  x.globalAlpha = 1;
  return canvas;
}

const tintCanvas = { c: null };
function maskTint(mask, color) {
  if (!tintCanvas.c) tintCanvas.c = makeCanvas(mask.width);
  const c = tintCanvas.c;
  if (c.width !== mask.width) { c.width = mask.width; c.height = mask.height; }
  const x = c.getContext('2d');
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalCompositeOperation = 'source-over';
  x.globalAlpha = 1;
  x.clearRect(0, 0, c.width, c.height);
  x.drawImage(mask, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'source-over';
  return c;
}

function mulberry(a) {
  let t = Math.floor(a * 4294967296) || 1;
  return () => {
    t |= 0; t = (t + 0x6D2B79F5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
