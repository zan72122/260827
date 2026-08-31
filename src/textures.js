// 手続き的テクスチャ生成。外部アセットゼロで、主役（紙・ゴム・木・インク）に密度を寄せる。
import * as THREE from './three.js';

export function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function texFromCanvas(canvas, { srgb = false, repeat = null, aniso = 4, filter = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  if (!filter) { t.magFilter = THREE.NearestFilter; }
  t.needsUpdate = true;
  return t;
}

// --- 乱数（見た目の再現性のため固定シード） -----------------------------
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// --- 紙 -----------------------------------------------------------------
/** はがき・台紙の紙目。繊維の粒と極薄い斑を持たせる。 */
export function paperCanvas(size = 512, base = '#fbf5e9', warm = '#efe3cd') {
  const c = makeCanvas(size);
  const x = c.getContext('2d');
  const r = rng(7);
  x.fillStyle = base;
  x.fillRect(0, 0, size, size);

  // 大きな斑（漉きムラ）
  for (let i = 0; i < 90; i++) {
    const px = r() * size, py = r() * size, rad = 30 + r() * 130;
    const g = x.createRadialGradient(px, py, 0, px, py, rad);
    g.addColorStop(0, `rgba(196,176,146,${0.020 + r() * 0.030})`);
    g.addColorStop(1, 'rgba(196,176,146,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(px, py, rad, 0, Math.PI * 2); x.fill();
  }
  // 繊維
  x.lineWidth = 1;
  for (let i = 0; i < 1400; i++) {
    const px = r() * size, py = r() * size, a = r() * Math.PI, len = 3 + r() * 16;
    x.strokeStyle = r() > 0.5
      ? `rgba(255,255,255,${0.05 + r() * 0.10})`
      : `rgba(170,150,120,${0.03 + r() * 0.07})`;
    x.beginPath();
    x.moveTo(px, py);
    x.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len);
    x.stroke();
  }
  // 微粒
  for (let i = 0; i < 2600; i++) {
    x.fillStyle = `rgba(150,128,100,${0.02 + r() * 0.05})`;
    x.fillRect(r() * size, r() * size, 1, 1);
  }
  // 端に向かってほんのり温かい色を寄せる
  const g2 = x.createLinearGradient(0, 0, size, size);
  g2.addColorStop(0, 'rgba(255,255,255,0)');
  g2.addColorStop(1, warm);
  x.globalAlpha = 0.22;
  x.fillStyle = g2;
  x.fillRect(0, 0, size, size);
  x.globalAlpha = 1;
  return c;
}

/** 紙の粗さマップ（roughnessMap用グレースケール） */
export function paperRoughCanvas(size = 256) {
  const c = makeCanvas(size);
  const x = c.getContext('2d');
  const r = rng(21);
  x.fillStyle = '#d8d8d8';
  x.fillRect(0, 0, size, size);
  for (let i = 0; i < 5000; i++) {
    const v = 190 + Math.floor(r() * 60);
    x.fillStyle = `rgba(${v},${v},${v},${0.25 + r() * 0.5})`;
    x.fillRect(r() * size, r() * size, 1 + r() * 2, 1 + r() * 2);
  }
  return c;
}

/** 紙の凹凸（bumpMap）：ごく浅い繊維の起伏 */
export function paperBumpCanvas(size = 256) {
  const c = makeCanvas(size);
  const x = c.getContext('2d');
  const r = rng(33);
  x.fillStyle = '#808080';
  x.fillRect(0, 0, size, size);
  for (let i = 0; i < 2200; i++) {
    const px = r() * size, py = r() * size, a = r() * Math.PI, len = 4 + r() * 22;
    const v = r() > 0.5 ? 255 : 0;
    x.strokeStyle = `rgba(${v},${v},${v},${0.05 + r() * 0.09})`;
    x.lineWidth = 1 + r();
    x.beginPath(); x.moveTo(px, py);
    x.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len);
    x.stroke();
  }
  return c;
}

// --- 木 -----------------------------------------------------------------
/** 持ち手の木肌。年輪と導管。 */
export function woodCanvas(size = 512, light = '#cfa06a', dark = '#8a5a33', seed = 5) {
  const c = makeCanvas(size);
  const x = c.getContext('2d');
  const r = rng(seed);
  x.fillStyle = light;
  x.fillRect(0, 0, size, size);

  // 年輪（横縞＋ゆらぎ）
  const rings = 26 + Math.floor(r() * 10);
  for (let i = 0; i < rings; i++) {
    const y0 = (i / rings) * size + (r() - 0.5) * 8;
    const w = 2 + r() * 9;
    x.strokeStyle = dark;
    x.globalAlpha = 0.10 + r() * 0.22;
    x.lineWidth = w;
    x.beginPath();
    const amp = 4 + r() * 14, ph = r() * 10;
    x.moveTo(0, y0);
    for (let px = 0; px <= size; px += 8) {
      x.lineTo(px, y0 + Math.sin(px * 0.012 + ph) * amp + Math.sin(px * 0.05 + ph * 2) * amp * 0.25);
    }
    x.stroke();
  }
  x.globalAlpha = 1;
  // 導管
  for (let i = 0; i < 900; i++) {
    const px = r() * size, py = r() * size, len = 4 + r() * 26;
    x.strokeStyle = `rgba(70,42,22,${0.05 + r() * 0.14})`;
    x.lineWidth = 0.6 + r() * 1.2;
    x.beginPath(); x.moveTo(px, py); x.lineTo(px + len, py + (r() - 0.5) * 3); x.stroke();
  }
  // ハイライトのムラ
  for (let i = 0; i < 40; i++) {
    const px = r() * size, py = r() * size, rad = 30 + r() * 110;
    const g = x.createRadialGradient(px, py, 0, px, py, rad);
    g.addColorStop(0, `rgba(255,236,205,${0.04 + r() * 0.08})`);
    g.addColorStop(1, 'rgba(255,236,205,0)');
    x.fillStyle = g; x.beginPath(); x.arc(px, py, rad, 0, Math.PI * 2); x.fill();
  }
  return c;
}

