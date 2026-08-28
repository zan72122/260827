import * as THREE from 'three'
import { concrete, galvanized, bench as benchTex, paintedSteel } from './Textures'
import { applyUnderwater, QUAY_Z, WATER_Y } from './Water'

/**
 * The fishing station: deck, quay wall, galvanised rail, work bench and
 * the observation tank. Dimensions are ordinary pier dimensions -- a
 * 1.05 m rail on 60.5 mm tube, a 0.86 m bench -- so the near field reads
 * at a believable scale next to a child's hands.
 */
export class Pier {
  readonly group = new THREE.Group()
  readonly railTopY = 1.02
  private mats: THREE.Material[] = []

  constructor() {
    this.group.name = 'pier'
    this.buildDeck()
    this.buildQuayWall()
    this.buildRail()
    this.buildBench()
    this.buildBollards()
  }

  private std(opts: THREE.MeshStandardMaterialParameters) {
    const m = applyUnderwater(new THREE.MeshStandardMaterial(opts))
    this.mats.push(m)
    return m
  }

  private buildDeck() {
    const c = concrete()
    c.map.repeat.set(7, 4); c.roughnessMap!.repeat.set(7, 4); c.normalMap!.repeat.set(7, 4)
    const mat = this.std({
      map: c.map, roughnessMap: c.roughnessMap, normalMap: c.normalMap,
      normalScale: new THREE.Vector2(0.7, 0.7), roughness: 1, metalness: 0,
      color: 0xd8d6cd,
    })
    // deck slab, sloped 1.5% toward the drainage channel at the rail
    const geo = new THREE.BoxGeometry(30, 0.42, 11, 1, 1, 1)
    const deck = new THREE.Mesh(geo, mat)
    deck.position.set(0, -0.21, QUAY_Z + 5.5)
    deck.rotation.x = -0.012
    deck.receiveShadow = true
    this.group.add(deck)

    // drainage channel with a grating, running parallel to the edge
    const ch = new THREE.Mesh(new THREE.BoxGeometry(30, 0.09, 0.24), this.std({ color: 0x3a3c39, roughness: 0.85, metalness: 0.1 }))
    ch.position.set(0, -0.045, QUAY_Z + 1.45)
    this.group.add(ch)
    const barGeo = new THREE.BoxGeometry(0.035, 0.06, 0.24)
    const bars = new THREE.InstancedMesh(barGeo, this.std({ color: 0x55554e, roughness: 0.62, metalness: 0.45 }), 120)
    const m4 = new THREE.Matrix4()
    for (let i = 0; i < 120; i++) {
      m4.setPosition(-9 + i * 0.15, -0.012, QUAY_Z + 1.45)
      bars.setMatrixAt(i, m4)
    }
    bars.instanceMatrix.needsUpdate = true
    this.group.add(bars)
  }

  private buildQuayWall() {
    const c = concrete()
    const wallTex = c.map.clone()
    wallTex.needsUpdate = true
    wallTex.repeat.set(16, 6)
    const mat = this.std({ map: wallTex, roughness: 0.95, metalness: 0, color: 0xb2b0a6 })
    const wall = new THREE.Mesh(new THREE.BoxGeometry(30, 11, 0.5), mat)
    wall.position.set(0, -5.5, QUAY_Z - 0.25)
    this.group.add(wall)

    // tide band: darker, weed-fouled, sits where the water actually works
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(30, 0.75, 0.52),
      this.std({ color: 0x4a4d3f, roughness: 1, metalness: 0 })
    )
    band.position.set(0, WATER_Y + 0.16, QUAY_Z - 0.26)
    this.group.add(band)
    const growth = new THREE.Mesh(
      new THREE.BoxGeometry(30, 0.42, 0.54),
      this.std({ color: 0x2f3a2a, roughness: 1, metalness: 0 })
    )
    growth.position.set(0, WATER_Y - 0.34, QUAY_Z - 0.27)
    this.group.add(growth)

