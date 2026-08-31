/**
 * 作中治具 / the workshop jigs designed for this piece.
 *
 * 実物の噛み合い調整は数十 µm の作業です。4 歳児が指一本で扱えるように、
 * 大きなローレットドラム (調整つまみ)、丸ベルトで繋いだ試し回しハンドル、
 * 太い把手のねじ回しを新しく設計しました。現物工場の治具ではありません。
 * 寸法と倍率は src/core/spec.ts に記録してあります。
 */

import * as THREE from 'three'
import { JIG, LAYOUT, MESH } from '../core/spec.ts'
import type { Materials } from './materials.ts'
import { AXIS, TOOTH_NORMAL, U_RADIAL } from './mechanism.ts'

export interface Jigs {
  root: THREE.Group
  /** 調整ドラムの中心 (world) */
  knobCentre: THREE.Vector3
  /** ドラムを転がす向き (world)。この向きに指を動かすと櫛が近づく。 */
  knobTangent: THREE.Vector3
  /** ハンドルの中心 (world) と回転軸 */
  handleCentre: THREE.Vector3
  handleAxis: THREE.Vector3
  tool: THREE.Group
  toolTip: THREE.Vector3
  handleProbe(spin: number, out: THREE.Vector3): THREE.Vector3
  setKnob(travel: number): void
  setHandle(angle: number): void
  setToolAt(head: THREE.Object3D | null, twist: number): void
}

/** 調整つまみからナットまでの距離 (mm)。送りねじの長さ。 */
const NUT_DISTANCE = 13.0

/** 工具の把手の中心が、先端 (ねじ頭) から離れている距離 (mm)。
 *  画面上では 100 CSS px 以上離れるので、指がねじ頭を隠さない。 */
export const TOOL_GRIP_Y = 5.6

