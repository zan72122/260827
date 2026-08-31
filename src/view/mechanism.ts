/**
 * 機構の実ジオメトリ / the real geometry of the movement.
 *
 * シリンダー、ピン、櫛歯、台座、ねじ、フレーム、軸受けをすべて実体で
 * 作ります。歯の根元は台座に挟まれていて宙に浮きません。ピンは筒に
 * 埋まっていて浮きません。裏側も作ってあります。
 */

import * as THREE from 'three'
import { COMB, CYLINDER, LAYOUT, MOVEMENT, PIN_TIP_RADIUS } from '../core/spec.ts'
import { cantileverProfile, toothRestRadius } from '../core/mechanics.ts'
import { toothAxialPosition, toothWeightHeight, toothWidth } from '../core/song.ts'
import type { Pin } from '../core/mechanics.ts'
import type { Materials } from './materials.ts'

const DEG = Math.PI / 180

/** 接触点の方位 (YZ 平面)。+Z を 0 とし、下向きが負。 */
export const CONTACT_BETA = LAYOUT.contactAngleDeg * DEG
/** 接触点での半径方向 (外向き)。噛み合い調整はこの向きに動かす。 */
export const U_RADIAL = new THREE.Vector3(0, Math.sin(CONTACT_BETA), Math.cos(CONTACT_BETA))
/** 接触点での接線方向 (回転が進む向き)。 */
export const T_TANGENT = new THREE.Vector3(
  0,
  Math.sin(CONTACT_BETA + Math.PI / 2),
  Math.cos(CONTACT_BETA + Math.PI / 2),
)
/** シリンダー軸の位置。 */
export const AXIS = new THREE.Vector3(0, LAYOUT.axisY, LAYOUT.axisZ)

const TILT = COMB.tiltDeg * DEG
/** 歯の根元 → 自由端の向き。歯先だけがシリンダーに一番近くなるよう傾けてある。 */
export const TOOTH_DIR = new THREE.Vector3()
  .copy(T_TANGENT)
  .multiplyScalar(Math.cos(TILT))
  .addScaledVector(U_RADIAL, Math.sin(TILT))
  .negate()
  .normalize()
/** 歯がたわむ向き (外向き、歯の面に垂直)。 */
export const TOOTH_NORMAL = new THREE.Vector3()
  .copy(T_TANGENT)
  .multiplyScalar(-Math.sin(TILT))
  .addScaledVector(U_RADIAL, Math.cos(TILT))
  .normalize()

/**
 * 半径方向の噛み合い深さ e に対して、歯先が実際に動く距離。
 * 歯は自分の面に垂直にたわむので、半径方向に e だけ逃げるには
 * e / cos(傾き) だけ曲がる必要がある。
 */
export const BEND_PER_RADIAL = 1 / Math.cos(TILT)

interface BendMaterial {
  material: THREE.MeshStandardMaterial
  uniforms: { uSlopeScale: { value: number } }
}

