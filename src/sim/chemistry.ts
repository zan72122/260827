import { BATHS, GH, GW, TEACHING } from './protocol';
import { REAGENTS, filmComponentOf, FILM_COMPONENTS } from './reagents';
import { SimState, idx, rowSubmergeFraction } from './state';

/**
 * 化学モデルの 1 ステップ。**純粋な関数**（乱数を使わない）。
 * 同じ (state, bathIdx, level, dt) 列を与えれば必ず同じ結果になる。
 *
 * 因果の向き（脱パラフィン不足→染色不足、過分別→核が淡い 等）は
 * [S2]/[S3] の記述に沿わせている。速度定数は TEACHING の教材係数であり、
 * 実試薬の反応速度として検証されたものではない。
 */
export function applyTick(s: SimState, bathIdx: number, level: number, dt: number): void {
  s.modelSec += dt;
  if (bathIdx >= 0) applyBathTick(s, bathIdx, level, dt);
  else applyAirTick(s, dt);
}

const T = TEACHING;

function applyBathTick(s: SimState, bathIdx: number, level: number, dt: number): void {
  const def = BATHS[bathIdx];
  const rt = s.baths[bathIdx];
  const rp = REAGENTS[def.kind];
  const film = s.film;
  film.airSec = 0;
  rt.usedSec += dt;

  const comp = filmComponentOf(def.kind);

  // --- 液膜が槽の液へ入れ替わる。入れ替わって出ていった分が「持ち込み」。
  const mix = 1 - Math.exp(-3.0 * dt);
  let removed = 0;
  for (let r = 0; r < GH; r++) {
    const fr = rowSubmergeFraction(r, level);
    if (fr <= 0) continue;
    const out = film.vol[r] * mix * fr;
    removed += out;
    film.vol[r] += (T.filmBase - film.vol[r]) * mix * fr;
  }

  if (removed > 0) {
    // 境界層（スライド近傍のわずかな液）へ持ち込まれる。次の液膜はここからできる。
    for (const c of FILM_COMPONENTS) {
      if (c === comp) continue;
      rt.local[c] = Math.min(1, rt.local[c] + (removed * film.comp[c]) / T.boundaryMl);
    }
    // 槽全体（大きな容量）への希釈は小さい。1 枚の持ち込みで新鮮な槽が失活しない。
    if (rp.family === 'solvent' || rp.family === 'alcohol') {
      rt.water = Math.min(0.6, rt.water + (removed * (film.comp.water + 0.3 * film.comp.acid)) / def.volumeMl);
    }
  }

  // 境界層は攪拌・拡散で薄まる
  const disp = Math.exp(-T.kDisperse * dt);
  for (const c of FILM_COMPONENTS) rt.local[c] *= disp;
  rt.dye = rt.local.hema + rt.local.eosin;
  rt.acid = rt.local.acid;

  // --- 液膜の組成は槽の成分へ緩和するが、境界層の残りより下がらない
  if (level > 0) {
    for (const c of FILM_COMPONENTS) {
      const target = c === comp ? 1 : 0;
      film.comp[c] += (target - film.comp[c]) * mix;
      if (c !== comp) film.comp[c] = Math.max(film.comp[c], rt.local[c]);
    }
    film.normalize();
  }

  // 洗浄効率（境界層が汚れていると洗い落としの効率が落ちる）
  const washEff = rp.family === 'aqueous' ? Math.max(0, 1 - (rt.dye + rt.acid) / T.washSaturation) : 0;

  const f = s.field;
  const localWater = rt.water;
  const acidCarry = filmAcidCarry(s);

  for (let r = 0; r < GH; r++) {
    const fr = rowSubmergeFraction(r, level);
    if (fr <= 0) continue;
    const w = fr * dt;
    // 行が均一なら 1 列だけ解いて横へ複製する（結果は完全に同一）
    const nx = f.rowUniform[r] ? 1 : GW;
    for (let x = 0; x < nx; x++) {
      const i = idx(x, r);

      // --- 脱パラフィン
      if (rp.dewax > 0) {
        const blockedByWater = 1 - 0.8 * Math.min(1, localWater + f.water[i] * 0.5);
        f.paraffin[i] *= Math.exp(-rp.dewax * Math.max(0.05, blockedByWater) * w);
      }

      const open = 1 - 0.85 * f.paraffin[i]; // パラフィンが残ると溶媒交換が進まない
      const damage = 1 - 0.5 * f.dried[i];

      // --- 媒体の極性（親水化 / 脱水）
      f.polar[i] += (rp.polarTarget - f.polar[i]) * (1 - Math.exp(-T.kPolar * open * w));

      // --- 残留水分
      const kw = def.kind === 'xylene' ? T.kWaterInXylene : T.kWater;
      const wt = Math.min(1, rp.waterTarget + localWater * 0.5);
      f.water[i] += (wt - f.water[i]) * (1 - Math.exp(-kw * open * w));

      // --- ヘマトキシリン結合（水系の到達性が必要）
      if (def.kind === 'hematoxylin') {
        const access = (1 - f.paraffin[i]) * clamp01((f.polar[i] - 0.55) / 0.35) * damage;
        if (access > 0) {
          f.hemaN[i] += (T.hemaNucMax - f.hemaN[i]) * (1 - Math.exp(-T.kHemaNuc * access * w));
          f.hemaB[i] += (T.hemaBgMax - f.hemaB[i]) * (1 - Math.exp(-T.kHemaBg * access * w));
        }
      }

      // --- 分別（酸アルコール）: 背景を速く、核をゆっくり脱色する
      if (def.kind === 'acid_alcohol') {
        const prot = 1 - T.bluedProtection * f.blue[i];
        f.hemaB[i] *= Math.exp(-T.kDiffBg * prot * w);
        f.hemaN[i] *= Math.exp(-T.kDiffNuc * prot * w);
      }

      // --- 色出し（Scott 液）: 量ではなく色調が変わる
      if (def.kind === 'scott') {
        const access = clamp01((f.polar[i] - 0.5) / 0.4) * (1 - f.paraffin[i]);
        f.blue[i] += (1 - f.blue[i]) * (1 - Math.exp(-T.kBlue * access * w));
      }

      // --- 水洗による色出し（水道水でも徐々に進む。Scott より遅い）
      if (rp.family === 'aqueous' && def.kind !== 'scott') {
        const access = clamp01((f.polar[i] - 0.5) / 0.4) * (1 - f.paraffin[i]);
        f.blue[i] += (1 - f.blue[i]) * (1 - Math.exp(-0.012 * access * w));
        // ゆるく結合した背景色素がわずかに抜ける（分別ではない）
        f.hemaB[i] *= Math.exp(-0.002 * washEff * w);
      }

      // --- エオジン取り込み
      if (def.kind === 'eosin') {
        const wet = 1 - 0.55 * clamp01((f.water[i] - 0.3) / 0.7);
        const access = (1 - f.paraffin[i]) * wet * damage;
        f.eosin[i] += (T.eosinMax - f.eosin[i]) * (1 - Math.exp(-T.kEosin * access * w));
      } else if (rp.eosinLoss > 0 && f.eosin[i] > 0) {
        // --- エオジンの溶出（水・アルコールで進む。方向は S2/S3 に沿う）
        f.eosin[i] *= Math.exp(-rp.eosinLoss * w);
      }

      // --- 持ち越した酸による分別の継続（水洗が不十分なとき）
      if (acidCarry > 0.02 && def.kind !== 'acid_alcohol') {
        const cont = acidCarry * (rp.family === 'aqueous' ? 0.25 * (1 - washEff * 0.8) : 0.5);
        f.hemaB[i] *= Math.exp(-T.kDiffBg * 0.25 * cont * w);
        f.hemaN[i] *= Math.exp(-T.kDiffNuc * 0.35 * cont * w);
      }

      // --- 透徹（キシレン）: 水分が残っていると進まない
      if (rp.clears) {
        const dryEnough = clamp01(1 - f.water[i] / 0.12);
        f.cleared[i] += (1 - f.cleared[i]) * (1 - Math.exp(-T.kClear * dryEnough * w));
      } else if (rp.family === 'aqueous' || rp.family === 'alcohol') {
        f.cleared[i] *= Math.exp(-0.05 * w);
      }

      f.wetSec[i] += w;
    }
    if (nx === 1) copyRow(f, r);
  }

}

