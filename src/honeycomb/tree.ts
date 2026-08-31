import * as THREE from 'three'
import { SPEC, shrinkAt } from '../design'
import { buildLattice, type Lattice } from './lattice'
import { Panel } from './panel'
import type { MaterialSet } from '../scene/materials'

export const RADIAL_SAMPLES = 15
/** つかみ代を付ける高さ（平たい紙の座標） */
const TAB_Y = SPEC.H * 0.22

/** 紙 i の扇の角度。積み順とそのまま対応する。 */
export function sheetAngle(i: number, delta: number): number {
  return i * delta
}

/**
 * 平たいときの積層厚み（紙の法線方向のずれ）。
 * 符号は扇が開く向きと揃える。揃えないと開き始めに隣の紙とすれ違ってしまう。
 * 開くにつれ 0 に寄り、芯（uMin）での角度間隔が紙厚を担うようになる。
 */
export function stackOffset(i: number, t: number): number {
  return -(i - (SPEC.N - 1) / 2) * SPEC.tau * (1 - t)
}

/**
 * ハニカム紙のツリー本体。
 *
 * 開閉の主状態は展開量 t (0..1) ひとつ。そこから
 *   delta = t * deltaMax          隣接シート間の折れ角
 *   psi   = psiNorm(y) * delta/2  各紙の周方向の折れ
 *   s(u)  = sqrt(1-(u delta/hf)^2) 自由スパンの縦の縮み
 * が全部同時に決まる。閉状態と開状態で別の物体に差し替えることはしない。
 */
export class HoneycombTree {
  readonly group = new THREE.Group()
  readonly sheetMeshes: THREE.InstancedMesh[] = []
  readonly boardMeshes: THREE.Mesh[] = []
  readonly tabMesh: THREE.Mesh

  private readonly panels: Panel[] = []
  private readonly boardLattice: Lattice
  private readonly boardPanel: Panel
  private open = -1
  private readonly matrix = new THREE.Matrix4()
  private readonly quat = new THREE.Quaternion()
  private readonly axisY = new THREE.Vector3(0, 1, 0)
  private readonly pos = new THREE.Vector3()
  private readonly one = new THREE.Vector3(1, 1, 1)
  private readonly tabIndex: number

  constructor(private readonly mats: MaterialSet) {
    const latEven = buildLattice(0)
    const latOdd = buildLattice(1)
    this.boardLattice = buildLattice(0, { psiConstNorm: 0 })

    const panelEven = new Panel({ lattice: latEven, radialSamples: RADIAL_SAMPLES, thickness: SPEC.tau, solid: false })
    const panelOdd = new Panel({ lattice: latOdd, radialSamples: RADIAL_SAMPLES, thickness: SPEC.tau, solid: false })
    this.boardPanel = new Panel({
      lattice: this.boardLattice,
      radialSamples: RADIAL_SAMPLES,
      thickness: SPEC.tauBoard,
      solid: true,
    })
    this.panels.push(panelEven, panelOdd, this.boardPanel)

    const nEven = Math.ceil(SPEC.N / 2)
    const nOdd = SPEC.N - nEven
    const even = new THREE.InstancedMesh(panelEven.geometry, mats.paper, nEven)
    const odd = new THREE.InstancedMesh(panelOdd.geometry, mats.paper, nOdd)
    for (const m of [even, odd]) {
      m.castShadow = true
      m.receiveShadow = true
      m.frustumCulled = false
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      this.group.add(m)
      this.sheetMeshes.push(m)
    }

    for (let k = 0; k < 2; k++) {
      const b = new THREE.Mesh(this.boardPanel.geometry, mats.board)
      b.castShadow = true
      b.receiveShadow = true
      b.frustumCulled = false
      this.group.add(b)
      this.boardMeshes.push(b)
    }

    // つかみ代: 紙本体とは別素材・別色の小さな板。触る場所はここだと形で分かる。
    const tabGeo = roundedSlab(0.032, 0.026, 0.0014, 0.006)
    this.tabMesh = new THREE.Mesh(tabGeo, mats.tab)
    this.tabMesh.castShadow = true
    this.tabMesh.receiveShadow = true
    this.tabMesh.frustumCulled = false
    this.group.add(this.tabMesh)

    // つかみ代を付ける高さに一番近い格子の行
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < this.boardLattice.ys.length; i++) {
      const d = Math.abs(this.boardLattice.ys[i] - TAB_Y)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    this.tabIndex = best

    this.setOpen(0)
  }

  get triangleCount(): number {
    const nEven = Math.ceil(SPEC.N / 2)
    const nOdd = SPEC.N - nEven
    return (
      this.panels[0].triangleCount * nEven +
      this.panels[1].triangleCount * nOdd +
      this.boardPanel.triangleCount * 2 +
      this.tabMesh.geometry.getIndex()!.count / 3
    )
  }

