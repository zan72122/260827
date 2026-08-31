import { GH, GW } from './protocol';
import { DIM, SECTION } from './geometry';
import type { MountResult } from './state';

/**
 * 封入の幾何モデル（教材用の近似）。
 * 完全な流体計算ではなく、次の 3 つの実際の機構だけを再現する:
 *   1. カバーガラスを傾けて降ろすと、接触位置から順にガラスとスライドの隙間が閉じる。
 *   2. 封入剤の濡れ広がり前線は毛細管で進む。
 *   3. 前線が届く前に隙間が閉じた場所には空気が残る（気泡）。
 * さらに封入剤量が足りなければ前線が止まり、未充填領域が残る。
 */
export interface MountParams {
  /** 押し出した封入剤の量(µL) */
  volumeUl: number;
  /** 封入剤を落とした位置（スライド下端からの mm） */
  dropY: number;
  /** 封入剤を落とした位置（スライド幅方向の中心からのずれ mm） */
  dropX: number;
  /** カバーガラスのリード辺（最初に接触する辺）の位置（スライド下端からの mm） */
  slipY: number;
  /** 降ろす操作の記録（t 秒, 角度 deg）。単調に角度が減る想定だが、途中で止めてもよい。 */
  angleSamples: { t: number; deg: number }[];
}

const NU = 64; // カバーガラス長手方向
const NV = 32; // カバーガラス幅方向
const L = DIM.cover.len;
const W = DIM.cover.wid;
const CELL_AREA = (L / NU) * (W / NV);
/** 封入剤の最終膜厚の下限・上限(mm)。教材係数。 */
const GAP_MIN = 0.010;
const GAP_MAX = 0.045;
/** 毛細管前進速度の係数(1/s)。教材係数。 */
const K_SPREAD = 900;
const V_MAX = 60; // mm/s

export function simulateMounting(p: MountParams): MountResult {
  const volMm3 = Math.max(0, p.volumeUl); // 1 µL = 1 mm^3
  const gap = clamp(volMm3 / (L * W), GAP_MIN, GAP_MAX);
  const capacityArea = Math.min(L * W, volMm3 / gap);
  const overflow = Math.max(0, volMm3 - L * W * gap);

  const filled = new Uint8Array(NU * NV);
  const airLocked = new Uint8Array(NU * NV);
  let filledArea = 0;

  // 初期の液滴（カバーガラス座標系）
  const du = (p.dropY - p.slipY) / L;
  const dv = 0.5 + p.dropX / W;
  const r0mm = Math.sqrt(Math.max(volMm3, 1) / (Math.PI * 0.6));
  for (let iu = 0; iu < NU; iu++) {
    for (let iv = 0; iv < NV; iv++) {
      const uu = (iu + 0.5) / NU;
      const vv = (iv + 0.5) / NV;
      const dx = (uu - du) * L;
      const dy = (vv - dv) * W;
      if (dx * dx + dy * dy <= r0mm * r0mm && filledArea < capacityArea) {
        filled[iu * NV + iv] = 1;
        filledArea += CELL_AREA;
      }
    }
  }
  if (filledArea === 0) {
    // 液滴がカバーガラスの外だった場合でも、接触時に最寄りへ引き込まれる
    const iu = clampInt(Math.round(du * NU), 0, NU - 1);
    const iv = clampInt(Math.round(dv * NV), 0, NV - 1);
    filled[iu * NV + iv] = 1;
    filledArea = CELL_AREA;
  }

  const acc = new Map<number, number>();
  const samples = normalizeSamples(p.angleSamples);
  const tEnd = samples[samples.length - 1].t + 0.4;
  const dt = 0.01;
  for (let t = 0; t <= tEnd; t += dt) {
    const deg = angleAt(samples, t);
    const sinT = Math.sin((deg * Math.PI) / 180);
    // 位置 u より手前は「隙間が最終値まで閉じた」= もう封入剤は入れない
    const closedU = sinT <= 1e-6 ? 1 : Math.min(1, gap / (L * sinT));
    const closedIdx = Math.floor(closedU * NU);

    // 閉じた列のうち未充填のセルは空気として固定される
    for (let iu = 0; iu < closedIdx && iu < NU; iu++) {
      for (let iv = 0; iv < NV; iv++) {
        const k = iu * NV + iv;
        if (!filled[k]) airLocked[k] = 1;
      }
    }

    // 前線の前進（4近傍）。局所の隙間が広いほど速い。
    const stepsNext: number[] = [];
    for (let iu = 0; iu < NU; iu++) {
      const uu = (iu + 0.5) / NU;
      const localGap = Math.max(gap, L * uu * sinT);
      const v = Math.min(V_MAX, K_SPREAD * localGap);
      const reach = v * dt; // mm
      const cellsPerStep = reach / (L / NU);
      if (cellsPerStep <= 0) continue;
      for (let iv = 0; iv < NV; iv++) {
        const k = iu * NV + iv;
        if (filled[k] || airLocked[k]) continue;
        // 乱数は使わない。前線がセルを 1 つ越えるのに要する時間を積算して判定する。
        if (hasFilledNeighbor(filled, iu, iv) && (cellsPerStep >= 0.999 || accumulate(acc, iu, iv, cellsPerStep))) {
          stepsNext.push(k);
        }
      }
    }
    for (const k of stepsNext) {
      if (filledArea + CELL_AREA > capacityArea) break;
      filled[k] = 1;
      filledArea += CELL_AREA;
    }
    if (closedIdx >= NU && stepsNext.length === 0) break;
  }

  // 未到達セル（容量不足など）
  for (let k = 0; k < filled.length; k++) if (!filled[k] && !airLocked[k]) airLocked[k] = 2; // 2 = 未充填(乾いた面)

  // --- 切片グリッドへ写像
  const coverage = new Float32Array(GW * GH);
  const air = new Float32Array(GW * GH);
  for (let gy = 0; gy < GH; gy++) {
    const slideY = SECTION.y0 + ((gy + 0.5) / GH) * (SECTION.y1 - SECTION.y0);
    const uu = (slideY - p.slipY) / L;
    for (let gx = 0; gx < GW; gx++) {
      const slideX = SECTION.x0 + ((gx + 0.5) / GW) * (SECTION.x1 - SECTION.x0);
      const vv = (slideX - (DIM.slide.wid - W) / 2) / W;
      const gi = gy * GW + gx;
      if (uu < 0 || uu >= 1 || vv < 0 || vv >= 1) {
        coverage[gi] = 0;
        air[gi] = 1;
        continue;
      }
      const iu = clampInt(Math.floor(uu * NU), 0, NU - 1);
      const iv = clampInt(Math.floor(vv * NV), 0, NV - 1);
      const k = iu * NV + iv;
      coverage[gi] = filled[k] ? 1 : 0;
      air[gi] = airLocked[k] === 1 ? 1 : 0; // 閉じ込められた空気のみ。未充填は coverage で表す。
    }
  }
  smooth(coverage);
  smooth(air);

  return {
    coverage,
    air,
    overflow,
    volumeUl: p.volumeUl,
    contactX: p.slipY,
    lowerSec: samples[samples.length - 1].t,
    angleDeg: samples[0].deg,
    bubbles: extractBubbles(airLocked, p.slipY),
  };
}

