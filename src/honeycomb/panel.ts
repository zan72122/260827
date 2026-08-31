import * as THREE from 'three'
import { SPEC, shrinkAt } from '../design'
import type { Lattice } from './lattice'

export interface PanelOptions {
  lattice: Lattice
  /** 片側あたりの半径方向の標本数 */
  radialSamples: number
  /** 板厚 (m) */
  thickness: number
  /** true なら表裏 2 面 + 全周のリム（端台紙）。false なら中面 1 枚 + 外周リム（薄紙）。 */
  solid: boolean
}

const TMP = {
  a: new THREE.Vector3(),
  b: new THREE.Vector3(),
  n: new THREE.Vector3(),
  o: new THREE.Vector3(),
}

/**
 * 展開量 delta（隣接シート間の角度, rad）から紙一枚の立体を作る。
 *
 * 点 (u, y) の位置:
 *   psi = psiNorm(y) * delta / 2                 … 周方向の折れ角
 *   s   = sqrt(1 - (|u| delta / hf)^2)            … 自由スパンの縦の縮み（紙は伸びない）
 *   Y   = glueBelow(y) + s * freeBelow(y)
 *   p   = ( u cos psi,  Y,  -u sin psi )
 *
 * 貼られている高さでは隣接する紙の psi と Y が一致するので、途中形状でも
 * 接着点は必ずつながる。u=0 では s=1 なので頂点の高さは不変、外周ほど沈む。
 */
export class Panel {
  readonly geometry: THREE.BufferGeometry
  readonly M: number
  readonly NU: number

  private readonly lat: Lattice
  private readonly thickness: number
  private readonly layers: number
  private readonly nGrid: number

  private readonly midPos: Float64Array
  private readonly midNor: Float64Array
  private readonly position: Float32Array
  private readonly normal: Float32Array

  /** リムの経路: [gridIdx, innerIdx] の並び。gridIdx は中面の頂点番号。 */
  private readonly rimPath: Int32Array
  private readonly rimInner: Int32Array
  private readonly rimBase: number

  private lastDelta = Number.NaN

