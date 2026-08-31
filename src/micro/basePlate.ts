import { mulberry32, hashSeed } from '../sim/rng';
import { E_VEC, H_BLUED, H_UNBLUED, quantile, separate, stainMatrix, type Vec3 } from './deconv';

export interface PlateProvenance {
  kind: 'photomicrograph' | 'schematic';
  title: string;
  credit: string;
  license: string;
  licenseUrl: string;
  sourceUrl: string;
  modifications: string;
  /** 実写の顕微鏡写真かどうか。false のとき UI は必ず「実写ではない」と明示する。 */
  isRealPhoto: boolean;
  note: string;
}

/**
 * 染色像の「基礎版」。
 * 各マップは **基準操作（reference）で染めたときの光学濃度成分**として持つ。
 * 実際の描画では、標本状態モデルの値を基準値で割った比を掛けて増減させる。
 *
 * 実写画像から作った場合、状態が基準値に一致すれば元画像の色調をそのまま再現する。
 * これは「元画像の色調が唯一の正解」という主張ではなく、比較の基準点として置いた取り決めである。
 */
export interface BasePlate {
  width: number;
  height: number;
  /** 核に結合したヘマトキシリン成分 */
  hNuc: Float32Array;
  /** 核外（細胞質・間質・粘液）のヘマトキシリン成分 */
  hBg: Float32Array;
  /** エオジン成分 */
  eAll: Float32Array;
  /** どちらの色素でも説明できない残差成分（散乱・非特異吸収） */
  resid: Float32Array;
  /** 組織の有無 0..1（0 = 腺腔・空白） */
  tissue: Float32Array;
  vectors: { hBlued: Vec3; hUnblued: Vec3; e: Vec3; resid: Vec3 };
  reference: { hemaN: number; hemaB: number; eosin: number };
  provenance: PlateProvenance;
}

/**
 * 基準操作（PROTOCOL.md の教材設定）で得られる標本状態の代表値。
 * test/unit/model.spec.ts がこの値と実際の基準ランの一致を検証する。
 */
export const REFERENCE_STATE = { hemaN: 0.906, hemaB: 0.176, eosin: 0.748 } as const;

/**
 * 模式図の表示に使う染色ベクトル。[教材係数]
 * 分離（separate）には [S8] と同じ Ruifrok の行列を使うが、
 * 実写画像が無い模式図では、H&E 標本の見え方に合う表示用ベクトルを用いる。
 * 実写画像から作る場合は分離に使った行列をそのまま再合成に使うので、この値は使わない。
 */
export const DISPLAY_E: Vec3 = normalize([0.164, 0.812, 0.560]);
export const DISPLAY_RESID: Vec3 = normalize([0.577, 0.577, 0.577]);

function normalize(v: Vec3): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

// ---------------------------------------------------------------------------
// 1) 実写画像から作る経路
// ---------------------------------------------------------------------------

/**
 * 実写の H&E 画像を色分離して基礎版にする。
 * **元画像に無い細胞構造は作らない**: 核・核外・残差はすべて H/E 濃度から導く。
 */
export function plateFromPhotomicrograph(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  provenance: PlateProvenance,
): BasePlate {
  const sep = separate(data, width, height);
  const m = stainMatrix();
  const n = width * height;

  const hHi = Math.max(1e-3, quantile(sep.h, 0.995));
  const eHi = Math.max(1e-3, quantile(sep.e, 0.995));

  const hNuc = new Float32Array(n);
  const hBg = new Float32Array(n);
  const eAll = new Float32Array(n);
  const resid = new Float32Array(n);
  const tissue = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const h = Math.max(0, sep.h[i]);
    const e = Math.max(0, sep.e[i]);
    // 核マスク: ヘマトキシリンが強くエオジンが相対的に弱い画素（元画像の情報だけから決める）
    const hn = h / hHi;
    const en = e / eHi;
    const mask = smoothstep(0.28, 0.62, hn - 0.45 * en);
    hNuc[i] = h * mask;
    hBg[i] = h * (1 - mask);
    eAll[i] = e;
    resid[i] = sep.residual[i];
    tissue[i] = clamp01(Math.max(hn, en) * 1.6);
  }

  return {
    width,
    height,
    hNuc,
    hBg,
    eAll,
    resid,
    tissue,
    vectors: {
      hBlued: H_BLUED,
      hUnblued: H_UNBLUED,
      e: E_VEC,
      resid: [m[2][0], m[2][1], m[2][2]],
    },
    reference: { ...REFERENCE_STATE },
    provenance,
  };
}

