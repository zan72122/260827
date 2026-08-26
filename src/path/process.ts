// ============================================================
// 一筆軌跡 → 施工可能な壁中心線への変換
//
// 方針:
//  - 数pxの震え除去（リサンプル + 弱いガウス平滑）
//  - 鋭すぎる折れをプリンター旋回半径 minTurnRadius へ丸める
//  - 自己交差の整理（大ループは閉曲線として採用、微小ループは除去）
//  - 端点が近ければ穏やかに閉じる
//  - 子どもの膨らみ・凹み・左右差は保持（テンプレートへの吸着はしない）
// ============================================================

import { DIM } from '../config';
import {
  P2, add, clamp, dist, lerp, lerp2, scale, segIntersect, sub,
} from '../util/math2d';

export interface RawSample { x: number; z: number; t: number; }

export interface PathSample {
  x: number; z: number;
  /** 進行方向単位ベクトル */
  tx: number; tz: number;
  /** 符号付き曲率 1/m（左曲がり正） */
  curv: number;
  /** 子どもの描画速度に由来する幅係数（1=標準） */
  widthF: number;
  /** 高さ係数（停止気味の区間で盛り上がる） */
  heightF: number;
  /** 経路先頭からの弧長 */
  s: number;
}

export interface WallPath {
  samples: PathSample[];
  closed: boolean;
  totalLen: number;
  layers: number;
  isBench: boolean;
  /** 生入力（比較カード用・正規化前） */
  raw: P2[];
}

const RESAMPLE = 0.028;      // 一次リサンプル間隔 28mm
const FINAL_SPACING = 0.045; // 最終サンプル間隔 45mm

function resample(pts: RawSample[], spacing: number): { p: P2[]; speed: number[] } {
  const out: P2[] = [];
  const speed: number[] = [];
  if (pts.length < 2) return { p: pts.map(q => ({ x: q.x, z: q.z })), speed: pts.map(() => 0.5) };
  out.push({ x: pts[0].x, z: pts[0].z });
  // 各生サンプルの瞬間速度 m/s
  const rawSpeed: number[] = pts.map((q, i) => {
    if (i === 0) return 0;
    const dt = Math.max(1e-3, (q.t - pts[i - 1].t) / 1000);
    return dist(q, pts[i - 1]) / dt;
  });
  rawSpeed[0] = rawSpeed[1] ?? 0.5;
  speed.push(rawSpeed[0]);
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1]; const b = pts[i];
    let segLen = dist(a, b);
    while (acc + segLen >= spacing) {
      const t = (spacing - acc) / segLen;
      const np = lerp2(a, b, t);
      out.push(np);
      speed.push(lerp(rawSpeed[i - 1], rawSpeed[i], t));
      a = { x: np.x, z: np.z } as RawSample & P2;
      segLen = dist(a, b);
      acc = 0;
    }
    acc += segLen;
  }
  const last = pts[pts.length - 1];
  if (dist(out[out.length - 1], last) > spacing * 0.35) {
    out.push({ x: last.x, z: last.z });
    speed.push(rawSpeed[rawSpeed.length - 1]);
  }
  return { p: out, speed };
}

function gaussSmooth(p: P2[], sigma: number, closed: boolean, passes = 1): P2[] {
  const n = p.length;
  if (n < 5) return p.slice();
  const r = Math.ceil(sigma * 2.5);
  const kernel: number[] = [];
  let ksum = 0;
  for (let k = -r; k <= r; k++) {
    const w = Math.exp(-(k * k) / (2 * sigma * sigma));
    kernel.push(w); ksum += w;
  }
  let cur = p.slice();
  for (let pass = 0; pass < passes; pass++) {
    const out: P2[] = new Array(n);
    for (let i = 0; i < n; i++) {
      let sx = 0, sz = 0, sw = 0;
      for (let k = -r; k <= r; k++) {
        let j = i + k;
        if (closed) j = ((j % n) + n) % n;
        else j = clamp(j, 0, n - 1);
        const w = kernel[k + r];
        sx += cur[j].x * w; sz += cur[j].z * w; sw += w;
      }
      out[i] = { x: sx / sw, z: sz / sw };
    }
    if (!closed) { out[0] = cur[0]; out[n - 1] = cur[n - 1]; }
    cur = out;
  }
  return cur;
}

function smoothScalar(v: number[], r: number): number[] {
  const n = v.length;
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let k = -r; k <= r; k++) {
      const j = clamp(i + k, 0, n - 1);
      s += v[j]; c++;
    }
    out[i] = s / c;
  }
  return out;
}

