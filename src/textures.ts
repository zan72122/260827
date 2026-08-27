import * as THREE from 'three';

// ---------------------------------------------------------------------------
// すべてのテクスチャは Canvas 2D で生成する（外部アセットなし）。
// 色マップは SRGB、bump/roughness は Linear のまま使う。
// ---------------------------------------------------------------------------

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

function toTexture(c: HTMLCanvasElement, srgb: boolean, repeat = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}

// 決定的な乱数（リロードごとに見た目が変わらないように）
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// 雪面
// ---------------------------------------------------------------------------
export function snowGroundTextures(): { map: THREE.Texture; bump: THREE.Texture } {
  const [c, ctx] = makeCanvas(512, 512);
  const rand = mulberry(11);
  // ベース: わずかに青みがかった白（発光する白にしない）
  const g = ctx.createLinearGradient(0, 0, 512, 512);
  g.addColorStop(0, '#e9eef6');
  g.addColorStop(1, '#e3e9f3');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  // 風紋・起伏の柔らかい斑
  for (let i = 0; i < 900; i++) {
    const x = rand() * 512, y = rand() * 512;
    const r = 4 + rand() * 22;
    const cool = rand() < 0.5;
    ctx.fillStyle = cool
      ? `rgba(186,200,222,${0.03 + rand() * 0.05})`
      : `rgba(255,255,255,${0.04 + rand() * 0.06})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.3 + rand() * 0.5), rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // きらめき（結晶の点）: 控えめ
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.35 + rand() * 0.4})`;
    const x = rand() * 512, y = rand() * 512;
    ctx.fillRect(x, y, 1.2, 1.2);
  }

  const [cb, cbx] = makeCanvas(256, 256);
  cbx.fillStyle = '#808080';
  cbx.fillRect(0, 0, 256, 256);
  const rb = mulberry(23);
  for (let i = 0; i < 700; i++) {
    const x = rb() * 256, y = rb() * 256;
    const r = 2 + rb() * 12;
    const v = 110 + rb() * 60;
    cbx.fillStyle = `rgba(${v},${v},${v},0.22)`;
    cbx.beginPath();
    cbx.ellipse(x, y, r, r * 0.5, rb() * Math.PI, 0, Math.PI * 2);
    cbx.fill();
  }
  return { map: toTexture(c, true, 56), bump: toTexture(cb, false, 56) };
}

// ---------------------------------------------------------------------------
// 毛皮（トナカイ個体別）
// u: 胴周り (0=背中→0.5=腹→1=背中), v: 体軸（0=首側→1=尻側）
// ---------------------------------------------------------------------------
export interface FurPalette {
  seed: number;
  back: string;      // 背の色
  side: string;      // 体側
  belly: string;     // 腹・下面（明るい）
  ruff: string;      // 首まわりの淡色
  faceBase: string;
  blaze?: string;    // 顔の模様色（なければ模様なし）
  blazeShape?: 'stripe' | 'star' | 'none';
  sockColor?: string;
}

function lerpColor(a: string, b: string, t: number): string {
  const ca = new THREE.Color(a), cb = new THREE.Color(b);
  ca.lerp(cb, t);
  return `rgb(${(ca.r * 255) | 0},${(ca.g * 255) | 0},${(ca.b * 255) | 0})`;
}

export interface FurMaps { map: THREE.Texture; bump: THREE.Texture; rough: THREE.Texture }