// ---------------------------------------------------------------------------
// 2) 実写画像を取得できない場合の代替（構造模式図）
// ---------------------------------------------------------------------------

export const SCHEMATIC_PROVENANCE: PlateProvenance = {
  kind: 'schematic',
  title: '正常大腸粘膜の構造模式図（手続き生成）',
  credit: '本プロジェクトによる自作',
  license: 'MIT（本リポジトリのコードと同じ）',
  licenseUrl: '',
  sourceUrl: '',
  modifications: '陰窩の断面・基底側の上皮核・杯細胞の粘液腔・粘膜固有層を手続き的に配置したもの',
  isRealPhoto: false,
  note:
    '実写の顕微鏡写真ではありません。基準にする実写画像（Wikimedia Commons: Colon, high mag. / CoRus13 / CC BY-SA 4.0）を ' +
    'この実行環境のネットワーク制限により取得できなかったため、構造の位置関係だけを示す模式図で代替しています。' +
    'npm run fetch-assets で実写画像を取得できた場合は、そちらが自動的に使われます。',
};

/**
 * 正常大腸粘膜の構造模式図を手続き生成する（実写の代替）。
 * 陰窩の断面、基底側に並ぶ上皮核、杯細胞の粘液腔、粘膜固有層の配置を示す。
 * これは実写組織像ではない。
 */
