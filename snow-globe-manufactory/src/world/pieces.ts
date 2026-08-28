import * as THREE from 'three'
import { enamel } from './materials'
import { snowTexture } from './textures'
import type { PieceKind } from '../core/state'

/**
 * The miniatures are real geometry, not billboards, because the camera ends up
 * standing among them. Everything is built from a handful of low-segment
 * primitives and shares one enamel texture, so seven kinds cost a few hundred
 * triangles each.
 */

export interface PieceBuild {
  group: THREE.Group
  /** Footprint radius used for placement spacing and the snow height field. */
  radius: number
  /** Height above the ground plane, for the glass-fit check. */
  height: number
  /** Meshes whose opacity/scale grow as snow settles. */
  caps: THREE.Mesh[]
  /** Emissive materials switched on when the town is lit. */
  glow: THREE.MeshStandardMaterial[]
  /** Local anchors where a real point light may be attached (at most two used). */
  lampAnchors: THREE.Vector3[]
  materials: THREE.Material[]
  geometries: THREE.BufferGeometry[]
}

export interface PieceSpec {
  kind: PieceKind
  palette: number[][]
  /** Fixed footprint radius used by the placement snapping. */
  radius: number
}

export const PIECE_SPECS: Record<PieceKind, PieceSpec> = {
  house: { kind: 'house', radius: 0.082, palette: [
    [0xe6dbc4, 0x8a3f34], [0xcfd8dc, 0x33484f], [0xd8b98a, 0x5d4530], [0xb9c7b0, 0x3f5148],
  ] },
  fir: { kind: 'fir', radius: 0.05, palette: [
    [0x2f5a3f], [0x27483a], [0x3a6647], [0x21402f],
  ] },
  lamp: { kind: 'lamp', radius: 0.032, palette: [
    [0x2b3236], [0x3d3a2e], [0x1f2a2a],
  ] },
  bridge: { kind: 'bridge', radius: 0.098, palette: [
    [0x8a5f39], [0x9c4436], [0x6d5c4a],
  ] },
  snowman: { kind: 'snowman', radius: 0.042, palette: [
    [0xb2453c], [0x3d6b8a], [0x6e5286],
  ] },
  deer: { kind: 'deer', radius: 0.046, palette: [
    [0x8a6647], [0x6d5138], [0xa07d58],
  ] },
  centerTree: { kind: 'centerTree', radius: 0.07, palette: [
    [0x2c5540], [0x24483a],
  ] },
}

const CAP_MAT_KEY = Symbol('cap')

function snowCapMaterial(): THREE.MeshStandardMaterial {
  const g = globalThis as unknown as Record<symbol, THREE.MeshStandardMaterial | undefined>
  let m = g[CAP_MAT_KEY]
  if (!m) {
    const tex = snowTexture()
    m = new THREE.MeshStandardMaterial({
      map: tex,
      color: 0xf1f6fb,
      roughness: 0.88,
      metalness: 0,
      transparent: true,
      opacity: 0,
    })
    g[CAP_MAT_KEY] = m
  }
  return m
}

/** Every cap in the town shares one material, so accumulation is one uniform. */
export function setSnowCapAmount(t: number) {
  const m = snowCapMaterial()
  m.opacity = THREE.MathUtils.clamp(t, 0, 1) * 0.74
  m.visible = m.opacity > 0.01
}

class Builder {
  group = new THREE.Group()
  caps: THREE.Mesh[] = []
  glow: THREE.MeshStandardMaterial[] = []
  lampAnchors: THREE.Vector3[] = []
  materials: THREE.Material[] = []
  geometries: THREE.BufferGeometry[] = []

  add(geo: THREE.BufferGeometry, mat: THREE.Material, own = true): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat)
    m.castShadow = true
    m.receiveShadow = true
    this.group.add(m)
    this.geometries.push(geo)
    if (own) this.materials.push(mat)
    return m
  }

  cap(geo: THREE.BufferGeometry): THREE.Mesh {
    const m = new THREE.Mesh(geo, snowCapMaterial())
    m.castShadow = false
    m.receiveShadow = false
    this.group.add(m)
    this.geometries.push(geo)
    this.caps.push(m)
    return m
  }

  paint(color: number, rough = 0.55): THREE.MeshStandardMaterial {
    const m = enamel(color, rough)
    this.materials.push(m)
    return m
  }

  lamp(color: number, strength: number): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({
      color: 0x3a3226,
      emissive: new THREE.Color(color),
      emissiveIntensity: strength,
      roughness: 0.42,
      metalness: 0.1,
    })
    this.materials.push(m)
    this.glow.push(m)
    return m
  }

  done(radius: number, height: number): PieceBuild {
    return {
      group: this.group,
      radius,
      height,
      caps: this.caps,
      glow: this.glow,
      lampAnchors: this.lampAnchors,
      materials: this.materials,
      geometries: this.geometries,
    }
  }
}

