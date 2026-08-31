/**
 * 噛み合いの幾何と発音判定 / meshing geometry and note judgement.
 *
 * このモジュールは純粋関数だけで出来ています。Three.js も Web Audio も
 * 参照しません。ここが「空振り / 接触 / たわみ / 解放」の唯一の真実で、
 * 描画も音もこの状態モデルから駆動されます。成功フラグから音を出す経路は
 * 存在しません。
 */

import { CYLINDER, MESH, PIN_CAP_CENTRE_RADIUS, PIN_TIP_RADIUS, TOLERANCE } from './spec.ts'

export const TWO_PI = Math.PI * 2

const R_BODY = CYLINDER.bodyRadius
const R_CAP = PIN_CAP_CENTRE_RADIUS
const R_TIP = PIN_TIP_RADIUS
const R_PIN = CYLINDER.pinRadius

/** ピン 1 本の断面外形が、自身の角度から δ ずれた半直線を切る半径 (mm)。
 *  シャフト (半径 R_PIN の丸棒) + 先端の丸みで出来た実体の外形。
 *  ピンの実体が無い角度では 0 を返す。 */
export function pinOuterRadius(delta: number): number {
  const c = Math.cos(delta)
  if (c <= 0) return 0
  const s = Math.abs(Math.sin(delta))
  let best = 0

  // 先端の丸み (中心 R_CAP, 半径 R_PIN) との交点
  const disc = R_PIN * R_PIN - R_CAP * R_CAP * s * s
  if (disc >= 0) best = Math.max(best, R_CAP * c + Math.sqrt(disc))

  // シャフト側面 (|across| = R_PIN) との交点
  if (s > TOLERANCE.angleEpsilon) {
    const rho = R_PIN / s
    const along = rho * c
    if (along >= R_BODY && along <= R_CAP) best = Math.max(best, rho)
  } else {
    best = Math.max(best, R_TIP)
  }
  return best
}

/** 調整つまみの実変位 travel(mm) から噛み合い深さ e(mm) を出す。
 *  e <= 0 は空振り。 */
export function engagementFromTravel(travel: number): number {
  return travel - MESH.initialClearance
}

/** 噛み合い深さ e のとき、歯の自由端が静止している半径 (mm)。 */
export function toothRestRadius(engagement: number): number {
  return R_TIP - engagement
}

/**
 * 接触が続く角度の半幅 (rad)。ピンの中心角から ±この範囲で歯が押される。
 * e <= 0 なら 0 (= 一度も触れない = 空振り)。
 */
export function contactHalfAngle(engagement: number): number {
  if (engagement <= 0) return 0
  const d = toothRestRadius(engagement)
  if (d >= R_TIP) return 0

  // 先端の丸みに当たっている場合 (浅い噛み合い)。
  // 2 次方程式には内側/外側 2 つの根があるので、外側 (ρ = R_CAP·cosδ + √…)
  // に対応する根であることを確かめてから採用する。
  const cosDelta = (d * d + R_CAP * R_CAP - R_PIN * R_PIN) / (2 * d * R_CAP)
  if (cosDelta <= 1) {
    const delta = Math.acos(Math.max(-1, cosDelta))
    if (R_CAP * Math.sin(delta) <= R_PIN && d >= R_CAP * Math.cos(delta)) return delta
  }

  // シャフト側面に当たっている場合 (深い噛み合い)
  if (d <= R_PIN) return Math.atan(R_PIN / R_BODY)
  const delta = Math.asin(Math.min(1, R_PIN / d))
  if (d * Math.cos(delta) < R_BODY) return Math.atan(R_PIN / R_BODY)
  return delta
}

/** ピン中心から δ ずれた位置での歯先のたわみ量 (mm)。触れていなければ 0。 */
export function deflectionAt(delta: number, engagement: number): number {
  if (engagement <= 0) return 0
  const rho = pinOuterRadius(delta)
  if (rho <= 0) return 0
  return Math.max(0, rho - toothRestRadius(engagement))
}

/** 角度差を (-π, π] に畳む。 */
export function wrapPi(a: number): number {
  let x = (a + Math.PI) % TWO_PI
  if (x < 0) x += TWO_PI
  return x - Math.PI
}

/** 曲のピン 1 本。角度と、弾く歯の番号。対応関係は固定。 */
export interface Pin {
  /** シリンダー上の角度 [0, 2π) */
  readonly angle: number
  /** 弾く櫛歯の番号 (0 = 最低音) */
  readonly tooth: number
}

