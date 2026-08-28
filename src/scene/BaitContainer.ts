import * as THREE from 'three'
import { amiMass, resin } from './Textures'
import { applyUnderwater } from './Water'

/**
 * The baiting bucket, clamped to the bench: a thick moulded resin tub,
 * three quarters full of wet krill, with a wide open channel bridging
 * the rim and a chunky slider -- the "guide" -- riding it. The rig hangs
 * in the guide's groove with its hooks buried in the krill, so pushing
 * the guide along ploughs the rig sideways through the mass.
 *
 * Nothing is labelled. What is supposed to read is the open channel, the
 * attendant's hand at its mouth, and krill that shifts when the tub moves.
 */
export class BaitContainer {
  readonly group = new THREE.Group()
  readonly guide = new THREE.Group()

  readonly outerW = 0.34
  readonly outerH = 0.44
  readonly outerD = 0.22
  readonly wall = 0.012
  /** guide travel each side of centre */
  readonly travel = 0.112
  /** local y of the krill surface */
  readonly amiTop = 0.345
  /** local y of the guide groove, where the rig hangs from */
  readonly grooveY = 0.472

  private mass!: THREE.Mesh
  private grains!: THREE.InstancedMesh
  private massBase!: Float32Array
  private massFurrow!: Float32Array
  private massShift = 0
  private mats: THREE.Material[] = []
  private tmpV = new THREE.Vector3()