  constructor(opts: PanelOptions) {
    this.lat = opts.lattice
    this.thickness = opts.thickness
    this.layers = opts.solid ? 2 : 1
    const M = (this.M = opts.lattice.ys.length)
    const NU = (this.NU = opts.radialSamples)
    const nGrid = (this.nGrid = 2 * M * NU)

    this.midPos = new Float64Array(nGrid * 3)
    this.midNor = new Float64Array(nGrid * 3)

    // --- リム経路の決定 ---------------------------------------------------
    const paths: Array<[number, number]> = []
    const gid = (p: number, i: number, j: number) => p * M * NU + i * NU + j
    const pushCol = (p: number, j: number, jIn: number) => {
      for (let i = 0; i < M; i++) paths.push([gid(p, i, j), gid(p, i, jIn)])
    }
    const pushRow = (p: number, i: number, iIn: number) => {
      for (let j = 0; j < NU; j++) paths.push([gid(p, i, j), gid(p, iIn, j)])
    }
    // 外周の切断端（左パネルの u=-R 列, 右パネルの u=+R 列）と底の切断端は常に作る。
    const colRuns: Array<[number, number, number]> = [
      [0, 0, 1],
      [1, NU - 1, NU - 2],
    ]
    const rowRuns: Array<[number, number, number]> = [
      [0, 0, 1],
      [1, 0, 1],
    ]
    if (opts.solid) {
      colRuns.push([0, NU - 1, NU - 2], [1, 0, 1])
      rowRuns.push([0, M - 1, M - 2], [1, M - 1, M - 2])
    }
    const runs: Array<{ kind: 'col' | 'row'; a: number; b: number; c: number }> = []
    for (const [p, j, jin] of colRuns) runs.push({ kind: 'col', a: p, b: j, c: jin })
    for (const [p, i, iin] of rowRuns) runs.push({ kind: 'row', a: p, b: i, c: iin })
    const runStart: number[] = []
    const runLen: number[] = []
    for (const r of runs) {
      runStart.push(paths.length)
      if (r.kind === 'col') pushCol(r.a, r.b, r.c)
      else pushRow(r.a, r.b, r.c)
      runLen.push(paths.length - runStart[runStart.length - 1])
    }
    this.rimPath = new Int32Array(paths.map((p) => p[0]))
    this.rimInner = new Int32Array(paths.map((p) => p[1]))

    const nSurfVerts = this.layers * nGrid
    this.rimBase = nSurfVerts
    const nVerts = nSurfVerts + paths.length * 2

    this.position = new Float32Array(nVerts * 3)
    this.normal = new Float32Array(nVerts * 3)
    const uv = new Float32Array(nVerts * 2)
    const color = new Float32Array(nVerts * 3)

    // --- インデックス -----------------------------------------------------
    const idx: number[] = []
    for (let L = 0; L < this.layers; L++) {
      const flip = L === 1
      for (let p = 0; p < 2; p++) {
        for (let i = 0; i < M - 1; i++) {
          for (let j = 0; j < NU - 1; j++) {
            const v00 = L * nGrid + gid(p, i, j)
            const v10 = L * nGrid + gid(p, i, j + 1)
            const v01 = L * nGrid + gid(p, i + 1, j)
            const v11 = L * nGrid + gid(p, i + 1, j + 1)
            if (!flip) idx.push(v00, v10, v11, v00, v11, v01)
            else idx.push(v00, v11, v10, v00, v01, v11)
          }
        }
      }
    }
    for (let r = 0; r < runs.length; r++) {
      const s = runStart[r]
      for (let k = 0; k < runLen[r] - 1; k++) {
        const a0 = this.rimBase + (s + k) * 2
        const a1 = a0 + 1
        const b0 = this.rimBase + (s + k + 1) * 2
        const b1 = b0 + 1
        idx.push(a0, a1, b1, a0, b1, b0)
      }
    }

    // --- UV（材料座標に固定。開閉しても模様が泳がない） --------------------
    const uvScale = 1 / 0.06
    for (let L = 0; L < this.layers; L++) {
      for (let p = 0; p < 2; p++) {
        for (let i = 0; i < M; i++) {
          const R = this.lat.radius[i]
          for (let j = 0; j < NU; j++) {
            const u = this.uAt(p, j, R)
            const v = (L * nGrid + gid(p, i, j)) * 2
            uv[v] = u * uvScale
            uv[v + 1] = this.lat.ys[i] * uvScale
          }
        }
      }
    }
    for (let k = 0; k < paths.length; k++) {
      for (let s = 0; s < 2; s++) {
        const v = (this.rimBase + k * 2 + s) * 2
        uv[v] = 0.5
        uv[v + 1] = 0.5
      }
    }

    // 糊で貼られた帯は、紙が糊を吸って少し濃く・少し滑らかに見える。
    // 貼られている場所が目で分かることは、この遊びの理解にそのまま効く。
    color.fill(1)
    for (let L = 0; L < this.layers; L++) {
      for (let p = 0; p < 2; p++) {
        for (let i = 0; i < M; i++) {
          if (!opts.lattice.inBand[i]) continue
          for (let j = 0; j < NU; j++) {
            const v = (L * nGrid + gid(p, i, j)) * 3
            color[v] = 0.84
            color[v + 1] = 0.87
            color[v + 2] = 0.85
          }
        }
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(this.position, 3))
    g.setAttribute('normal', new THREE.BufferAttribute(this.normal, 3))
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    g.setAttribute('color', new THREE.BufferAttribute(color, 3))
    g.setIndex(nVerts > 65535 ? new THREE.BufferAttribute(new Uint32Array(idx), 1) : new THREE.BufferAttribute(new Uint16Array(idx), 1))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, SPEC.H * 0.5, 0), SPEC.H * 0.8)
    g.boundingBox = new THREE.Box3(
      new THREE.Vector3(-SPEC.Rmax * 1.2, -0.01, -SPEC.Rmax * 1.2),
      new THREE.Vector3(SPEC.Rmax * 1.2, SPEC.H * 1.05, SPEC.Rmax * 1.2),
    )
    this.geometry = g
    this.update(0)
  }

  get triangleCount(): number {
    const index = this.geometry.getIndex()
    return index ? index.count / 3 : 0
  }

  private uAt(p: number, j: number, R: number): number {
    const a = j / (this.NU - 1)
    const uMin = SPEC.uMin
    return p === 1 ? uMin + (R - uMin) * a : -R + (R - uMin) * a
  }

  /** delta が変わったときだけ頂点を書き換える。毎フレームの再生成はしない。 */
  update(delta: number): boolean {
    if (delta === this.lastDelta) return false
    this.lastDelta = delta
    const { M, NU, nGrid, midPos, midNor, lat } = this
    const hf = SPEC.hf

    // 1) 中面の位置
    for (let i = 0; i < M; i++) {
      const psi = lat.psiNorm[i] * delta * 0.5
      const cp = Math.cos(psi)
      const sp = Math.sin(psi)
      const R = lat.radius[i]
      const gb = lat.glueBelow[i]
      const fb = lat.freeBelow[i]
      for (let p = 0; p < 2; p++) {
        for (let j = 0; j < NU; j++) {
          const u = this.uAt(p, j, R)
          const s = shrinkAt(Math.abs(u), delta, hf)
          const Y = gb + s * fb
          const o = (p * M * NU + i * NU + j) * 3
          midPos[o] = u * cp
          midPos[o + 1] = Y
          midPos[o + 2] = -u * sp
        }
      }
    }

    // 2) 中面の法線（格子の差分から）
    for (let p = 0; p < 2; p++) {
      for (let i = 0; i < M; i++) {
        const i0 = Math.max(0, i - 1)
        const i1 = Math.min(M - 1, i + 1)
        for (let j = 0; j < NU; j++) {
          const j0 = Math.max(0, j - 1)
          const j1 = Math.min(NU - 1, j + 1)
          const base = p * M * NU
          const dj = (base + i * NU + j1) * 3
          const dj0 = (base + i * NU + j0) * 3
          const di = (base + i1 * NU + j) * 3
          const di0 = (base + i0 * NU + j) * 3
          const ax = midPos[dj] - midPos[dj0]
          const ay = midPos[dj + 1] - midPos[dj0 + 1]
          const az = midPos[dj + 2] - midPos[dj0 + 2]
          const bx = midPos[di] - midPos[di0]
          const by = midPos[di + 1] - midPos[di0 + 1]
          const bz = midPos[di + 2] - midPos[di0 + 2]
          let nx = ay * bz - az * by
          let ny = az * bx - ax * bz
          let nz = ax * by - ay * bx
          const len = Math.hypot(nx, ny, nz) || 1
          nx /= len
          ny /= len
          nz /= len
          const o = (base + i * NU + j) * 3
          midNor[o] = nx
          midNor[o + 1] = ny
          midNor[o + 2] = nz
        }
      }
    }

    // 2.5) 糊帯での紙厚。貼られた 2 枚は「紙 1 枚ぶん」だけ離れていなければならない。
    // 剛体の積層オフセットは開くにつれ 0 になるので、その分をここで補う。
    // 中面の法線は「積み順が減る向き」なので、psiNorm と同符号にずらすと
    // 貼られた 2 枚がちょうど紙 1 枚ぶん離れる。
    const tOpen = SPEC.deltaMax > 0 ? Math.min(1, Math.abs(delta) / SPEC.deltaMax) : 0
    if (tOpen > 0) {
      for (let i = 0; i < M; i++) {
        const shift = lat.psiNorm[i] * SPEC.tau * 0.5 * tOpen
        if (shift === 0) continue
        for (let p = 0; p < 2; p++) {
          for (let j = 0; j < NU; j++) {
            const o = (p * M * NU + i * NU + j) * 3
            midPos[o] += midNor[o] * shift
            midPos[o + 1] += midNor[o + 1] * shift
            midPos[o + 2] += midNor[o + 2] * shift
          }
        }
      }
    }

    // 3) レイヤ（solid なら表裏、そうでなければ中面のみ）
    const half = this.thickness * 0.5
    const pos = this.position
    const nor = this.normal
    for (let L = 0; L < this.layers; L++) {
      const off = this.layers === 1 ? 0 : L === 0 ? half : -half
      const sgn = L === 1 ? -1 : 1
      for (let v = 0; v < nGrid; v++) {
        const s = v * 3
        const d = (L * nGrid + v) * 3
        pos[d] = midPos[s] + midNor[s] * off
        pos[d + 1] = midPos[s + 1] + midNor[s + 1] * off
        pos[d + 2] = midPos[s + 2] + midNor[s + 2] * off
        nor[d] = midNor[s] * sgn
        nor[d + 1] = midNor[s + 1] * sgn
        nor[d + 2] = midNor[s + 2] * sgn
      }
    }

    // 4) リム（切断端）
    for (let k = 0; k < this.rimPath.length; k++) {
      const e = this.rimPath[k] * 3
      const inr = this.rimInner[k] * 3
      TMP.n.set(midNor[e], midNor[e + 1], midNor[e + 2])
      TMP.o.set(midPos[e] - midPos[inr], midPos[e + 1] - midPos[inr + 1], midPos[e + 2] - midPos[inr + 2])
      TMP.o.addScaledVector(TMP.n, -TMP.o.dot(TMP.n))
      if (TMP.o.lengthSq() < 1e-16) TMP.o.set(1, 0, 0)
      TMP.o.normalize()
      for (let s = 0; s < 2; s++) {
        const sign = s === 0 ? 1 : -1
        const d = (this.rimBase + k * 2 + s) * 3
        pos[d] = midPos[e] + TMP.n.x * half * sign
        pos[d + 1] = midPos[e + 1] + TMP.n.y * half * sign
        pos[d + 2] = midPos[e + 2] + TMP.n.z * half * sign
        nor[d] = TMP.o.x
        nor[d + 1] = TMP.o.y
        nor[d + 2] = TMP.o.z
      }
    }

    this.geometry.getAttribute('position').needsUpdate = true
    this.geometry.getAttribute('normal').needsUpdate = true
    return true
  }

  /** 任意の半径 u・行 row における中面の点（検査と当たり判定に使う）。 */
  evalMid(u: number, row: number, delta: number, out: THREE.Vector3): THREE.Vector3 {
    const lat = this.lat
    const psi = lat.psiNorm[row] * delta * 0.5
    const s = shrinkAt(Math.abs(u), delta, SPEC.hf)
    const Y = lat.glueBelow[row] + s * lat.freeBelow[row]
    return out.set(u * Math.cos(psi), Y, -u * Math.sin(psi))
  }

  /** 検査用: 中面の点を返す。 */
  sampleMid(p: 0 | 1, i: number, j: number): THREE.Vector3 {
    const o = (p * this.M * this.NU + i * this.NU + j) * 3
    return new THREE.Vector3(this.midPos[o], this.midPos[o + 1], this.midPos[o + 2])
  }

  dispose(): void {
    this.geometry.dispose()
  }
}