export type PassEventKind = 'contact' | 'release'

export interface PassEvent {
  readonly kind: PassEventKind
  readonly pin: number
  readonly tooth: number
  /** ステップ内の位置 0..1。音のスケジューリングに使う。 */
  readonly at: number
  /** そのときの噛み合い深さ (mm) */
  readonly engagement: number
  /** この通過での最大たわみ (mm) = 解放時に開放される変位 */
  readonly deflection: number
}

/**
 * 前フレームの累積角 `prev` から今フレームの `next` までに起きた
 * 「接触の開始」と「解放」を全て返す。
 *
 * - `next` は `prev` 以上でなければならない (ラチェットにより逆転しない)。
 * - 区間は半開区間 (prev, next]。同じ角度に留まる限り二度と発火しない。
 * - フレームが飛んでも、区間に入る交差を全て拾うので音抜けが起きない。
 * - 交差は角度で決まるので、時間刻みが変わっても結果は変わらない。
 */
export function stepPasses(
  prev: number,
  next: number,
  engagement: number,
  pins: readonly Pin[],
): PassEvent[] {
  const events: PassEvent[] = []
  if (!(next > prev)) return events
  const half = contactHalfAngle(engagement)
  if (half <= 0) return events // 空振り: 接触も解放も起こらない

  const span = next - prev
  const peak = deflectionAt(0, engagement)
  let budget = TOLERANCE.maxEventsPerStep

  for (let i = 0; i < pins.length; i++) {
    const pin = pins[i]!
    for (const kind of ['contact', 'release'] as const) {
      const target = kind === 'contact' ? pin.angle - half : pin.angle + half
      let k = Math.floor((prev - target) / TWO_PI) + 1
      let x = target + k * TWO_PI
      while (x <= next) {
        if (budget-- <= 0) return sortEvents(events)
        events.push({
          kind,
          pin: i,
          tooth: pin.tooth,
          at: span > 0 ? (x - prev) / span : 1,
          engagement,
          deflection: peak,
        })
        k++
        x = target + k * TWO_PI
      }
    }
  }
  return sortEvents(events)
}

function sortEvents(events: PassEvent[]): PassEvent[] {
  events.sort((a, b) => a.at - b.at || (a.kind === 'contact' ? -1 : 1))
  return events
}

/**
 * 今この瞬間の、各歯のたわみ量 (mm) を求める。
 * ピンは自分が弾く歯を知っているので、全ピン × 全歯の総当たりはしない。
 */
export function toothDeflections(
  theta: number,
  engagement: number,
  pins: readonly Pin[],
  out: Float32Array,
): Float32Array {
  out.fill(0)
  if (engagement <= 0) return out
  const half = contactHalfAngle(engagement)
  if (half <= 0) return out
  for (let i = 0; i < pins.length; i++) {
    const pin = pins[i]!
    const delta = wrapPi(theta - pin.angle)
    if (delta < -half || delta > half) continue
    const y = deflectionAt(delta, engagement)
    const t = pin.tooth
    if (y > (out[t] ?? 0)) out[t] = y
  }
  return out
}

/** 解放時に楽音になるか。浅すぎるたわみは擦れる機械音だけで終わる。 */
export function isAudibleRelease(engagement: number): boolean {
  return engagement >= MESH.audibleEngagement
}

/** 固定ねじを締めてよい噛み合いか。 */
export function isSecurelyMeshed(engagement: number): boolean {
  return engagement >= MESH.secureEngagement
}

/**
 * たわみ量から発音の強さ 0..1 を出す。回す速さでは変えない
 * (蓄えられた変位のエネルギーが解放されるだけなので)。
 *
 * 噛み合いが浅いほど弱く、深いほど強い。ただし「はじめて鳴った一音」が
 * 聞き取れないと因果が伝わらないので、下限を 0.3 に置いています。
 * これは可聴性のための設計上の圧縮で、物理そのままの二乗則ではありません
 * (STATUS.md に簡略化として記録)。
 */
export function releaseLoudness(deflection: number): number {
  const e = Math.max(0, deflection)
  const norm = Math.min(1, e / MESH.maxEngagement)
  return 0.3 + 0.7 * Math.pow(norm, 0.55)
}

/** 片持ち梁の静たわみ形状。x は根元 0 〜 自由端 1、戻り値は δ に対する倍率。 */
export function cantileverProfile(x: number): number {
  const t = Math.min(1, Math.max(0, x))
  return (3 * t * t - t * t * t) / 2
}
