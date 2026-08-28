import * as THREE from 'three'
import { applyUnderwater } from './Water'
import { LineSeg } from './Rig'
import { paintedSteel } from './Textures'

const UP = new THREE.Vector3(0, 1, 0)

/**
 * Rod, holder and electric reel. The rod is a chain of tapered segments
 * so it can actually bend: the tip twitch on a bite is a real deflection
 * running down the blank, not a sprite.
 */
export class Tackle {
  readonly group = new THREE.Group()
  readonly buttPos = new THREE.Vector3(0.62, 1.03, 0.55)
  readonly rodLength = 1.80

  /** rod pointing out over the water */
  readonly dirSea = new THREE.Vector3(-0.57, 0.83, -1.57).normalize()
  /** rod stood up inboard, rig dangling into the bait bucket */
  readonly dirBait = new THREE.Vector3(-0.57, 1.56, 0.64).normalize()

  private root = new THREE.Group()
  private joints: THREE.Object3D[] = []
  private segLen: number
  private bend = 0
  private bendVel = 0
  private targetQuat = new THREE.Quaternion()
  private reelButton = new THREE.Object3D()
  private reel!: THREE.Group
  private reelAnchor = new THREE.Vector3()
  private spool!: THREE.Mesh
  private line: LineSeg
  private lineToGuide: LineSeg
  private mats: THREE.Material[] = []
  private tmpA = new THREE.Vector3()
  private tmpB = new THREE.Vector3()

