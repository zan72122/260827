import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { MaterialSet } from './materials'

/** 大きめの金属クリップ。留まった接触そのものが見えるよう、口の位置を紙の端に合わせる。 */
export class Clip {
  readonly group = new THREE.Group()
  private readonly rest = new THREE.Vector3(0.035, 0.018, -0.148)
  private readonly control = new THREE.Vector3(0.06, 0.125, -0.075)
  private readonly target = new THREE.Vector3()
  private readonly outward = new THREE.Vector3(1, 0, 0)
  private readonly tmp = new THREE.Vector3()
  private readonly geoms: THREE.BufferGeometry[] = []
  private restYaw = -0.5

  constructor(mats: MaterialSet) {
    const parts: THREE.BufferGeometry[] = []
    const H = 0.036 // 縦（紙の端に沿う長さ）
    const D = 0.030 // 口から背までの奥行き
    const BACK = 0.024 // 背の幅
    const T = 0.0022 // 板厚

    // 断面は三角形の輪。口(-X 側)で紙をくわえ、背(+X)側へ開いている。
    const tri = (scale: number, inset: number): THREE.Vector2[] => [
      new THREE.Vector2(inset, 0),
      new THREE.Vector2(D * scale, (BACK / 2) * scale - inset),
      new THREE.Vector2(D * scale, -(BACK / 2) * scale + inset),
    ]
    const shape = new THREE.Shape(tri(1, 0))
    const hole = new THREE.Path(tri(1, T).reverse())
    shape.holes.push(hole)
    const body = new THREE.ExtrudeGeometry(shape, { depth: H, bevelEnabled: false, curveSegments: 1 })
    body.rotateX(-Math.PI / 2)
    body.translate(0, H, 0)
    parts.push(body)

    // 針金の取っ手 2 本（背側に立っている）
    for (const sy of [0.26, 0.74]) {
      const arc = new THREE.TorusGeometry(0.013, 0.0011, 5, 12, Math.PI * 1.2)
      arc.rotateZ(-Math.PI * 0.6)
      arc.translate(D * 0.8, H * sy, 0)
      // ExtrudeGeometry は非索引なので、結合できるよう揃える
      parts.push(arc.toNonIndexed())
    }

    const merged = mergeGeometries(parts, false)!
    for (const p of parts) p.dispose()
    this.geoms.push(merged)
    const mesh = new THREE.Mesh(merged, mats.metal)
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.group.add(mesh)
    mesh.position.y = -0.018
    this.group.position.copy(this.rest)
    this.group.rotation.y = this.restYaw
  }

  setTarget(position: THREE.Vector3, outward: THREE.Vector3): void {
    this.target.copy(position)
    this.outward.copy(outward)
  }

  /** 経路上の位置（状態を変えずに問い合わせる） */
  positionAt(t: number, out: THREE.Vector3): THREE.Vector3 {
    const k = Math.min(1, Math.max(0, t))
    const om = 1 - k
    out.x = om * om * this.rest.x + 2 * om * k * this.control.x + k * k * this.target.x
    out.y = om * om * this.rest.y + 2 * om * k * this.control.y + k * k * this.target.y
    out.z = om * om * this.rest.z + 2 * om * k * this.control.z + k * k * this.target.z
    out.addScaledVector(this.outward, 0.013 * k)
    return out
  }

  /** t=0 で机の上、t=1 で継ぎ目をくわえた位置。途中も連続。 */
  setProgress(t: number): void {
    const k = Math.min(1, Math.max(0, t))
    // 目標姿勢: 口(-X)が紙の端を外から挟むので、+X が外向きの逆
    const yawTarget = Math.atan2(-this.outward.z, -this.outward.x)
    this.positionAt(k, this.tmp)
    this.group.position.copy(this.tmp)
    const yaw = this.restYaw + (yawTarget - this.restYaw) * smoothstep(k)
    this.group.rotation.set(0, yaw, 0)
    this.group.updateMatrixWorld()
  }

  worldPosition(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.group.position)
  }

  dispose(): void {
    for (const g of this.geoms) g.dispose()
  }
}

function smoothstep(x: number): number {
  return x * x * (3 - 2 * x)
}