export function buildJigs(mats: Materials): Jigs {
  const root = new THREE.Group()
  const keepers: THREE.BufferGeometry[] = []
  const keep = <T extends THREE.BufferGeometry>(g: T): T => (keepers.push(g), g)

  // ---- 調整つまみ: 半径方向の送りねじに付いたローレットドラム -------------
  const knobCentre = new THREE.Vector3(LAYOUT.knobCentre.x, LAYOUT.knobCentre.y, LAYOUT.knobCentre.z)
  const knob = new THREE.Group()
  knob.position.copy(knobCentre)
  // ドラムの軸 = すべりの向き (U_RADIAL)。指はドラムの縁に沿って動かす。
  knob.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), U_RADIAL)
  root.add(knob)

  const drum = new THREE.Mesh(
    keep(new THREE.CylinderGeometry(JIG.knobRadius, JIG.knobRadius, 6.4, 48, 1)),
    mats.brass,
  )
  drum.name = 'jig.drum'
  drum.castShadow = true
  knob.add(drum)
  // ローレット (滑り止め)。回っているのが見えるように。
  const knurlGeom = keep(new THREE.BoxGeometry(0.55, 6.6, 0.9))
  const knurl = new THREE.InstancedMesh(knurlGeom, mats.grip, 36)
  const m = new THREE.Matrix4()
  const qq = new THREE.Quaternion()
  const pp = new THREE.Vector3()
  const ss = new THREE.Vector3(1, 1, 1)
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2
    pp.set(Math.sin(a) * JIG.knobRadius, 0, Math.cos(a) * JIG.knobRadius)
    qq.setFromEuler(new THREE.Euler(0, a, 0))
    knurl.setMatrixAt(i, m.compose(pp, qq, ss))
  }
  knurl.instanceMatrix.needsUpdate = true
  knurl.name = 'jig.knurl'
  knob.add(knurl)
  // 送りねじの軸と、櫛の台座側のラグ
  const feed = new THREE.Mesh(keep(new THREE.CylinderGeometry(1.5, 1.5, NUT_DISTANCE + 3, 16)), mats.brass)
  feed.name = 'jig.feedScrew'
  feed.position.y = -NUT_DISTANCE / 2
  knob.add(feed)
  // 送りねじを受けるナット。櫛のスライドから前へ伸びた腕の先に付く。
  const nutBlock = new THREE.Group()
  nutBlock.position.copy(knobCentre).addScaledVector(U_RADIAL, -NUT_DISTANCE)
  const nutBody = new THREE.Mesh(keep(new THREE.BoxGeometry(5.2, 3.8, 4.6)), mats.screw)
  nutBody.name = 'jig.nut'
  nutBody.quaternion.copy(knob.quaternion)
  nutBody.castShadow = true
  nutBlock.add(nutBody)
  // 腕: ナットから櫛の台座へ伸びる。実体で繋がっている。
  const armEnd = new THREE.Vector3(knobCentre.x, 13.4, 19.0)
  const armVec = armEnd.clone().sub(nutBlock.position)
  const arm = new THREE.Mesh(keep(new THREE.BoxGeometry(2.6, 2.2, armVec.length())), mats.frame)
  arm.name = 'jig.arm'
  arm.position.copy(armVec).multiplyScalar(0.5)
  arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), armVec.clone().normalize())
  arm.castShadow = true
  nutBlock.add(arm)
  root.add(nutBlock)
  // ドラムを受ける支柱 (机から立っている)
  // 支柱は作業台の天板 (y = -5.2) から立ち上がる。宙に浮かせない。
  const postH = knobCentre.y + 5.2
  const knobPost = new THREE.Mesh(keep(new THREE.BoxGeometry(4.6, postH, 5.2)), mats.frame)
  knobPost.name = 'jig.knobPost'
  knobPost.position.set(knobCentre.x, -5.2 + postH / 2, knobCentre.z + 1.6)
  knobPost.castShadow = true
  knobPost.receiveShadow = true
  root.add(knobPost)
  // ---- 試し回しハンドルと丸ベルト -----------------------------------------
  const handleCentre = new THREE.Vector3(
    LAYOUT.handleCentre.x, LAYOUT.handleCentre.y, LAYOUT.handleCentre.z,
  )
  const shaftY = handleCentre.y
  const shaftZ = handleCentre.z

  const jx0 = LAYOUT.jackshaftX[0]
  const jx1 = LAYOUT.jackshaftX[1]
  const jackshaft = new THREE.Mesh(
    keep(new THREE.CylinderGeometry(1.5, 1.5, jx1 - jx0, 16)),
    mats.frame,
  )
  jackshaft.name = 'jig.jackshaft'
  jackshaft.rotation.z = Math.PI / 2
  jackshaft.position.set((jx0 + jx1) / 2, shaftY, shaftZ)
  jackshaft.castShadow = true
  root.add(jackshaft)
  for (const px of [jx0, jx1]) {
    // 中間軸の受けはベッドプレートの上面 (y = 3.2) にねじ止めされている。
    const pedH = shaftY - 3.2
    const ped = new THREE.Mesh(keep(new THREE.BoxGeometry(2.8, pedH, 6)), mats.frame)
    ped.name = 'jig.pedestal'
    ped.position.set(px, 3.2 + pedH / 2, shaftZ)
    ped.castShadow = true
    ped.receiveShadow = true
    root.add(ped)
  }

  // ハンドルは「軸を X に向ける」外側のグループと、
  // その中で自分の Z 軸まわりに回る内側のグループに分ける。
  const wheelPivot = new THREE.Group()
  wheelPivot.position.copy(handleCentre)
  wheelPivot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0))
  root.add(wheelPivot)
  const wheel = new THREE.Group()
  wheelPivot.add(wheel)
  const rim = new THREE.Mesh(
    keep(new THREE.TorusGeometry(JIG.handleRadius, 1.5, 12, 44)),
    mats.brass,
  )
  rim.name = 'jig.rim'
  rim.castShadow = true
  wheel.add(rim)
  const hub = new THREE.Mesh(keep(new THREE.CylinderGeometry(2.6, 2.6, 4.2, 20)), mats.brass)
  hub.name = 'jig.hub'
  hub.rotation.x = Math.PI / 2
  wheel.add(hub)
  for (let i = 0; i < 4; i++) {
    const spoke = new THREE.Mesh(keep(new THREE.BoxGeometry(1.5, JIG.handleRadius, 1.5)), mats.brass)
    spoke.position.set(
      Math.cos((i / 4) * Math.PI * 2 + 0.4) * JIG.handleRadius * 0.5,
      Math.sin((i / 4) * Math.PI * 2 + 0.4) * JIG.handleRadius * 0.5,
      0,
    )
    spoke.rotation.z = (i / 4) * Math.PI * 2 + 0.4 - Math.PI / 2
    spoke.castShadow = true
    wheel.add(spoke)
  }
  // 握り玉。ここを指で回す。
  const gripKnob = new THREE.Mesh(keep(new THREE.SphereGeometry(2.6, 20, 14)), mats.grip)
  gripKnob.name = 'jig.gripKnob'
  gripKnob.position.set(JIG.handleRadius - 0.6, 0, 3.0)
  gripKnob.castShadow = true
  wheel.add(gripKnob)
  const gripPin = new THREE.Mesh(keep(new THREE.CylinderGeometry(1.1, 1.1, 4, 12)), mats.brass)
  gripPin.rotation.x = Math.PI / 2
  gripPin.position.set(JIG.handleRadius - 0.6, 0, 1.5)
  wheel.add(gripPin)

  const pulleyH = new THREE.Mesh(
    keep(new THREE.CylinderGeometry(JIG.pulleyHandle, JIG.pulleyHandle, 3.0, 32)),
    mats.brass,
  )
  pulleyH.name = 'jig.pulleyH'
  pulleyH.rotation.z = Math.PI / 2
  pulleyH.position.set(LAYOUT.pulleyX, shaftY, shaftZ)
  pulleyH.castShadow = true
  root.add(pulleyH)
  const pulleyC = new THREE.Mesh(
    keep(new THREE.CylinderGeometry(JIG.pulleyCylinder, JIG.pulleyCylinder, 3.0, 32)),
    mats.brass,
  )
  pulleyC.name = 'jig.pulleyC'
  pulleyC.rotation.z = Math.PI / 2
  pulleyC.position.set(LAYOUT.pulleyX, AXIS.y, AXIS.z)
  pulleyC.castShadow = true
  root.add(pulleyC)

  // 丸ベルト: 二つの車に本当に巻き付いた閉ループ。
  root.add(buildBelt(keep, mats, pulleyC.position, JIG.pulleyCylinder, pulleyH.position, JIG.pulleyHandle))

  // 逆回し止めのラチェット爪 (ハンドル側)。逆に回すとここが噛む。
  const pawl = new THREE.Mesh(keep(new THREE.BoxGeometry(1.4, 5.6, 1.2)), mats.screw)
  pawl.name = 'jig.pawl'
  pawl.position.set(LAYOUT.pulleyX - 3.2, shaftY + JIG.pulleyHandle + 1.6, shaftZ)
  pawl.rotation.x = 0.5
  root.add(pawl)

  // ---- ねじ回し (太い把手、先端は指から離れている) -------------------------
  const tool = new THREE.Group()
  tool.visible = false
  // 短い工房用ドライバ。把手が太く、先端は指のずっと先にある。
  const blade = new THREE.Mesh(keep(new THREE.CylinderGeometry(1.05, 1.05, 3.2, 14)), mats.screw)
  blade.position.y = 1.6
  const bladeTip = new THREE.Mesh(keep(new THREE.BoxGeometry(2.9, 1.4, 0.5)), mats.screw)
  bladeTip.position.y = 0.55
  const handleBody = new THREE.Mesh(keep(new THREE.CylinderGeometry(3.2, 3.9, 6.6, 26)), mats.grip)
  handleBody.name = 'tool.grip'
  handleBody.position.y = TOOL_GRIP_Y
  handleBody.castShadow = true
  const collar = new THREE.Mesh(keep(new THREE.CylinderGeometry(2.0, 2.0, 1.1, 20)), mats.brass)
  collar.position.y = 2.5
  for (let i = 0; i < 8; i++) {
    const flute = new THREE.Mesh(keep(new THREE.BoxGeometry(1.05, 6.0, 1.05)), mats.grip)
    const a = (i / 8) * Math.PI * 2
    flute.position.set(Math.cos(a) * 3.2, TOOL_GRIP_Y, Math.sin(a) * 3.2)
    flute.rotation.y = -a
    tool.add(flute)
  }
  tool.add(blade, bladeTip, handleBody, collar)
  root.add(tool)

  const toolTip = new THREE.Vector3()
  const upY = new THREE.Vector3(0, 1, 0)
  const screwAxis = new THREE.Vector3().copy(TOOTH_NORMAL).negate()

  const knobTangent = new THREE.Vector3().crossVectors(U_RADIAL, new THREE.Vector3(1, 0, 0)).normalize()

  return {
    root,
    knobCentre,
    knobTangent,
    handleCentre,
    handleAxis: new THREE.Vector3(1, 0, 0),
    tool,
    toolTip,
    setKnob(travel: number) {
      const turns = travel / MESH.maxTravel
      knob.rotation.y = -turns * JIG.knobSweepDeg * (Math.PI / 180)
      nutBlock.position
        .copy(knobCentre)
        .addScaledVector(U_RADIAL, -NUT_DISTANCE - travel)
    },
    setHandle(angle: number) {
      const handleAngle = angle / JIG.handleToCylinder
      wheel.rotation.z = -handleAngle
      pulleyH.rotation.x = -handleAngle
      pulleyC.rotation.x = -angle
    },
    /** ハンドルの回転を確かめるための試験点 (world)。画面上の回転の向きを
     *  カメラから数値で求めるのに使う。 */
    handleProbe(spin: number, out: THREE.Vector3): THREE.Vector3 {
      out.set(Math.cos(-spin) * JIG.handleRadius, Math.sin(-spin) * JIG.handleRadius, 0)
      return wheelPivot.localToWorld(out)
    },
    setToolAt(head: THREE.Object3D | null, twist: number) {
      if (!head) {
        tool.visible = false
        return
      }
      tool.visible = true
      head.getWorldPosition(toolTip)
      toolTip.addScaledVector(screwAxis, 0.6)
      tool.position.copy(toolTip)
      tool.quaternion.setFromUnitVectors(upY, screwAxis)
      tool.rotateY(twist)
    },
  }
}