  constructor() {
    this.group.name = 'tackle'
    const N = 12
    this.segLen = this.rodLength / N

    const blankMat = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0x22282b, roughness: 0.36, metalness: 0.12 }))
    const wrapMat = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0x6b2f2a, roughness: 0.6, metalness: 0.05 }))
    const gripMat = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0x3a3733, roughness: 0.92, metalness: 0.0 }))
    const metalMat = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0x9aa0a0, roughness: 0.4, metalness: 0.8 }))
    this.mats.push(blankMat, wrapMat, gripMat, metalMat)

    this.root.position.copy(this.buttPos)
    this.group.add(this.root)

    let parent: THREE.Object3D = this.root
    for (let i = 0; i < N; i++) {
      const j = new THREE.Group()
      j.position.y = i === 0 ? 0 : this.segLen
      parent.add(j)
      const r0 = 0.0115 * (1 - i / N) + 0.0022
      const r1 = 0.0115 * (1 - (i + 1) / N) + 0.0022
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, this.segLen, 8, 1, true), i < 2 ? gripMat : blankMat)
      seg.position.y = this.segLen / 2
      seg.castShadow = i > 1
      j.add(seg)
      if (i === 2) {
        const wrap = new THREE.Mesh(new THREE.CylinderGeometry(r0 * 1.12, r0 * 1.12, 0.03, 8), wrapMat)
        wrap.position.y = 0.02
        j.add(wrap)
      }
      if (i === 4 || i === 7 || i === 9 || i === 11) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(r1 * 2.6, 0.0016, 5, 12), metalMat)
        ring.position.set(0, this.segLen * 0.8, r1 * 2.4)
        ring.rotation.x = Math.PI / 2
        const foot = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.016, r1 * 2.4), metalMat)
        foot.position.set(0, this.segLen * 0.72, r1 * 1.3)
        j.add(ring, foot)
      }
      this.joints.push(j)
      parent = j
    }

    this.buildHolder(metalMat, gripMat)
    this.buildReel()

    const lineMat = applyUnderwater(new THREE.MeshStandardMaterial({
      color: 0xdadeda, roughness: 0.3, metalness: 0, transparent: true, opacity: 0.85,
    }))
    this.mats.push(lineMat)
    this.line = new LineSeg(lineMat, 0.0016)
    this.lineToGuide = new LineSeg(lineMat, 0.0016)
    this.group.add(this.line.mesh, this.lineToGuide.mesh)

    this.setPose('sea', true)
  }

  private buildHolder(metal: THREE.Material, grip: THREE.Material) {
    const holder = new THREE.Group()
    holder.position.copy(this.buttPos)
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.13, 12, 1, true), metal)
    cup.castShadow = true
    holder.add(cup)
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.02, 0.26), metal)
    arm.position.set(0, -0.03, -0.05)
    holder.add(arm)
    const clamp = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.052, 12, 1, true), metal)
    clamp.rotation.z = Math.PI / 2
    clamp.position.set(0, -0.11, -0.10)
    holder.add(clamp)
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.03, 8), grip)
    knob.rotation.x = Math.PI / 2
    knob.position.set(0.052, -0.11, -0.10)
    holder.add(knob)
    this.group.add(holder)
  }

  private buildReel() {
    const reel = new THREE.Group()
    const bodyMat = applyUnderwater(new THREE.MeshStandardMaterial({ ...paintedSteel('#4a5257'), color: 0xffffff, roughness: 0.44, metalness: 0.55 }))
    const rubberMat = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0x8e3a2c, roughness: 0.85, metalness: 0.0 }))
    const glassMat = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0x1b2124, roughness: 0.18, metalness: 0.1 }))
    const lineMat = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0xb9a98c, roughness: 0.7, metalness: 0 }))
    this.mats.push(bodyMat, rubberMat, glassMat, lineMat)

    for (const sx of [-1, 1]) {
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.014, 20), bodyMat)
      plate.rotation.z = Math.PI / 2
      plate.position.x = sx * 0.041
      plate.castShadow = true
      reel.add(plate)
    }
    this.spool = new THREE.Mesh(new THREE.CylinderGeometry(0.030, 0.030, 0.070, 18), lineMat)
    this.spool.rotation.z = Math.PI / 2
    reel.add(this.spool)
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.096, 0.030, 0.062), bodyMat)
    frame.position.y = -0.038
    reel.add(frame)
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.03), bodyMat)
    foot.position.y = -0.060
    reel.add(foot)
    // control face: a big rubber jog dial and a dark, unlit display lens
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.090, 0.015, 0.052), bodyMat)
    panel.position.set(0, 0.052, 0.0)
    reel.add(panel)
    const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.023, 0.016, 20), rubberMat)
    dial.position.set(-0.018, 0.066, 0.0)
    dial.castShadow = true
    reel.add(dial)
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      const nub = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.017, 0.006), rubberMat)
      nub.position.set(-0.018 + Math.cos(a) * 0.021, 0.066, Math.sin(a) * 0.021)
      nub.rotation.y = -a
      reel.add(nub)
    }
    const lens = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.004, 0.02), glassMat)
    lens.position.set(0.026, 0.061, 0)
    reel.add(lens)
    this.reelButton.position.set(-0.018, 0.078, 0)
    reel.add(this.reelButton)

    // the reel rides on the rod but stays upright: it is a control the
    // child has to find and hold, so it must not roll out of view
    reel.scale.setScalar(1.35)
    this.reel = reel
    this.group.add(reel)
  }

  setPose(pose: 'sea' | 'bait', immediate = false) {
    const dir = pose === 'sea' ? this.dirSea : this.dirBait
    this.targetQuat.setFromUnitVectors(UP, dir)
    if (immediate) this.root.quaternion.copy(this.targetQuat)
  }

  /** A bite: a short, sharp deflection that runs out of the blank. */
  twitch(strength = 1) {
    this.bendVel -= 5.2 * strength
  }

  /** Steady load, e.g. while the reel is winding a fish up. */
  setLoad(v: number) { this.loadTarget = v }
  private loadTarget = 0

  spinSpool(dt: number, rate: number) {
    this.spool.rotation.x += dt * rate
  }

  /** Keep the reel at the 0.33 m mark of the blank, upright. */
  private placeReel() {
    const j = this.joints[1]
    j.updateWorldMatrix(true, false)
    this.reelAnchor.set(0, this.segLen * 1.2, 0).applyMatrix4(j.matrixWorld)
    this.getTipWorld(this.tmpA)
    this.tmpB.subVectors(this.tmpA, this.buttPos)
    this.tmpB.y = 0
    if (this.tmpB.lengthSq() < 1e-6) this.tmpB.set(0, 0, -1)
    this.tmpB.normalize()
    this.reel.position.copy(this.reelAnchor)
    this.reel.position.y += 0.055
    this.reel.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), this.tmpB)
  }

  getTipWorld(target: THREE.Vector3) {
    const last = this.joints[this.joints.length - 1]
    last.updateWorldMatrix(true, false)
    target.set(0, this.segLen, 0).applyMatrix4(last.matrixWorld)
    return target
  }

  getReelButtonWorld(target: THREE.Vector3) {
    this.reelButton.updateWorldMatrix(true, false)
    return target.setFromMatrixPosition(this.reelButton.matrixWorld)
  }

  /** Draw the line from the rod tip to the rig, optionally via the guide. */
  updateLine(rigTop: THREE.Vector3, via: THREE.Vector3 | null, camera: THREE.Camera) {
    this.getTipWorld(this.tmpA)
    const d = camera.position.distanceTo(this.tmpA)
    if (via) {
      this.line.setEnds(this.tmpA, via, d)
      this.lineToGuide.mesh.visible = true
      this.lineToGuide.setEnds(via, rigTop, camera.position.distanceTo(via))
    } else {
      this.line.setEnds(this.tmpA, rigTop, d)
      this.lineToGuide.mesh.visible = false
    }
  }

  update(dt: number) {
    this.root.quaternion.slerp(this.targetQuat, Math.min(1, dt * 2.6))
    this.placeReel()
    // damped spring on the blank
    const k = 46, c = 7.5
    const acc = (this.loadTarget - this.bend) * k - this.bendVel * c
    this.bendVel += acc * dt
    this.bend += this.bendVel * dt
    this.bend = THREE.MathUtils.clamp(this.bend, -0.5, 1.6)
    for (let i = 0; i < this.joints.length; i++) {
      const w = Math.pow((i + 1) / this.joints.length, 1.9)
      this.joints[i].rotation.x = (i === 0 ? 0 : 0.008) + this.bend * w * 0.085
    }
  }

  dispose() { this.mats.forEach((m) => m.dispose()) }
}
