import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { SPEC, GIVEN, MM, shrinkAt } from '../../src/design'
import { buildLattice } from '../../src/honeycomb/lattice'
import { Panel } from '../../src/honeycomb/panel'
import { RADIAL_SAMPLES, sheetAngle, stackOffset } from '../../src/honeycomb/tree'
import { silhouetteRadius } from '../../src/honeycomb/profile'

const latEven = buildLattice(0)
const latOdd = buildLattice(1)
const panelEven = new Panel({ lattice: latEven, radialSamples: RADIAL_SAMPLES, thickness: SPEC.tau, solid: false })
const panelOdd = new Panel({ lattice: latOdd, radialSamples: RADIAL_SAMPLES, thickness: SPEC.tau, solid: false })

const OPENS = [0, 0.08, 0.25, 0.5, 0.75, 0.93, 1]

/** 紙 i のワールド座標（ツリーが使うのと同じ変換） */
function world(panel: Panel, i: number, t: number, p: 0 | 1, row: number, col: number): THREE.Vector3 {
  const delta = t * SPEC.deltaMax
  const v = panel.sampleMid(p, row, col)
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), sheetAngle(i, delta))
  const off = new THREE.Vector3(0, 0, stackOffset(i, t)).applyQuaternion(q)
  return v.applyQuaternion(q).add(off)
}

function setOpen(t: number): void {
  const d = t * SPEC.deltaMax
  panelEven.update(d)
  panelOdd.update(d)
}

describe('作中の設計値', () => {
  it('紙が伸びない条件を満たす（最大半径での周方向のずれ < 自由スパン長）', () => {
    expect(SPEC.Rmax * SPEC.deltaMax).toBeLessThan(SPEC.hf)
  })

  it('高さが糊ピッチの整数倍', () => {
    expect(SPEC.periods * SPEC.P).toBeCloseTo(SPEC.H, 9)
    expect(SPEC.H).toBeCloseTo(GIVEN.treeHeightMm * MM, 9)
    expect(SPEC.Rmax * 2).toBeCloseTo(GIVEN.maxDiameterMm * MM, 9)
  })

  it('縮み率は 1 以下（紙は決して伸びない）で、軸上では 1', () => {
    expect(shrinkAt(0, SPEC.deltaMax, SPEC.hf)).toBe(1)
    let prev = 1
    for (let u = 0; u <= SPEC.Rmax; u += SPEC.Rmax / 20) {
      const s = shrinkAt(u, SPEC.deltaMax, SPEC.hf)
      expect(s).toBeLessThanOrEqual(1 + 1e-12)
      expect(s).toBeLessThanOrEqual(prev + 1e-12)
      prev = s
    }
    expect(prev).toBeLessThan(0.8)
  })
})

describe('互い違いの糊と格子', () => {
  it('偶数枚目と奇数枚目で、糊帯の高さと縮みの積算は完全に一致する', () => {
    expect(latEven.ys.length).toBe(latOdd.ys.length)
    for (let i = 0; i < latEven.ys.length; i++) {
      expect(latOdd.ys[i]).toBeCloseTo(latEven.ys[i], 12)
      expect(latOdd.glueBelow[i]).toBeCloseTo(latEven.glueBelow[i], 12)
      expect(latOdd.freeBelow[i]).toBeCloseTo(latEven.freeBelow[i], 12)
      expect(latOdd.radius[i]).toBeCloseTo(latEven.radius[i], 12)
    }
  })

  it('折れ角は互い違い（符号が反転している）', () => {
    let flips = 0
    for (let i = 0; i < latEven.ys.length; i++) {
      expect(latOdd.psiNorm[i]).toBeCloseTo(-latEven.psiNorm[i], 12)
      if (Math.abs(latEven.psiNorm[i]) > 0.99) flips++
    }
    expect(flips).toBeGreaterThan(SPEC.periods * 2)
  })

  it('糊帯と自由スパンの合計が高さに一致する', () => {
    for (let i = 0; i < latEven.ys.length; i++) {
      expect(latEven.glueBelow[i] + latEven.freeBelow[i]).toBeCloseTo(latEven.ys[i], 12)
    }
  })
})