export function woodRoughCanvas(size = 256, seed = 9) {
  const c = makeCanvas(size);
  const x = c.getContext('2d');
  const r = rng(seed);
  x.fillStyle = '#666';
  x.fillRect(0, 0, size, size);
  for (let i = 0; i < 30; i++) {
    const y0 = r() * size;
    x.strokeStyle = `rgba(${r() > 0.5 ? 255 : 40},${r() > 0.5 ? 255 : 40},${r() > 0.5 ? 255 : 40},0.10)`;
    x.lineWidth = 3 + r() * 12;
    x.beginPath(); x.moveTo(0, y0);
    for (let px = 0; px <= size; px += 10) x.lineTo(px, y0 + Math.sin(px * 0.02 + i) * 8);
    x.stroke();
  }
  for (let i = 0; i < 2500; i++) {
    const v = 70 + Math.floor(r() * 90);
    x.fillStyle = `rgba(${v},${v},${v},0.35)`;
    x.fillRect(r() * size, r() * size, 1, 1);
  }
  return c;
}

// --- ゴム印面 -----------------------------------------------------------
/** ゴムの微細な凹凸（bump用）。荒れた表面＋気泡。 */
export function rubberBumpCanvas(size = 256) {
  const c = makeCanvas(size);
  const x = c.getContext('2d');
  const r = rng(101);
  x.fillStyle = '#808080';
  x.fillRect(0, 0, size, size);
  for (let i = 0; i < 9000; i++) {
    const v = r() > 0.5 ? 255 : 0;
    x.fillStyle = `rgba(${v},${v},${v},${0.04 + r() * 0.10})`;
    x.fillRect(r() * size, r() * size, 1 + r() * 1.6, 1 + r() * 1.6);
  }
  for (let i = 0; i < 260; i++) {
    const px = r() * size, py = r() * size, rad = 1 + r() * 3.4;
    const g = x.createRadialGradient(px, py, 0, px, py, rad);
    g.addColorStop(0, 'rgba(0,0,0,0.30)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.beginPath(); x.arc(px, py, rad, 0, Math.PI * 2); x.fill();
  }
  return c;
}

// --- インクパッド布 -----------------------------------------------------
export function padClothCanvas(size = 256, hex = '#c8496a') {
  const c = makeCanvas(size);
  const x = c.getContext('2d');
  const r = rng(55);
  x.fillStyle = hex;
  x.fillRect(0, 0, size, size);
  // 織り目
  for (let i = 0; i < size; i += 3) {
    x.fillStyle = `rgba(0,0,0,${0.05 + (i % 6 === 0 ? 0.05 : 0)})`;
    x.fillRect(i, 0, 1.4, size);
    x.fillStyle = `rgba(255,255,255,${0.04 + (i % 6 === 0 ? 0.03 : 0)})`;
    x.fillRect(0, i, size, 1.4);
  }
  // 湿りのムラ（濃い部分＝インクだまり）
  for (let i = 0; i < 60; i++) {
    const px = r() * size, py = r() * size, rad = 12 + r() * 60;
    const g = x.createRadialGradient(px, py, 0, px, py, rad);
    g.addColorStop(0, `rgba(0,0,0,${0.06 + r() * 0.14})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.beginPath(); x.arc(px, py, rad, 0, Math.PI * 2); x.fill();
  }
  for (let i = 0; i < 26; i++) {
    const px = r() * size, py = r() * size, rad = 8 + r() * 34;
    const g = x.createRadialGradient(px, py, 0, px, py, rad);
    g.addColorStop(0, `rgba(255,255,255,${0.05 + r() * 0.10})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.beginPath(); x.arc(px, py, rad, 0, Math.PI * 2); x.fill();
  }
  return c;
}

/** 湿ったインク面の粗さ：低い＝てかる。だまりの部分をさらに低く。 */
export function padRoughCanvas(size = 256) {
  const c = makeCanvas(size);
  const x = c.getContext('2d');
  const r = rng(77);
  x.fillStyle = '#4a4a4a';
  x.fillRect(0, 0, size, size);
  for (let i = 0; i < 70; i++) {
    const px = r() * size, py = r() * size, rad = 10 + r() * 70;
    const g = x.createRadialGradient(px, py, 0, px, py, rad);
    g.addColorStop(0, `rgba(0,0,0,${0.25 + r() * 0.45})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.beginPath(); x.arc(px, py, rad, 0, Math.PI * 2); x.fill();
  }
  for (let i = 0; i < 3000; i++) {
    const v = 40 + Math.floor(r() * 120);
    x.fillStyle = `rgba(${v},${v},${v},0.30)`;
    x.fillRect(r() * size, r() * size, 1, 1);
  }
  return c;
}

// --- フェルト（机のマット） ---------------------------------------------
export function feltCanvas(size = 256, hex = '#2f5d4e') {
  const c = makeCanvas(size);
  const x = c.getContext('2d');
  const r = rng(13);
  x.fillStyle = hex;
  x.fillRect(0, 0, size, size);
  for (let i = 0; i < 12000; i++) {
    const v = r() > 0.5 ? 255 : 0;
    x.fillStyle = `rgba(${v},${v},${v},${0.015 + r() * 0.045})`;
    x.fillRect(r() * size, r() * size, 1 + r() * 2, 1 + r() * 2);
  }
  return c;
}

// --- かすれノイズ（印影用マスク） ---------------------------------------
/** 押しムラの素。白＝インクが乗る、黒＝かすれる。 */
export function speckleCanvas(size = 512, seed = 3) {
  const c = makeCanvas(size);
  const x = c.getContext('2d');
  const r = rng(seed);
  x.fillStyle = '#000';
  x.fillRect(0, 0, size, size);
  // 大きな抜け
  for (let i = 0; i < 46; i++) {
    const px = r() * size, py = r() * size, rad = 12 + r() * 90;
    const g = x.createRadialGradient(px, py, 0, px, py, rad);
    g.addColorStop(0, `rgba(255,255,255,${0.25 + r() * 0.55})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.beginPath(); x.arc(px, py, rad, 0, Math.PI * 2); x.fill();
  }
  // 細かい抜け
  for (let i = 0; i < 2400; i++) {
    const px = r() * size, py = r() * size, rad = 0.8 + r() * 4.5;
    x.fillStyle = `rgba(255,255,255,${0.10 + r() * 0.55})`;
    x.beginPath(); x.arc(px, py, rad, 0, Math.PI * 2); x.fill();
  }
  // 筋
  for (let i = 0; i < 130; i++) {
    const px = r() * size, py = r() * size, a = r() * Math.PI * 2, len = 10 + r() * 70;
    x.strokeStyle = `rgba(255,255,255,${0.10 + r() * 0.35})`;
    x.lineWidth = 0.7 + r() * 2.6;
    x.beginPath(); x.moveTo(px, py);
    x.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len);
    x.stroke();
  }
  return c;
}

// --- ふわっとした丸（キラキラ／ガイド用） -------------------------------
export function softDiscCanvas(size = 128, inner = 0.0, hex = '255,255,255') {
  const c = makeCanvas(size);
  const x = c.getContext('2d');
  const g = x.createRadialGradient(size / 2, size / 2, size * inner * 0.5, size / 2, size / 2, size / 2);
  g.addColorStop(0, `rgba(${hex},1)`);
  g.addColorStop(0.45, `rgba(${hex},0.45)`);
  g.addColorStop(1, `rgba(${hex},0)`);
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  return c;
}

/** 四方向のきらめき（星） */
export function sparkCanvas(size = 128) {
  const c = makeCanvas(size);
  const x = c.getContext('2d');
  const h = size / 2;
  const g = x.createRadialGradient(h, h, 0, h, h, h * 0.42);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,240,210,0.5)');
  g.addColorStop(1, 'rgba(255,230,190,0)');
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  x.save();
  x.translate(h, h);
  for (let k = 0; k < 4; k++) {
    x.rotate(Math.PI / 2);
    const lg = x.createLinearGradient(0, 0, 0, -h);
    lg.addColorStop(0, 'rgba(255,255,255,0.95)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = lg;
    x.beginPath();
    x.moveTo(0, 0); x.lineTo(-h * 0.09, -h * 0.35); x.lineTo(0, -h);
    x.lineTo(h * 0.09, -h * 0.35); x.closePath(); x.fill();
  }
  x.restore();
  return c;
}

/** 破線のガイドリング（押す場所のあたり） */
export function guideRingCanvas(size = 256) {
  const c = makeCanvas(size);
  const x = c.getContext('2d');
  const h = size / 2;
  x.strokeStyle = 'rgba(255,255,255,0.95)';
  x.lineWidth = 7;
  x.setLineDash([13, 15]);
  x.lineCap = 'round';
  x.beginPath(); x.arc(h, h, h * 0.74, 0, Math.PI * 2); x.stroke();
  x.setLineDash([]);
  x.strokeStyle = 'rgba(255,255,255,0.5)';
  x.lineWidth = 3;
  x.beginPath(); x.arc(h, h, h * 0.9, 0, Math.PI * 2); x.stroke();
  return c;
}