// --- 前線の部分前進を保持する（決定的。乱数を使わない）
function accumulate(acc: Map<number, number>, iu: number, iv: number, add: number): boolean {
  const k = iu * NV + iv;
  const v = (acc.get(k) ?? 0) + add;
  if (v >= 1) {
    acc.set(k, 0);
    return true;
  }
  acc.set(k, v);
  return false;
}

function hasFilledNeighbor(filled: Uint8Array, iu: number, iv: number): boolean {
  if (iu > 0 && filled[(iu - 1) * NV + iv]) return true;
  if (iu < NU - 1 && filled[(iu + 1) * NV + iv]) return true;
  if (iv > 0 && filled[iu * NV + iv - 1]) return true;
  if (iv < NV - 1 && filled[iu * NV + iv + 1]) return true;
  return false;
}

function normalizeSamples(s: { t: number; deg: number }[]): { t: number; deg: number }[] {
  if (!s.length) return [{ t: 0, deg: 30 }, { t: 0.2, deg: 0 }];
  const out = s.slice().sort((a, b) => a.t - b.t);
  if (out[out.length - 1].deg > 0.05) out.push({ t: out[out.length - 1].t + 0.05, deg: 0 });
  return out;
}

function angleAt(s: { t: number; deg: number }[], t: number): number {
  if (t <= s[0].t) return s[0].deg;
  for (let i = 1; i < s.length; i++) {
    if (t <= s[i].t) {
      const f = (t - s[i - 1].t) / Math.max(1e-6, s[i].t - s[i - 1].t);
      return s[i - 1].deg + (s[i].deg - s[i - 1].deg) * f;
    }
  }
  return s[s.length - 1].deg;
}

function extractBubbles(airLocked: Uint8Array, slipY: number): { x: number; y: number; r: number }[] {
  const seen = new Uint8Array(airLocked.length);
  const out: { x: number; y: number; r: number }[] = [];
  for (let iu = 0; iu < NU; iu++) {
    for (let iv = 0; iv < NV; iv++) {
      const k = iu * NV + iv;
      if (airLocked[k] !== 1 || seen[k]) continue;
      let n = 0;
      let su = 0;
      let sv = 0;
      const stack = [k];
      seen[k] = 1;
      while (stack.length) {
        const c = stack.pop()!;
        const cu = Math.floor(c / NV);
        const cv = c % NV;
        n++;
        su += cu;
        sv += cv;
        const nb = [
          cu > 0 ? (cu - 1) * NV + cv : -1,
          cu < NU - 1 ? (cu + 1) * NV + cv : -1,
          cv > 0 ? cu * NV + cv - 1 : -1,
          cv < NV - 1 ? cu * NV + cv + 1 : -1,
        ];
        for (const m of nb) if (m >= 0 && !seen[m] && airLocked[m] === 1) { seen[m] = 1; stack.push(m); }
      }
      if (n < 2) continue;
      const cu = su / n / NU;
      const cv = sv / n / NV;
      out.push({
        x: cv * W + (DIM.slide.wid - W) / 2,
        y: slipY + cu * L,
        r: Math.sqrt((n * CELL_AREA) / Math.PI),
      });
    }
  }
  out.sort((a, b) => b.r - a.r);
  return out.slice(0, 24);
}

function smooth(a: Float32Array): void {
  const c = new Float32Array(a);
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      let s = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy < 0 || yy >= GH || xx < 0 || xx >= GW) continue;
          s += c[yy * GW + xx];
          n++;
        }
      }
      a[y * GW + x] = s / n;
    }
  }
}

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
function clampInt(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : Math.floor(v);
}
