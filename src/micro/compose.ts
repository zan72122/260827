import type { BasePlate } from './basePlate';
import type { MicroFields } from './fields';
import { mulberry32, hashSeed } from '../sim/rng';

/**
 * 状態モデル → 完成画像。
 *
 * 方針:
 *  - 核成分と非核成分を「光学濃度の重ね合わせ」として独立に増減させる（[S8] の考え方）。
 *  - 気泡・未充填・曇りは組織そのものを書き換えず、光学的な観察妨害として上に重ねる。
 *  - RGB 全体への色相回転や彩度操作は使わない。照明演出・カラーグレーディングも行わない。
 */
export interface ComposeOptions {
  /** 観察妨害（曇り・気泡・未充填・乾燥）を重ねるか */
  obstructions: boolean;
  /** 乾燥むらなど、決定的なテクスチャに使う seed */
  seed: string;
}

export const DEFAULT_COMPOSE: ComposeOptions = {
  obstructions: true,
  seed: 'view',
};

/** DOM に依存しないラスタ画像（テストでもそのまま扱える）。 */
export interface RasterImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export function compose(plate: BasePlate, fields: MicroFields, opt: Partial<ComposeOptions> = {}): RasterImage {
  const o = { ...DEFAULT_COMPOSE, ...opt };
  const { width: W, height: H } = plate;
  const out = new Uint8ClampedArray(W * H * 4);
  const rnd = mulberry32(hashSeed(o.seed));
  const mottle = noiseField(W, H, 26, rnd);
  const V = plate.vectors;
  const ref = plate.reference;

  // 画像の上下は、ラックに挿したときのスライドの上下に合わせる（教材上の取り決め）。
  // グリッド行 0 = 切片の下端 = 画像の下端。
  for (let y = 0; y < H; y++) {
    const gy = ((H - 1 - y) / H) * fields.gh - 0.5;
    for (let x = 0; x < W; x++) {
      const gx = (x / W) * fields.gw - 0.5;
      const i = y * W + x;
      const j = i * 4;

      if (plate.tissue[i] < 0.06 && plate.hNuc[i] + plate.eAll[i] < 1e-4) {
        out[j] = 255;
        out[j + 1] = 255;
        out[j + 2] = 255;
        out[j + 3] = 255;
        continue;
      }

      const hemaN = sample(fields.hemaN, fields.gw, fields.gh, gx, gy);
      const hemaB = sample(fields.hemaB, fields.gw, fields.gh, gx, gy);
      const blue = sample(fields.blue, fields.gw, fields.gh, gx, gy);
      const eos = sample(fields.eosin, fields.gw, fields.gh, gx, gy);
      const par = sample(fields.paraffin, fields.gw, fields.gh, gx, gy);
      const dried = sample(fields.dried, fields.gw, fields.gh, gx, gy);

      // 色出しは色素量ではなく色調を変える（[S2] の記述に沿う方向）
      const hR = V.hUnblued[0] + (V.hBlued[0] - V.hUnblued[0]) * blue;
      const hG = V.hUnblued[1] + (V.hBlued[1] - V.hUnblued[1]) * blue;
      const hB = V.hUnblued[2] + (V.hBlued[2] - V.hUnblued[2]) * blue;

      // 乾燥した部位は色素が濃縮して見え、むらが出る（教材上の近似）
      const dryBoost = 1 + 0.7 * dried * (0.6 + 0.8 * mottle[i]);

      const cH = (plate.hNuc[i] * (hemaN / ref.hemaN) + plate.hBg[i] * (hemaB / ref.hemaB)) * dryBoost;
      const cE = plate.eAll[i] * (eos / ref.eosin) * dryBoost;
      const cR = plate.resid[i];

      let odR = hR * cH + V.e[0] * cE + V.resid[0] * cR;
      let odG = hG * cH + V.e[1] * cE + V.resid[1] * cR;
      let odB = hB * cH + V.e[2] * cE + V.resid[2] * cR;

      // 残存パラフィンは色素の乗りを妨げ、屈折して見える
      if (par > 0.02) {
        const k = 1 - 0.55 * par;
        odR = odR * k + 0.045 * par;
        odG = odG * k + 0.050 * par;
        odB = odB * k + 0.075 * par;
      }

      out[j] = 255 * Math.pow(10, -Math.max(0, odR));
      out[j + 1] = 255 * Math.pow(10, -Math.max(0, odG));
      out[j + 2] = 255 * Math.pow(10, -Math.max(0, odB));
      out[j + 3] = 255;
    }
  }