    // fender: worn rubber, hung on chains at the working position
    const fenderMat = this.std({ color: 0x1c1c1b, roughness: 0.78, metalness: 0 })
    for (const fx of [-3.4, 3.9]) {
      const f = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.62, 14, 1, true), fenderMat)
      f.position.set(fx, WATER_Y + 0.55, QUAY_Z - 0.34)
      this.group.add(f)
    }
  }

  private buildRail() {
    const g = galvanized()
    const tubeMat = this.std({
      map: g.map, roughnessMap: g.roughnessMap, normalMap: g.normalMap,
      normalScale: new THREE.Vector2(0.45, 0.45),
      roughness: 0.70, metalness: 0.42, color: 0xccd0cf,
    })
    const railZ = QUAY_Z + 0.30
    const span = 26
    // top rail and mid rail: 60.5 and 48.6 mm tube
    for (const [y, r] of [[this.railTopY, 0.0303], [0.55, 0.0243]] as const) {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(r, r, span, 14, 1), tubeMat)
      tube.rotation.z = Math.PI / 2
      tube.position.set(0, y, railZ)
      tube.castShadow = true
      this.group.add(tube)
    }
    // posts with base flanges and bolts
    const postGeo = new THREE.CylinderGeometry(0.0243, 0.0243, this.railTopY, 12)
    const count = 17
    const posts = new THREE.InstancedMesh(postGeo, tubeMat, count)
    const flangeGeo = new THREE.CylinderGeometry(0.075, 0.082, 0.018, 12)
    const flanges = new THREE.InstancedMesh(flangeGeo, tubeMat, count)
    const boltGeo = new THREE.CylinderGeometry(0.009, 0.009, 0.016, 6)
    const bolts = new THREE.InstancedMesh(boltGeo, this.std({ color: 0x8d8f8a, roughness: 0.5, metalness: 0.8 }), count * 4)
    const m4 = new THREE.Matrix4()
    let bi = 0
    for (let i = 0; i < count; i++) {
      const x = -12.8 + i * 1.6
      m4.setPosition(x, this.railTopY / 2, railZ)
      posts.setMatrixAt(i, m4)
      m4.setPosition(x, 0.009, railZ)
      flanges.setMatrixAt(i, m4)
      for (let b = 0; b < 4; b++) {
        const a = (b / 4) * Math.PI * 2 + 0.4
        m4.setPosition(x + Math.cos(a) * 0.056, 0.026, railZ + Math.sin(a) * 0.056)
        bolts.setMatrixAt(bi++, m4)
      }
    }
    posts.instanceMatrix.needsUpdate = true
    flanges.instanceMatrix.needsUpdate = true
    bolts.instanceMatrix.needsUpdate = true
    posts.castShadow = true
    this.group.add(posts, flanges, bolts)
  }

  private buildBench() {
    const w = benchTex()
    w.map.repeat.set(4, 2); w.roughnessMap!.repeat.set(4, 2)
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.045, 0.62),
      this.std({ map: w.map, roughnessMap: w.roughnessMap, roughness: 0.86, metalness: 0, color: 0xbaa88c })
    )
    top.position.set(0.05, 0.855, QUAY_Z + 0.95)
    top.castShadow = true
    top.receiveShadow = true
    this.group.add(top)
    // frame: galvanised angle legs, bolted to the deck
    const legMat = this.std({ color: 0x9aa0a0, roughness: 0.6, metalness: 0.7 })
    for (const lx of [-0.62, 0.7]) {
      for (const lz of [QUAY_Z + 0.72, QUAY_Z + 1.18]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.83, 0.035), legMat)
        leg.position.set(0.05 + lx, 0.415, lz)
        leg.castShadow = true
        this.group.add(leg)
      }
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.03, 0.03), legMat)
    rail.position.set(0.05, 0.25, QUAY_Z + 0.95)
    this.group.add(rail)
  }

  private buildBollards() {
    const mat = this.std({ ...paintedSteel('#5d6663'), roughness: 0.72, metalness: 0.35, color: 0xffffff })
    for (const x of [-5.2, 5.6]) {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.19, 0.46, 16), mat)
      body.position.set(x, 0.23, QUAY_Z + 0.95)
      body.castShadow = true
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.14, 0.1, 16), mat)
      head.position.set(x, 0.5, QUAY_Z + 0.95)
      this.group.add(body, head)
    }
  }

  dispose() { this.mats.forEach((m) => m.dispose()) }
}

/**
 * Mooring rope and weed on the quay wall. They are the only readout the
 * child gets for the current: the slack rope and the weed lean, and
 * their sway amplitude follows the same flow the bait particles use.
 */
export class CurrentTells {
  readonly group = new THREE.Group()
  private rope: THREE.Mesh
  private ropeBase: Float32Array
  private weeds: { mesh: THREE.Mesh; phase: number; base: Float32Array }[] = []
  private flow = 0
  private weedMat = applyUnderwater(new THREE.MeshStandardMaterial({
    color: 0x36502f, roughness: 0.9, metalness: 0, side: THREE.DoubleSide, transparent: true, opacity: 0.94,
  }))

