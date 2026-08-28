import * as THREE from 'three'
import { WATER_Y, QUAY_Z } from '../scene/Water'
import { createFishGeometry, createFishMaterial, attachPhase } from './Fish'
import type { DensityField } from './DensityField'

const FWD = new THREE.Vector3(0, 0, 1)

interface Fish {
  p: THREE.Vector3
  v: THREE.Vector3
  phase: number
  speedVar: number
  /** 0 = patrolling, 1 = has turned toward the krill */
  interest: number
  /** set when recruited by a neighbour: a beat of hesitation before turning */
  delay: number
  /** who it is following until it smells the krill itself */
  leader: number
  /** best concentration this fish has personally met, and where */
  mem: THREE.Vector3
  memV: number
  feed: number
  bank: number
  size: number
  hero: number
  caught: boolean
}

export class School {
  readonly group = new THREE.Group()
  readonly fish: Fish[] = []
  private inst: THREE.InstancedMesh
  private heroes: THREE.Mesh[] = []
  private mat: THREE.MeshStandardMaterial
  private geoLow: THREE.BufferGeometry
  private geoHigh: THREE.BufferGeometry
  private m4 = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private tmp = new THREE.Vector3()
  private grad = { x: 0, y: 0, z: 0 }
  private qRoll = new THREE.Quaternion()
  private one = new THREE.Vector3(1, 1, 1)
  readonly center = new THREE.Vector3(-0.5, -3.85, -3.1)
  private centerVel = new THREE.Vector3()
  private t = 0
  private recruitClock = 0
  /** seconds since the first fish turned; -1 while none has */
  firstTurnAge = -1
  bandY = WATER_Y - 2.5
  flow = new THREE.Vector2(0, 0)
  /** how many fish have committed to the krill */
  interested = 0
  /** fish currently nosing a baited hook */
  atHook = 0
  onFirstTurn?: () => void
  onBite?: () => void
  private biteArmed = false
  private biteCool = 0

  /** How many fish are simulated: the first frames run a smaller shoal
   *  so the fishing seat is playable before the rest streams in. */
  private active: number