function house(paint: number[]): PieceBuild {
  const b = new Builder()
  const wall = b.paint(paint[0], 0.68)
  const roofMat = b.paint(paint[1], 0.6)
  const trim = b.paint(0x4a3a2c, 0.7)
  const w = 0.11
  const d = 0.086
  const wallH = 0.072

  const body = b.add(new THREE.BoxGeometry(w, wallH, d), wall)
  body.position.y = wallH / 2

  // Gabled roof from a 3-sided prism, rotated so the ridge runs along X.
  const roofGeo = new THREE.CylinderGeometry(0.001, 0.076, w * 1.16, 3, 1, false)
  roofGeo.rotateZ(Math.PI / 2)
  roofGeo.rotateY(Math.PI / 2)
  const roof = b.add(roofGeo, roofMat)
  roof.position.y = wallH + 0.028
  roof.scale.set(1, 1, 0.86)

  const capGeo = roofGeo.clone()
  const capMesh = b.cap(capGeo)
  capMesh.position.copy(roof.position)
  capMesh.position.y += 0.004
  capMesh.scale.set(1.015, 1.015, 0.875)

  const chimGeo = new THREE.BoxGeometry(0.018, 0.038, 0.018)
  const chim = b.add(chimGeo, trim)
  chim.position.set(w * 0.27, wallH + 0.048, d * 0.16)

  const door = b.add(new THREE.BoxGeometry(0.026, 0.042, 0.006), trim)
  door.position.set(-w * 0.16, 0.021, d / 2 + 0.001)

  const glowMat = b.lamp(0xffcd84, 1.35)
  for (const x of [w * 0.2, -w * 0.34]) {
    const win = b.add(new THREE.BoxGeometry(0.022, 0.02, 0.006), glowMat, false)
    win.position.set(x, wallH * 0.62, d / 2 + 0.001)
  }
  const side = b.add(new THREE.BoxGeometry(0.006, 0.02, 0.02), glowMat, false)
  side.position.set(-w / 2 - 0.001, wallH * 0.6, 0)

  b.lampAnchors.push(new THREE.Vector3(0, wallH * 0.7, d * 0.6))
  return b.done(0.072, wallH + 0.066)
}

function fir(paint: number[]): PieceBuild {
  const b = new Builder()
  const needle = b.paint(paint[0], 0.78)
  const bark = b.paint(0x4a3524, 0.82)

  const trunk = b.add(new THREE.CylinderGeometry(0.006, 0.009, 0.03, 7), bark)
  trunk.position.y = 0.015

  const tiers: [number, number, number][] = [
    [0.046, 0.062, 0.032],
    [0.036, 0.056, 0.068],
    [0.024, 0.05, 0.104],
  ]
  for (const [r, h, y] of tiers) {
    const g = new THREE.ConeGeometry(r, h, 9)
    const m = b.add(g, needle)
    m.position.y = y + h / 2 - 0.014
    // The cap shares the tier's base but is shallower, so it shows as snow
    // lying on the branch skirt rather than a saucer sticking out of it.
    const c = b.cap(new THREE.ConeGeometry(r * 1.015, h * 0.5, 9))
    c.position.y = m.position.y - h * 0.25
  }
  return b.done(0.048, 0.152)
}

function lamp(paint: number[]): PieceBuild {
  const b = new Builder()
  const metal = b.paint(paint[0], 0.5)
  const base = b.add(new THREE.CylinderGeometry(0.014, 0.018, 0.012, 10), metal)
  base.position.y = 0.006
  const post = b.add(new THREE.CylinderGeometry(0.0045, 0.006, 0.115, 8), metal)
  post.position.y = 0.07

  const head = b.add(new THREE.CylinderGeometry(0.016, 0.011, 0.012, 8), metal)
  head.position.y = 0.142
  const finial = b.add(new THREE.ConeGeometry(0.008, 0.014, 8), metal)
  finial.position.y = 0.154

  const glassMat = b.lamp(0xffd79a, 1.9)
  const lantern = b.add(new THREE.CylinderGeometry(0.011, 0.012, 0.026, 8), glassMat, false)
  lantern.position.y = 0.124
  lantern.castShadow = false

  const capMesh = b.cap(new THREE.CylinderGeometry(0.0172, 0.0122, 0.004, 8))
  capMesh.position.y = 0.1495

  b.lampAnchors.push(new THREE.Vector3(0, 0.124, 0))
  return b.done(0.026, 0.162)
}