function applyAirTick(s: SimState, dt: number): void {
  const film = s.film;
  film.airSec += dt;
  const f = s.field;
  const acidCarry = filmAcidCarry(s);
  const xyleneWet = film.comp.xylene > 0.5;

  // 液切り: 余分な液膜が滴となって落ち、薄い膜が残る
  applyDrain(s, dt);
  for (let r = 0; r < GH; r++) {
    // 液膜は蒸発する。上の行ほど早く薄くなる（下へ流れるため）
    const drainBias = 1 + 0.6 * (r / (GH - 1)) + (xyleneWet ? 2.0 : 0);
    film.vol[r] = Math.max(0, film.vol[r] - T.kEvap * drainBias * film.vol[r] * dt - 1e-5 * dt);
  }

  const acidB = acidCarry > 0.02 ? Math.exp(-T.kDiffBg * 0.18 * acidCarry * dt) : 1;
  const acidN = acidCarry > 0.02 ? Math.exp(-T.kDiffNuc * 0.25 * acidCarry * dt) : 1;
  const waterLoss = Math.exp(-0.05 * dt);
  for (let r = 0; r < GH; r++) {
    const wet = film.vol[r] > 1e-4;
    const drying = !wet && film.airSec > T.dryGraceSec;
    if (drying) f.rowUniform[r] = 0;
    const nx = f.rowUniform[r] ? 1 : GW;
    for (let x = 0; x < nx; x++) {
      const i = idx(x, r);
      if (drying) {
        const over = film.airSec - T.dryGraceSec;
        // キシレン湿潤からの乾きは水系からの乾きより障害が軽い（教材上の重み付け）
        const weight = xyleneWet ? 0.6 : 1;
        // 液膜は切片の縁から先に薄くなるため、乾燥は縁で早く進む（教材モデル）
        const u = GW > 1 ? x / (GW - 1) : 0.5;
        const edge = 1 + 1.1 * Math.pow(Math.abs(u - 0.5) * 2, 2.2);
        f.dried[i] = Math.min(1, f.dried[i] + T.kDry * weight * edge * Math.min(1, over / 10) * dt);
        f.water[i] *= waterLoss;
      }
      if (acidB !== 1) {
        f.hemaB[i] *= acidB;
        f.hemaN[i] *= acidN;
      }
    }
    if (nx === 1 && (acidB !== 1 || drying)) copyRow(f, r);
  }
}