export function proceduralColonSchematic(width = 900, height = 675, seed = 'colon'): BasePlate {
  const rnd = mulberry32(hashSeed(seed));
  const n = width * height;
  const nuc = new Float32Array(n);
  const cyt = new Float32Array(n);
  const muc = new Float32Array(n);
  const tissue = new Float32Array(n);

  const coarse = valueNoise(width, height, 110, rnd);
  const fine = valueNoise(width, height, 9, rnd);

  // --- 粘膜固有層（間質）の下地
  for (let i = 0; i < n; i++) {
    tissue[i] = 1;
    cyt[i] = 0.26 + coarse[i] * 0.10 + fine[i] * 0.05;
  }

  // --- 陰窩（腺管）の断面を千鳥配置。画面端で切れるものも作る。
  const sx = 285;
  const sy = 255;
  interface Crypt { x: number; y: number; rl: number; ro: number; ecc: number; rot: number }
  const crypts: Crypt[] = [];
  for (let gy = -1; ; gy++) {
    const cy = 40 + gy * sy;
    if (cy > height + 110) break;
    for (let gx = -1; ; gx++) {
      const cx = 60 + gx * sx + (((gy % 2) + 2) % 2 ? sx / 2 : 0);
      if (cx > width + 110) break;
      const rl = 38 + rnd() * 11;
      crypts.push({
        x: cx + (rnd() - 0.5) * 40,
        y: cy + (rnd() - 0.5) * 36,
        rl,
        ro: rl + 55 + rnd() * 12,
        ecc: 0.86 + rnd() * 0.24,
        rot: rnd() * Math.PI,
      });
    }
  }

  /** 陰窩中心からの正規化距離（わずかに楕円）。 */
  const cryptDist = (c: Crypt, x: number, y: number): number => {
    const dx = x - c.x;
    const dy = y - c.y;
    const ca = Math.cos(c.rot);
    const sa = Math.sin(c.rot);
    const u = (dx * ca + dy * sa) / c.ecc;
    const v = (-dx * sa + dy * ca) * c.ecc;
    return Math.hypot(u, v);
  };

  for (const c of crypts) {
    const R = c.ro * 1.25 + 8;
    const x0 = Math.max(0, Math.floor(c.x - R));
    const x1 = Math.min(width - 1, Math.ceil(c.x + R));
    const y0 = Math.max(0, Math.floor(c.y - R));
    const y1 = Math.min(height - 1, Math.ceil(c.y + R));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = cryptDist(c, x, y);
        const i = y * width + x;
        if (d < c.rl) {
          tissue[i] = 0;
          cyt[i] = 0;
          muc[i] = 0;
          nuc[i] = 0;
        } else if (d < c.ro) {
          const t = (d - c.rl) / (c.ro - c.rl);
          tissue[i] = 1;
          cyt[i] = 0.34 + 0.16 * t + fine[i] * 0.06;
        } else if (d < c.ro + 3.5) {
          cyt[i] = Math.max(cyt[i], 0.5);
        }
      }
    }
    // 基底側に並ぶ上皮核（放射方向に長い楕円）
    const rn = c.ro - 17;
    const count = Math.max(14, Math.round((2 * Math.PI * rn) / 26));
    const a0 = rnd() * Math.PI * 2;
    for (let k = 0; k < count; k++) {
      const a = a0 + (k / count) * Math.PI * 2 + (rnd() - 0.5) * 0.10;
      const ca = Math.cos(c.rot);
      const sa = Math.sin(c.rot);
      const ux = Math.cos(a) * rn * c.ecc;
      const uy = (Math.sin(a) * rn) / c.ecc;
      ellipseMax(
        nuc, width, height,
        c.x + ux * ca - uy * sa,
        c.y + ux * sa + uy * ca,
        11.5 + rnd() * 3, 6.2 + rnd() * 1.6, a + c.rot,
        0.80 + rnd() * 0.15, fine,
      );
    }
    // 杯細胞の粘液腔（核より内腔側、角度位置の一部だけ）
    const rg = c.rl + (c.ro - c.rl) * 0.30;
    const gcount = Math.max(9, Math.round((2 * Math.PI * rg) / 29));
    for (let k = 0; k < gcount; k++) {
      if (rnd() > 0.60) continue;
      const a = a0 + (k / gcount) * Math.PI * 2 + (rnd() - 0.5) * 0.16;
      const ca = Math.cos(c.rot);
      const sa = Math.sin(c.rot);
      const ux = Math.cos(a) * rg * c.ecc;
      const uy = (Math.sin(a) * rg) / c.ecc;
      ellipseMax(
        muc, width, height,
        c.x + ux * ca - uy * sa,
        c.y + ux * sa + uy * ca,
        14 + rnd() * 4, 10 + rnd() * 3, a + c.rot, 0.92, fine,
      );
    }
  }

  // --- 粘膜固有層の細胞核（リンパ球・形質細胞・線維芽細胞）
  for (let k = 0; k < 1100; k++) {
    const x = rnd() * width;
    const y = rnd() * height;
    let inside = false;
    for (const c of crypts) {
      if (cryptDist(c, x, y) < c.ro + 5) {
        inside = true;
        break;
      }
    }
    if (inside) continue;
    const small = rnd() < 0.55;
    ellipseMax(
      nuc,
      width,
      height,
      x,
      y,
      small ? 4.4 + rnd() * 1.3 : 7.0 + rnd() * 2.6,
      small ? 4.1 + rnd() * 1.1 : 3.5 + rnd() * 1.3,
      rnd() * Math.PI,
      small ? 0.9 : 0.6,
      fine,
    );
  }

  // --- 毛細血管の内腔
  for (let k = 0; k < 46; k++) {
    const x = rnd() * width;
    const y = rnd() * height;
    let inside = false;
    for (const c of crypts) if (cryptDist(c, x, y) < c.ro + 9) inside = true;
    if (inside) continue;
    const a = rnd() * Math.PI;
    ellipseSet(tissue, width, height, x, y, 8 + rnd() * 5, 3.2 + rnd() * 2, a, 0.05);
    ellipseSet(cyt, width, height, x, y, 8 + rnd() * 5, 3.2 + rnd() * 2, a, 0.04);
    ellipseSet(muc, width, height, x, y, 8 + rnd() * 5, 3.2 + rnd() * 2, a, 0);
  }

  // --- 濃度成分へ変換
  const hNuc = new Float32Array(n);
  const hBg = new Float32Array(n);
  const eAll = new Float32Array(n);
  const resid = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = tissue[i];
    const m = clamp01(muc[i]);
    // 粘液腔は細胞質を置き換える（すべてを均一なピンクで塗り潰さない）
    const c = clamp01(cyt[i]) * (1 - 0.72 * m);
    const nu = clamp01(nuc[i]) * (1 - 0.75 * m);
    if (t < 0.06) {
      continue;
    }
    hNuc[i] = nu * 1.05;
    hBg[i] = c * 0.10 + m * 0.075;
    eAll[i] = c * 0.50 + m * 0.03;
    resid[i] = t * 0.05;
  }

  return {
    width,
    height,
    hNuc,
    hBg,
    eAll,
    resid,
    tissue,
    vectors: { hBlued: H_BLUED, hUnblued: H_UNBLUED, e: DISPLAY_E, resid: DISPLAY_RESID },
    reference: { ...REFERENCE_STATE },
    provenance: SCHEMATIC_PROVENANCE,
  };
}

