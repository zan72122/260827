import * as THREE from 'three'
import { GROUND_Y, MOUTH_R, MOUTH_Y, PLATE_THICKNESS, PLOT_R, fitsInside } from './dims'
import { PIECE_SPECS, buildPiece, disposePiece, setSnowCapAmount, type PieceBuild } from './pieces'
import { HeightField } from './snow'
import { enamel } from './materials'
import type { MatKit } from './materials'
import { Rng } from '../core/random'
import { MAX_PIECES, type PedestalKind, type PieceKind, type PlacedPiece } from '../core/state'

/**
 * The plug assembly: the disc that seals the sphere's mouth, the ground the
 * town stands on, the fixed scenery that gives the interior a far distance, and
 * the sockets the player's miniatures snap to.
 */

export interface Socket {
  x: number
  z: number
  /** Placed piece id, or null. */
  taken: number | null
  /** The centre socket is reserved for the big tree while one is unplaced. */
  central: boolean
}

interface Placed {
  data: PlacedPiece
  build: PieceBuild
  socket: Socket | null
}

const SOCKETS: [number, number, boolean][] = [
  [0, 0, true],
  [0.165, 0.165, false],
  [-0.165, 0.165, false],
  [-0.165, -0.165, false],
  [0.165, -0.165, false],
  [0.262, 0, false],
  [0, 0.262, false],
  [-0.262, 0, false],
  [0, -0.262, false],
].map(([a, b, c]) => [a as number, b as number, c as boolean] as [number, number, boolean])

/**
 * Gentle terrain, never negative: the plug's face sits just underneath, and a
 * dip below it would punch straight through. Pinned to zero at the rim so the
 * ground meets the plug without a seam.
 */
function groundHeight(x: number, z: number, seed: number): number {
  const r = Math.hypot(x, z)
  const edge = 1 - THREE.MathUtils.smoothstep(r, MOUTH_R * 0.72, MOUTH_R * 0.995)
  const a = seed * 0.37
  const h =
    (Math.sin(x * 7.3 + a) * Math.cos(z * 6.1 - a) * 0.5 + 0.5) * 0.013 +
    (Math.sin(x * 3.1 - z * 3.7 + a * 2) * 0.5 + 0.5) * 0.009
  return h * edge
}

/** Clearance between the plug's face and the lowest point of the ground. */
const PLUG_SINK = 0.006

export class Town {
  /** Seals the mouth; parent of everything that goes inside. */
  readonly plate = new THREE.Group()
  /** Ground + miniatures + fixed scenery. */
  readonly ground = new THREE.Group()
  readonly gasket: THREE.Mesh
  readonly collar: THREE.Group
  readonly field = new HeightField()

  sockets: Socket[] = SOCKETS.map(([x, z, central]) => ({ x, z, taken: null, central }))

  private placed = new Map<number, Placed>()
  private nextId = 1
  private owned: Array<THREE.BufferGeometry | THREE.Material> = []
  private groundMesh: THREE.Mesh
  private plug: THREE.Mesh
  private lampLights: THREE.PointLight[] = []
  private decorAnchors: THREE.Vector3[] = []
  private glowMats: THREE.MeshStandardMaterial[] = []
  private lit = 0
  private seed: number

