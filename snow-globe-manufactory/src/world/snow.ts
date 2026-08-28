import * as THREE from 'three'
import { GROUND_Y, PLOT_R, R_IN } from './dims'

/**
 * Snow inside the globe.
 *
 * Positions live in assembly-local space, which makes containment a single
 * length test and lets the ground plane and the rooftop height field stay
 * static however the globe is turned. Gravity is transformed into that space
 * instead, so inverting the globe is a change of one vector. Nothing collides
 * with building geometry: settling reads a 32x32 height field sampled once when
 * the town changes.
 */

const FIXED_DT = 1 / 60
const MAX_STEPS = 3
/** Share of the globe's rotation the water does NOT pass on to the flakes. */
const SNOW_LAG = 0.34

const VERT = /* glsl */ `
  attribute float aSize;
  attribute float aTone;
  uniform float uScale;
  uniform float uOpacity;
  varying float vTone;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float d = max(0.04, -mv.z);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uScale / d;
    vTone = aTone;
    // Flakes crossing very close to the lens soften instead of covering it.
    vAlpha = uOpacity * smoothstep(0.02, 0.09, d);
  }
`

const FRAG = /* glsl */ `
  precision mediump float;
  uniform vec3 uColor;
  varying float vTone;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c) * 2.0;
    if (r > 1.0) discard;
    float a = (1.0 - r * r);
    a *= a;
    gl_FragColor = vec4(uColor * (0.72 + vTone * 0.34), a * vAlpha);
    if (gl_FragColor.a < 0.006) discard;
  }
`

const GRID = 32

export class HeightField {
  readonly data = new Float32Array(GRID * GRID)

  constructor() {
    this.data.fill(GROUND_Y)
  }

  clear() {
    this.data.fill(GROUND_Y)
  }

  /** Raises a disc of the field — one call per miniature, cheap and coarse. */
  stamp(x: number, z: number, radius: number, top: number) {
    const step = (PLOT_R * 2.4) / GRID
    const half = PLOT_R * 1.2
    for (let j = 0; j < GRID; j++) {
      const wz = -half + (j + 0.5) * step
      for (let i = 0; i < GRID; i++) {
        const wx = -half + (i + 0.5) * step
        const d = Math.hypot(wx - x, wz - z)
        if (d > radius) continue
        // Domed falloff so snow gathers on the ridge, not in a flat slab.
        const h = top - (d / radius) * (d / radius) * (top - GROUND_Y) * 0.55
        const k = j * GRID + i
        if (h > this.data[k]) this.data[k] = h
      }
    }
  }

  sample(x: number, z: number): number {
    const half = PLOT_R * 1.2
    const step = (half * 2) / GRID
    const i = Math.floor((x + half) / step)
    const j = Math.floor((z + half) / step)
    if (i < 0 || j < 0 || i >= GRID || j >= GRID) return GROUND_Y
    return this.data[j * GRID + i]
  }
}

export class SnowSystem {
  readonly points: THREE.Points

  /** How much snow was scooped in, 0..1. Drives how many flakes are active. */
  amount = 0

  private geo = new THREE.BufferGeometry()
  private mat: THREE.ShaderMaterial
  private capacity: number
  private pos: Float32Array
  private vel: Float32Array
  private size: Float32Array
  private state: Uint8Array // 0 dormant, 1 free, 2 settled
  private field: HeightField | null = null
  private acc = 0
  private time = 0
  private swirl = new THREE.Vector3()
  private gLocal = new THREE.Vector3(0, -1, 0)
  private prevQuat = new THREE.Quaternion()
  private dq = new THREE.Quaternion()
  private idq = new THREE.Quaternion()
  private tmp = new THREE.Vector3()
  private settledCount = 0
  private activeCount = 0
  private stirred = 0

