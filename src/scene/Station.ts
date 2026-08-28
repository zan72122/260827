import * as THREE from 'three'
import { applyUnderwater, QUAY_Z } from './Water'
import { resin } from './Textures'

/**
 * The attendant's hands. An adult sets and steadies the rig; only the
 * gloved hands and forearms come into frame, which is all the child ever
 * needs to see of them. The near hand holds the line at the mouth of the
 * guide, and gives it a small steadying move when the child hesitates.
 */
export class Attendant {
  readonly group = new THREE.Group()
  private hand = new THREE.Group()
  private upper!: THREE.Mesh
  private fore!: THREE.Mesh
  private shoulder = new THREE.Vector3(0.78, 1.40, 1.30)
  private steadyT = -1
  private anchor = new THREE.Vector3(-0.06, 1.60, 1.06)
  private anchorRot = new THREE.Euler(0.28, 0.30, -0.42)
  private handPos = new THREE.Vector3()
  private elbow = new THREE.Vector3()
  private tmp = new THREE.Vector3()
  private tmp2 = new THREE.Vector3()
  private mats: THREE.Material[] = []

  constructor() {
    this.group.name = 'attendant'
    // rubber-palmed work glove, wet: dark grip, pale knit back
    const gloveMat = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0x2a333a, roughness: 0.45, metalness: 0.02 }))
    const knitMat = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0x76796f, roughness: 0.96, metalness: 0 }))
    const jacketMat = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0x39434e, roughness: 0.92, metalness: 0 }))
    const trouserMat = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0x4a4d47, roughness: 0.95, metalness: 0 }))
    const bootMat = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0x23282a, roughness: 0.6, metalness: 0 }))
    const skinMat = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0xb28c72, roughness: 0.78, metalness: 0 }))
    this.mats.push(gloveMat, knitMat, jacketMat, trouserMat, bootMat, skinMat)

    // ---- the hand that works the line, built at the origin ----
    const palm = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.05, 4, 10), knitMat)
    palm.scale.set(1, 1, 0.52)
    palm.castShadow = true
    this.hand.add(palm)
    const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.024, 0.046, 4, 10), gloveMat)
    grip.scale.set(1, 1, 0.3)
    grip.position.set(0, -0.006, -0.014)
    this.hand.add(grip)
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Group()
      f.position.set(-0.019 + i * 0.0127, -0.044, -0.004)
      const p1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.0062, 0.026, 3, 6), gloveMat)
      p1.position.y = -0.014
      f.add(p1)
      const p2 = new THREE.Mesh(new THREE.CapsuleGeometry(0.0058, 0.02, 3, 6), gloveMat)
      p2.position.set(0, -0.036, -0.008)
      p2.rotation.x = -0.9
      f.add(p2)
      f.rotation.x = 0.15 + i * 0.05
      this.hand.add(f)
    }
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.0075, 0.03, 3, 6), gloveMat)
    thumb.position.set(0.03, -0.03, -0.012)
    thumb.rotation.set(-0.5, 0, 0.8)
    this.hand.add(thumb)
    const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.029, 0.05, 12), gloveMat)
    wrist.position.y = 0.058
    this.hand.add(wrist)
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.030, 0.032, 12), knitMat)
    cuff.position.y = 0.092
    this.hand.add(cuff)
    this.hand.position.copy(this.anchor)
    this.hand.rotation.copy(this.anchorRot)
    this.group.add(this.hand)

    // ---- two bone arm from the shoulder down to that hand ----
    const seg = (r0: number, r1: number, mat: THREE.Material) => {
      const g = new THREE.CylinderGeometry(r1, r0, 1, 10, 1)
      g.translate(0, 0.5, 0)
      const m = new THREE.Mesh(g, mat)
      m.castShadow = true
      this.group.add(m)
      return m
    }
    this.upper = seg(0.058, 0.048, jacketMat)
    this.fore = seg(0.048, 0.038, jacketMat)

    // ---- the rest of the attendant: an adult standing at the station ----
    const body = new THREE.Group()
    // the attendant stands to the far side of the bench, facing the tub,
    // close enough that the arm holding the line actually reaches it
    body.position.set(-0.55, 0, 1.16)
    body.rotation.y = 0.35
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.20, 0.34, 6, 14), jacketMat)
    torso.scale.set(1, 1, 0.62)
    torso.position.y = 1.18
    torso.castShadow = true
    body.add(torso)
    const hips = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.14, 4, 12), trouserMat)
    hips.scale.set(1, 1, 0.68)
    hips.position.y = 0.90
    body.add(hips)
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.088, 0.80, 10), trouserMat)
      leg.position.set(sx * 0.11, 0.50, 0)
      leg.castShadow = true
      body.add(leg)
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.19, 0.26), bootMat)
      boot.position.set(sx * 0.11, 0.095, 0.03)
      boot.castShadow = true
      boot.receiveShadow = true
      body.add(boot)
    }
    // left arm hangs at the side; the right arm is the working one above
    const larm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.042, 0.56, 10), jacketMat)
    larm.position.set(-0.24, 1.10, 0.02)
    larm.rotation.z = 0.12
    body.add(larm)
    const lhand = new THREE.Mesh(new THREE.CapsuleGeometry(0.036, 0.05, 4, 10), gloveMat)
    lhand.position.set(-0.28, 0.78, 0.02)
    body.add(lhand)
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.07, 10), skinMat)
    neck.position.y = 1.44
    body.add(neck)
    const head = new THREE.Mesh(new THREE.CapsuleGeometry(0.088, 0.07, 6, 14), skinMat)
    head.scale.set(1, 1, 0.92)
    head.position.y = 1.545
    head.castShadow = true
    body.add(head)
    const capMat = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0x2f3a44, roughness: 0.9 }))
    this.mats.push(capMat)
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.097, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.72), capMat)
    cap.position.y = 1.582
    cap.castShadow = true
    body.add(cap)
    const peak = new THREE.Mesh(new THREE.BoxGeometry(0.165, 0.014, 0.095), capMat)
    peak.position.set(0, 1.566, 0.105)
    peak.rotation.x = -0.16
    body.add(peak)
    this.group.add(body)
    // the shoulder the working arm hangs from, in world space
    // right shoulder in world space, from the body transform above
    this.shoulder.set(-0.55 + 0.20 * Math.cos(0.35), 1.34, 1.16 - 0.20 * Math.sin(0.35))
  }

  /** Steady the top of the rig: a small, quiet motion, no pointing. */
  steady() { if (this.steadyT < 0) this.steadyT = 0 }

  /** Move the hand to another working position (guide, reel, out of frame). */
  setAnchor(p: THREE.Vector3, rot: THREE.Euler) {
    this.anchor.copy(p)
    this.anchorRot.copy(rot)
  }

  setVisible(v: boolean) { this.group.visible = v }

  private aim(m: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3, r: number) {
    this.tmp2.subVectors(to, from)
    const len = this.tmp2.length()
    m.position.copy(from)
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.tmp2.normalize())
    m.scale.set(r, len, r)
  }

  update(dt: number, t: number) {
    const k = Math.min(1, dt * 2.2)
    this.hand.position.lerp(this.anchor, k)
    this.hand.rotation.x += (this.anchorRot.x - this.hand.rotation.x) * k
    this.hand.rotation.y += (this.anchorRot.y - this.hand.rotation.y) * k
    this.hand.rotation.z += (this.anchorRot.z - this.hand.rotation.z) * k
    this.hand.position.y += Math.sin(t * 0.7) * 0.0016
    if (this.steadyT >= 0) {
      this.steadyT += dt
      const p = Math.min(1, this.steadyT / 1.5)
      const e = Math.sin(p * Math.PI)
      this.hand.position.y -= e * 0.016
      this.hand.rotation.z += e * 0.06
      if (p >= 1) this.steadyT = -1
    }
    // two bone arm: elbow swings out and down from the shoulder
    this.handPos.copy(this.hand.position)
    this.handPos.y += 0.11
    const upperLen = 0.34, foreLen = 0.30
    this.tmp.subVectors(this.handPos, this.shoulder)
    const d = Math.min(this.tmp.length(), upperLen + foreLen - 0.01)
    this.tmp.normalize()
    const a = (upperLen * upperLen - foreLen * foreLen + d * d) / (2 * d)
    const h = Math.sqrt(Math.max(0, upperLen * upperLen - a * a))
    this.elbow.copy(this.shoulder).addScaledVector(this.tmp, a)
    // push the elbow outboard and down, the way an arm actually folds
    this.tmp2.set(-this.tmp.z, -0.55, this.tmp.x).normalize()
    this.elbow.addScaledVector(this.tmp2, h)
    this.aim(this.upper, this.shoulder, this.elbow, 1)
    this.aim(this.fore, this.elbow, this.handPos, 1)
    this.upper.scale.set(0.052, this.upper.scale.y, 0.052)
    this.fore.scale.set(0.042, this.fore.scale.y, 0.042)
  }

  dispose() { this.mats.forEach((m) => m.dispose()) }
}