// 自己交差の整理
function resolveSelfIntersections(p: P2[], speed: number[]): { p: P2[]; speed: number[]; forcedClosed: boolean } {
  let pts = p.slice();
  let spd = speed.slice();
  let forcedClosed = false;
  for (let guard = 0; guard < 8; guard++) {
    let found: { i: number; j: number; pt: P2 } | null = null;
    outer:
    for (let i = 0; i < pts.length - 2; i++) {
      for (let j = i + 2; j < pts.length - 1; j++) {
        if (i === 0 && j === pts.length - 2) continue; // 端点同士の接近は閉曲線処理に任せる
        const hit = segIntersect(pts[i], pts[i + 1], pts[j], pts[j + 1]);
        if (hit) {
          const pt = lerp2(pts[i], pts[i + 1], hit[0]);
          found = { i, j, pt };
          break outer;
        }
      }
    }
    if (!found) break;
    const { i, j, pt } = found;
    const loopCount = j - i;             // 交差間のサンプル数
    const total = pts.length;
    if (loopCount > total * 0.42) {
      // 大きなループ → 投げ縄として閉曲線に採用（交差点で切り出す）
      pts = [pt, ...pts.slice(i + 1, j + 1)];
      spd = [spd[i], ...spd.slice(i + 1, j + 1)];
      forcedClosed = true;
    } else {
      // 微小ループ → 切除して交差点で繋ぐ
      pts = [...pts.slice(0, i + 1), pt, ...pts.slice(j + 1)];
      spd = [...spd.slice(0, i + 1), spd[i], ...spd.slice(j + 1)];
    }
  }
  return { p: pts, speed: spd, forcedClosed };
}