  constructor() {
    const ropeMat = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0x8a8168, roughness: 0.95, metalness: 0 }))
    this.buildPile(ropeMat)
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= 24; i++) {
      const t = i / 24
      pts.push(new THREE.Vector3(-1.9 + t * 2.0, WATER_Y + 0.42 - Math.sin(t * Math.PI) * 0.62, QUAY_Z - 0.12 - t * 0.5))
    }
    const curve = new THREE.CatmullRomCurve3(pts)
    this.rope = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.022, 6, false), ropeMat)
    this.ropeBase = Float32Array.from((this.rope.geometry.attributes.position as THREE.BufferAttribute).array)
    this.group.add(this.rope)

    const weedMat = this.weedMat
    for (let i = 0; i < 14; i++) {
      const h = 0.4 + Math.random() * 0.5
      const geo = new THREE.PlaneGeometry(0.055 + Math.random() * 0.05, h, 1, 6)
      geo.translate(0, h / 2, 0)
      const m = new THREE.Mesh(geo, weedMat)
      m.position.set(-4 + Math.random() * 8, WATER_Y - 0.55 - Math.random() * 0.5, QUAY_Z - 0.02)
      m.rotation.y = (Math.random() - 0.5) * 0.6
      this.weeds.push({ mesh: m, phase: Math.random() * 6.28, base: Float32Array.from((geo.attributes.position as THREE.BufferAttribute).array) })
      this.group.add(m)
    }
  }

  /** A fouled mooring pile hanging in the water column, where an
   *  underwater camera can actually see it lean with the current. */
  private buildPile(ropeMat: THREE.Material) {
    const pileMat = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0x585c50, roughness: 1, metalness: 0 }))
    const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.10, 7.2, 10), pileMat)
    pile.position.set(-1.95, WATER_Y - 3.2, -0.62)
    this.group.add(pile)
    const growth = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.115, 1.4, 10), applyUnderwater(new THREE.MeshStandardMaterial({ color: 0x3b4436, roughness: 1 })))
    growth.position.set(-1.95, WATER_Y - 0.75, -0.62)
    this.group.add(growth)
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= 16; i++) {
      const t = i / 16
      pts.push(new THREE.Vector3(-1.95 + t * 0.5, WATER_Y + 0.5 - t * 3.4, -0.62 + t * 0.22))
    }
    const rope = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.019, 6, false), ropeMat)
    this.group.add(rope)
    for (let i = 0; i < 10; i++) {
      const h = 0.45 + Math.random() * 0.55
      const geo = new THREE.PlaneGeometry(0.06 + Math.random() * 0.05, h, 1, 6)
      geo.translate(0, h / 2, 0)
      const m = new THREE.Mesh(geo, this.weedMat)
      const a = Math.random() * 6.28
      m.position.set(-1.95 + Math.cos(a) * 0.09, WATER_Y - 0.4 - i * 0.32, -0.62 + Math.sin(a) * 0.09)
      m.rotation.y = a
      this.weeds.push({ mesh: m, phase: Math.random() * 6.28, base: Float32Array.from((geo.attributes.position as THREE.BufferAttribute).array) })
      this.group.add(m)
    }
  }

  setFlow(v: number) { this.flow = v }

  update(t: number) {
    const amp = 0.02 + this.flow * 0.16
    const pos = this.rope.geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const bx = this.ropeBase[i * 3], by = this.ropeBase[i * 3 + 1], bz = this.ropeBase[i * 3 + 2]
      const s = Math.sin(t * 0.9 + bx * 1.4) * amp * 0.5
      pos.setXYZ(i, bx + s * 0.6, by + Math.sin(t * 1.3 + bx) * 0.012, bz + s)
    }
    pos.needsUpdate = true

    for (const w of this.weeds) {
      const p = w.mesh.geometry.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < p.count; i++) {
        const by = w.base[i * 3 + 1]
        const k = by / 0.9
        const bend = (Math.sin(t * 1.1 + w.phase) * 0.35 + 0.65) * (0.06 + this.flow * 0.85) * k * k
        p.setX(i, w.base[i * 3] + bend)
        p.setZ(i, w.base[i * 3 + 2] - bend * 0.25)
      }
      p.needsUpdate = true
    }
  }
}