/** 片持ち梁のたわみを頂点シェーダで作る。歯ごとの変形は 1 本の属性だけ。 */
function makeBendMaterial(base: THREE.MeshStandardMaterial, slopeScale: number): BendMaterial {
  const material = base.clone()
  const uniforms = { uSlopeScale: { value: slopeScale } }
  material.onBeforeCompile = (shader) => {
    shader.uniforms['uSlopeScale'] = uniforms.uSlopeScale
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aDeflect;
uniform float uSlopeScale;
float combProfile(float z) { return (3.0 * z * z - z * z * z) * 0.5; }`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
{
  float zn = clamp(position.z, 0.0, 1.0);
  float sl = aDeflect * (3.0 * zn - 1.5 * zn * zn) * uSlopeScale;
  objectNormal = normalize(vec3(
    objectNormal.x,
    objectNormal.y - sl * objectNormal.z,
    objectNormal.z + sl * objectNormal.y));
}`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
transformed.y += aDeflect * combProfile(clamp(position.z, 0.0, 1.0));`,
      )
  }
  material.customProgramCacheKey = () => `comb-bend-${slopeScale.toFixed(4)}`
  return { material, uniforms }
}

function boxFrom(
  x0: number, x1: number, y0: number, y1: number, z0: number, z1: number,
): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0)
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
  return g
}

/** 穴の空いた板 (軸受けブラケットなど)。 */
function platedWithBore(w: number, h: number, bore: number, thick: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape()
  const r = 1.4
  shape.moveTo(-w / 2 + r, 0)
  shape.lineTo(w / 2 - r, 0)
  shape.quadraticCurveTo(w / 2, 0, w / 2, r)
  shape.lineTo(w / 2, h - r)
  shape.quadraticCurveTo(w / 2, h, w / 2 - r, h)
  shape.lineTo(-w / 2 + r, h)
  shape.quadraticCurveTo(-w / 2, h, -w / 2, h - r)
  shape.lineTo(-w / 2, r)
  shape.quadraticCurveTo(-w / 2, 0, -w / 2 + r, 0)
  const hole = new THREE.Path()
  hole.absarc(0, h - w / 2, bore, 0, Math.PI * 2, true)
  shape.holes.push(hole)
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 20 })
  g.translate(0, 0, -thick / 2)
  return g
}

export interface Mechanism {
  root: THREE.Group
  cylinder: THREE.Group
  comb: THREE.Group
  combTeeth: THREE.InstancedMesh
  screwHeads: THREE.Object3D[]
  contactPoint: THREE.Vector3
  setRotation(theta: number): void
  setEngagement(engagement: number): void
  setDeflections(mm: Float32Array): void
  setScrew(index: number, progress: number): void
}

export function buildMechanism(
  mats: Materials,
  pins: readonly Pin[],
): Mechanism {
  const root = new THREE.Group()
  const disposables: THREE.BufferGeometry[] = []
  const keep = <T extends THREE.BufferGeometry>(g: T): T => {
    disposables.push(g)
    return g
  }

  // ---- ベッドプレートと響板 -------------------------------------------------
  const bedZ0 = LAYOUT.bedZ - MOVEMENT.bedDepth / 2
  const bedZ1 = LAYOUT.bedZ + MOVEMENT.bedDepth / 2
  const bed = new THREE.Mesh(
    keep(boxFrom(-MOVEMENT.bedWidth / 2, MOVEMENT.bedWidth / 2, 0, MOVEMENT.bedThickness, bedZ0, bedZ1)),
    mats.frame,
  )
  bed.name = 'mech.bed'
  bed.receiveShadow = true
  root.add(bed)

  const board = new THREE.Mesh(
    keep(boxFrom(-52, 52, -5.2, 0, bedZ0 - 5, bedZ1 + 1)),
    mats.wood,
  )
  board.name = 'mech.soundboard'
  board.receiveShadow = true
  root.add(board)

  // ---- 軸受けブラケット ----------------------------------------------------
  for (const sx of [-1, 1]) {
    const bracket = new THREE.Mesh(
      keep(platedWithBore(13, LAYOUT.axisY - MOVEMENT.bedThickness + 6.5, CYLINDER.arborRadius + 0.12, 2.6)),
      mats.frame,
    )
    bracket.name = 'mech.bearing'
    bracket.rotation.y = Math.PI / 2
    bracket.position.set(sx * LAYOUT.bearingX, MOVEMENT.bedThickness, LAYOUT.axisZ)
    bracket.castShadow = true
    bracket.receiveShadow = true
    root.add(bracket)
    // 台座のフィレット
    const foot = new THREE.Mesh(keep(boxFrom(-1.6, 1.6, 0, 2.2, -7.5, 7.5)), mats.frame)
    foot.position.set(sx * LAYOUT.bearingX, MOVEMENT.bedThickness, LAYOUT.axisZ)
    foot.castShadow = true
    root.add(foot)
  }

  // ---- シリンダー ----------------------------------------------------------
  const cylinder = new THREE.Group()
  cylinder.position.copy(AXIS)
  root.add(cylinder)

  const body = new THREE.Mesh(
    keep(new THREE.CylinderGeometry(CYLINDER.bodyRadius, CYLINDER.bodyRadius, CYLINDER.pinnedLength, 56, 1)),
    mats.cylinder,
  )
  body.name = 'mech.cylinder'
  body.rotation.z = Math.PI / 2
  body.castShadow = true
  body.receiveShadow = true
  cylinder.add(body)

  for (const sx of [-1, 1]) {
    const flange = new THREE.Mesh(
      keep(new THREE.CylinderGeometry(7.4, 7.4, 1.5, 40, 1)),
      mats.frame,
    )
    flange.name = 'mech.flange'
    flange.rotation.z = Math.PI / 2
    flange.position.x = sx * (CYLINDER.pinnedLength / 2 + 0.75)
    flange.castShadow = true
    cylinder.add(flange)
  }

  const arbor = new THREE.Mesh(
    keep(new THREE.CylinderGeometry(CYLINDER.arborRadius, CYLINDER.arborRadius, 56, 20, 1)),
    mats.frame,
  )
  arbor.name = 'mech.arbor'
  arbor.rotation.z = Math.PI / 2
  arbor.position.x = 3
  arbor.castShadow = true
  cylinder.add(arbor)

  // ピン: 丸線を植えたもの。半分は筒に埋まっている。
  const pinGeom = keep(new THREE.CapsuleGeometry(CYLINDER.pinRadius, CYLINDER.pinProtrusion * 2 - CYLINDER.pinRadius * 2, 3, 8))
  const pinMesh = new THREE.InstancedMesh(pinGeom, mats.pin, pins.length)
  pinMesh.name = 'mech.pins'
  pinMesh.castShadow = true
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const dir = new THREE.Vector3()
  const pos = new THREE.Vector3()
  const one = new THREE.Vector3(1, 1, 1)
  pins.forEach((pin, i) => {
    const a = CONTACT_BETA - pin.angle
    dir.set(0, Math.sin(a), Math.cos(a))
    q.setFromUnitVectors(up, dir)
    pos.set(toothAxialPosition(pin.tooth), dir.y * CYLINDER.bodyRadius, dir.z * CYLINDER.bodyRadius)
    pinMesh.setMatrixAt(i, m.compose(pos, q, one))
  })
  pinMesh.instanceMatrix.needsUpdate = true
  cylinder.add(pinMesh)

  // ---- 櫛歯ブロック (スライド上に乗っていて、丸ごと動く) --------------------
  const comb = new THREE.Group()
  const basis = new THREE.Matrix4().makeBasis(
    new THREE.Vector3().crossVectors(TOOTH_NORMAL, TOOTH_DIR).normalize(),
    TOOTH_NORMAL,
    TOOTH_DIR,
  )
  comb.quaternion.setFromRotationMatrix(basis)
  root.add(comb)

  const L = COMB.freeLength
  const th = COMB.thickness
  const toothGeom = keep(new THREE.BoxGeometry(1, 1, 1, 1, 1, 12))
  toothGeom.translate(0, 0, 0.5)

  const teethMat = makeBendMaterial(mats.comb, th / L)
  const combTeeth = new THREE.InstancedMesh(toothGeom, teethMat.material, COMB.teeth)
  combTeeth.name = 'mech.teeth'
  combTeeth.castShadow = true
  const deflectAttr = new THREE.InstancedBufferAttribute(new Float32Array(COMB.teeth), 1)
  toothGeom.setAttribute('aDeflect', deflectAttr)

  const wearGeom = keep(new THREE.BoxGeometry(1, 1, 1, 1, 1, 2))
  wearGeom.translate(0, -0.53, 0.965)
  wearGeom.scale(1, 0.06, 0.07)
  const wearMat = makeBendMaterial(mats.combWear, th / L)
  const wear = new THREE.InstancedMesh(wearGeom, wearMat.material, COMB.teeth)
  wear.name = 'mech.toothWear'
  wearGeom.setAttribute('aDeflect', deflectAttr)

  const weightGeom = keep(new THREE.BoxGeometry(1, 1, 1, 1, 1, 3))
  weightGeom.translate(0, 0.5, 0.815)
  weightGeom.scale(1, 1, 0.24)
  const weightMat = makeBendMaterial(mats.lead, 1 / L)
  const weightCount = COMB.weightedTeeth
  const weights = new THREE.InstancedMesh(weightGeom, weightMat.material, weightCount)
  weights.name = 'mech.tipWeights'
  weights.castShadow = true
  const weightDeflect = new THREE.InstancedBufferAttribute(new Float32Array(weightCount), 1)
  weightGeom.setAttribute('aDeflect', weightDeflect)

  const weightScale: number[] = []
  for (let t = 0; t < COMB.teeth; t++) {
    const w = toothWidth(t)
    const x = toothAxialPosition(t)
    combTeeth.setMatrixAt(t, m.compose(pos.set(x, 0, 0), q.identity(), dir.set(w, th, L)))
    wear.setMatrixAt(t, m.compose(pos.set(x, 0, 0), q.identity(), dir.set(w * 0.86, th, L)))
    const wh = toothWeightHeight(t)
    if (t < weightCount) {
      weightScale.push(wh)
      weights.setMatrixAt(t, m.compose(pos.set(x, th / 2, 0), q.identity(), dir.set(w * 0.94, wh, L)))
    }
  }
  combTeeth.instanceMatrix.needsUpdate = true
  wear.instanceMatrix.needsUpdate = true
  weights.instanceMatrix.needsUpdate = true
  comb.add(combTeeth, wear, weights)

  // 根元を挟む台座と押さえ板。歯の根元は必ずここに挟まれている。
  const halfSpan = ((COMB.teeth - 1) * COMB.pitch) / 2 + 2.6
  const base = new THREE.Mesh(
    keep(boxFrom(-halfSpan - 2.4, halfSpan + 2.4, th / 2, th / 2 + COMB.baseHeight, -COMB.baseLength, 0.4)),
    mats.frame,
  )
  base.name = 'mech.combBase'
  base.castShadow = true
  base.receiveShadow = true
  comb.add(base)
  const clamp = new THREE.Mesh(
    keep(boxFrom(-halfSpan - 2.4, halfSpan + 2.4, -th / 2 - 1.1, -th / 2, -COMB.baseLength, 0.9)),
    mats.frame,
  )
  clamp.name = 'mech.combClamp'
  clamp.castShadow = true
  comb.add(clamp)

  // 固定ねじ (押さえ板を貫いて台座へ)。工具で締めると頭が回って沈む。
  const screwHeads: THREE.Object3D[] = []
  const headGeom = keep(new THREE.CylinderGeometry(1.55, 1.75, 0.9, 24))
  const slotGeom = keep(boxFrom(-1.35, 1.35, 0.24, 0.46, -0.19, 0.19))
  const shankGeom = keep(new THREE.CylinderGeometry(0.85, 0.85, COMB.baseHeight + 2.4, 14))
  for (const sx of LAYOUT.screwX) {
    const g = new THREE.Group()
    g.position.set(sx, -th / 2 - 1.1, -COMB.baseLength * 0.45)
    const head = new THREE.Mesh(headGeom, mats.screw)
    head.name = 'mech.screwHead'
    head.rotation.x = Math.PI
    head.castShadow = true
    const slot = new THREE.Mesh(slotGeom, mats.slot)
    slot.position.y = -0.12
    const shank = new THREE.Mesh(shankGeom, mats.screw)
    shank.position.y = (COMB.baseHeight + 2.4) / 2
    g.add(head, slot, shank)
    comb.add(g)
    screwHeads.push(g)
  }

  // スライドの案内。ベッドに固定された傾斜台の上を、櫛の台座がすべる。
  // 動く向きは常に半径方向 (U_RADIAL) の一本道で、倍率も一定。
  const combOuter = new THREE.Vector3()
  for (const sx of [-1, 1]) {
    combOuter
      .copy(AXIS)
      .addScaledVector(U_RADIAL, PIN_TIP_RADIUS + 0.1)
      .addScaledVector(TOOTH_DIR, -L)
      .addScaledVector(TOOTH_NORMAL, COMB.baseHeight + th)
      .addScaledVector(TOOTH_DIR, -COMB.baseLength * 0.6)
    const pad = new THREE.Mesh(keep(boxFrom(-3.4, 3.4, -0.9, 0.9, -4.6, 4.6)), mats.frame)
    pad.name = 'mech.slidePad'
    pad.position.set(sx * 13.5, combOuter.y - 0.9, combOuter.z)
    pad.quaternion.setFromRotationMatrix(basis)
    pad.castShadow = true
    pad.receiveShadow = true
    root.add(pad)
    const post = new THREE.Mesh(keep(boxFrom(-3.0, 3.0, 0, 1, -3.6, 3.6)), mats.frame)
    post.name = 'mech.slidePost'
    post.position.set(sx * 13.5, MOVEMENT.bedThickness, combOuter.z)
    post.scale.y = Math.max(0.6, pad.position.y - MOVEMENT.bedThickness - 0.4)
    post.castShadow = true
    post.receiveShadow = true
    root.add(post)
    // 抜け止めの押さえ金具 (すべり面を上から押さえる)
    const gib = new THREE.Mesh(keep(boxFrom(-1.1, 1.1, -0.7, 0.7, -4.0, 4.0)), mats.screw)
    gib.name = 'mech.gib'
    gib.position.set(sx * 17.4, combOuter.y - 0.3, combOuter.z)
    gib.quaternion.setFromRotationMatrix(basis)
    root.add(gib)
  }

  // ---- 更新関数 ------------------------------------------------------------
  const combHome = new THREE.Vector3()
  const contactPoint = new THREE.Vector3()

  const placeComb = (engagement: number) => {
    const d = toothRestRadius(engagement)
    combHome
      .copy(AXIS)
      .addScaledVector(U_RADIAL, d)
      .addScaledVector(TOOTH_DIR, -L)
    comb.position.copy(combHome)
    contactPoint.copy(AXIS).addScaledVector(U_RADIAL, (d + PIN_TIP_RADIUS) / 2)
  }
  placeComb(-0.1)

  const screwSink = LAYOUT.screwX.map(() => 0)

  return {
    root,
    cylinder,
    comb,
    combTeeth,
    screwHeads,
    contactPoint,
    setRotation(theta: number) {
      cylinder.rotation.x = -theta
    },
    setEngagement(engagement: number) {
      placeComb(engagement)
    },
    setDeflections(mmArr: Float32Array) {
      const a = deflectAttr.array as Float32Array
      const b = weightDeflect.array as Float32Array
      for (let t = 0; t < COMB.teeth; t++) {
        const bend = (mmArr[t] ?? 0) * BEND_PER_RADIAL
        a[t] = bend / th
        if (t < weightCount) b[t] = bend / Math.max(1e-4, weightScale[t] ?? 1)
      }
      deflectAttr.needsUpdate = true
      weightDeflect.needsUpdate = true
    },
    setScrew(index: number, progress: number) {
      const g = screwHeads[index]
      if (!g) return
      const p = Math.min(1, Math.max(0, progress))
      screwSink[index] = p
      g.rotation.y = -p * 6 * Math.PI
      g.position.y = -th / 2 - 1.1 + p * 0.36
    },
  }
}

export { cantileverProfile }