/**
 * Automatic hook releaser and the observation tank. The child never
 * handles a hook: the rig runs up through the releaser's V channel, the
 * fish comes off into the chute and slides into the tank.
 */
export class Releaser {
  readonly group = new THREE.Group()
  /** where the rig passes through the releaser */
  readonly gateWorld = new THREE.Vector3(-0.62, 1.10, QUAY_Z + 0.28)
  readonly tankWorld = new THREE.Vector3(-1.34, 0.62, QUAY_Z + 0.85)
  readonly tankInner = { w: 0.44, d: 0.28, top: 0.70, bottom: 0.44 }

  private mats: THREE.Material[] = []
  private waterMesh!: THREE.Mesh

  constructor() {
    this.group.name = 'releaser'
    const steel = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0xa8aeae, roughness: 0.34, metalness: 0.85 }))
    const nylon = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0xdad6c8, roughness: 0.55, metalness: 0 }))
    this.mats.push(steel, nylon)

    // V channel over the rail
    for (const sx of [-1, 1]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.062, 0.055), steel)
      plate.position.set(this.gateWorld.x + sx * 0.022, this.gateWorld.y + 0.01, this.gateWorld.z)
      plate.rotation.z = sx * 0.30
      plate.castShadow = true
      this.group.add(plate)
      const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.018, 12), nylon)
      roller.rotation.x = Math.PI / 2
      roller.position.set(this.gateWorld.x + sx * 0.016, this.gateWorld.y + 0.042, this.gateWorld.z)
      this.group.add(roller)
    }
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.02), steel)
    post.position.set(this.gateWorld.x, this.gateWorld.y - 0.06, this.gateWorld.z)
    const clamp = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.045, 12, 1, true), steel)
    clamp.rotation.z = Math.PI / 2
    clamp.position.set(this.gateWorld.x, 1.02, QUAY_Z + 0.30)
    this.group.add(post, clamp)

    // chute: a shallow trough sloping from the releaser to the tank
    const chuteMat = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0x7e8a86, roughness: 0.5, metalness: 0.2, side: THREE.DoubleSide }))
    this.mats.push(chuteMat)
    const chute = new THREE.Group()
    const len = 0.62
    const floor = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.005, len), chuteMat)
    chute.add(floor)
    for (const sx of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.036, len), chuteMat)
      w.position.set(sx * 0.05, 0.018, 0)
      chute.add(w)
    }
    chute.position.set(-0.99, 0.90, QUAY_Z + 0.58)
    chute.rotation.set(0, 1.35, 0)
    chute.rotateX(0.30)
    this.group.add(chute)

    this.buildTank()
  }

  private buildTank() {
    const ro = resin(false)
    const tubMat = applyUnderwater(new THREE.MeshStandardMaterial({
      map: ro.map, roughnessMap: ro.roughnessMap, color: 0x5f6a64, roughness: 0.7, metalness: 0.02, side: THREE.DoubleSide,
    }))
    const standMat = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0x99a09f, roughness: 0.55, metalness: 0.7 }))
    this.mats.push(tubMat, standMat)
    const { w, d } = this.tankInner
    const cx = this.tankWorld.x, cz = this.tankWorld.z
    const base = 0.42, h = 0.32, wall = 0.012
    const floor = new THREE.Mesh(new THREE.BoxGeometry(w + wall * 2, wall, d + wall * 2), tubMat)
    floor.position.set(cx, base, cz)
    this.group.add(floor)
    for (const sx of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(wall, h, d), tubMat)
      p.position.set(cx + sx * (w / 2 + wall / 2), base + h / 2, cz)
      p.castShadow = true
      this.group.add(p)
    }
    for (const sz of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(w + wall * 2, h, wall), tubMat)
      p.position.set(cx, base + h / 2, cz + sz * (d / 2 + wall / 2))
      p.castShadow = true
      this.group.add(p)
    }
    // seawater: shallow, slightly turbid, not a glass box
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x4a6b66, roughness: 0.12, metalness: 0.0, transparent: true, opacity: 0.30,
    })
    this.mats.push(waterMat)
    this.waterMesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, d), waterMat)
    this.waterMesh.position.set(cx, base + 0.11, cz)
    this.group.add(this.waterMesh)

    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.42, 0.026), standMat)
        leg.position.set(cx + sx * (w / 2 - 0.02), 0.21, cz + sz * (d / 2 - 0.02))
        leg.castShadow = true
        this.group.add(leg)
      }
    }
    // aeration hose over the rim
    const hoseMat = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0xb9bcb4, roughness: 0.6, metalness: 0 }))
    this.mats.push(hoseMat)
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= 10; i++) {
      const t = i / 10
      pts.push(new THREE.Vector3(cx - w / 2 - 0.02 + t * 0.06, base + h + 0.06 - Math.pow(t, 1.6) * 0.30, cz - d / 2 + 0.05 + t * 0.02))
    }
    const hose = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.005, 5, false), hoseMat)
    this.group.add(hose)
  }

  update(t: number) {
    this.waterMesh.position.y = 0.42 + 0.11 + Math.sin(t * 2.1) * 0.0012
  }

  dispose() { this.mats.forEach((m) => m.dispose()) }
}