function bridge(paint: number[]): PieceBuild {
  const b = new Builder()
  const wood = b.paint(paint[0], 0.72)
  const rail = b.paint(0x5b4632, 0.75)

  // Deck: a shallow arch of short planks, so it reads as a bridge from inside.
  const span = 0.19
  const planks = 11
  const rise = 0.026
  const arch = (t: number) => Math.sin(t * Math.PI) * rise
  for (let i = 0; i < planks; i++) {
    const t = (i + 0.5) / planks
    const g = new THREE.BoxGeometry(span / planks + 0.002, 0.007, 0.062)
    const m = b.add(g, wood)
    m.position.set(-span / 2 + t * span, 0.02 + arch(t), 0)
    m.rotation.z = -Math.cos(t * Math.PI) * (rise * 4.2)
    const c = b.cap(new THREE.BoxGeometry(span / planks + 0.002, 0.004, 0.062))
    c.position.copy(m.position)
    c.position.y += 0.0055
    c.rotation.z = m.rotation.z
  }

  for (const z of [-0.031, 0.031]) {
    for (let i = 0; i < 5; i++) {
      const t = (i + 0.5) / 5
      const post = b.add(new THREE.BoxGeometry(0.006, 0.028, 0.006), rail)
      post.position.set(-span / 2 + t * span, 0.034 + arch(t), z)
    }
    const top = b.add(new THREE.BoxGeometry(span, 0.005, 0.006), rail)
    top.position.set(0, 0.05 + rise * 0.55, z)
  }

  for (const x of [-span / 2, span / 2]) {
    const pier = b.add(new THREE.BoxGeometry(0.016, 0.024, 0.06), rail)
    pier.position.set(x, 0.012, 0)
  }
  return b.done(0.098, 0.062)
}

function snowman(paint: number[]): PieceBuild {
  const b = new Builder()
  const body = b.paint(0xf2f6fa, 0.9)
  const scarf = b.paint(paint[0], 0.78)
  const coal = b.paint(0x22242a, 0.6)
  const carrot = b.paint(0xd8792c, 0.6)

  const s: [number, number][] = [[0.028, 0.028], [0.021, 0.068], [0.015, 0.1]]
  for (const [r, y] of s) {
    const m = b.add(new THREE.SphereGeometry(r, 12, 9), body)
    m.position.y = y
  }
  const sc = b.add(new THREE.TorusGeometry(0.019, 0.005, 6, 12), scarf)
  sc.position.y = 0.084
  sc.rotation.x = Math.PI / 2

  const nose = b.add(new THREE.ConeGeometry(0.004, 0.016, 6), carrot)
  nose.position.set(0, 0.101, 0.015)
  nose.rotation.x = Math.PI / 2

  for (const x of [-0.005, 0.005]) {
    const eye = b.add(new THREE.SphereGeometry(0.0022, 6, 5), coal)
    eye.position.set(x, 0.106, 0.0134)
  }
  const hat = b.add(new THREE.CylinderGeometry(0.014, 0.014, 0.004, 10), coal)
  hat.position.y = 0.113
  const crown = b.add(new THREE.CylinderGeometry(0.009, 0.009, 0.018, 10), coal)
  crown.position.y = 0.123

  for (const dir of [-1, 1]) {
    const arm = b.add(new THREE.CylinderGeometry(0.0018, 0.0018, 0.034, 5), b.paint(0x5a4530, 0.85))
    arm.position.set(dir * 0.024, 0.07, 0)
    arm.rotation.z = dir * -0.9
  }

  const capMesh = b.cap(new THREE.SphereGeometry(0.0152, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.4))
  capMesh.position.y = 0.1
  return b.done(0.032, 0.132)
}