// ---------------------------------------------------------------------------

function ellipseMax(
  target: Float32Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  ra: number,
  rb: number,
  ang: number,
  value: number,
  fine: Float32Array,
): void {
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const R = Math.max(ra, rb) + 2;
  for (let y = Math.max(0, Math.floor(cy - R)); y <= Math.min(h - 1, Math.ceil(cy + R)); y++) {
    for (let x = Math.max(0, Math.floor(cx - R)); x <= Math.min(w - 1, Math.ceil(cx + R)); x++) {
      const dx = x - cx;
      const dy = y - cy;
      const u = (dx * ca + dy * sa) / ra;
      const v = (-dx * sa + dy * ca) / rb;
      const d = u * u + v * v;
      if (d > 1.3) continue;
      const edge = 1 - smoothstep(0.7, 1.14, d);
      const i = y * w + x;
      target[i] = Math.max(target[i], value * edge * (0.84 + fine[i] * 0.32));
    }
  }
}

function ellipseSet(target: Float32Array, w: number, h: number, cx: number, cy: number, ra: number, rb: number, ang: number, value: number): void {
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const R = Math.max(ra, rb) + 2;
  for (let y = Math.max(0, Math.floor(cy - R)); y <= Math.min(h - 1, Math.ceil(cy + R)); y++) {
    for (let x = Math.max(0, Math.floor(cx - R)); x <= Math.min(w - 1, Math.ceil(cx + R)); x++) {
      const dx = x - cx;
      const dy = y - cy;
      const u = (dx * ca + dy * sa) / ra;
      const v = (-dx * sa + dy * ca) / rb;
      if (u * u + v * v > 1) continue;
      target[y * w + x] = value;
    }
  }
}

function valueNoise(w: number, h: number, cell: number, rnd: () => number): Float32Array {
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const g = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = y / cell;
    const y0 = Math.floor(fy);
    const ty = sm(fy - y0);
    for (let x = 0; x < w; x++) {
      const fx = x / cell;
      const x0 = Math.floor(fx);
      const tx = sm(fx - x0);
      out[y * w + x] = lerp(
        lerp(g[y0 * gw + x0], g[y0 * gw + x0 + 1], tx),
        lerp(g[(y0 + 1) * gw + x0], g[(y0 + 1) * gw + x0 + 1], tx),
        ty,
      );
    }
  }
  return out;
}

const sm = (t: number): number => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