/** 液膜に含まれる酸の持ち越し量（0 付近〜2 程度）。 */
export function filmAcidCarry(s: SimState): number {
  const total = s.film.totalVol();
  const base = GH * T.filmBase;
  return s.film.comp.acid * (total / base);
}

/** 引き上げ時の液膜形成。速度が速いほど厚い膜が残る（傾向のみを模した教材式）。 */
export function applyWithdrawFilm(s: SimState, rowsLeaving: number[], speedNorm: number): void {
  const amount = T.filmBase * (1 + T.filmSpeedGain * Math.min(1.5, speedNorm));
  for (const r of rowsLeaving) {
    s.film.vol[r] = Math.max(s.film.vol[r], amount);
  }
}

/** 液切り（槽の上で保持）: 液膜が薄くなり、滴が槽へ戻る。戻った量を返す。 */
export function applyDrain(s: SimState, dt: number): number {
  let returned = 0;
  const floor = T.filmBase * T.filmDrainFloor;
  for (let r = 0; r < GH; r++) {
    const v = s.film.vol[r];
    if (v > floor) {
      const nv = floor + (v - floor) * Math.exp(-T.kDrain * dt);
      returned += v - nv;
      s.film.vol[r] = nv;
    }
  }
  return returned;
}

/** 行の 0 列目の値を、その行の全列へ複製する。 */
function copyRow(f: SimState['field'], r: number): void {
  const base = idx(0, r);
  for (let x = 1; x < GW; x++) {
    const i = idx(x, r);
    f.paraffin[i] = f.paraffin[base];
    f.polar[i] = f.polar[base];
    f.water[i] = f.water[base];
    f.hemaN[i] = f.hemaN[base];
    f.hemaB[i] = f.hemaB[base];
    f.blue[i] = f.blue[base];
    f.eosin[i] = f.eosin[base];
    f.cleared[i] = f.cleared[base];
    f.dried[i] = f.dried[base];
    f.wetSec[i] = f.wetSec[base];
  }
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