  constructor(count: number, heroCount = 3) {
    this.group.name = 'school'
    this.active = Math.min(count, 26)
    this.geoLow = createFishGeometry('low')
    this.geoHigh = createFishGeometry('high')
    this.mat = createFishMaterial()

    const instCount = count - heroCount
    const phases = new Float32Array(instCount)
    const speeds = new Float32Array(instCount)
    for (let i = 0; i < instCount; i++) {
      phases[i] = Math.random() * 6.283
      speeds[i] = 0.82 + Math.random() * 0.42
    }
    this.inst = new THREE.InstancedMesh(this.geoLow, this.mat, instCount)
    this.inst.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1))
    this.inst.geometry.setAttribute('aSpeed', new THREE.InstancedBufferAttribute(speeds, 1))
    this.inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.inst.frustumCulled = false
    this.group.add(this.inst)

    for (let h = 0; h < heroCount; h++) {
      const g = attachPhase(this.geoHigh.clone(), Math.random() * 6.283, 0.9 + Math.random() * 0.3)
      const m = new THREE.Mesh(g, this.mat)
      m.frustumCulled = false
      this.heroes.push(m)
      this.group.add(m)
    }

    for (let i = 0; i < count; i++) {
      const hero = i < heroCount ? i : -1
      this.fish.push({
        p: new THREE.Vector3(
          this.center.x + (Math.random() - 0.5) * 2.6,
          this.bandY + (Math.random() - 0.5) * 0.9,
          this.center.z + (Math.random() - 0.5) * 2.2 - (hero >= 0 ? 0.5 : 0)
        ),
        v: new THREE.Vector3(0.2 + Math.random() * 0.1, 0, (Math.random() - 0.5) * 0.05),
        phase: Math.random() * 6.283,
        speedVar: 0.85 + Math.random() * 0.35,
        interest: 0, delay: 0, leader: -1,
        mem: new THREE.Vector3(), memV: 0, feed: 0, bank: 0, hero, caught: false,
        size: 0.86 + Math.random() * 0.3,
      })
    }
  }

  /** Start every trial from the same shoal position: the child is
   *  comparing one changed variable, so the rest must not drift. */
  reset(bandY = WATER_Y - 2.5) {
    this.bandY = bandY
    this.firstTurnAge = -1
    this.interested = 0
    this.biteArmed = false
    this.center.set(-0.5, bandY, -3.1)
    this.centerVel.set(0, 0, 0)
    this.t = 0
    this.recruitClock = 0
    for (const f of this.fish) {
      f.interest = 0; f.delay = 0; f.leader = -1; f.memV = 0; f.feed = 0; f.caught = false
      f.p.set(this.center.x + (Math.random() - 0.5) * 2.6, bandY + (Math.random() - 0.5) * 0.9, this.center.z + (Math.random() - 0.5) * 2.2)
      f.v.set(0.2 + Math.random() * 0.1, 0, (Math.random() - 0.5) * 0.05)
    }
  }

  /**
   * Hand over the fish that actually took the bait. They leave the shoal
   * -- they are on the rig now -- and the game animates them from there.
   */
  takeAt(pos: THREE.Vector3, n: number): number[] {
    const cand: { i: number; d: number }[] = []
    for (let i = 0; i < this.active; i++) {
      const f = this.fish[i]
      if (f.caught) continue
      const d = f.p.distanceTo(pos)
      if (d < 1.2) cand.push({ i, d })
    }
    cand.sort((a, b) => a.d - b.d)
    const out: number[] = []
    for (let k = 0; k < Math.min(n, cand.length); k++) {
      this.fish[cand[k].i].caught = true
      out.push(cand[k].i)
    }
    // there is always at least one fish on the hooks when a bite is set
    if (out.length === 0) {
      for (let i = 0; i < this.active; i++) {
        if (!this.fish[i].caught) { this.fish[i].caught = true; out.push(i); break }
      }
    }
    return out
  }

  armBite() { this.biteArmed = true }
  disarmBite() { this.biteArmed = false }

  /** Swap two fish so the detailed model is the one doing the key move. */
  private promoteToHero(i: number) {
    const f = this.fish[i]
    if (f.hero >= 0) return i
    let target = -1
    for (let h = 0; h < this.fish.length; h++) {
      if (this.fish[h].hero >= 0 && this.fish[h].interest === 0) { target = h; break }
    }
    if (target < 0) return i
    const a = this.fish[i], b = this.fish[target]
    const pt = a.p.clone(), vt = a.v.clone()
    a.p.copy(b.p); a.v.copy(b.v)
    b.p.copy(pt); b.v.copy(vt)
    return target
  }

  /** Bring the rest of the shoal in once the first frames are through. */
  activateAll() { this.active = this.fish.length }

  get activeCount() { return this.active }

  update(dt: number, field: DensityField, rig: THREE.Vector3, rigBaited: boolean) {
    this.t += dt
    const N = this.active

    // the shoal patrols the quay: a slow wander, unaffected by the rig
    this.centerVel.x += (Math.sin(this.t * 0.26) * 0.9 - this.center.x - 0.2) * dt * 0.25
    this.centerVel.z += (Math.sin(this.t * 0.19 + 1.7) * 1.0 - this.center.z - 2.6) * dt * 0.25
    this.centerVel.multiplyScalar(1 - dt * 0.9)
    this.center.addScaledVector(this.centerVel, dt)
    this.center.y += (this.bandY - this.center.y) * Math.min(1, dt * 0.6)
    this.center.x += this.flow.x * dt * 0.25
    this.center.z += this.flow.y * dt * 0.25

    // ---- interest: one fish first, then its neighbours ----
    if (field.peak.v > 0.35) {
      let anyInterest = false
      for (const f of this.fish) if (f.interest > 0) { anyInterest = true; break }
      if (!anyInterest) {
        let best = -1, bestV = 0.22
        for (let i = 0; i < N; i++) {
          const f = this.fish[i]
          const s = field.sample(f.p.x + f.v.x * 0.7, f.p.y + f.v.y * 0.7, f.p.z + f.v.z * 0.7)
          if (s > bestV) { bestV = s; best = i }
        }
        if (best >= 0) {
          const idx = this.promoteToHero(best)
          const f = this.fish[idx]
          f.interest = 1
          f.delay = 0
          f.mem.copy(f.p)
          f.memV = bestV
          this.firstTurnAge = 0
          this.onFirstTurn?.()
        }
      }
    }
    if (this.firstTurnAge >= 0) this.firstTurnAge += dt

    // the cascade: the fish that turned first gets a clear beat alone,
    // then it pulls in a neighbour at a time. the shoal's shape changes
    // over several seconds, never all at once
    this.recruitClock += dt
    if (this.firstTurnAge > 1.6 && this.recruitClock > 0.5) {
      this.recruitClock = 0
      const R2 = 1.7 * 1.7
      for (let i = 0; i < N; i++) {
        const a = this.fish[i]
        if (a.interest <= 0 || a.delay > 0 || a.caught) continue
        if (Math.random() > 0.28) continue
        for (let j = 0; j < N; j++) {
          const b = this.fish[j]
          if (b.interest > 0 || b.delay > 0 || b.caught) continue
          if (a.p.distanceToSquared(b.p) > R2) continue
          b.delay = 0.25 + Math.random() * 0.6
          b.leader = i
          break
        }
      }
    }

    let interested = 0
    let atHook = 0
    const cruise = 0.22

    for (let i = 0; i < N; i++) {
      const f = this.fish[i]
      if (f.caught) continue
      if (f.delay > 0) {
        f.delay -= dt
        if (f.delay <= 0) { f.interest = 1; f.mem.copy(f.p); f.memV = 0.02 }
      }
      const here = field.sample(f.p.x, f.p.y, f.p.z)
      if (here > f.memV) { f.memV = here; f.mem.set(f.p.x, f.p.y, f.p.z) }
      // interest decays where there is nothing left to smell
      if (f.interest > 0) {
        f.memV *= 1 - dt * 0.12
        if (f.memV < 0.02 && here < 0.02 && field.peak.v < 0.05) { f.interest = 0; f.leader = -1 }
      }
      if (f.interest > 0) interested++

      const ax = { x: 0, y: 0, z: 0 }
      // --- separation, alignment, cohesion over the near neighbours ---
      let cx = 0, cy = 0, cz = 0, ac = 0
      let vx = 0, vy = 0, vz = 0
      for (let j = 0; j < N; j++) {
        if (j === i) continue
        const o = this.fish[j]
        if (o.caught) continue
        const dx = f.p.x - o.p.x, dy = f.p.y - o.p.y, dz = f.p.z - o.p.z
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 > 1.4) continue
        if (d2 < 0.085) {
          const inv = 1 / (Math.sqrt(d2) + 1e-4)
          ax.x += dx * inv * 0.9; ax.y += dy * inv * 0.9; ax.z += dz * inv * 0.9
        }
        cx += o.p.x; cy += o.p.y; cz += o.p.z
        vx += o.v.x; vy += o.v.y; vz += o.v.z
        ac++
      }
      if (ac > 0) {
        cx /= ac; cy /= ac; cz /= ac
        ax.x += (cx - f.p.x) * 0.22; ax.y += (cy - f.p.y) * 0.22; ax.z += (cz - f.p.z) * 0.22
        ax.x += (vx / ac - f.v.x) * 0.5; ax.y += (vy / ac - f.v.y) * 0.5; ax.z += (vz / ac - f.v.z) * 0.5
      }

      let speed = cruise * f.speedVar

      if (f.interest > 0) {
        speed = cruise * 1.5 * f.speedVar
        if (here > 0.03) {
          // it can smell krill right here: swim up the gradient
          field.gradient(f.p.x, f.p.y, f.p.z, this.grad)
          const gl = Math.hypot(this.grad.x, this.grad.y, this.grad.z) + 1e-5
          ax.x += (this.grad.x / gl) * 1.7
          ax.y += (this.grad.y / gl) * 1.7
          ax.z += (this.grad.z / gl) * 1.7
        } else if (f.leader >= 0 && this.fish[f.leader].interest > 0) {
          // recruited, still blind: hold on the fish that turned
          const l = this.fish[f.leader]
          ax.x += (l.p.x - f.p.x) * 0.85
          ax.y += (l.p.y - f.p.y) * 0.85
          ax.z += (l.p.z - f.p.z) * 0.85
          ax.x += (l.v.x - f.v.x) * 0.5
          ax.z += (l.v.z - f.v.z) * 0.5
        } else {
          // work back toward the strongest patch it has met
          ax.x += (f.mem.x - f.p.x) * 0.55
          ax.y += (f.mem.y - f.p.y) * 0.55
          ax.z += (f.mem.z - f.p.z) * 0.55
        }
        // right at the bait, slow down and mill
        const dr = f.p.distanceTo(rig)
        if (rigBaited && dr < 0.55) {
          speed *= 0.42
          f.feed = Math.min(1, f.feed + dt * 1.4)
          if (dr < 0.3) atHook++
          if (this.biteArmed && this.biteCool <= 0 && dr < 0.26 && f.feed > 0.7) {
            this.biteCool = 1.0
            this.onBite?.()
          }
        } else {
          f.feed = Math.max(0, f.feed - dt * 0.7)
        }
      } else {
        // patrolling: hold the shoal together around its wandering centre
        ax.x += (this.center.x - f.p.x) * 0.30
        ax.y += (this.center.y - f.p.y) * 0.55
        ax.z += (this.center.z - f.p.z) * 0.30
        ax.x += Math.sin(this.t * 0.7 + f.phase) * 0.12
        ax.z += Math.cos(this.t * 0.5 + f.phase * 1.3) * 0.12
        // a bare rig is an object in the water, not an attraction: a few
        // fish shy a little as they pass it, nothing more
        const dr = f.p.distanceTo(rig)
        if (dr < 0.45) {
          this.tmp.subVectors(f.p, rig).normalize()
          ax.x += this.tmp.x * 0.45; ax.y += this.tmp.y * 0.2; ax.z += this.tmp.z * 0.45
        }
      }

      // drift with the water
      ax.x += (this.flow.x * 0.5 - 0) * 0.4
      ax.z += (this.flow.y * 0.5 - 0) * 0.4

      // stay in the water column and off the wall
      if (f.p.y > WATER_Y - 0.55) ax.y -= (f.p.y - (WATER_Y - 0.55)) * 6
      if (f.p.y < WATER_Y - 7.6) ax.y += ((WATER_Y - 7.6) - f.p.y) * 6
      if (f.p.z > QUAY_Z - 0.55) ax.z -= (f.p.z - (QUAY_Z - 0.55)) * 7
      if (f.p.z < -7.5) ax.z += (-7.5 - f.p.z) * 5
      if (Math.abs(f.p.x) > 5) ax.x -= Math.sign(f.p.x) * (Math.abs(f.p.x) - 5) * 5

      // integrate with a capped turn rate: no snapping, no teleporting
      f.v.x += ax.x * dt * 2.2
      f.v.y += ax.y * dt * 2.2
      f.v.z += ax.z * dt * 2.2
      const sp = f.v.length()
      if (sp > 1e-5) {
        const target = THREE.MathUtils.clamp(speed, 0.05, 0.62)
        f.v.multiplyScalar((sp + (target - sp) * Math.min(1, dt * 2.0)) / sp)
      }
      const prevX = f.v.x, prevZ = f.v.z
      f.p.addScaledVector(f.v, dt)
      f.bank += ((prevX * f.v.z - prevZ * f.v.x) * 6 - f.bank) * Math.min(1, dt * 4)
    }

    this.interested = interested
    this.atHook = atHook
    if (this.biteCool > 0) this.biteCool -= dt

    // ---- write transforms ----
    let ii = 0
    for (let i = 0; i < N; i++) {
      const f = this.fish[i]
      if (f.caught) { if (f.hero >= 0) this.heroes[f.hero].visible = false; continue }
      if (f.hero >= 0) this.heroes[f.hero].visible = true
      this.tmp.copy(f.v)
      if (this.tmp.lengthSq() < 1e-8) this.tmp.set(0, 0, 1)
      this.tmp.normalize()
      this.q.setFromUnitVectors(FWD, this.tmp)
      this.qRoll.setFromAxisAngle(this.tmp, THREE.MathUtils.clamp(f.bank, -0.8, 0.8))
      this.q.premultiply(this.qRoll)
      if (f.hero >= 0) {
        const h = this.heroes[f.hero]
        h.position.copy(f.p)
        h.quaternion.copy(this.q)
        h.scale.setScalar(f.size)
      } else {
        this.one.setScalar(f.size)
        this.m4.compose(f.p, this.q, this.one)
        this.inst.setMatrixAt(ii++, this.m4)
      }
    }
    this.inst.count = ii
    this.inst.instanceMatrix.needsUpdate = true
  }

  dispose() {
    this.geoLow.dispose()
    this.geoHigh.dispose()
    this.heroes.forEach((h) => h.geometry.dispose())
    this.mat.dispose()
  }
}