  if (o.obstructions) applyObstructions(out, plate, fields, mottle);
  return { data: out, width: W, height: H };
}

function applyObstructions(out: Uint8ClampedArray, plate: BasePlate, f: MicroFields, mottle: Float32Array): void {
  const W = plate.width;
  const H = plate.height;

  // --- 曇り（残留水分・透徹不良）: ぼけと乳白色のベールを重ねる
  let maxHaze = 0;
  for (let i = 0; i < f.haze.length; i++) maxHaze = Math.max(maxHaze, f.haze[i]);
  if (maxHaze > 0.03) {
    const blurred = boxBlur(out, W, H, 4);
    for (let y = 0; y < H; y++) {
      const gy = ((H - 1 - y) / H) * f.gh - 0.5;
      for (let x = 0; x < W; x++) {
        const gx = (x / W) * f.gw - 0.5;
        const hz = Math.min(1, sample(f.haze, f.gw, f.gh, gx, gy));
        if (hz < 0.02) continue;
        const j = (y * W + x) * 4;
        const b = Math.min(0.85, hz);
        for (let c = 0; c < 3; c++) {
          const v = out[j + c] + (blurred[j + c] - out[j + c]) * b;
          out[j + c] = v + (243 - v) * 0.42 * hz;
        }
      }
    }
  }

  // --- 未充填（封入剤が届かない乾いた面）: 屈折が強くコントラストが立ち、わずかに黄褐色
  for (let y = 0; y < H; y++) {
    const gy = ((H - 1 - y) / H) * f.gh - 0.5;
    for (let x = 0; x < W; x++) {
      const gx = (x / W) * f.gw - 0.5;
      const uf = sample(f.unfilled, f.gw, f.gh, gx, gy);
      if (uf < 0.02) continue;
      const j = (y * W + x) * 4;
      const t = Math.min(1, uf);
      const edge = 0.5 + 0.5 * mottle[y * W + x];
      for (let c = 0; c < 3; c++) {
        const v = out[j + c];
        const boosted = 128 + (v - 128) * (1 + 0.55 * t);
        out[j + c] = boosted + (c === 2 ? -14 : c === 1 ? -6 : 4) * t * edge;
      }
    }
  }

  // --- 気泡: 組織は書き換えず、屈折による観察妨害だけを重ねる
  const bubbles = extractBubbleBlobs(f);
  for (const b of bubbles) {
    const cx = b.cx * W;
    const cy = (1 - b.cy) * H;
    const r = b.r * Math.min(W, H);
    const x0 = Math.max(0, Math.floor(cx - r - 3));
    const x1 = Math.min(W - 1, Math.ceil(cx + r + 3));
    const y0 = Math.max(0, Math.floor(cy - r - 3));
    const y1 = Math.min(H - 1, Math.ceil(cy + r + 3));
    const src = out.slice();
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const d = Math.hypot(dx, dy);
        if (d > r) continue;
        const u = d / r;
        const j = (y * W + x) * 4;
        // 屈折による像のずれ（組織そのものは変えない）
        const shift = 1 + 0.22 * (1 - u * u);
        const sxp = Math.round(cx + dx * shift);
        const syp = Math.round(cy + dy * shift);
        const k = (Math.min(H - 1, Math.max(0, syp)) * W + Math.min(W - 1, Math.max(0, sxp))) * 4;
        for (let c = 0; c < 3; c++) {
          let v = src[k + c];
          v = 255 - (255 - v) * (1 - 0.45 * (1 - u * u)); // 中心ほど明るく、像が薄れる
          if (u > 0.82) {
            const ring = (u - 0.82) / 0.18;
            v *= 1 - 0.55 * Math.sin(ring * Math.PI); // 縁の暗い環（Becke 線様）
          }
          out[j + c] = v;
        }
      }
    }
  }
}

