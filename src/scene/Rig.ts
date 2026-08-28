import * as THREE from 'three'
import { amiMass } from './Textures'
import { applyUnderwater } from './Water'

/**
 * A cylinder used as a line segment. The radius is nudged with distance
 * so nylon stays about two pixels wide instead of vanishing -- the one
 * place the game exaggerates scale on purpose.
 */
export class LineSeg {
  readonly mesh: THREE.Mesh
  private baseRadius: number
  private up = new THREE.Vector3(0, 1, 0)
  private dir = new THREE.Vector3()

  constructor(material: THREE.Material, radius: number, segments = 6) {
    const geo = new THREE.CylinderGeometry(1, 1, 1, segments, 1, true)
    geo.translate(0, 0.5, 0)
    this.mesh = new THREE.Mesh(geo, material)
    this.mesh.frustumCulled = false
    this.baseRadius = radius
  }

  /** `viewDist` is the world distance from the camera, supplied by the owner. */
  setEnds(a: THREE.Vector3, b: THREE.Vector3, viewDist?: number) {
    this.dir.subVectors(b, a)
    const len = this.dir.length()
    if (len < 1e-6) { this.mesh.visible = false; return }
    this.mesh.visible = true
    // nylon stays about two pixels wide at any distance
    const r = viewDist === undefined ? this.baseRadius : Math.max(this.baseRadius, viewDist * 0.0015)
    this.mesh.position.copy(a)
    this.mesh.quaternion.setFromUnitVectors(this.up, this.dir.normalize())
    this.mesh.scale.set(r, len, r)
  }
}

function irregularBlob(seed: number) {
  const geo = new THREE.IcosahedronGeometry(1, 1)
  const pos = geo.attributes.position as THREE.BufferAttribute
  let s = seed
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
  for (let i = 0; i < pos.count; i++) {
    const k = 0.62 + rnd() * 0.72
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.72, pos.getZ(i) * k * 0.86)
  }
  geo.computeVertexNormals()
  return geo
}

export interface HookState { load: number }

/**
 * Three-branch sabiki rig. Deliberately simplified to three droppers so
 * a child can see which points have taken krill and which have not; the
 * hooks stay small and are never the subject of a close-up.
 */
export class Rig {
  readonly group = new THREE.Group()
  readonly hooks: HookState[] = [{ load: 0 }, { load: 0 }, { load: 0 }]
  readonly hookNodes: THREE.Object3D[] = []
  /** vertical offsets of the three hook points below the rig top */
  readonly hookY = [-0.14, -0.24, -0.34]
  readonly bottomY = -0.42

  private trunk: LineSeg
  private arms: LineSeg[] = []
  private droppers: LineSeg[] = []
  private baitClumps: THREE.Mesh[][] = [[], [], []]
  private lineMat: THREE.Material
  private mats: THREE.Material[] = []
  private tmp = new THREE.Vector3()
  private tmp2 = new THREE.Vector3()

