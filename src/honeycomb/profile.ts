import { SPEC } from '../design'

/**
 * 紙束の輪郭（裁断済み）。y は平たい紙の下端からの高さ (m)、返り値は半径 (m)。
 * 4 段のもみの木。段の境目は 1.5 mm の丸めを入れて、半径が不連続に飛ばないようにする
 * （不連続だと開いたときに三角形が退化し、法線が壊れるため）。
 */

const H = SPEC.H

/** 各段の [下端y比, 上端y比, 下端半径比, 上端半径比] */
const TIERS: Array<[number, number, number, number]> = [
  [0.0, 0.28, 1.0, 0.70],
  [0.28, 0.54, 0.83, 0.55],
  [0.54, 0.78, 0.63, 0.36],
  [0.78, 1.0, 0.42, 0.02],
]

const FILLET = 0.0015

export const TIER_BOUNDARIES: number[] = (() => {
  const out: number[] = []
  for (const [y0, y1] of TIERS) {
    out.push(y0 * H, y1 * H)
    if (y0 > 0) {
      out.push(y0 * H - FILLET, y0 * H + FILLET)
    }
  }
  return out.filter((y) => y > 1e-9 && y < H - 1e-9).sort((a, b) => a - b)
})()

function rawRadius(y: number): number {
  const f = Math.min(1, Math.max(0, y / H))
  for (const [y0, y1, r0, r1] of TIERS) {
    if (f >= y0 && f <= y1) {
      const k = (f - y0) / (y1 - y0)
      // 裾がわずかに膨らむ曲線（直線だと円錐すぎる）
      const e = k * k * 0.35 + k * 0.65
      return (r0 + (r1 - r0) * e) * SPEC.Rmax
    }
  }
  return f < 0.5 ? TIERS[0][2] * SPEC.Rmax : TIERS[TIERS.length - 1][3] * SPEC.Rmax
}

/** 段の境目を FILLET 幅で線形に混ぜた半径。 */
export function silhouetteRadius(y: number): number {
  let r = rawRadius(y)
  for (const [y0] of TIERS) {
    if (y0 <= 0) continue
    const yb = y0 * H
    const d = y - yb
    if (Math.abs(d) < FILLET) {
      const below = rawRadius(yb - FILLET)
      const above = rawRadius(yb + FILLET)
      const k = (d + FILLET) / (2 * FILLET)
      r = below + (above - below) * k
    }
  }
  // 芯より内側にはできない。頂点付近も潰れた三角形を作らないよう下限を置く。
  return Math.max(r, SPEC.uMin + 0.0006)
}