// 胴体用。UV: u(キャンバスx) = 胴周り (0=背 → 0.5=腹 → 1=背),
//          v(キャンバスy) = 体軸（flipY のため y=H が首側, y=0 が尻側）
export function furBodyTextures(p: FurPalette, withRuff = false): FurMaps {
  const W = 512, H = 512;
  const [c, ctx] = makeCanvas(W, H);
  const rand = mulberry(p.seed);
  for (let x = 0; x < W; x++) {
    const u = x / W;
    const dBelly = Math.abs(u - 0.5) * 2; // 0=腹, 1=背
    let col: string;
    if (dBelly > 0.72) col = p.back;
    else if (dBelly > 0.38) col = lerpColor(p.side, p.back, (dBelly - 0.38) / 0.34);
    else col = lerpColor(p.belly, p.side, dBelly / 0.38);
    ctx.fillStyle = col;
    ctx.fillRect(x, 0, 1, H);
  }
  // 首側 (v=0 → キャンバス下端) を淡いラフ色へ。
  // 均一なグラデーションだと断面リングに沿った同心円に見えるため、
  // 毛先のギザギザした縦ストロークで不規則に混ぜる。
  if (withRuff) {
    const ruffCol = new THREE.Color(p.ruff);
    const rr255 = (ruffCol.r * 255) | 0, rg255 = (ruffCol.g * 255) | 0, rb255 = (ruffCol.b * 255) | 0;
    const ruffRand = mulberry(p.seed + 3);
    for (let x = 0; x < W; x += 2) {
      const len = H * (0.30 + ruffRand() * 0.35);
      const grad = ctx.createLinearGradient(0, H, 0, H - len);
      grad.addColorStop(0, `rgba(${rr255},${rg255},${rb255},0.8)`);
      grad.addColorStop(0.6, `rgba(${rr255},${rg255},${rb255},0.45)`);
      grad.addColorStop(1, `rgba(${rr255},${rg255},${rb255},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(x, H - len, 2, len);
    }
  }
  // 毛流れストリーク（体軸方向 = キャンバス縦、腹側へ垂れる）
  for (let i = 0; i < 5200; i++) {
    const x = rand() * W, y = rand() * H;
    const len = 6 + rand() * 16;
    const light = rand() < 0.5;
    ctx.strokeStyle = light
      ? `rgba(255,250,240,${0.05 + rand() * 0.08})`
      : `rgba(40,28,18,${0.05 + rand() * 0.09})`;
    ctx.lineWidth = 0.8 + rand() * 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    // 側面では腹（x=W/2）方向へわずかに流れる
    const toward = x < W / 2 ? 1 : -1;
    const drift = (1 - Math.abs(x / W - 0.5) * 2) * 6 * toward;
    ctx.quadraticCurveTo(x + drift * 0.5, y - len * 0.5, x + drift, y - len);
    ctx.stroke();
  }

  // bump: 同じストリークを高さとして
  const [cb, cbx] = makeCanvas(256, 256);
  cbx.fillStyle = '#7a7a7a';
  cbx.fillRect(0, 0, 256, 256);
  const rb = mulberry(p.seed + 7);
  for (let i = 0; i < 3600; i++) {
    const x = rb() * 256, y = rb() * 256;
    const len = 4 + rb() * 10;
    const v = rb() < 0.5 ? 95 + rb() * 30 : 135 + rb() * 40;
    cbx.strokeStyle = `rgba(${v},${v},${v},0.5)`;
    cbx.lineWidth = 1;
    cbx.beginPath();
    cbx.moveTo(x, y);
    cbx.lineTo(x + len, y + (rb() - 0.5) * 3);
    cbx.stroke();
  }
  // roughness: 冬毛はマット。腹側はやや粗く
  const [cr, crx] = makeCanvas(128, 128);
  crx.fillStyle = '#e6e6e6';
  crx.fillRect(0, 0, 128, 128);
  const rr = mulberry(p.seed + 13);
  for (let i = 0; i < 500; i++) {
    const v = 205 + rr() * 45;
    crx.fillStyle = `rgba(${v},${v},${v},0.4)`;
    crx.fillRect(rr() * 128, rr() * 128, 3 + rr() * 8, 2 + rr() * 5);
  }
  return { map: toTexture(c, true), bump: toTexture(cb, false), rough: toTexture(cr, false) };
}

// 頭部用。UV: u(キャンバスx) = 周回（0=頭頂 → 0.5=顎下 → 1=頭頂）,
//          v(キャンバスy) = 後頭(y=H) → 鼻先(y=0)  ※flipY
export function furHeadTextures(p: FurPalette): FurMaps {
  const W = 256, H = 256;
  const [c, ctx] = makeCanvas(W, H);
  const rand = mulberry(p.seed + 31);
  for (let x = 0; x < W; x++) {
    const u = x / W;
    const dTop = Math.pow(Math.abs(u - 0.5) * 2, 1.6); // 0=顎下, 1=頭頂（明るい頬を広めに）
    const col = lerpColor(lerpColor(p.belly, p.faceBase, 0.35), p.faceBase, dTop);
    ctx.fillStyle = col;
    ctx.fillRect(x, 0, 1, H);
  }
  // 鼻先 (v=1 → キャンバス上端) は濃く、しっとり
  const noseG = ctx.createLinearGradient(0, 0, 0, H * 0.2);
  noseG.addColorStop(0, 'rgba(58,44,36,0.95)');
  noseG.addColorStop(1, 'rgba(58,44,36,0)');
  ctx.fillStyle = noseG;
  ctx.fillRect(0, 0, W, H * 0.2);
  // 顔の模様（頭頂の中心線 = キャンバス左右端）
  if (p.blaze && p.blazeShape === 'stripe') {
    const bc = new THREE.Color(p.blaze);
    ctx.fillStyle = `rgba(${(bc.r * 255) | 0},${(bc.g * 255) | 0},${(bc.b * 255) | 0},0.9)`;
    ctx.beginPath();
    ctx.ellipse(W * 0.02, H * 0.5, W * 0.06, H * 0.3, 0, 0, Math.PI * 2);
    ctx.ellipse(W * 0.98, H * 0.5, W * 0.06, H * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (p.blaze && p.blazeShape === 'star') {
    const bc = new THREE.Color(p.blaze);
    ctx.fillStyle = `rgba(${(bc.r * 255) | 0},${(bc.g * 255) | 0},${(bc.b * 255) | 0},0.85)`;
    ctx.beginPath();
    ctx.ellipse(W * 0.03, H * 0.62, W * 0.05, H * 0.10, 0, 0, Math.PI * 2);
    ctx.ellipse(W * 0.97, H * 0.62, W * 0.05, H * 0.10, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // 目の周りをわずかに濃く（側面・眼窩の位置）
  ctx.fillStyle = 'rgba(60,45,32,0.35)';
  ctx.beginPath();
  ctx.ellipse(W * 0.24, H * 0.72, W * 0.06, H * 0.06, 0, 0, Math.PI * 2);
  ctx.ellipse(W * 0.76, H * 0.72, W * 0.06, H * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();
  // 短い毛のストリーク（鼻先方向 = キャンバス上方向）
  for (let i = 0; i < 1400; i++) {
    const x = rand() * W, y = rand() * H;
    ctx.strokeStyle = rand() < 0.5 ? 'rgba(255,250,240,0.06)' : 'rgba(40,28,18,0.07)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 2, y - 3 - rand() * 5);
    ctx.stroke();
  }
  const [cb, cbx] = makeCanvas(128, 128);
  cbx.fillStyle = '#7a7a7a';
  cbx.fillRect(0, 0, 128, 128);
  const rb = mulberry(p.seed + 37);
  for (let i = 0; i < 900; i++) {
    const v = rb() < 0.5 ? 100 : 150;
    cbx.strokeStyle = `rgba(${v},${v},${v},0.45)`;
    cbx.beginPath();
    const x = rb() * 128, y = rb() * 128;
    cbx.moveTo(x, y);
    cbx.lineTo(x + 3, y + (rb() - 0.5) * 2);
    cbx.stroke();
  }
  const [cr, crx] = makeCanvas(64, 64);
  crx.fillStyle = '#e2e2e2';
  crx.fillRect(0, 0, 64, 64);
  return { map: toTexture(c, true), bump: toTexture(cb, false), rough: toTexture(cr, false) };
}

// 脚用: v=0 上部 → v=1 蹄側
export function furLegTexture(p: FurPalette): THREE.Texture {
  const W = 64, H = 128;
  const [c, ctx] = makeCanvas(W, H);
  for (let y = 0; y < H; y++) {
    const t = y / H;
    let col = lerpColor(p.side, p.back, 0.3 + t * 0.3);
    if (p.sockColor && t > 0.74) {
      col = lerpColor(col, p.sockColor, Math.min(1, (t - 0.74) / 0.12));
    }
    ctx.fillStyle = col;
    ctx.fillRect(0, y, W, 1);
  }
  const rand = mulberry(p.seed + 41);
  for (let i = 0; i < 380; i++) {
    ctx.strokeStyle = rand() < 0.5 ? 'rgba(255,250,240,0.06)' : 'rgba(40,28,18,0.08)';
    ctx.beginPath();
    const x = rand() * W, y = rand() * H;
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 2, y + 3 + rand() * 5);
    ctx.stroke();
  }
  return toTexture(c, true);
}

// 毛カード（輪郭・胸のもくもく用の透過テクスチャ）
export function furCardTexture(tint: string): THREE.Texture {
  const [c, ctx] = makeCanvas(128, 128);
  const rand = mulberry(97);
  ctx.clearRect(0, 0, 128, 128);
  const col = new THREE.Color(tint);
  const rr = (col.r * 255) | 0, gg = (col.g * 255) | 0, bb = (col.b * 255) | 0;
  // 下向きの毛束
  for (let i = 0; i < 240; i++) {
    const x = 8 + rand() * 112;
    const y0 = 10 + rand() * 30;
    const len = 40 + rand() * 60;
    const a = 0.16 + rand() * 0.3;
    const w = 1 + rand() * 2.4;
    const drift = (rand() - 0.5) * 22;
    const grad = ctx.createLinearGradient(x, y0, x + drift, y0 + len);
    grad.addColorStop(0, `rgba(${rr},${gg},${bb},${a})`);
    grad.addColorStop(1, `rgba(${rr},${gg},${bb},0)`);
    ctx.strokeStyle = grad;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.quadraticCurveTo(x + drift * 0.3, y0 + len * 0.6, x + drift, y0 + len);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------
// 革（牽引線・首輪・ハーネス）
// ---------------------------------------------------------------------------
export function leatherTextures(seed = 51): { map: THREE.Texture; bump: THREE.Texture; rough: THREE.Texture } {
  const W = 256, H = 64;
  const [c, ctx] = makeCanvas(W, H);
  const rand = mulberry(seed);
  // ベースの飴色〜焦げ茶
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#5a3a22');
  g.addColorStop(0.5, '#6b4527');
  g.addColorStop(1, '#553520');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // シボ（革の粒）
  for (let i = 0; i < 1600; i++) {
    const x = rand() * W, y = rand() * H;
    ctx.fillStyle = rand() < 0.5 ? 'rgba(30,18,10,0.12)' : 'rgba(200,150,100,0.08)';
    ctx.beginPath();
    ctx.arc(x, y, 0.6 + rand() * 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  // 曲げ癖・引張の皺（長手方向の筋）
  for (let i = 0; i < 26; i++) {
    const y = rand() * H;
    ctx.strokeStyle = `rgba(28,16,8,${0.10 + rand() * 0.12})`;
    ctx.lineWidth = 0.8 + rand();
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= W; x += 24) ctx.lineTo(x, y + (rand() - 0.5) * 4);
    ctx.stroke();
  }
  // 端の摩耗（金具付近を想定して両端を明るく擦れさせる）
  const wearL = ctx.createLinearGradient(0, 0, 36, 0);
  wearL.addColorStop(0, 'rgba(190,150,110,0.35)');
  wearL.addColorStop(1, 'rgba(190,150,110,0)');
  ctx.fillStyle = wearL;
  ctx.fillRect(0, 0, 36, H);
  const wearR = ctx.createLinearGradient(W, 0, W - 36, 0);
  wearR.addColorStop(0, 'rgba(190,150,110,0.35)');
  wearR.addColorStop(1, 'rgba(190,150,110,0)');
  ctx.fillStyle = wearR;
  ctx.fillRect(W - 36, 0, 36, H);
  // 縫い目（両縁に沿う二列のステッチ）
  ctx.strokeStyle = 'rgba(232,214,170,0.85)';
  ctx.lineWidth = 1.6;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(0, 7); ctx.lineTo(W, 7);
  ctx.moveTo(0, H - 7); ctx.lineTo(W, H - 7);
  ctx.stroke();
  ctx.setLineDash([]);

  const [cb, cbx] = makeCanvas(128, 32);
  cbx.fillStyle = '#808080';
  cbx.fillRect(0, 0, 128, 32);
  const rb = mulberry(seed + 3);
  for (let i = 0; i < 500; i++) {
    const v = rb() < 0.5 ? 105 : 150;
    cbx.fillStyle = `rgba(${v},${v},${v},0.4)`;
    cbx.fillRect(rb() * 128, rb() * 32, 1.5, 1.5);
  }
  // ステッチの盛り上がり
  cbx.fillStyle = 'rgba(190,190,190,0.9)';
  for (let x = 0; x < 128; x += 5) {
    cbx.fillRect(x, 2, 3, 2);
    cbx.fillRect(x, 28, 3, 2);
  }
  const [cr, crx] = makeCanvas(64, 16);
  crx.fillStyle = '#b0b0b0';
  crx.fillRect(0, 0, 64, 16);
  const rr2 = mulberry(seed + 5);
  for (let i = 0; i < 100; i++) {
    const v = 140 + rr2() * 70;
    crx.fillStyle = `rgba(${v},${v},${v},0.5)`;
    crx.fillRect(rr2() * 64, rr2() * 16, 3, 2);
  }
  return { map: toTexture(c, true), bump: toTexture(cb, false), rough: toTexture(cr, false) };
}

// ---------------------------------------------------------------------------
// 真鍮（鈴・金具）: 打痕と曇りのある金
// ---------------------------------------------------------------------------
export function brassTextures(seed = 71): { map: THREE.Texture; rough: THREE.Texture; bump: THREE.Texture } {
  const [c, ctx] = makeCanvas(128, 128);
  const rand = mulberry(seed);
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, '#c99f4e');
  g.addColorStop(0.5, '#b8893c');
  g.addColorStop(1, '#a1762f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  // 曇り（緑青ではなく茶系のくすみ）
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = `rgba(90,66,30,${0.08 + rand() * 0.1})`;
    ctx.beginPath();
    ctx.arc(rand() * 128, rand() * 128, 3 + rand() * 10, 0, Math.PI * 2);
    ctx.fill();
  }
  // 縁の摩耗による明るい擦れ
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(255,236,190,${0.10 + rand() * 0.16})`;
    ctx.beginPath();
    ctx.arc(rand() * 128, rand() * 128, 1 + rand() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  const [cr, crx] = makeCanvas(128, 128);
  crx.fillStyle = '#6e6e6e';
  crx.fillRect(0, 0, 128, 128);
  const rr = mulberry(seed + 1);
  for (let i = 0; i < 120; i++) {
    const v = 70 + rr() * 120;
    crx.fillStyle = `rgba(${v},${v},${v},0.5)`;
    crx.beginPath();
    crx.arc(rr() * 128, rr() * 128, 2 + rr() * 8, 0, Math.PI * 2);
    crx.fill();
  }
  const [cb, cbx] = makeCanvas(128, 128);
  cbx.fillStyle = '#808080';
  cbx.fillRect(0, 0, 128, 128);
  const rbm = mulberry(seed + 2);
  // 打痕（浅いへこみ）
  for (let i = 0; i < 26; i++) {
    const x = rbm() * 128, y = rbm() * 128, r = 2 + rbm() * 5;
    const dg = cbx.createRadialGradient(x, y, 0, x, y, r);
    dg.addColorStop(0, 'rgba(96,96,96,0.9)');
    dg.addColorStop(0.7, 'rgba(140,140,140,0.5)');
    dg.addColorStop(1, 'rgba(128,128,128,0)');
    cbx.fillStyle = dg;
    cbx.beginPath();
    cbx.arc(x, y, r, 0, Math.PI * 2);
    cbx.fill();
  }
  return { map: toTexture(c, true), rough: toTexture(cr, false), bump: toTexture(cb, false) };
}

// ---------------------------------------------------------------------------
// 木材
// ---------------------------------------------------------------------------
export function woodTextures(base: string, dark: string, seed = 91): { map: THREE.Texture; bump: THREE.Texture } {
  const [c, ctx] = makeCanvas(256, 256);
  const rand = mulberry(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  // 板目
  for (let i = 0; i < 40; i++) {
    const y = rand() * 256;
    ctx.strokeStyle = `rgba(0,0,0,${0.05 + rand() * 0.1})`;
    ctx.lineWidth = 0.8 + rand() * 1.6;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= 256; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.05 + i) * 3 + (rand() - 0.5) * 2);
    ctx.stroke();
  }
  // 節
  for (let i = 0; i < 6; i++) {
    const x = rand() * 256, y = rand() * 256;
    ctx.strokeStyle = dark;
    ctx.lineWidth = 1.4;
    for (let r = 2; r < 9; r += 2.4) {
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.5, r, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  // 板の継ぎ目
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = 2;
  for (let y = 0; y < 256; y += 64) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y);
    ctx.stroke();
  }
  const [cb, cbx] = makeCanvas(128, 128);
  cbx.fillStyle = '#808080';
  cbx.fillRect(0, 0, 128, 128);
  const rb = mulberry(seed + 1);
  for (let i = 0; i < 30; i++) {
    const y = rb() * 128;
    cbx.strokeStyle = `rgba(${100 + rb() * 60},${100 + rb() * 60},${100 + rb() * 60},0.5)`;
    cbx.beginPath();
    cbx.moveTo(0, y);
    cbx.lineTo(128, y + (rb() - 0.5) * 4);
    cbx.stroke();
  }
  return { map: toTexture(c, true, 1), bump: toTexture(cb, false, 1) };
}

// ---------------------------------------------------------------------------
// 空（縦グラデーション + 低い太陽の暖かさ）
// ---------------------------------------------------------------------------
export function skyTexture(): THREE.Texture {
  const [c, ctx] = makeCanvas(16, 512);
  const g = ctx.createLinearGradient(0, 512, 0, 0);
  g.addColorStop(0.0, '#f4e2ce');   // 地平線: 淡い暖色（低い冬の太陽）
  g.addColorStop(0.18, '#e4dcd8');
  g.addColorStop(0.42, '#c3cfdf');
  g.addColorStop(1.0, '#8fa6c4');   // 天頂: 青灰
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 遠景の針葉樹シルエット（帯状・透過）
export function treelineTexture(): THREE.Texture {
  const [c, ctx] = makeCanvas(1024, 128);
  const rand = mulberry(151);
  ctx.clearRect(0, 0, 1024, 128);
  for (let layer = 0; layer < 2; layer++) {
    const col = layer === 0 ? 'rgba(96,116,138,0.55)' : 'rgba(70,88,108,0.75)';
    ctx.fillStyle = col;
    let x = 0;
    while (x < 1024) {
      const w = 18 + rand() * 30;
      const h = (layer === 0 ? 40 : 62) + rand() * 40;
      const base = 128;
      // 三角の樹形を数段重ねる
      for (let s = 0; s < 3; s++) {
        const sw = w * (1 - s * 0.26);
        const sy = base - h * (0.3 + s * 0.3);
        ctx.beginPath();
        ctx.moveTo(x + w / 2, sy - h * 0.34);
        ctx.lineTo(x + w / 2 - sw / 2, sy);
        ctx.lineTo(x + w / 2 + sw / 2, sy);
        ctx.closePath();
        ctx.fill();
      }
      x += w * (0.5 + rand() * 0.8);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// 丸い柔らかな粒（雪・息用スプライト）
export function softParticleTexture(): THREE.Texture {
  const [c, ctx] = makeCanvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// サンタ服（赤い羅紗地）
export function clothTexture(base: string, seed = 171): THREE.Texture {
  const [c, ctx] = makeCanvas(128, 128);
  const rand = mulberry(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1800; i++) {
    ctx.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)';
    ctx.fillRect(rand() * 128, rand() * 128, 1.4, 1.4);
  }
  return toTexture(c, true, 2);
}