function deer(paint: number[]): PieceBuild {
  const b = new Builder()
  const hide = b.paint(paint[0], 0.8)
  const dark = b.paint(0x3a2b1f, 0.8)

  const body = b.add(new THREE.CapsuleGeometry(0.017, 0.038, 4, 9), hide)
  body.position.set(0, 0.056, 0)
  body.rotation.z = Math.PI / 2

  const neck = b.add(new THREE.CylinderGeometry(0.008, 0.011, 0.03, 7), hide)
  neck.position.set(0.026, 0.076, 0)
  neck.rotation.z = -0.45

  const head = b.add(new THREE.CapsuleGeometry(0.009, 0.014, 3, 8), hide)
  head.position.set(0.04, 0.09, 0)
  head.rotation.z = Math.PI / 2 - 0.25

  for (const dx of [-0.021, 0.019]) {
    for (const dz of [-0.011, 0.011]) {
      const leg = b.add(new THREE.CylinderGeometry(0.0035, 0.003, 0.042, 6), dark)
      leg.position.set(dx, 0.021, dz)
    }
  }

  for (const dz of [-0.006, 0.006]) {
    const antler = b.add(new THREE.CylinderGeometry(0.0016, 0.0022, 0.024, 5), dark)
    antler.position.set(0.042, 0.106, dz)
    antler.rotation.z = -0.3
    antler.rotation.x = dz > 0 ? 0.3 : -0.3
    const tine = b.add(new THREE.CylinderGeometry(0.0013, 0.0016, 0.013, 5), dark)
    tine.position.set(0.05, 0.114, dz * 1.6)
    tine.rotation.z = -1.0
  }

  const tail = b.add(new THREE.SphereGeometry(0.006, 7, 6), b.paint(0xe8e2d6, 0.85))
  tail.position.set(-0.03, 0.062, 0)

  const capMesh = b.cap(new THREE.SphereGeometry(0.019, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5))
  capMesh.position.set(-0.002, 0.066, 0)
  capMesh.scale.set(1.5, 0.42, 0.95)
  return b.done(0.044, 0.12)
}

function centerTree(paint: number[]): PieceBuild {
  const b = new Builder()
  const needle = b.paint(paint[0], 0.76)
  const bark = b.paint(0x46311f, 0.85)

  const trunk = b.add(new THREE.CylinderGeometry(0.008, 0.013, 0.042, 8), bark)
  trunk.position.y = 0.021

  const tiers: [number, number, number][] = [
    [0.066, 0.078, 0.036],
    [0.052, 0.072, 0.09],
    [0.036, 0.066, 0.138],
    [0.019, 0.05, 0.184],
  ]
  for (const [r, h, y] of tiers) {
    const m = b.add(new THREE.ConeGeometry(r, h, 10), needle)
    m.position.y = y + h / 2 - 0.018
    const c = b.cap(new THREE.ConeGeometry(r * 1.015, h * 0.5, 10))
    c.position.y = m.position.y - h * 0.25
  }

  const star = b.lamp(0xffe6ac, 2.2)
  const tip = b.add(new THREE.OctahedronGeometry(0.014, 0), star, false)
  tip.position.y = 0.226
  tip.castShadow = false

  // A few warm beads on the lower tiers; emissive only, no extra lights.
  const bead = b.lamp(0xffb066, 1.6)
  const beadGeo = new THREE.SphereGeometry(0.0042, 6, 5)
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.4
    const y = 0.05 + (i % 3) * 0.045
    const r = 0.052 - (i % 3) * 0.014
    const m = new THREE.Mesh(beadGeo, bead)
    m.position.set(Math.cos(a) * r, y, Math.sin(a) * r)
    b.group.add(m)
  }
  b.geometries.push(beadGeo)

  b.lampAnchors.push(new THREE.Vector3(0, 0.19, 0))
  return b.done(0.068, 0.24)
}

const BUILDERS: Record<PieceKind, (paint: number[]) => PieceBuild> = {
  house, fir, lamp, bridge, snowman, deer, centerTree,
}

export function buildPiece(kind: PieceKind, paintIndex: number): PieceBuild {
  const spec = PIECE_SPECS[kind]
  const paint = spec.palette[paintIndex % spec.palette.length]
  const build = BUILDERS[kind](paint)
  build.group.name = `piece:${kind}`
  return build
}

export function disposePiece(p: PieceBuild) {
  for (const g of p.geometries) g.dispose()
  for (const m of p.materials) m.dispose()
  p.group.clear()
}