// 旋回半径制限: 局所曲率が 1/minR を超える箇所だけを近傍中点へ寄せる
function limitCurvature(p: P2[], closed: boolean, minR: number, iterations = 60): P2[] {
  const pts = p.map(q => ({ ...q }));
  const n = pts.length;
  if (n < 4) return pts;
  for (let it = 0; it < iterations; it++) {
    let changed = false;
    const start = closed ? 0 : 1;
    const end = closed ? n : n - 1;
    for (let i = start; i < end; i++) {
      const im = closed ? (i - 1 + n) % n : i - 1;
      const ip = closed ? (i + 1) % n : i + 1;
      const a = pts[im], b = pts[i], c = pts[ip];
      const d1 = dist(a, b), d2 = dist(b, c);
      if (d1 < 1e-6 || d2 < 1e-6) continue;
      // 外接円半径による曲率評価
      const area2 = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
      const d3 = dist(a, c);
      const r = (d1 * d2 * d3) / Math.max(1e-9, 2 * area2);
      if (r < minR) {
        const mid = lerp2(a, c, 0.5);
        const t = clamp(0.55 * (1 - r / minR) + 0.15, 0.15, 0.6);
        pts[i] = lerp2(b, mid, t);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return pts;
}

// 非隣接区間の接近を緩和（壁同士の物理的重なり防止）
function relaxProximity(p: P2[], closed: boolean, minGap: number, arcSkip: number, spacing: number): P2[] {
  const pts = p.map(q => ({ ...q }));
  const n = pts.length;
  const skip = Math.ceil(arcSkip / spacing);
  for (let it = 0; it < 14; it++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + skip; j < n; j++) {
        if (closed && (n - (j - i)) < skip) continue;
        const d = dist(pts[i], pts[j]);
        if (d < minGap && d > 1e-6) {
          const push = scale({ x: (pts[i].x - pts[j].x) / d, z: (pts[i].z - pts[j].z) / d }, (minGap - d) * 0.30);
          pts[i] = add(pts[i], push);
          pts[j] = sub(pts[j], push);
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  return pts;
}

function clampToBuildArea(p: P2[]): P2[] {
  const mx = DIM.buildW / 2 - DIM.beadW;
  const mz = DIM.buildD / 2 - DIM.beadW;
  return p.map(q => ({ x: clamp(q.x, -mx, mx), z: clamp(q.z, -mz, mz) }));
}

export function processStroke(raw: RawSample[]): WallPath | null {
  if (raw.length < 4) return null;
  const rawP2: P2[] = raw.map(q => ({ x: q.x, z: q.z }));

  // 1) リサンプル + 震え除去
  let { p, speed } = resample(raw, RESAMPLE);
  if (p.length < 6) return null;
  p = gaussSmooth(p, 1.6, false, 2);

  // 2) 自己交差整理
  const si = resolveSelfIntersections(p, speed);
  p = si.p; speed = si.speed;
  let closed = si.forcedClosed;

  // 3) 閉曲線判定（端点距離）
  let arc = 0;
  for (let i = 1; i < p.length; i++) arc += dist(p[i - 1], p[i]);
  if (arc < 0.5) return null;
  if (!closed) {
    const gap = dist(p[0], p[p.length - 1]);
    if (gap < Math.max(0.5, arc * 0.16)) {
      closed = true;
      // 端点間を弧で補間して閉じる
      const bridgeSteps = Math.max(2, Math.round(gap / RESAMPLE));
      const s0 = p[p.length - 1], s1 = p[0];
      for (let k = 1; k < bridgeSteps; k++) {
        p.push(lerp2(s0, s1, k / bridgeSteps));
        speed.push((speed[0] + speed[speed.length - 1]) / 2);
      }
    }
  }
  if (closed) {
    // 継ぎ目もなめらかに（円環として平滑）
    p = gaussSmooth(p, 1.8, true, 2);
  }

  // 4) 小さすぎる輪郭の拡大（形は保持）
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const q of p) { minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); minZ = Math.min(minZ, q.z); maxZ = Math.max(maxZ, q.z); }
  const bbox = Math.max(maxX - minX, maxZ - minZ);
  const minBox = closed ? 1.15 : 0.9;
  if (bbox < minBox && bbox > 1e-3) {
    const s = minBox / bbox;
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    p = p.map(q => ({ x: cx + (q.x - cx) * s, z: cz + (q.z - cz) * s }));
  }

  // 5) 旋回半径制限 → 建築範囲へクランプ → 近接緩和
  p = limitCurvature(p, closed, DIM.minTurnRadius);
  p = clampToBuildArea(p);
  p = relaxProximity(p, closed, DIM.beadW * 3.2, 0.55, RESAMPLE);
  p = gaussSmooth(p, 1.1, closed, 1);
  p = limitCurvature(p, closed, DIM.minTurnRadius, 30);
  p = clampToBuildArea(p);

  // 6) 最終リサンプル
  const asRaw: RawSample[] = p.map((q, i) => ({ x: q.x, z: q.z, t: i }));
  const fin = resampleWithScalar(asRaw, speed, FINAL_SPACING, closed);
  if (fin.p.length < 5) return null;

  // 7) 幅・高さ係数（描画速度由来） — 採点ではなく個性
  const spdSm = smoothScalar(fin.speed, 4);
  const n = fin.p.length;
  const widthF: number[] = new Array(n);
  const heightF: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const v = spdSm[i]; // m/s（指の速度）
    // ゆっくり(<0.15) → 幅広 1.16 / 速い(>0.9) → 細め 0.88 / 停止気味(<0.05) → 盛り上がり
    const wSlow = 1.16 - smoothstepN(0.08, 0.85, v) * 0.28;
    widthF[i] = clamp(wSlow, 0.86, 1.22);
    heightF[i] = clamp(1 + (0.06 - Math.min(v, 0.06)) * 2.2, 1, 1.14);
  }

  // 8) 接線・曲率・弧長
  const samples: PathSample[] = [];
  let sAcc = 0;
  for (let i = 0; i < n; i++) {
    const im = closed ? (i - 1 + n) % n : Math.max(0, i - 1);
    const ip = closed ? (i + 1) % n : Math.min(n - 1, i + 1);
    const a = fin.p[im], b = fin.p[i], c = fin.p[ip];
    let tx = c.x - a.x, tz = c.z - a.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    // 符号付き曲率
    const v1x = b.x - a.x, v1z = b.z - a.z;
    const v2x = c.x - b.x, v2z = c.z - b.z;
    const crossV = v1x * v2z - v1z * v2x;
    const dotV = v1x * v2x + v1z * v2z;
    const ang = Math.atan2(crossV, dotV);
    const ds = (Math.hypot(v1x, v1z) + Math.hypot(v2x, v2z)) / 2 || 1;
    const curv = ang / ds;
    if (i > 0) sAcc += dist(fin.p[i - 1], fin.p[i]);
    samples.push({ x: b.x, z: b.z, tx, tz, curv, widthF: widthF[i], heightF: heightF[i], s: sAcc });
  }
  const totalLen = closed ? sAcc + dist(fin.p[n - 1], fin.p[0]) : sAcc;

  const isBench = !closed && totalLen < 2.4;
  const layers = isBench ? DIM.benchLayers : DIM.wallLayers;

  return { samples, closed, totalLen, layers, isBench, raw: rawP2 };
}

function smoothstepN(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

function resampleWithScalar(pts: RawSample[], scalar: number[], spacing: number, closed: boolean): { p: P2[]; speed: number[] } {
  const src: P2[] = pts.map(q => ({ x: q.x, z: q.z }));
  if (closed) src.push({ ...src[0] });
  const scal = closed ? [...scalar, scalar[0]] : scalar.slice();
  const out: P2[] = [{ ...src[0] }];
  const spd: number[] = [scal[0] ?? 0.5];
  let acc = 0;
  for (let i = 1; i < src.length; i++) {
    let a = src[i - 1]; const b = src[i];
    let segLen = dist(a, b);
    while (acc + segLen >= spacing) {
      const t = (spacing - acc) / segLen;
      const np = lerp2(a, b, t);
      out.push(np);
      const sa = scal[Math.min(i - 1, scal.length - 1)] ?? 0.5;
      const sb = scal[Math.min(i, scal.length - 1)] ?? 0.5;
      spd.push(lerp(sa, sb, t));
      a = np;
      segLen = dist(a, b);
      acc = 0;
    }
    acc += segLen;
  }
  if (!closed) {
    const last = src[src.length - 1];
    if (dist(out[out.length - 1], last) > spacing * 0.3) {
      out.push({ ...last });
      spd.push(scal[scal.length - 1] ?? 0.5);
    }
  } else {
    // 閉曲線: 末尾が先頭と重複しないように
    if (dist(out[out.length - 1], out[0]) < spacing * 0.5) { out.pop(); spd.pop(); }
  }
  return { p: out, speed: spd };
}