  constructor() {
    this.group.name = 'baitTub'
    const { outerW, outerH, outerD, wall } = this
    const ri = resin(true), ro = resin(false)

    const outMat = applyUnderwater(new THREE.MeshStandardMaterial({
      map: ro.map, roughnessMap: ro.roughnessMap, normalMap: ro.normalMap,
      normalScale: new THREE.Vector2(0.32, 0.32),
      color: 0x707a73, roughness: 0.74, metalness: 0.02, side: THREE.DoubleSide,
    }))
    const inMat = applyUnderwater(new THREE.MeshStandardMaterial({
      map: ri.map, roughnessMap: ri.roughnessMap, normalMap: ri.normalMap,
      normalScale: new THREE.Vector2(0.35, 0.35),
      color: 0x7c847c, roughness: 0.5, metalness: 0.02, side: THREE.DoubleSide,
    }))
    this.mats.push(outMat, inMat)

    const add = (m: THREE.Mesh) => { m.castShadow = true; m.receiveShadow = true; this.group.add(m); return m }

    // floor with a moulded rib pattern underneath
    add(new THREE.Mesh(new THREE.BoxGeometry(outerW, wall, outerD), outMat)).position.set(0, wall / 2, 0)
    // side walls with a small draft angle: moulded, not a perfect prism
    const draft = 0.035
    for (const sx of [-1, 1]) {
      const w = add(new THREE.Mesh(new THREE.BoxGeometry(wall, outerH, outerD), outMat))
      w.position.set(sx * (outerW - wall) / 2, outerH / 2, 0)
      w.rotation.z = -sx * draft
    }
    for (const sz of [-1, 1]) {
      const w = add(new THREE.Mesh(new THREE.BoxGeometry(outerW, outerH, wall), outMat))
      w.position.set(0, outerH / 2, sz * (outerD - wall) / 2)
      w.rotation.x = sz * draft
    }
    // interior liner: four faces and a floor, so the bucket is open at the
    // top. the only polished surface in the tub, worn by rigs drawn through
    const iw = outerW - wall * 2.2, id = outerD - wall * 2.2, ih = outerH - wall
    for (const sx of [-1, 1]) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(id, ih), inMat)
      f.position.set(sx * iw / 2, wall + ih / 2, 0)
      f.rotation.y = -sx * Math.PI / 2
      this.group.add(f)
    }
    for (const sz of [-1, 1]) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(iw, ih), inMat)
      f.position.set(0, wall + ih / 2, sz * id / 2)
      f.rotation.y = sz > 0 ? Math.PI : 0
      this.group.add(f)
    }

    // rolled rim
    const rimMat = outMat
    for (const sz of [-1, 1]) {
      const lip = add(new THREE.Mesh(new THREE.BoxGeometry(outerW + 0.042, 0.017, 0.024), rimMat))
      lip.position.set(0, outerH + 0.008, sz * (outerD / 2 + 0.014))
    }
    for (const sx of [-1, 1]) {
      const lip = add(new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.017, outerD + 0.052), rimMat))
      lip.position.set(sx * (outerW / 2 + 0.016), outerH + 0.008, 0)
    }
    // moulded handle lugs
    for (const sx of [-1, 1]) {
      const lug = add(new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.045, 0.05), outMat))
      lug.position.set(sx * (outerW / 2 + 0.014), outerH - 0.075, 0)
    }
    // drain boss and plug at the base, on the bench side
    const drain = add(new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.022, 10), outMat))
    drain.rotation.z = Math.PI / 2
    drain.position.set(outerW / 2 + 0.006, 0.036, 0.05)
    const plugMat = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0x2b2f2d, roughness: 0.88 }))
    this.mats.push(plugMat)
    const plug = add(new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.016, 8), plugMat))
    plug.rotation.z = Math.PI / 2
    plug.position.set(outerW / 2 + 0.02, 0.036, 0.05)

    // clamps fixing the tub to the bench
    const clampMat = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0x9aa0a0, roughness: 0.48, metalness: 0.76 }))
    this.mats.push(clampMat)
    for (const sx of [-1, 1]) {
      const foot = add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.01, 0.26), clampMat))
      foot.position.set(sx * (outerW / 2 + 0.02), 0.005, 0)
      const post = add(new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.13, 0.012), clampMat))
      post.position.set(sx * (outerW / 2 + 0.022), 0.065, 0.08)
      const strap = add(new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.10, 0.012), clampMat))
      strap.position.set(sx * (outerW / 2 + 0.022), 0.12, -0.08)
    }

    this.buildAmi()
    this.buildGuideRails()
    this.buildGuide()
  }

  private buildAmi() {
    const w = this.outerW - this.wall * 2.6
    const d = this.outerD - this.wall * 2.6
    // wet krill settles level-ish with a slight dish and a lumpy surface
    const geo = new THREE.PlaneGeometry(w, d, 30, 20)
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i)
      const dish = -Math.cos((x / w) * Math.PI) * Math.cos((z / d) * Math.PI) * 0.006
      const lump = Math.sin(x * 74 + z * 12) * 0.0022 + Math.cos(z * 96 + x * 31) * 0.0018 + Math.sin(x * 150 + z * 60) * 0.0011
      pos.setY(i, this.amiTop + dish + lump + this.heapAt(x, z))
    }
    geo.computeVertexNormals()
    const a = amiMass()
    a.map.repeat.set(2.0, 1.4); a.roughnessMap!.repeat.set(2.0, 1.4); a.normalMap!.repeat.set(2.0, 1.4)
    const mat = applyUnderwater(new THREE.MeshStandardMaterial({
      map: a.map, roughnessMap: a.roughnessMap, normalMap: a.normalMap,
      normalScale: new THREE.Vector2(1.15, 1.15),
      color: 0xffffff, roughness: 0.44, metalness: 0,
    }))
    this.mats.push(mat)
    this.mass = new THREE.Mesh(geo, mat)
    this.mass.castShadow = true
    this.mass.receiveShadow = true
    this.massBase = Float32Array.from((pos as any).array)
    this.massFurrow = new Float32Array(pos.count)
    this.group.add(this.mass)

    const fill = new THREE.Mesh(new THREE.BoxGeometry(w, this.amiTop - this.wall, d), mat)
    fill.position.y = (this.amiTop + this.wall) / 2 - 0.002
    this.group.add(fill)
    // the top layer is fresher and paler than the packed mass below it
    const grainTex = amiMass(true)
    grainTex.map.repeat.set(1, 1)
    const grainMat = applyUnderwater(new THREE.MeshStandardMaterial({
      map: grainTex.map, roughnessMap: grainTex.roughnessMap,
      color: 0xffffff, roughness: 0.36, metalness: 0,
    }))
    this.mats.push(grainMat)
    this.buildGrains(w, d, grainMat)
  }

  /**
   * The top layer of krill as real grains. A texture alone reads as
   * gravel once the camera is close; individual bodies with their own
   * silhouette and a wet highlight read as shrimp.
   */
  private buildGrains(w: number, d: number, mat: THREE.Material) {
    const geo = new THREE.IcosahedronGeometry(1, 0)
    const pos = geo.attributes.position as THREE.BufferAttribute
    let s = 991
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
    for (let i = 0; i < pos.count; i++) {
      const k = 0.6 + rnd() * 0.7
      pos.setXYZ(i, pos.getX(i) * k * 1.7, pos.getY(i) * k * 0.55, pos.getZ(i) * k * 0.7)
    }
    geo.computeVertexNormals()
    const n = 520
    const inst = new THREE.InstancedMesh(geo, mat, n)
    inst.castShadow = true
    inst.receiveShadow = true
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    const v = new THREE.Vector3()
    const sc = new THREE.Vector3()
    for (let i = 0; i < n; i++) {
      const x = (rnd() - 0.5) * w * 0.98
      const z = (rnd() - 0.5) * d * 0.98
      const dish = -Math.cos((x / w) * Math.PI) * Math.cos((z / d) * Math.PI) * 0.006
      const heap = this.heapAt(x, z)
      v.set(x, this.amiTop + dish + heap + (rnd() - 0.5) * 0.004, z)
      e.set(rnd() * 6.28, rnd() * 6.28, rnd() * 6.28)
      q.setFromEuler(e)
      const g = 0.0035 + rnd() * 0.0045
      sc.set(g, g, g)
      m4.compose(v, q, sc)
      inst.setMatrixAt(i, m4)
    }
    inst.instanceMatrix.needsUpdate = true
    this.grains = inst
    this.group.add(inst)
  }

  /** Krill does not sit level: it heaps to one side and keeps a scoop mark. */
  private heapAt(x: number, z: number) {
    const heap = Math.exp(-(Math.pow((x + 0.075) / 0.10, 2) + Math.pow(z / 0.075, 2))) * 0.016
    const scoop = -Math.exp(-(Math.pow((x - 0.085) / 0.055, 2) + Math.pow((z - 0.02) / 0.05, 2))) * 0.020
    return heap + scoop
  }

  private buildGuideRails() {
    const railMat = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0x8b918d, roughness: 0.4, metalness: 0.8 }))
    this.mats.push(railMat)
    const railLen = this.outerW + 0.02
    for (const z of [-0.058, 0.058]) {
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.0065, railLen, 8), railMat)
      r.rotation.z = Math.PI / 2
      r.position.set(0, this.grooveY - 0.022, z)
      r.castShadow = true
      this.group.add(r)
    }
    // end standards carrying the rails, bolted over the rim
    for (const sx of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.062, 0.15), railMat)
      p.position.set(sx * (this.outerW / 2 + 0.004), this.grooveY - 0.05, 0)
      p.castShadow = true
      this.group.add(p)
    }
  }

  /** The part the child grabs: wide, chunky, with an open groove on top. */
  private buildGuide() {
    const bodyMat = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0x4e5b56, roughness: 0.62, metalness: 0.04 }))
    const wearMat = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0xb2b8b3, roughness: 0.28, metalness: 0.6 }))
    this.mats.push(bodyMat, wearMat)
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.086, 0.026, 0.16), bodyMat)
    body.castShadow = true
    this.guide.add(body)
    for (const z of [-0.068, 0.068]) {
      const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.019, 0.055, 12), bodyMat)
      horn.position.set(0, 0.04, z)
      horn.castShadow = true
      this.guide.add(horn)
    }
    const gripMat = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0x8a5c3c, roughness: 0.9, metalness: 0 }))
    this.mats.push(gripMat)
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.0155, 0.0155, 0.138, 14), gripMat)
    bar.rotation.x = Math.PI / 2
    bar.position.y = 0.062
    bar.castShadow = true
    this.guide.add(bar)
    for (let i = 0; i < 7; i++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(0.0158, 0.0016, 5, 12), gripMat)
      rib.rotation.y = Math.PI / 2
      rib.position.set(0, 0.062, -0.052 + i * 0.0173)
      this.guide.add(rib)
    }
    // open V groove, polished where line has run through it
    const vL = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.03, 0.055), wearMat)
    vL.position.set(-0.023, 0.014, 0)
    vL.rotation.z = 0.6
    const vR = vL.clone() as THREE.Mesh
    vR.position.x = 0.023
    vR.rotation.z = -0.6
    this.guide.add(vL, vR)
    for (const z of [-0.058, 0.058]) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.0105, 0.0105, 0.034, 10), wearMat)
      b.rotation.z = Math.PI / 2
      b.position.set(0, -0.022, z)
      this.guide.add(b)
    }
    this.guide.position.set(-this.travel * 0.8, this.grooveY - 0.012, 0)
    this.group.add(this.guide)
  }

  get guideX() { return this.guide.position.x }

  setGuideX(x: number) {
    this.guide.position.x = THREE.MathUtils.clamp(x, -this.travel, this.travel)
  }

  /** World position of the groove the line hangs in. */
  getGrooveWorld(target: THREE.Vector3) {
    this.guide.getWorldPosition(target)
    target.y += 0.024
    return target
  }

  /** World position of the krill surface directly under the guide. */
  getAmiSurfaceWorld(target: THREE.Vector3) {
    this.group.getWorldPosition(target)
    target.x += this.guide.position.x
    target.y += this.amiTop
    return target
  }

  /** Krill parts where the rig has ploughed, and stays parted. */
  ploughAt(localX: number, strength: number) {
    const pos = this.mass.geometry.attributes.position as THREE.BufferAttribute
    let changed = false
    for (let i = 0; i < pos.count; i++) {
      const bx = this.massBase[i * 3]
      const d = Math.abs(bx - localX)
      if (d > 0.055) continue
      const w = 1 - d / 0.055
      const add = w * w * strength
      if (add > 0.00002) {
        this.massFurrow[i] = Math.min(0.022, this.massFurrow[i] + add)
        changed = true
      }
    }
    if (changed) this.applyMass()
  }

  /** Wet krill slumps slowly back. */
  settle(dt: number) {
    let changed = false
    for (let i = 0; i < this.massFurrow.length; i++) {
      if (this.massFurrow[i] > 0.00005) { this.massFurrow[i] *= 1 - Math.min(0.5, dt * 0.1); changed = true }
    }
    if (this.massShift !== 0) { this.massShift *= 1 - Math.min(0.5, dt * 1.2); changed = true }
    if (changed) this.applyMass()
  }

  /** A nudge to the tub: the wet mass shifts a few millimetres inside. */
  nudge(amount: number) {
    this.massShift += amount
    this.applyMass()
  }

  private applyMass() {
    const pos = this.mass.geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const bx = this.massBase[i * 3], by = this.massBase[i * 3 + 1], bz = this.massBase[i * 3 + 2]
      const f = this.massFurrow[i]
      const edge = Math.min(1, Math.abs(bx) / 0.14)
      const s = Math.sign(bx) || 1
      pos.setXYZ(i, bx + this.massShift * (1 - edge * 0.6) + f * 0.22 * s, by - f, bz + f * 0.28 * (Math.sign(bz) || 1))
    }
    pos.needsUpdate = true
    this.mass.geometry.computeVertexNormals()
  }

  /** Screen-space friendly grab point (the guide bar). */
  getGrabWorld(target: THREE.Vector3) {
    this.guide.getWorldPosition(target)
    target.y += 0.05
    return target
  }

  worldGuideBounds() {
    this.group.getWorldPosition(this.tmpV)
    return { minX: this.tmpV.x - this.travel, maxX: this.tmpV.x + this.travel, centerX: this.tmpV.x }
  }

  dispose() {
    this.grains.geometry.dispose()
    this.mats.forEach((m) => m.dispose())
  }
}