  constructor(private mats: MatKit, seed: number) {
    this.seed = seed
    const rng = new Rng(seed)

    // --- the plug disc that the gasket seals against -----------------------
    const plugGeo = new THREE.CylinderGeometry(
      MOUTH_R + 0.012, MOUTH_R + 0.02, PLATE_THICKNESS, 48,
    )
    this.plug = new THREE.Mesh(plugGeo, mats.paintedMetal)
    this.plug.position.y = MOUTH_Y + PLATE_THICKNESS / 2 - PLUG_SINK
    // Deliberately not a shadow caster: it is wider than the ground and only
    // centimetres below it, so it would throw the whole town into shade. The
    // globe's contact with the bench is carried by the contact decal instead.
    this.plug.castShadow = false
    this.plug.receiveShadow = true
    this.plate.add(this.plug)
    this.owned.push(plugGeo)

    const gasketGeo = new THREE.TorusGeometry(MOUTH_R + 0.012, 0.014, 8, 44)
    gasketGeo.rotateX(Math.PI / 2)
    this.gasket = new THREE.Mesh(gasketGeo, mats.rubber)
    this.gasket.position.y = MOUTH_Y + PLATE_THICKNESS
    this.gasket.castShadow = false
    this.plate.add(this.gasket)
    this.owned.push(gasketGeo)

    // --- locking collar ----------------------------------------------------
    this.collar = new THREE.Group()
    const collarGeo = new THREE.CylinderGeometry(MOUTH_R + 0.032, MOUTH_R + 0.034, 0.036, 44)
    const collarMesh = new THREE.Mesh(collarGeo, mats.brass)
    collarMesh.castShadow = false
    collarMesh.receiveShadow = true
    this.collar.add(collarMesh)
    this.owned.push(collarGeo)
    const knurlGeo = new THREE.BoxGeometry(0.012, 0.03, 0.012)
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2
      const k = new THREE.Mesh(knurlGeo, mats.brass)
      k.position.set(Math.cos(a) * (MOUTH_R + 0.036), 0, Math.sin(a) * (MOUTH_R + 0.036))
      k.rotation.y = -a
      this.collar.add(k)
    }
    this.owned.push(knurlGeo)
    this.collar.position.y = MOUTH_Y - 0.006
    this.plate.add(this.collar)

