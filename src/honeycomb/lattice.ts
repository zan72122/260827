import { SPEC } from '../design'
import { silhouetteRadius, TIER_BOUNDARIES } from './profile'

/**
 * 一枚の紙の「縦方向の構造」を離散化したもの。
 *
 * 糊帯は水平な帯。ある紙 i は
 *   - 上隣 (i+1) と 界面 i の位置で貼られ（そこで psi = +delta/2）
 *   - 下隣 (i-1) と 界面 i-1 の位置で貼られる（そこで psi = -delta/2）
 * 界面 i と 界面 i-1 は P/2 だけ互い違いにずれている。これが
 * 「層ごとに糊の線を互い違いに配置する」ということ。
 *
 * parity = i % 2。parity が違うと上隣用/下隣用の帯が入れ替わるだけで、
 * 帯の存在する高さの集合は両者で同じ。したがって縮み（glueBelow / freeBelow）は
 * 両 parity・端台紙で共通に使える = 貼られた点が必ず一致する。
 */
export interface Lattice {
  /** 平たい状態での高さ (m) の標本列。糊帯の縁と輪郭の段の境目を必ず含む。 */
  ys: Float64Array
  /** 各標本高さでの輪郭半径 (m) */
  radius: Float64Array
  /** その高さより下にある糊帯の合計長 (m) */
  glueBelow: Float64Array
  /** その高さより下にある自由スパンの合計長 (m) */
  freeBelow: Float64Array
  /** -1..+1。実際の角度は psiNorm * delta / 2 */
  psiNorm: Float64Array
  /** その標本が糊帯の中にあるか */
  inBand: Uint8Array
}

interface Band {
  lo: number
  hi: number
  sign: number
}

function buildBands(parity: 0 | 1): Band[] {
  const { P, w, periods } = SPEC
  const bands: Band[] = []
  for (let k = -1; k <= periods + 1; k++) {
    const cUpper = (k + parity * 0.5) * P
    const cLower = (k + (1 - parity) * 0.5) * P
    bands.push({ lo: cUpper - w / 2, hi: cUpper + w / 2, sign: +1 })
    bands.push({ lo: cLower - w / 2, hi: cLower + w / 2, sign: -1 })
  }
  bands.sort((a, b) => a.lo - b.lo)
  return bands
}

function psiNormAt(bands: Band[], y: number): number {
  const eps = 1e-9
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i]
    if (y >= b.lo - eps && y <= b.hi + eps) return b.sign
    if (b.lo > y) {
      const prev = bands[i - 1]
      if (!prev) return b.sign
      const k = (y - prev.hi) / (b.lo - prev.hi)
      return prev.sign + (b.sign - prev.sign) * k
    }
  }
  return bands[bands.length - 1].sign
}

function inBandAt(bands: Band[], y: number): boolean {
  const eps = 1e-9
  for (const b of bands) {
    if (y >= b.lo - eps && y <= b.hi + eps) return true
  }
  return false
}

/** [0, y] のうち糊帯に覆われている長さ */
function glueLengthBelow(bands: Band[], y: number): number {
  let sum = 0
  for (const b of bands) {
    const lo = Math.max(0, b.lo)
    const hi = Math.min(y, b.hi)
    if (hi > lo) sum += hi - lo
  }
  return sum
}

export function buildLattice(parity: 0 | 1, opts?: { psiConstNorm?: number }): Lattice {
  const { H } = SPEC
  const bands = buildBands(parity)

  const raw: number[] = [0, H, ...TIER_BOUNDARIES]
  for (const b of bands) {
    if (b.lo > 1e-9 && b.lo < H - 1e-9) raw.push(b.lo)
    if (b.hi > 1e-9 && b.hi < H - 1e-9) raw.push(b.hi)
  }
  raw.sort((a, b) => a - b)
  const ysArr: number[] = []
  for (const y of raw) {
    if (ysArr.length === 0 || y - ysArr[ysArr.length - 1] > 1e-7) ysArr.push(y)
  }

  const M = ysArr.length
  const ys = new Float64Array(ysArr)
  const radius = new Float64Array(M)
  const glueBelow = new Float64Array(M)
  const freeBelow = new Float64Array(M)
  const psiNorm = new Float64Array(M)
  const inBand = new Uint8Array(M)

  for (let i = 0; i < M; i++) {
    const y = ys[i]
    radius[i] = silhouetteRadius(y)
    const g = glueLengthBelow(bands, y)
    glueBelow[i] = g
    freeBelow[i] = y - g
    psiNorm[i] = opts?.psiConstNorm !== undefined ? opts.psiConstNorm : psiNormAt(bands, y)
    inBand[i] = inBandAt(bands, y) ? 1 : 0
  }

  return { ys, radius, glueBelow, freeBelow, psiNorm, inBand }
}
