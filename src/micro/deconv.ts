/**
 * 色分離（color deconvolution）と光学濃度からの再合成。
 *
 * 手法の参考: [S8] scikit-image "Separate colors in immunohistochemical staining"
 *   https://scikit-image.org/docs/0.25.x/auto_examples/color_exposure/plot_ihc_color_separation.html
 * 染色ベクトルは Ruifrok & Johnston (2001) の H&E 値（scikit-image の rgb_from_hed と同じ並び）。
 *
 * これは「色成分を分けて独立に増減させる」ための道具であり、
 * 染色反応の速度論や、失敗標本の再現性を保証するものではない。
 */

export type Vec3 = [number, number, number];

const norm = (v: Vec3): Vec3 => {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
};

/** ヘマトキシリン（色出し済み・青紫）の光学濃度ベクトル。 */
export const H_BLUED: Vec3 = norm([0.65, 0.70, 0.29]);
/**
 * 色出し前のヘマラム（赤褐色〜紫）の光学濃度ベクトル。[教材係数]
 * 「色出しは量ではなく色調を変える」ことを表すために置いた値であり、
 * 実測の吸収スペクトルではない。
 */
export const H_UNBLUED: Vec3 = norm([0.32, 0.60, 0.73]);
/** エオジン Y の光学濃度ベクトル。 */
export const E_VEC: Vec3 = norm([0.07, 0.99, 0.11]);

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** H・E と、その両者に直交する残差成分からなる 3x3 行列（行が染色ベクトル）。 */
export function stainMatrix(h: Vec3 = H_BLUED, e: Vec3 = E_VEC): number[][] {
  const r = norm(cross(h, e));
  return [
    [h[0], h[1], h[2]],
    [e[0], e[1], e[2]],
    [r[0], r[1], r[2]],
  ];
}

export function invert3(m: number[][]): number[][] {
  const [a, b, c] = m[0];
  const [d, e, f] = m[1];
  const [g, h, i] = m[2];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new Error('stain matrix is singular');
  const id = 1 / det;
  return [
    [A * id, -(b * i - c * h) * id, (b * f - c * e) * id],
    [B * id, (a * i - c * g) * id, -(a * f - c * d) * id],
    [C * id, -(a * h - b * g) * id, (a * e - b * d) * id],
  ];
}

/** RGB(0..255) → 光学濃度。scikit-image と同じ -log10 変換。 */
export function odFromRgb(r: number, g: number, b: number, out: Vec3): void {
  out[0] = -Math.log10(Math.max(r, 1) / 255);
  out[1] = -Math.log10(Math.max(g, 1) / 255);
  out[2] = -Math.log10(Math.max(b, 1) / 255);
}

/** 光学濃度 → RGB(0..255)。 */
export function rgbFromOd(od: Vec3, out: Vec3): void {
  out[0] = 255 * Math.pow(10, -od[0]);
  out[1] = 255 * Math.pow(10, -od[1]);
  out[2] = 255 * Math.pow(10, -od[2]);
}

/** 実写画像を H / E / 残差 の濃度マップに分離する。 */
export interface Separated {
  width: number;
  height: number;
  h: Float32Array;
  e: Float32Array;
  residual: Float32Array;
}

export function separate(data: Uint8ClampedArray, width: number, height: number): Separated {
  const M = stainMatrix();
  const inv = invert3(M);
  const n = width * height;
  const h = new Float32Array(n);
  const e = new Float32Array(n);
  const residual = new Float32Array(n);
  const od: Vec3 = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    odFromRgb(data[i * 4], data[i * 4 + 1], data[i * 4 + 2], od);
    // C = OD * inv(M) （行ベクトル × 逆行列）
    h[i] = od[0] * inv[0][0] + od[1] * inv[1][0] + od[2] * inv[2][0];
    e[i] = od[0] * inv[0][1] + od[1] * inv[1][1] + od[2] * inv[2][1];
    residual[i] = od[0] * inv[0][2] + od[1] * inv[1][2] + od[2] * inv[2][2];
  }
  return { width, height, h, e, residual };
}

/** 分位点（外れ値に強い正規化に使う）。 */
export function quantile(a: Float32Array, q: number): number {
  const step = Math.max(1, Math.floor(a.length / 200000));
  const s: number[] = [];
  for (let i = 0; i < a.length; i += step) s.push(a[i]);
  s.sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))];
}