  constructor() {
    this.group.name = 'rig'
    this.lineMat = applyUnderwater(new THREE.MeshStandardMaterial({
      color: 0xd8dbd6, roughness: 0.32, metalness: 0.0, transparent: true, opacity: 0.88,
    }))
    const wireMat = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0x9fa5a3, roughness: 0.35, metalness: 0.8 }))
    this.mats.push(this.lineMat, wireMat)

    this.trunk = new LineSeg(this.lineMat, 0.0016)
    this.group.add(this.trunk.mesh)

    // swivel at the top so the rig reads as a made object
    const swivel = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.018, 8), wireMat)
    swivel.position.y = -0.012
    this.group.add(swivel)

    const a = amiMass(true)
    const baitMat = applyUnderwater(new THREE.MeshStandardMaterial({
      map: a.map, roughnessMap: a.roughnessMap, normalMap: a.normalMap,
      color: 0xffeade, roughness: 0.5, metalness: 0,
      transparent: true, opacity: 0.95,
    }))
    this.mats.push(baitMat)

    for (let i = 0; i < 3; i++) {
      const arm = new LineSeg(this.lineMat, 0.0013)
      const drop = new LineSeg(this.lineMat, 0.0011)
      this.arms.push(arm); this.droppers.push(drop)
      this.group.add(arm.mesh, drop.mesh)

      const node = new THREE.Group()
      node.position.set(0.062, this.hookY[i] - 0.028, 0)
      this.group.add(node)
      this.hookNodes.push(node)

      // hook: shank plus a bend, a few millimetres across
      const shank = new THREE.Mesh(new THREE.CylinderGeometry(0.0009, 0.0009, 0.016, 6), wireMat)
      shank.position.y = -0.006
      const bend = new THREE.Mesh(new THREE.TorusGeometry(0.0042, 0.0009, 5, 10, Math.PI * 1.25), wireMat)
      bend.position.y = -0.0155
      bend.rotation.z = Math.PI * 0.15
      node.add(shank, bend)

      for (let k = 0; k < 4; k++) {
        const clump = new THREE.Mesh(irregularBlob(1000 + i * 17 + k * 5), baitMat)
        const ang = (k / 4) * Math.PI * 2 + i
        clump.position.set(Math.cos(ang) * 0.004, -0.010 - k * 0.004, Math.sin(ang) * 0.004)
        clump.scale.setScalar(0.0001)
        clump.visible = false
        node.add(clump)
        this.baitClumps[i].push(clump)
      }
    }

    // teardrop sinker, dull cast lead
    const sinkMat = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0x77787a, roughness: 0.55, metalness: 0.55 }))
    this.mats.push(sinkMat)
    const sinker = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 10), sinkMat)
    sinker.scale.set(1, 1.7, 1)
    sinker.position.y = this.bottomY - 0.02
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.02, 10), sinkMat)
    cap.position.y = this.bottomY + 0.008
    this.group.add(sinker, cap)
  }

  get totalLoad() { return this.hooks.reduce((s, h) => s + h.load, 0) }

  addLoad(amount: number, atLocalX?: number) {
    // krill sticks where the rig is actually in the mass; when the whole
    // rig is drawn through, every branch picks some up
    for (let i = 0; i < 3; i++) {
      let w = 1
      if (atLocalX !== undefined) w = Math.max(0, 1 - Math.abs(atLocalX) / 0.3)
      this.hooks[i].load = THREE.MathUtils.clamp(this.hooks[i].load + amount * w * (0.82 + i * 0.09), 0, 2)
    }
    this.refreshBait()
  }

  setLoad(v: number) {
    for (const h of this.hooks) h.load = v
    this.refreshBait()
  }

  consume(i: number, amount: number) {
    this.hooks[i].load = Math.max(0, this.hooks[i].load - amount)
  }

  refreshBait() {
    for (let i = 0; i < 3; i++) {
      const load = this.hooks[i].load
      for (let k = 0; k < 4; k++) {
        const c = this.baitClumps[i][k]
        // one pass fills two clumps, a second pass fills all four and fattens them
        const share = THREE.MathUtils.clamp(load * 2 - k * 0.85, 0, 1.35)
        if (share <= 0.02) { c.visible = false; continue }
        c.visible = true
        const s = 0.004 + share * 0.0065
        c.scale.set(s, s * 0.8, s * 0.9)
      }
    }
  }

  hookWorld(i: number, target: THREE.Vector3) {
    return this.hookNodes[i].getWorldPosition(target)
  }

  update(camera: THREE.Camera) {
    const d = camera.position.distanceTo(this.group.getWorldPosition(this.tmp))
    this.tmp.set(0, 0, 0)
    this.tmp2.set(0, this.bottomY, 0)
    this.trunk.setEnds(this.tmp, this.tmp2, d)
    for (let i = 0; i < 3; i++) {
      this.tmp.set(0, this.hookY[i], 0)
      this.tmp2.set(0.062, this.hookY[i] - 0.006, 0)
      this.arms[i].setEnds(this.tmp, this.tmp2, d)
      this.tmp.copy(this.tmp2)
      this.tmp2.set(0.062, this.hookY[i] - 0.028, 0)
      this.droppers[i].setEnds(this.tmp, this.tmp2, d)
    }
  }

  dispose() { this.mats.forEach((m) => m.dispose()) }
}
