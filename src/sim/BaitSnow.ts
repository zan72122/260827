import * as THREE from 'three'
import { amiMass } from '../scene/Textures'
import { applyUnderwater, WATER_Y } from '../scene/Water'
import type { DensityField } from './DensityField'

/**
 * Loose krill in the water: pooled instanced fragments, each with its
 * own sink rate and size, pushed sideways by a simple flow field with a
 * little turbulence. No glow, no sparkle, no six-fold symmetry -- these
 * are wet scraps of shrimp coming apart, and they write the density
 * field the fish read.
 */

function fragmentGeometry(): THREE.BufferGeometry {
  // one irregular chip; per-instance rotation and non-uniform scale do
  // the rest of the variation
  const geo = new THREE.IcosahedronGeometry(1, 0)
  const pos = geo.attributes.position as THREE.BufferAttribute
  let s = 12345
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
  for (let i = 0; i < pos.count; i++) {
    const k = 0.55 + rnd() * 0.8
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.62, pos.getZ(i) * k * 0.85)
  }
  geo.computeVertexNormals()
  return geo
}

interface P {
  x: number; y: number; z: number
  vx: number; vy: number; vz: number
  sink: number; size: number; life: number; maxLife: number
  rx: number; ry: number; rz: number; spin: number
  alive: boolean
}

export class BaitSnow {
  readonly mesh: THREE.InstancedMesh
  readonly capacity: number
  private pool: P[] = []
  private free: number[] = []
  private live: number[] = []
  private mat: THREE.MeshStandardMaterial
  private m4 = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private e = new THREE.Euler()
  private v = new THREE.Vector3()
  private s = new THREE.Vector3()
  private color = new THREE.Color()
  private time = 0
  /** horizontal flow, m/s */
  flow = new THREE.Vector2(0, 0)

  constructor(capacity: number) {
    this.capacity = capacity
    const a = amiMass(true)
    this.mat = applyUnderwater(new THREE.MeshStandardMaterial({
      map: a.map,
      color: 0xffe8de,
      roughness: 0.62,
      metalness: 0,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      flatShading: true,
      side: THREE.DoubleSide,
    })) as THREE.MeshStandardMaterial
    this.mesh = new THREE.InstancedMesh(fragmentGeometry(), this.mat, capacity)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.frustumCulled = false
    this.mesh.name = 'baitSnow'
    this.mesh.castShadow = false
    const colors = new Float32Array(capacity * 3).fill(1)
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3)
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage)
    for (let i = 0; i < capacity; i++) {
      this.pool.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, sink: 0, size: 0, life: 0, maxLife: 1, rx: 0, ry: 0, rz: 0, spin: 0, alive: false })
      this.free.push(i)
      this.hide(i)
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }

  get liveCount() { return this.live.length }

  private hide(i: number) {
    this.m4.makeScale(0, 0, 0)
    this.mesh.setMatrixAt(i, this.m4)
  }

  /** Shed one fragment from a hook. */
  spawn(x: number, y: number, z: number, spread = 0.02, sizeScale = 1) {
    const i = this.free.pop()
    if (i === undefined) return
    const p = this.pool[i]
    p.x = x + (Math.random() - 0.5) * spread
    p.y = y + (Math.random() - 0.5) * spread * 0.6
    p.z = z + (Math.random() - 0.5) * spread
    p.vx = (Math.random() - 0.5) * 0.03
    p.vy = -0.01 - Math.random() * 0.02
    p.vz = (Math.random() - 0.5) * 0.03
    // wet krill scraps: heavier pieces drop, shreds hang in the water
    const grade = Math.random()
    p.sink = 0.035 + grade * grade * 0.20
    p.size = (0.0075 + grade * 0.0125) * sizeScale
    p.maxLife = 11 + Math.random() * 9
    p.life = 0
    p.rx = Math.random() * 6.28; p.ry = Math.random() * 6.28; p.rz = Math.random() * 6.28
    p.spin = (Math.random() - 0.5) * 1.4
    p.alive = true
    this.live.push(i)
  }

  clear() {
    for (const i of this.live) { this.pool[i].alive = false; this.hide(i); this.free.push(i) }
    this.live.length = 0
    this.mesh.instanceMatrix.needsUpdate = true
  }

  update(dt: number, field: DensityField) {
    this.time += dt
    field.clearAccum()
    const t = this.time
    for (let n = this.live.length - 1; n >= 0; n--) {
      const i = this.live[n]
      const p = this.pool[i]
      p.life += dt
      // flow: stronger near the surface, and slack down in the lee of the quay
      const depth = WATER_Y - p.y
      const shear = 1 / (1 + depth * 0.14)
      const fx = this.flow.x * shear
      const fz = this.flow.y * shear
      // cheap turbulence: three offset sines, no fluid solve
      const tx = Math.sin(p.y * 2.3 + t * 0.9 + p.z * 1.7) * 0.5 + Math.sin(p.x * 3.1 - t * 0.6) * 0.5
      const tz = Math.cos(p.y * 2.1 - t * 0.75 + p.x * 1.3) * 0.5 + Math.sin(p.z * 2.7 + t * 0.5) * 0.5
      const turb = 0.012 + Math.abs(this.flow.x) * 0.05
      p.vx += ((fx + tx * turb) - p.vx) * Math.min(1, dt * 1.6)
      p.vz += ((fz + tz * turb) - p.vz) * Math.min(1, dt * 1.6)
      p.vy += ((-p.sink) - p.vy) * Math.min(1, dt * 2.4)
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt
      p.rx += p.spin * dt * 0.7
      p.rz += p.spin * dt

      const fade = p.life / p.maxLife
      if (fade >= 1 || p.y < WATER_Y - 9.5) {
        p.alive = false
        this.hide(i)
        this.free.push(i)
        this.live.splice(n, 1)
        continue
      }
      // fragments break down: smaller and paler as they go
      const shrink = 1 - fade * fade * 0.65
      const sz = p.size * shrink
      this.e.set(p.rx, p.ry, p.rz)
      this.q.setFromEuler(this.e)
      this.v.set(p.x, p.y, p.z)
      this.s.set(sz * 1.35, sz * 0.85, sz)
      this.m4.compose(this.v, this.q, this.s)
      this.mesh.setMatrixAt(i, this.m4)
      const pale = 1 - fade * 0.45
      this.color.setRGB(pale, pale * (0.96 + fade * 0.04), pale * (0.94 + fade * 0.06))
      this.mesh.setColorAt(i, this.color)
      // deposit: bigger, fresher grains smell strongest. the fine dust
      // that comes off each grain is not drawn, but it still sinks and
      // drifts, so a short tail is deposited below and down-current
      const w = (0.55 + shrink) * (1 - fade * 0.5)
      field.splat(p.x, p.y, p.z, w)
      // the plume widens as it sinks; the offsets are fixed per grain so
      // the cone drifts with the grain instead of shimmering
      const jx = Math.sin(p.rx * 3.1), jz = Math.cos(p.rz * 2.7)
      field.splat(p.x + this.flow.x * 0.5 + jx * 0.55, p.y - 0.5, p.z + this.flow.y * 0.5 + jz * 0.55, w * 0.42)
      field.splat(p.x + this.flow.x * 1.1 - jz * 1.0, p.y - 1.05, p.z + this.flow.y * 1.1 + jx * 1.0, w * 0.24)
      field.splat(p.x + this.flow.x * 1.6 + jz * 1.5, p.y - 1.7, p.z + this.flow.y * 1.6 - jx * 1.5, w * 0.13)
    }
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
    field.commit(dt)
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.mat.dispose()
  }
}
