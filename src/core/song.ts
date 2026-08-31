/**
 * 櫛歯の音程とピン配置 / comb tuning and pin layout.
 *
 * 音程は歯ごとに固定です。噛み合い調整はここを一切書き換えません
 * (調整は「音が出るかどうか」に効き、「どの音が出るか」には効かない)。
 *
 * 旋律はこの作品のための短い自作フレーズです。既存製品の録音や採譜には
 * 依存していません。
 */

import { COMB } from './spec.ts'
import type { Pin } from './mechanics.ts'
import { TWO_PI } from './mechanics.ts'

/** 歯 0 (最低音) から歯 11 (最高音) までの調律。単位 Hz。 */
export const TOOTH_HZ: readonly number[] = [
  293.66, // 0  D4
  440.0, // 1  A4
  493.88, // 2  B4
  587.33, // 3  D5
  659.25, // 4  E5
  739.99, // 5  F#5
  783.99, // 6  G5
  880.0, // 7  A5
  987.77, // 8  B5
  1174.66, // 9  D6
  1318.51, // 10 E6
  1479.98, // 11 F#6
]

export const TOOTH_NAME: readonly string[] = [
  'D4', 'A4', 'B4', 'D5', 'E5', 'F#5', 'G5', 'A5', 'B5', 'D6', 'E6', 'F#6',
]

/**
 * 歯の幅 (軸方向、mm)。低音ほど広い。
 * 片持ち梁は f ∝ (t / L^2)·√(E/ρ) で、幅は本来効きません。実物の櫛は
 * 幅を変えて先端に鉛錘を載せることで音程を下げています。ここでも同じで、
 * 幅と錘が音程の見た目の根拠になります。
 * → 質量の効き方を式で解いてはいない点を STATUS.md に簡略化として記録。
 */
export function toothWidth(tooth: number): number {
  const f = TOOTH_HZ[tooth] ?? TOOTH_HZ[0]!
  const lo = TOOTH_HZ[TOOTH_HZ.length - 1]!
  const hi = TOOTH_HZ[0]!
  const k = (x: number) => 1 / Math.sqrt(x)
  const u = (k(f) - k(lo)) / (k(hi) - k(lo))
  return COMB.widthHigh + u * (COMB.widthLow - COMB.widthHigh)
}

/** 先端の鉛錘の高さ (mm)。低音側の歯にだけ付く。0 なら錘なし。 */
export function toothWeightHeight(tooth: number): number {
  if (tooth >= COMB.weightedTeeth) return 0
  const u = 1 - tooth / COMB.weightedTeeth
  return COMB.weightHeight * (0.35 + 0.65 * u)
}

/** 1 回転 = 1 曲。曲は 24 拍で 1 周する。 */
export const BEATS_PER_TURN = 24
/** 拍あたりのシリンダー角 (rad)。 */
export const RADIANS_PER_BEAT = TWO_PI / BEATS_PER_TURN
/** 起動位置から最初のピンまでの余白 (rad)。少し回すと最初の一音が来る。 */
export const START_OFFSET = (18 * Math.PI) / 180

/** [拍, 歯番号] の並び。これがそのままシリンダー上のピン配置になる。 */
const SCORE: ReadonlyArray<readonly [number, number]> = [
  [0, 3], [0, 0],
  [2, 5],
  [3, 7],
  [4, 6],
  [6, 4],
  [8, 3], [8, 0],
  [9, 4],
  [10, 5],
  [12, 7],
  [14, 8],
  [15, 7],
  [16, 5], [16, 0],
  [18, 4],
  [19, 3],
  [20, 2],
  [21, 1],
  [22, 3],
  [23, 5],
]

function buildPins(score: ReadonlyArray<readonly [number, number]>): Pin[] {
  return score
    .map(([beat, tooth]) => ({
      angle: (beat * RADIANS_PER_BEAT + START_OFFSET) % TWO_PI,
      tooth,
    }))
    .sort((a, b) => a.angle - b.angle)
}

/** 完成した曲のピン。 */
export const SONG_PINS: readonly Pin[] = buildPins(SCORE)

/**
 * 最初に因果を成立させた最小構成: ピン 1 本、歯 1 枚。
 * 曲版はこれと同じ `stepPasses` / `toothDeflections` を通ります。
 * テストと開発用のデバッグトラックで使います。
 */
export const SINGLE_PIN_TRACK: readonly Pin[] = [{ angle: START_OFFSET, tooth: 3 }]

/** 歯が軸方向のどこにあるか (mm, シリンダー中心を 0 とする)。 */
export function toothAxialPosition(tooth: number): number {
  const span = (COMB.teeth - 1) * COMB.pitch
  return -span / 2 + tooth * COMB.pitch
}