/** 二つの車に巻き付いた丸ベルト。接線と巻き付き円弧で閉じた実体を作る。 */
function buildBelt(
  keep: <T extends THREE.BufferGeometry>(g: T) => T,
  mats: Materials,
  cA: THREE.Vector3,
  rA: number,
  cB: THREE.Vector3,
  rB: number,
): THREE.Mesh {
  const ay = cA.y, az = cA.z, by = cB.y, bz = cB.z
  const dy = by - ay, dz = bz - az
  const dist = Math.hypot(dy, dz)
  const base = Math.atan2(dy, dz)
  // 外接接線 (同じ向きに回る掛け方)
  const alpha = Math.acos(Math.min(1, Math.max(-1, (rA - rB) / dist)))
  const pts: THREE.Vector3[] = []
  const x = (cA.x + cB.x) / 2
  const add = (cy: number, cz: number, r: number, a0: number, a1: number, steps: number) => {
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps
      pts.push(new THREE.Vector3(x, cy + Math.sin(a) * r, cz + Math.cos(a) * r))
    }
  }
  // A の巻き付き -> 接線 -> B の巻き付き -> 接線
  add(ay, az, rA, base + alpha, base + Math.PI * 2 - alpha, 22)
  add(by, bz, rB, base - alpha + Math.PI * 2, base + alpha, 22)
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.02)
  const geom = keep(new THREE.TubeGeometry(curve, 120, 0.85, 8, true))
  const belt = new THREE.Mesh(geom, mats.grip)
  belt.name = 'jig.belt'
  belt.castShadow = true
  return belt
}