  setOpen(t: number): void {
    if (t === this.open) return
    this.open = t
    const delta = t * SPEC.deltaMax
    for (const p of this.panels) p.update(delta)

    const nEven = Math.ceil(SPEC.N / 2)
    for (let i = 0; i < SPEC.N; i++) {
      const mesh = i % 2 === 0 ? this.sheetMeshes[0] : this.sheetMeshes[1]
      const slot = i % 2 === 0 ? i / 2 : (i - 1) / 2
      this.quat.setFromAxisAngle(this.axisY, sheetAngle(i, delta))
      const d = stackOffset(i, t)
      this.pos.set(0, 0, d).applyQuaternion(this.quat)
      this.matrix.compose(this.pos, this.quat, this.one)
      mesh.setMatrixAt(slot, this.matrix)
    }
    this.sheetMeshes[0].count = nEven
    this.sheetMeshes[1].count = SPEC.N - nEven
    this.sheetMeshes[0].instanceMatrix.needsUpdate = true
    this.sheetMeshes[1].instanceMatrix.needsUpdate = true

    // 端台紙は紙の外側に必ず 1 枚ぶん + 台紙半分だけ出ている。
    // 平たいときは束の厚みぶん外へ、全開では 2 枚の台紙がちょうど背中合わせで触れる。
    const boardOff = SPEC.tauBoard / 2 + SPEC.tau / 2 + ((SPEC.N - 1) / 2) * SPEC.tau * (1 - t)
    const angles = [-delta / 2, (SPEC.N - 1) * delta + delta / 2]
    const offs = [boardOff, -boardOff]
    for (let k = 0; k < 2; k++) {
      const b = this.boardMeshes[k]
      b.quaternion.setFromAxisAngle(this.axisY, angles[k])
      b.position.set(0, 0, offs[k]).applyQuaternion(b.quaternion)
      b.updateMatrix()
      b.matrixAutoUpdate = false
    }

    this.updateTab(delta, angles[1], offs[1])
  }

  private updateTab(delta: number, boardAngle: number, boardOffset: number): void {
    const i = this.tabIndex
    const lat = this.boardLattice
    const R = lat.radius[i]
    const s = shrinkAt(R, delta, SPEC.hf)
    const Y = lat.glueBelow[i] + s * lat.freeBelow[i]
    this.tabMesh.quaternion.setFromAxisAngle(this.axisY, boardAngle)
    this.tabMesh.position.set(R + 0.009, Y, boardOffset).applyQuaternion(this.tabMesh.quaternion)
    this.tabMesh.updateMatrix()
    this.tabMesh.matrixAutoUpdate = false
  }

  /** つかみ代のワールド座標（当たり判定と手の合図に使う） */
  tabWorldPosition(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.tabMesh.position)
  }

  /** 端台紙どうしが出会う「継ぎ目」のワールド位置と外向き方向 */
  seamAnchor(height: number, position: THREE.Vector3, outward: THREE.Vector3): void {
    const lat = this.boardLattice
    let i = 0
    let bd = Infinity
    for (let k = 0; k < lat.ys.length; k++) {
      const d = Math.abs(lat.ys[k] - height)
      if (d < bd) {
        bd = d
        i = k
      }
    }
    const delta = this.open * SPEC.deltaMax
    const R = lat.radius[i]
    const s = shrinkAt(R, delta, SPEC.hf)
    const Y = lat.glueBelow[i] + s * lat.freeBelow[i]
    const a = -delta / 2
    position.set(Math.cos(a) * R, Y, -Math.sin(a) * R)
    outward.set(Math.cos(a), 0, -Math.sin(a))
  }

  setPaperColor(hex: number): void {
    this.mats.paper.color.setHex(hex)
    const c = new THREE.Color(hex)
    c.multiplyScalar(0.78)
    this.mats.board.color.copy(c)
  }

  dispose(): void {
    for (const p of this.panels) p.dispose()
    this.tabMesh.geometry.dispose()
    for (const m of this.sheetMeshes) this.group.remove(m)
  }
}

function roundedSlab(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  const x = -w / 2
  const y = -h / 2
  shape.moveTo(x + r, y)
  shape.lineTo(x + w - r, y)
  shape.quadraticCurveTo(x + w, y, x + w, y + r)
  shape.lineTo(x + w, y + h - r)
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  shape.lineTo(x + r, y + h)
  shape.quadraticCurveTo(x, y + h, x, y + h - r)
  shape.lineTo(x, y + r)
  shape.quadraticCurveTo(x, y, x + r, y)
  const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false, curveSegments: 4 })
  g.translate(0, 0, -d / 2)
  g.computeVertexNormals()
  return g
}