    // --- ground ------------------------------------------------------------
    const gr = MOUTH_R * 0.995
    const groundGeo = new THREE.CircleGeometry(gr, 72, 0, Math.PI * 2)
    groundGeo.rotateX(-Math.PI / 2)
    const gp = groundGeo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < gp.count; i++) {
      const x = gp.getX(i)
      const z = gp.getZ(i)
      gp.setY(i, groundHeight(x, z, seed))
    }
    groundGeo.computeVertexNormals()
    this.groundMesh = new THREE.Mesh(groundGeo, mats.snow)
    this.groundMesh.position.y = GROUND_Y
    this.groundMesh.receiveShadow = true
    this.ground.add(this.groundMesh)
    this.owned.push(groundGeo)

    // A soft skirt so the ground never shows a hard edge against the glass.
    const skirtGeo = new THREE.CylinderGeometry(gr, gr * 0.96, 0.016, 60, 1, true)
    const skirt = new THREE.Mesh(skirtGeo, mats.snow)
    skirt.position.y = GROUND_Y - 0.008
    this.ground.add(skirt)
    this.owned.push(skirtGeo)

    this.buildScenery(rng)
    this.plate.add(this.ground)
    this.rebuildField()
  }

  /** Fixed background: a lane, a fence, two far cottages and low hills. */
  private buildScenery(rng: Rng) {
    const lane = new THREE.Group()
    const laneMat = enamel(0xb9b4a6, 0.9)
    this.owned.push(laneMat)
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.31, 0, 0.1),
      new THREE.Vector3(-0.12, 0, 0.2),
      new THREE.Vector3(0.08, 0, 0.06),
      new THREE.Vector3(0.16, 0, -0.16),
      new THREE.Vector3(0.31, 0, -0.24),
    ])
    const pts = curve.getPoints(30)
    const laneGeo = new THREE.BufferGeometry()
    const verts: number[] = []
    const idx: number[] = []
    const halfW = 0.021
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]
      const q = pts[Math.min(pts.length - 1, i + 1)]
      const t = new THREE.Vector3().subVectors(q, p).normalize()
      const n = new THREE.Vector3(-t.z, 0, t.x).multiplyScalar(halfW)
      const y = GROUND_Y + groundHeight(p.x, p.z, this.seed) + 0.0022
      verts.push(p.x - n.x, y, p.z - n.z, p.x + n.x, y, p.z + n.z)
      if (i < pts.length - 1) {
        const b = i * 2
        idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2)
      }
    }
    laneGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
    laneGeo.setIndex(idx)
    laneGeo.computeVertexNormals()
    const laneMesh = new THREE.Mesh(laneGeo, laneMat)
    laneMesh.receiveShadow = true
    lane.add(laneMesh)
    this.owned.push(laneGeo)
    this.ground.add(lane)

    // Fence: the near-field object the camera brushes past on the way in.
    const fenceMat = enamel(0x6d5740, 0.85)
    this.owned.push(fenceMat)
    const postGeo = new THREE.BoxGeometry(0.007, 0.036, 0.007)
    const railGeo = new THREE.BoxGeometry(0.052, 0.005, 0.004)
    this.owned.push(postGeo, railGeo)
    for (let i = 0; i < 7; i++) {
      const a = -0.5 + i * 0.19
      const x = Math.cos(a) * 0.305
      const z = Math.sin(a) * 0.305
      const y = GROUND_Y + groundHeight(x, z, this.seed) + 0.018
      const post = new THREE.Mesh(postGeo, fenceMat)
      post.position.set(x, y, z)
      post.rotation.y = -a
      post.castShadow = true
      this.ground.add(post)
      if (i < 6) {
        const a2 = a + 0.095
        const rx = Math.cos(a2) * 0.305
        const rz = Math.sin(a2) * 0.305
        for (const dy of [0.006, -0.008]) {
          const rail = new THREE.Mesh(railGeo, fenceMat)
          rail.position.set(rx, y + dy, rz)
          rail.rotation.y = -a2 - Math.PI / 2
          this.ground.add(rail)
        }
      }
    }

    // Far cottages: simple, small, and set at the rim to hold the distance.
    const farWall = enamel(0xbdb3a0, 0.8)
    const farRoof = enamel(0x4b4038, 0.75)
    const farGlow = new THREE.MeshStandardMaterial({
      color: 0x37302a, emissive: new THREE.Color(0xffbf78), emissiveIntensity: 1.1, roughness: 0.5,
    })
    this.glowMats.push(farGlow)
    this.owned.push(farWall, farRoof, farGlow)
    const bodyGeo = new THREE.BoxGeometry(0.05, 0.032, 0.04)
    const roofGeo = new THREE.CylinderGeometry(0.001, 0.036, 0.056, 3)
    roofGeo.rotateZ(Math.PI / 2)
    roofGeo.rotateY(Math.PI / 2)
    const winGeo = new THREE.BoxGeometry(0.012, 0.01, 0.004)
    this.owned.push(bodyGeo, roofGeo, winGeo)
    for (let i = 0; i < 3; i++) {
      const a = 2.1 + i * 1.15 + rng.range(-0.15, 0.15)
      const r = 0.3 + rng.range(-0.015, 0.015)
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r
      const y = GROUND_Y + groundHeight(x, z, this.seed)
      const g = new THREE.Group()
      const body = new THREE.Mesh(bodyGeo, farWall)
      body.position.y = 0.016
      body.castShadow = true
      const roof = new THREE.Mesh(roofGeo, farRoof)
      roof.position.y = 0.034
      roof.scale.set(1, 1, 0.8)
      const win = new THREE.Mesh(winGeo, farGlow)
      win.position.set(0.008, 0.018, 0.021)
      g.add(body, roof, win)
      g.position.set(x, y, z)
      g.rotation.y = -a + Math.PI / 2 + rng.range(-0.3, 0.3)
      g.scale.setScalar(0.86)
      this.ground.add(g)
      this.decorAnchors.push(new THREE.Vector3(x, y + 0.03, z))
    }

    // Low hills at the rim, kept under the glass line.
    const hillMat = this.mats.snow
    const hillGeo = new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5)
    this.owned.push(hillGeo)
    for (let i = 0; i < 5; i++) {
      const a = rng.range(0, Math.PI * 2)
      const r = rng.range(0.24, 0.33)
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r
      const rad = rng.range(0.05, 0.095)
      const hh = rng.range(0.016, 0.032)
      if (!fitsInside(r + rad, GROUND_Y + hh, 0.02)) continue
      const m = new THREE.Mesh(hillGeo, hillMat)
      m.position.set(x, GROUND_Y + groundHeight(x, z, this.seed) - 0.004, z)
      m.scale.set(rad, hh, rad * 0.9)
      m.receiveShadow = true
      this.ground.add(m)
    }

    // Two small firs of fixed scenery so an empty plot never looks bare.
    for (let i = 0; i < 2; i++) {
      const a = 3.6 + i * 1.7
      const x = Math.cos(a) * 0.29
      const z = Math.sin(a) * 0.29
      const b = buildPiece('fir', 1)
      b.group.position.set(x, GROUND_Y + groundHeight(x, z, this.seed), z)
      b.group.scale.setScalar(0.72)
      this.ground.add(b.group)
      this.owned.push(...b.geometries, ...b.materials)
      this.decorGlow(b)
    }
  }

  private decorGlow(b: PieceBuild) {
    for (const g of b.glow) this.glowMats.push(g)
  }

  // --- placement ---------------------------------------------------------

  get count(): number {
    return this.placed.size
  }

  get pieces(): PlacedPiece[] {
    return [...this.placed.values()].map((p) => ({ ...p.data }))
  }

  private freeSocket(kind: PieceKind): Socket | null {
    const open = this.sockets.filter((s) => s.taken === null)
    if (open.length === 0) return null
    if (kind === 'centerTree') {
      const c = open.find((s) => s.central)
      if (c) return c
    }
    // Prefer sockets that leave the silhouettes spread out.
    const used = this.sockets.filter((s) => s.taken !== null)
    let best = open[0]
    let bestScore = -Infinity
    for (const s of open) {
      if (s.central && kind !== 'centerTree' && open.length > 2) continue
      let d = Math.hypot(s.x, s.z) * 0.35
      for (const u of used) d += Math.min(0.4, Math.hypot(s.x - u.x, s.z - u.z))
      if (d > bestScore) {
        bestScore = d
        best = s
      }
    }
    return best
  }

  /** Adds a miniature at the best free socket. Returns its id, or -1. */
  add(kind: PieceKind, paint: number): number {
    if (this.placed.size >= MAX_PIECES) return -1
    const socket = this.freeSocket(kind)
    if (!socket) return -1
    const build = buildPiece(kind, paint)
    const id = this.nextId++
    const data: PlacedPiece = { id, kind, x: socket.x, z: socket.z, rotY: 0, paint }
    socket.taken = id
    const rec: Placed = { data, build, socket }
    this.placed.set(id, rec)
    this.ground.add(build.group)
    this.orient(rec)
    this.apply(rec)
    this.rebuildField()
    return id
  }

  removeLast(): boolean {
    const ids = [...this.placed.keys()]
    if (ids.length === 0) return false
    return this.remove(ids[ids.length - 1])
  }

  remove(id: number): boolean {
    const rec = this.placed.get(id)
    if (!rec) return false
    if (rec.socket) rec.socket.taken = null
    this.ground.remove(rec.build.group)
    disposePiece(rec.build)
    this.placed.delete(id)
    this.rebuildField()
    return true
  }

  clear() {
    for (const id of [...this.placed.keys()]) this.remove(id)
    this.nextId = 1
  }

  /** Restores an exact saved layout. */
  restore(pieces: PlacedPiece[]) {
    this.clear()
    for (const p of pieces) {
      const build = buildPiece(p.kind, p.paint)
      const id = this.nextId++
      const data: PlacedPiece = { ...p, id }
      const socket =
        this.sockets.find((s) => s.taken === null && Math.hypot(s.x - p.x, s.z - p.z) < 0.02) ??
        this.sockets.find((s) => s.taken === null) ??
        null
      if (socket) socket.taken = id
      const rec: Placed = { data, build, socket }
      this.placed.set(id, rec)
      this.ground.add(build.group)
      this.apply(rec)
    }
    this.rebuildField()
  }

  private orient(rec: Placed) {
    const { kind } = rec.data
    const a = Math.atan2(rec.data.x, rec.data.z)
    if (kind === 'house') rec.data.rotY = a + Math.PI + (Math.random() - 0.5) * 0.5
    else if (kind === 'bridge') rec.data.rotY = a + Math.PI / 2
    else if (kind === 'deer') rec.data.rotY = a + Math.PI * 0.75
    else rec.data.rotY = Math.random() * Math.PI * 2
  }

  private apply(rec: Placed) {
    const { x, z, rotY } = rec.data
    const y = GROUND_Y + groundHeight(x, z, this.seed)
    rec.build.group.position.set(x, y, z)
    rec.build.group.rotation.y = rotY
  }

  /** Nearest placed piece to a local ground point, within `max` metres. */
  pick(x: number, z: number, max = 0.13): number | null {
    let best: number | null = null
    let bestD = max
    for (const [id, rec] of this.placed) {
      const d = Math.hypot(rec.data.x - x, rec.data.z - z)
      if (d < bestD) {
        bestD = d
        best = id
      }
    }
    return best
  }

  /** Free drag; the piece follows the finger without snapping yet. */
  dragTo(id: number, x: number, z: number) {
    const rec = this.placed.get(id)
    if (!rec) return
    const r = Math.hypot(x, z)
    const lim = PLOT_R
    if (r > lim) {
      x = (x / r) * lim
      z = (z / r) * lim
    }
    rec.data.x = x
    rec.data.z = z
    this.apply(rec)
  }

  /** Release: pull to the nearest free candidate rather than demanding aim. */
  snap(id: number): { x: number; z: number } | null {
    const rec = this.placed.get(id)
    if (!rec) return null
    let best: Socket | null = null
    let bestD = Infinity
    for (const s of this.sockets) {
      if (s.taken !== null && s.taken !== id) continue
      const d = Math.hypot(s.x - rec.data.x, s.z - rec.data.z)
      if (d < bestD) {
        bestD = d
        best = s
      }
    }
    if (!best) return null
    if (rec.socket && rec.socket !== best) rec.socket.taken = null
    best.taken = id
    rec.socket = best
    rec.data.x = best.x
    rec.data.z = best.z
    this.apply(rec)
    this.rebuildField()
    return { x: best.x, z: best.z }
  }

  /** The scene object for a placed piece, for spawn animations. */
  pieceObject(id: number): THREE.Object3D | null {
    return this.placed.get(id)?.build.group ?? null
  }

  /** World-space centre of a placed piece, for effects and camera targets. */
  worldPos(id: number, out: THREE.Vector3): boolean {
    const rec = this.placed.get(id)
    if (!rec) return false
    rec.build.group.getWorldPosition(out)
    return true
  }

  private rebuildField() {
    this.field.clear()
    for (const rec of this.placed.values()) {
      const spec = PIECE_SPECS[rec.data.kind]
      this.field.stamp(
        rec.data.x, rec.data.z, spec.radius * 1.05,
        GROUND_Y + groundHeight(rec.data.x, rec.data.z, this.seed) + rec.build.height * 0.82,
      )
    }
  }

  // --- lighting & snow ---------------------------------------------------

  /** Attaches at most two real point lights; everything else stays emissive. */
  installLights(max = 2) {
    this.removeLights()
    const anchors: Array<{ v: THREE.Vector3; obj: THREE.Object3D }> = []
    for (const rec of this.placed.values()) {
      for (const a of rec.build.lampAnchors) anchors.push({ v: a, obj: rec.build.group })
    }
    for (let i = 0; i < Math.min(max, anchors.length); i++) {
      const l = new THREE.PointLight(0xffc07a, 0, 0.42, 2)
      l.position.copy(anchors[i].v)
      anchors[i].obj.add(l)
      this.lampLights.push(l)
    }
  }

  removeLights() {
    for (const l of this.lampLights) l.removeFromParent()
    this.lampLights.length = 0
  }

  /** 0 = daylight globe on the bench, 1 = the town's own lamps burning. */
  setLit(v: number) {
    this.lit = THREE.MathUtils.clamp(v, 0, 1)
    for (const rec of this.placed.values()) {
      for (const m of rec.build.glow) m.emissiveIntensity = 0.1 + this.lit * 1.9
    }
    for (const m of this.glowMats) m.emissiveIntensity = 0.08 + this.lit * 1.4
    for (const l of this.lampLights) l.intensity = this.lit * 0.09
  }

  get litAmount(): number {
    return this.lit
  }

  setSnowAccumulation(t: number) {
    setSnowCapAmount(t)
  }

  /** Swaps the plug/collar finish when the player picks a different pedestal. */
  setPedestalStyle(kind: PedestalKind) {
    const mat =
      kind === 'brass' ? this.mats.brass : kind === 'ceramic' ? this.mats.ceramic : this.mats.darkWood
    this.plug.material = mat
  }

  dispose() {
    this.clear()
    this.removeLights()
    for (const o of this.owned) o.dispose()
    this.owned.length = 0
    this.plate.clear()
    this.ground.clear()
  }
}