  constructor(capacity: number) {
    this.capacity = capacity
    this.pos = new Float32Array(capacity * 3)
    this.vel = new Float32Array(capacity * 3)
    this.size = new Float32Array(capacity)
    this.state = new Uint8Array(capacity)

    const tone = new Float32Array(capacity)
    for (let i = 0; i < capacity; i++) {
      // A deliberate spread: fine dust through to a few fat, slow flakes.
      const t = Math.random()
      this.size[i] = 1.5 + t * t * 7.5
      tone[i] = Math.random()
      this.pos[i * 3 + 1] = -999
    }

    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1))
    this.geo.setAttribute('aTone', new THREE.BufferAttribute(tone, 1))
    this.geo.setDrawRange(0, capacity)

    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uScale: { value: 320 },
        uOpacity: { value: 1 },
        uColor: { value: new THREE.Color(0xf6fbff) },
      },
      transparent: true,
      depthWrite: false,
    })

    this.points = new THREE.Points(this.geo, this.mat)
    this.points.frustumCulled = false
    this.points.renderOrder = 10
    this.points.name = 'snow'
  }

  setHeightField(f: HeightField | null) {
    this.field = f
  }

  setPointScale(px: number) {
    this.mat.uniforms.uScale.value = px
  }

  setOpacity(v: number) {
    this.mat.uniforms.uOpacity.value = v
  }

  /** Fraction of settled flakes — drives the snow caps on roofs and ground. */
  get accumulation(): number {
    return this.activeCount > 0 ? this.settledCount / this.activeCount : 0
  }

  /** Rough measure of how lively the snow currently is, 0..1. */
  get agitation(): number {
    return THREE.MathUtils.clamp(this.stirred, 0, 1)
  }

  private budget(): number {
    return Math.round(this.capacity * THREE.MathUtils.clamp(this.amount, 0, 1))
  }

  /** Drops `n` flakes in near a local point — one scoopful. */
  pour(n: number, at: THREE.Vector3, spread = 0.09) {
    const cap = this.budget()
    let made = 0
    for (let i = 0; i < this.capacity && made < n; i++) {
      if (this.state[i] !== 0) continue
      if (this.activeCount >= cap) break
      const k = i * 3
      this.pos[k] = at.x + (Math.random() - 0.5) * spread
      this.pos[k + 1] = at.y + (Math.random() - 0.5) * spread * 0.4
      this.pos[k + 2] = at.z + (Math.random() - 0.5) * spread
      this.vel[k] = (Math.random() - 0.5) * 0.05
      this.vel[k + 1] = -0.05 - Math.random() * 0.1
      this.vel[k + 2] = (Math.random() - 0.5) * 0.05
      this.state[i] = 1
      this.activeCount++
      made++
    }
  }

  /** Instantly fills to `amount` with flakes already resting on the ground. */
  settleImmediately() {
    const cap = this.budget()
    this.activeCount = 0
    this.settledCount = 0
    for (let i = 0; i < this.capacity; i++) {
      const k = i * 3
      if (i >= cap) {
        this.state[i] = 0
        this.pos[k + 1] = -999
        continue
      }
      const a = Math.random() * Math.PI * 2
      const r = Math.sqrt(Math.random()) * PLOT_R * 1.12
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r
      this.pos[k] = x
      this.pos[k + 1] = (this.field ? this.field.sample(x, z) : GROUND_Y) + 0.004
      this.pos[k + 2] = z
      this.vel[k] = this.vel[k + 1] = this.vel[k + 2] = 0
      this.state[i] = 2
      this.activeCount++
      this.settledCount++
    }
    this.geo.attributes.position.needsUpdate = true
  }

  /** A swipe across the globe: adds spin about `axis` plus loose turbulence. */
  shake(axisLocal: THREE.Vector3, power: number) {
    this.swirl.addScaledVector(axisLocal, power)
    if (this.swirl.length() > 9) this.swirl.setLength(9)
    this.stirred = Math.min(1.35, this.stirred + power * 0.28)
    for (let i = 0; i < this.capacity; i++) {
      if (this.state[i] === 0) continue
      if (this.state[i] === 2) {
        this.state[i] = 1
        this.settledCount--
      }
      const k = i * 3
      const j = power * 0.16
      this.vel[k] += (Math.random() - 0.5) * j
      this.vel[k + 1] += (Math.random() - 0.5) * j
      this.vel[k + 2] += (Math.random() - 0.5) * j
    }
  }

  /** Knocks resting snow loose within a small radius (tapping a bridge). */
  dislodge(at: THREE.Vector3, radius: number) {
    let woke = 0
    for (let i = 0; i < this.capacity; i++) {
      if (this.state[i] !== 2) continue
      const k = i * 3
      const d = Math.hypot(this.pos[k] - at.x, this.pos[k + 1] - at.y, this.pos[k + 2] - at.z)
      if (d > radius) continue
      this.state[i] = 1
      this.settledCount--
      this.vel[k] = (Math.random() - 0.5) * 0.1
      this.vel[k + 1] = -0.03
      this.vel[k + 2] = (Math.random() - 0.5) * 0.1
      woke++
    }
    return woke
  }

  /**
   * @param assemblyQuat world orientation of the globe, used to bring gravity
   *        into local space and to drag the water with the glass.
   * @param submerged 0..1 — dry snow falls fast, snow in water drifts.
   */
  update(dt: number, assemblyQuat: THREE.Quaternion, submerged: number) {
    // Water carries the snow most of the way round with the glass; the rest
    // lags. In local space "no drag at all" is D = Qnew^-1 * Qold, so applying
    // a partial slerp from identity toward D gives the lag for free.
    this.dq.copy(assemblyQuat).invert().multiply(this.prevQuat)
    this.prevQuat.copy(assemblyQuat)
    if (Math.abs(this.dq.w) < 0.999995) {
      this.idq.identity().slerp(this.dq, SNOW_LAG)
      for (let i = 0; i < this.capacity; i++) {
        if (this.state[i] === 0) continue
        const k = i * 3
        this.tmp.set(this.pos[k], this.pos[k + 1], this.pos[k + 2]).applyQuaternion(this.idq)
        this.pos[k] = this.tmp.x
        this.pos[k + 1] = this.tmp.y
        this.pos[k + 2] = this.tmp.z
      }
      this.geo.attributes.position.needsUpdate = true
    }

    this.gLocal.set(0, -1, 0).applyQuaternion(this.tmpInv(assemblyQuat))

    this.acc = Math.min(this.acc + dt, FIXED_DT * (MAX_STEPS + 1))
    let steps = 0
    while (this.acc >= FIXED_DT && steps < MAX_STEPS) {
      this.step(FIXED_DT, submerged)
      this.acc -= FIXED_DT
      steps++
    }
    if (steps > 0) this.geo.attributes.position.needsUpdate = true
  }

  private invQ = new THREE.Quaternion()
  private tmpInv(q: THREE.Quaternion): THREE.Quaternion {
    return this.invQ.copy(q).invert()
  }

  private step(h: number, submerged: number) {
    this.time += h
    // Water damps hard; the dry sphere lets flakes drop briskly.
    const damp = THREE.MathUtils.lerp(0.985, 0.918, submerged)
    const gScale = THREE.MathUtils.lerp(0.9, 0.115, submerged)
    // Water keeps a vortex alive for several seconds; dry air does not. This is
    // the part the player is really watching after they let go.
    const swirlDecay = Math.exp(-h * THREE.MathUtils.lerp(3.4, 0.55, submerged))
    this.swirl.multiplyScalar(swirlDecay)
    this.stirred = Math.max(0, this.stirred - h * 0.5)

    const sx = this.swirl.x
    const sy = this.swirl.y
    const sz = this.swirl.z
    const swirling = this.swirl.lengthSq() > 1e-5
    const gx = this.gLocal.x
    const gy = this.gLocal.y
    const gz = this.gLocal.z
    const groundFacesGravity = gy < -0.25
    const limit = R_IN - 0.012
    const limitSq = limit * limit

    for (let i = 0; i < this.capacity; i++) {
      const s = this.state[i]
      if (s === 0) continue
      const k = i * 3
      let px = this.pos[k]
      let py = this.pos[k + 1]
      let pz = this.pos[k + 2]

      if (s === 2) {
        // Settled snow only wakes when the surface it rests on tips over.
        if (!groundFacesGravity) {
          this.state[i] = 1
          this.settledCount--
        }
        continue
      }

      let vx = this.vel[k]
      let vy = this.vel[k + 1]
      let vz = this.vel[k + 2]

      // Terminal-speed spread: the fattest flakes sink noticeably slower.
      const drag = 1 - (this.size[i] - 1.5) * 0.028
      vx += gx * gScale * h * drag
      vy += gy * gScale * h * drag
      vz += gz * gScale * h * drag

      if (swirling) {
        // v += omega x r, so the whole body of water turns together.
        vx += (sy * pz - sz * py) * h
        vy += (sz * px - sx * pz) * h
        vz += (sx * py - sy * px) * h
      }

      // Cheap curl-ish turbulence keeps the vortex from staying a clean ring.
      const t = this.time * 0.9
      vx += Math.sin(py * 9.1 + t * 1.7 + i) * 0.0055 * submerged
      vy += Math.sin(pz * 8.3 + t * 1.3 + i * 0.7) * 0.004 * submerged
      vz += Math.sin(px * 9.7 + t * 1.9 + i * 0.3) * 0.0055 * submerged

      vx *= damp
      vy *= damp
      vz *= damp

      px += vx * h
      py += vy * h
      pz += vz * h

      // Contain within the glass.
      const d2 = px * px + py * py + pz * pz
      if (d2 > limitSq) {
        const d = Math.sqrt(d2)
        const nx = px / d
        const ny = py / d
        const nz = pz / d
        px = nx * limit
        py = ny * limit
        pz = nz * limit
        const dot = vx * nx + vy * ny + vz * nz
        // Slide along the glass rather than bouncing off it.
        vx = (vx - nx * dot) * 0.55
        vy = (vy - ny * dot) * 0.55
        vz = (vz - nz * dot) * 0.55
      }

      // Land on the ground / rooftops, but only when they face gravity.
      if (groundFacesGravity) {
        const top = this.field ? this.field.sample(px, pz) : GROUND_Y
        if (py <= top + 0.004) {
          py = top + 0.004
          const speed = Math.hypot(vx, vy, vz)
          if (speed < 0.075) {
            this.state[i] = 2
            this.settledCount++
            this.vel[k] = this.vel[k + 1] = this.vel[k + 2] = 0
            this.pos[k] = px
            this.pos[k + 1] = py
            this.pos[k + 2] = pz
            continue
          }
          vy = Math.abs(vy) * 0.12
          vx *= 0.6
          vz *= 0.6
        }
      }

      this.pos[k] = px
      this.pos[k + 1] = py
      this.pos[k + 2] = pz
      this.vel[k] = vx
      this.vel[k + 1] = vy
      this.vel[k + 2] = vz
    }
  }

  dispose() {
    this.geo.dispose()
    this.mat.dispose()
  }
}