describe('閉・途中・全開で同じ紙構造が追跡できる', () => {
  it('貼られた隣接関係は途中形状でも保たれる（隣り合う紙が糊帯で接している）', () => {
    for (const t of OPENS) {
      setOpen(t)
      for (const i of [0, 5, 11, SPEC.N - 2]) {
        const a = i % 2 === 0 ? panelEven : panelOdd
        const b = i % 2 === 0 ? panelOdd : panelEven
        const latA = i % 2 === 0 ? latEven : latOdd
        for (let row = 0; row < latA.ys.length; row++) {
          if (!latA.inBand[row]) continue
          if (latA.psiNorm[row] < 0.5) continue // 上隣と貼られている帯だけ見る
          for (const col of [0, 4, RADIAL_SAMPLES - 1]) {
            for (const p of [0, 1] as const) {
              const pa = world(a, i, t, p, row, col)
              const pb = world(b, i + 1, t, p, row, col)
              // 隙間は紙厚のオーダー（積層オフセット分）に収まる
              expect(pa.distanceTo(pb)).toBeLessThan(SPEC.tau * 3)
            }
          }
        }
      }
    }
  })

  it('自由スパンの紙の長さは展開量によらず一定（伸びも縮みもしない）', () => {
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    let checked = 0
    for (const t of OPENS) {
      const delta = t * SPEC.deltaMax
      for (let row = 0; row + 1 < latEven.ys.length; row++) {
        // 区間が糊帯を含まないこと（含めば紙は動かない）
        if (latEven.glueBelow[row + 1] - latEven.glueBelow[row] > 1e-9) continue
        const flat = latEven.ys[row + 1] - latEven.ys[row]
        if (flat < 1e-6) continue
        // 紙の材料線は「半径一定の線」。同じ u で 2 行を比べる。
        const rmax = Math.min(latEven.radius[row], latEven.radius[row + 1])
        for (const f of [0.15, 0.5, 1.0]) {
          const u = SPEC.uMin + (rmax - SPEC.uMin) * f
          panelEven.evalMid(u, row, delta, a)
          panelEven.evalMid(u, row + 1, delta, b)
          // 半径は変わらない（紙は半径方向にも伸び縮みしない）
          const ua = Math.hypot(a.x, a.z)
          const ub = Math.hypot(b.x, b.z)
          expect(ub).toBeCloseTo(ua, 9)
          // 折れは軸まわりの螺旋。出力された頂点だけから弧長を測ると平らなときの長さに一致する。
          const dAng = Math.atan2(-b.z, b.x) - Math.atan2(-a.z, a.x)
          const helix = Math.hypot(b.y - a.y, ua * dAng)
          expect(helix).toBeCloseTo(flat, 9)
          // 直線距離が平らなときの長さを超えることは無い（伸びない）
          expect(a.distanceTo(b)).toBeLessThanOrEqual(flat + 1e-12)
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(100)
  })

  it('セルの隙間は本当に空間として存在し、展開量とともに広がる', () => {
    let prev = -1
    for (const t of OPENS) {
      setOpen(t)
      // 自由スパンの中央付近の行で、隣り合う紙の距離を測る
      let row = -1
      for (let r = 0; r < latEven.ys.length; r++) {
        if (!latEven.inBand[r] && Math.abs(latEven.psiNorm[r]) < 0.5) row = r
      }
      // 中間行が無ければ帯の外の行を使う
      if (row < 0) row = Math.floor(latEven.ys.length / 2)
      const col = RADIAL_SAMPLES - 1
      const pa = world(panelEven, 10, t, 1, row, col)
      const pb = world(panelOdd, 11, t, 1, row, col)
      const gap = pa.distanceTo(pb)
      expect(gap).toBeGreaterThan(prev)
      prev = gap
    }
    expect(prev).toBeGreaterThan(0.004)
  })

  it('紙どうしの順序が入れ替わらない（貫通しない）', () => {
    for (const t of OPENS) {
      setOpen(t)
      const delta = t * SPEC.deltaMax
      for (let row = 0; row < latEven.ys.length; row += 3) {
        for (const col of [3, 9, RADIAL_SAMPLES - 1]) {
          for (let i = 0; i + 1 < SPEC.N; i++) {
            const a = i % 2 === 0 ? panelEven : panelOdd
            const b = i % 2 === 0 ? panelOdd : panelEven
            const pa = world(a, i, t, 1, row, col)
            const pb = world(b, i + 1, t, 1, row, col)
            const u = Math.hypot(pa.x, pa.z)
            if (u < 1e-6) continue
            // 紙面に垂直な向き（積み順が増える向き）へ測った隣の紙までの距離
            const ang = Math.atan2(-pa.z, pa.x)
            const tx = -Math.sin(ang)
            const tz = -Math.cos(ang)
            const sep = (pb.x - pa.x) * tx + (pb.z - pa.z) * tz
            expect(sep).toBeGreaterThan(SPEC.tau * 0.4)
            // セルの最大幅は隣接シート 2 枚ぶんの折れ角 2*delta まで
            expect(sep).toBeLessThan(u * 2 * delta + SPEC.tau * 2.5)
          }
        }
      }
    }
  })

  it('閉じ切りでは平ら、全開では頂点の高さが変わらず外周が沈む', () => {
    setOpen(0)
    for (let row = 0; row < latEven.ys.length; row += 4) {
      expect(panelEven.sampleMid(1, row, RADIAL_SAMPLES - 1).y).toBeCloseTo(latEven.ys[row], 9)
    }
    setOpen(1)
    const top = latEven.ys.length - 1
    // 頂点付近は半径が小さいので高さがほぼ変わらない
    expect(panelEven.sampleMid(1, top, 0).y).toBeGreaterThan(SPEC.H * 0.985)
    // 裾の広いところは縦に縮む
    let sank = 0
    for (let row = 0; row < latEven.ys.length; row++) {
      const y = panelEven.sampleMid(1, row, RADIAL_SAMPLES - 1).y
      if (y < latEven.ys[row] - 0.002) sank++
    }
    expect(sank).toBeGreaterThan(latEven.ys.length * 0.5)
  })

  it('どの展開量でも NaN や退化した法線が出ない', () => {
    for (let k = 0; k <= 40; k++) {
      setOpen(k / 40)
      for (const g of [panelEven.geometry, panelOdd.geometry]) {
        const pos = g.getAttribute('position').array as Float32Array
        const nor = g.getAttribute('normal').array as Float32Array
        for (let i = 0; i < pos.length; i++) expect(Number.isFinite(pos[i])).toBe(true)
        for (let i = 0; i < nor.length; i += 3) {
          const l = Math.hypot(nor[i], nor[i + 1], nor[i + 2])
          expect(l).toBeGreaterThan(0.5)
        }
      }
    }
  })

  it('底の縁は常に机の高さ（接地する）', () => {
    for (const t of OPENS) {
      setOpen(t)
      for (const col of [0, 7, RADIAL_SAMPLES - 1]) {
        expect(panelEven.sampleMid(1, 0, col).y).toBeCloseTo(0, 9)
      }
    }
  })
})

describe('輪郭', () => {
  it('半径は常に芯より大きく、最大径を超えない', () => {
    for (let k = 0; k <= 200; k++) {
      const y = (k / 200) * SPEC.H
      const r = silhouetteRadius(y)
      expect(r).toBeGreaterThan(SPEC.uMin)
      expect(r).toBeLessThanOrEqual(SPEC.Rmax + 1e-9)
    }
    expect(silhouetteRadius(0)).toBeCloseTo(SPEC.Rmax, 9)
  })
})

describe('毎フレームの再生成をしない', () => {
  it('同じ展開量なら頂点を書き換えない', () => {
    panelEven.update(0.05)
    expect(panelEven.update(0.05)).toBe(false)
    expect(panelEven.update(0.06)).toBe(true)
  })
})