/** 気泡グリッドから代表的な円を取り出す（描画用）。 */
function extractBubbleBlobs(f: MicroFields): { cx: number; cy: number; r: number }[] {
  const out: { cx: number; cy: number; r: number }[] = [];
  const seen = new Uint8Array(f.gw * f.gh);
  for (let y = 0; y < f.gh; y++) {
    for (let x = 0; x < f.gw; x++) {
      const i = y * f.gw + x;
      if (seen[i] || f.bubble[i] < 0.35) continue;
      let n = 0;
      let sx = 0;
      let sy = 0;
      const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const c = stack.pop()!;
        const cy2 = Math.floor(c / f.gw);
        const cx2 = c % f.gw;
        n++;
        sx += cx2;
        sy += cy2;
        const nb = [
          cx2 > 0 ? c - 1 : -1,
          cx2 < f.gw - 1 ? c + 1 : -1,
          cy2 > 0 ? c - f.gw : -1,
          cy2 < f.gh - 1 ? c + f.gw : -1,
        ];
        for (const m of nb) if (m >= 0 && !seen[m] && f.bubble[m] >= 0.35) { seen[m] = 1; stack.push(m); }
      }
      const area = n / (f.gw * f.gh);
      out.push({ cx: (sx / n + 0.5) / f.gw, cy: (sy / n + 0.5) / f.gh, r: Math.sqrt(area / Math.PI) * 1.15 });
    }
  }
  return out;
}

function sample(a: Float32Array, gw: number, gh: number, gx: number, gy: number): number {
  const x = Math.min(gw - 1.001, Math.max(0, gx));
  const y = Math.min(gh - 1.001, Math.max(0, gy));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const x1 = Math.min(gw - 1, x0 + 1);
  const y1 = Math.min(gh - 1, y0 + 1);
  const a00 = a[y0 * gw + x0];
  const a10 = a[y0 * gw + x1];
  const a01 = a[y1 * gw + x0];
  const a11 = a[y1 * gw + x1];
  return a00 + (a10 - a00) * tx + (a01 - a00) * ty + (a00 - a10 - a01 + a11) * tx * ty;
}

function boxBlur(src: Uint8ClampedArray, W: number, H: number, r: number): Uint8ClampedArray {
  const tmp = new Float32Array(W * H * 3);
  const out = new Uint8ClampedArray(src.length);
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < H; y++) {
    for (let c = 0; c < 3; c++) {
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += src[(y * W + clampI(x, W)) * 4 + c];
      for (let x = 0; x < W; x++) {
        tmp[(y * W + x) * 3 + c] = acc * inv;
        acc += src[(y * W + clampI(x + r + 1, W)) * 4 + c] - src[(y * W + clampI(x - r, W)) * 4 + c];
      }
    }
  }
  for (let x = 0; x < W; x++) {
    for (let c = 0; c < 3; c++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[(clampI(y, H) * W + x) * 3 + c];
      for (let y = 0; y < H; y++) {
        out[(y * W + x) * 4 + c] = acc * inv;
        acc += tmp[(clampI(y + r + 1, H) * W + x) * 3 + c] - tmp[(clampI(y - r, H) * W + x) * 3 + c];
      }
    }
  }
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  return out;
}

const clampI = (v: number, n: number): number => (v < 0 ? 0 : v >= n ? n - 1 : v);

function noiseField(w: number, h: number, cell: number, rnd: () => number): Float32Array {
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
      const a = g[y0 * gw + x0];
      const b = g[y0 * gw + x0 + 1];
      const c = g[(y0 + 1) * gw + x0];
      const d = g[(y0 + 1) * gw + x0 + 1];
      out[y * w + x] = lp(lp(a, b, tx), lp(c, d, tx), ty);
    }
  }
  return out;
}
const sm = (t: number): number => t * t * (3 - 2 * t);
const lp = (a: number, b: number, t: number): number => a + (b - a) * t;