/**
 * Near-field flakes for the workbench: the handful of granules that actually
 * leave the scoop. Simulated in world space and short-lived, kept separate from
 * the in-globe system so the pour reads crisp without inflating that budget.
 */
export class PourFx {
  readonly points: THREE.Points
  private geo = new THREE.BufferGeometry()
  private mat: THREE.ShaderMaterial
  private pos: Float32Array
  private vel: Float32Array
  private life: Float32Array
  private n: number
  private cursor = 0

  constructor(count: number) {
    this.n = count
    this.pos = new Float32Array(count * 3)
    this.vel = new Float32Array(count * 3)
    this.life = new Float32Array(count)
    const size = new Float32Array(count)
    const tone = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      size[i] = 2.2 + Math.random() * 5.5
      tone[i] = Math.random()
      this.pos[i * 3 + 1] = -999
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
    this.geo.setAttribute('aTone', new THREE.BufferAttribute(tone, 1))
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uScale: { value: 320 },
        uOpacity: { value: 1 },
        uColor: { value: new THREE.Color(0xfbfdff) },
      },
      transparent: true,
      depthWrite: false,
    })
    this.points = new THREE.Points(this.geo, this.mat)
    this.points.frustumCulled = false
    this.points.renderOrder = 20
  }

  setPointScale(px: number) {
    this.mat.uniforms.uScale.value = px
  }

  emit(at: THREE.Vector3, dir: THREE.Vector3, n: number) {
    for (let i = 0; i < n; i++) {
      const idx = this.cursor % this.n
      this.cursor++
      const k = idx * 3
      this.pos[k] = at.x + (Math.random() - 0.5) * 0.04
      this.pos[k + 1] = at.y + (Math.random() - 0.5) * 0.02
      this.pos[k + 2] = at.z + (Math.random() - 0.5) * 0.04
      this.vel[k] = dir.x * 0.25 + (Math.random() - 0.5) * 0.14
      this.vel[k + 1] = dir.y * 0.25 + (Math.random() - 0.5) * 0.06
      this.vel[k + 2] = dir.z * 0.25 + (Math.random() - 0.5) * 0.14
      this.life[idx] = 0.75 + Math.random() * 0.5
    }
    this.points.visible = true
  }

  update(dt: number) {
    let any = false
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue
      any = true
      this.life[i] -= dt
      const k = i * 3
      this.vel[k + 1] -= 1.6 * dt
      this.pos[k] += this.vel[k] * dt
      this.pos[k + 1] += this.vel[k + 1] * dt
      this.pos[k + 2] += this.vel[k + 2] * dt
      if (this.life[i] <= 0) this.pos[k + 1] = -999
    }
    if (any) this.geo.attributes.position.needsUpdate = true
    this.points.visible = any
  }

  clear() {
    this.life.fill(0)
    for (let i = 0; i < this.n; i++) this.pos[i * 3 + 1] = -999
    this.geo.attributes.position.needsUpdate = true
    this.points.visible = false
  }

  dispose() {
    this.geo.dispose()
    this.mat.dispose()
  }
}
