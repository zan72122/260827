import { Vector3 } from 'three'
import { approach, clamp, lerp, noise1, smoothstep, Spring } from './util/num'

export type Act = 1 | 2 | 3
export type ReelState = 'idle' | 'winding' | 'showing' | 'lowering'
export type FishPhase = 'cruise' | 'approach' | 'nibble' | 'retreat' | 'hooked' | 'landed'

/** The single fishing axis: the line enters the water here. */
export const AXIS_X = 0
export const AXIS_Z = 0
export const WATER_Y = 0
export const DECK_TOP = 0.42
export const DECK_THICK = 0.055
export const LAKE_BED = -5.2
export const REST_DEPTH = -0.52
export const MIN_DEPTH = -0.22
export const MAX_DEPTH = -1.02

export interface Fish {
  phase: FishPhase
  pos: Vector3
  vel: Vector3
  yaw: number
  bank: number
  tailPhase: number
  size: number
  timer: number
  nibblesLeft: number
  nextNibble: number
  seed: number
}

function makeFish(seed: number): Fish {
  const a = seed * 2.399963
  return {
    phase: 'cruise',
    pos: new Vector3(Math.cos(a) * (0.75 + noise1(seed * 3.1) * 0.75), REST_DEPTH - 0.22, Math.sin(a) * (0.75 + noise1(seed * 7.7) * 0.75)),
    vel: new Vector3(),
    yaw: a,
    bank: 0,
    tailPhase: seed * 1.7,
    size: 0.098 + noise1(seed * 5.3) * 0.032,
    timer: 0,
    nibblesLeft: 0,
    nextNibble: 0,
    seed,
  }
}

export class World {
  time = 0
  dt = 1 / 60
  act: Act = 1
  started = false

  /** ---- shared state read by every renderer, above and below the surface ---- */
  lurePosition = new Vector3(AXIS_X, REST_DEPTH, AXIS_Z)
  /** world position of the bait a fish actually goes for (fed by the rig) */
  baitPos = new Vector3(AXIS_X, REST_DEPTH, AXIS_Z)
  lureRestDepth = REST_DEPTH
  lureVel = 0
  lureMotion = 0 // 0..1 smoothed jigging energy
  stillTime = 0
  jigCount = 0
  lineTension = 0.22 // 0..1, static rig weight at rest
  tensionPulse = -1 // seconds since a pulse left the bait, <0 = none
  tensionPulseAmp = 0
  fishIntent = 0 // attraction accumulated by the child's jigging
  fishContact = 0 // 0..1 envelope while a fish is actually touching the bait
  boatSway = 0 // radians of hull roll
  boatSwayVel = 0
  boatGust = 0 // 0..1 slow envelope: calm spells vs swell spells
  rodTipDeflection = new Vector3()
  cutawayVisibility = { deck: 1, surface: 1, pocket: 1 }
  reelState: ReelState = 'idle'
  reelSpin = 0
  reelWound = 0

  /** ---- internal ---- */
  fish: Fish[] = []
  hooked: Fish | null = null
  hookWindow = 0
  layerDepth = REST_DEPTH
  contactEvents = 0
  landed = 0
  actTimer = 0
  confirm = 0 // 0..1 confirmation view weight (act 2)
  confirmTimer = 0
  strikeFlash = 0 // rod motion caused by the child's own strike
  strikeLift = 0 // the rig snatched upward by that same strike
  lastStrikeAt = -99
  ripple = { amp: 0, t: 99 }
  surfaceBreak = 0 // fish breaking the surface in the hole

  private tipFast = new Spring(6.6, 0.16)
  private tipSlow = new Spring(1.45, 0.3)
  private swaySeed = Math.random() * 100

  constructor() {
    for (let i = 0; i < 4; i++) this.fish.push(makeFish(i + 1))
  }

  /** child drags: sets the target depth of the rig */
  dragTo(depth: number) {
    this.lureRestDepth = clamp(depth, MAX_DEPTH, MIN_DEPTH)
  }

  /** short upward flick = 合わせ */
  strike() {
    if (!this.started) return
    if (this.reelState !== 'idle') return
    this.lastStrikeAt = this.time
    this.strikeFlash = 1
    this.strikeLift = 1
    this.ripple.amp = Math.max(this.ripple.amp, 0.5)
    this.ripple.t = 0
    if (this.hookWindow > 0) {
      const f = this.fish.find((x) => x.phase === 'nibble')
      if (f) {
        f.phase = 'hooked'
        this.hooked = f
        this.hookWindow = 0
        this.lineTension = 1
        this.reelWound = 0
        this.contactEvents++
        if (this.act === 2) {
          // hold the rig still first: the point of the look is to check the
          // guess against what was really down there, not to watch it arrive
          this.confirm = 1
          this.confirmTimer = 0
        } else {
          this.reelState = 'winding'
        }
        return
      }
    }
    // a miss just snatches the rig upward for a moment; nothing is punished
    // and the rig settles back to the depth the child chose.
    for (const f of this.fish) {
      if (f.phase === 'approach' || f.phase === 'nibble') {
        f.phase = 'retreat'
        f.timer = 0
        this.fishIntent *= 0.45
      }
    }
  }

  step(dt: number) {
    this.dt = dt
    this.time += dt
    if (!this.started) return

    this.stepBoat(dt)
    this.stepLure(dt)
    this.stepFish(dt)
    this.stepRod(dt)
    this.stepReel(dt)
    this.stepActs(dt)

    this.ripple.t += dt
    this.ripple.amp = approach(this.ripple.amp, 0, 2.4, dt)
    this.strikeFlash = approach(this.strikeFlash, 0, 5.5, dt)
    this.strikeLift = approach(this.strikeLift, 0, 3.4, dt)
    this.fishContact = approach(this.fishContact, 0, 7, dt)
    if (this.tensionPulse >= 0) {
      this.tensionPulse += dt
      if (this.tensionPulse > 0.9) this.tensionPulse = -1
    }
    this.hookWindow = Math.max(0, this.hookWindow - dt)
  }

  /** low frequency hull roll with slow calm/swell spells */
  private stepBoat(dt: number) {
    const t = this.time
    const gustTarget = smoothstep(0.42, 0.66, noise1(t * 0.055 + this.swaySeed))
    this.boatGust = approach(this.boatGust, gustTarget, 0.5, dt)
    const amp = 0.0105 + this.boatGust * 0.024
    const a = Math.sin(t * 2 * Math.PI * 0.23) * 1.0 + Math.sin(t * 2 * Math.PI * 0.147 + 1.7) * 0.62
    const prev = this.boatSway
    this.boatSway = a * amp
    this.boatSwayVel = (this.boatSway - prev) / Math.max(dt, 1e-4)
  }

  private stepLure(dt: number) {
    const p = this.lurePosition
    const prevY = p.y
    let target = this.lureRestDepth + this.strikeLift * 0.13
    if (this.reelState === 'winding') target = lerp(this.lureRestDepth, 0.54, this.reelWound)
    else if (this.reelState === 'showing') target = 0.56
    else if (this.reelState === 'lowering') target = lerp(0.56, this.lureRestDepth, this.reelWound)
    // the rig follows the rod tip through the water with drag
    p.y = approach(p.y, target, this.reelState === 'idle' ? 7.5 : this.reelState === 'showing' ? 7 : 4.5, dt)
    // hull roll pushes the whole rig sideways very slightly (it hangs from the boat)
    p.x = AXIS_X + this.boatSway * 0.9
    p.z = AXIS_Z + this.boatSway * 0.35
    this.lureVel = (p.y - prevY) / Math.max(dt, 1e-4)
    const speed = Math.abs(this.lureVel)
    this.lureMotion = approach(this.lureMotion, clamp(speed / 0.9, 0, 1), speed > this.lureMotion ? 22 : 5, dt)
    if (this.lureMotion > 0.16) {
      this.stillTime = 0
      this.ripple.amp = Math.max(this.ripple.amp, clamp(this.lureMotion * 0.8, 0, 1))
      if (this.ripple.t > 0.35) this.ripple.t = 0
    } else this.stillTime += dt

    // 誘い accumulates interest; it saturates so there is no single correct rhythm
    const gain = 1.5 * this.lureMotion * (1 - this.fishIntent)
    const decay = 0.19 * this.fishIntent
    this.fishIntent = clamp(this.fishIntent + (gain - decay) * dt, 0, 1)

    // static tension = rig weight, plus reeling load
    let tension = 0.2 + clamp(speed * 0.25, 0, 0.25)
    if (this.hooked) tension = 0.78 + Math.sin(this.time * 7.3) * 0.06
    if (this.reelState === 'winding') tension += 0.16
    this.lineTension = approach(this.lineTension, clamp(tension, 0, 1), 8, dt)
  }

  private stepFish(dt: number) {
    this.layerDepth = -0.6 + Math.sin(this.time * 0.0817) * 0.2
    const depthFit = Math.exp(-Math.pow((this.lurePosition.y - this.layerDepth) / 0.4, 2))
    const engaged = this.fish.some((f) => f.phase === 'approach' || f.phase === 'nibble' || f.phase === 'hooked')

    if (!engaged && this.reelState === 'idle' && this.stillTime > 0.4 && this.fishIntent * depthFit > 0.3) {
      // the closest cruising fish commits
      let best: Fish | null = null
      let bd = 1e9
      for (const f of this.fish) {
        if (f.phase !== 'cruise') continue
        const d = f.pos.distanceTo(this.baitPos)
        if (d < bd) {
          bd = d
          best = f
        }
      }
      if (best) {
        best.phase = 'approach'
        best.timer = 0
      }
    }

    for (const f of this.fish) {
      f.timer += dt
      const toLure = this.baitPos.clone().sub(f.pos)
      const dist = toLure.length()
      switch (f.phase) {
        case 'cruise': {
          const home = this.layerDepth - 0.1 + Math.sin(this.time * 0.31 + f.seed * 2.1) * 0.12
          const ang = this.time * (0.16 + f.seed * 0.022) + f.seed * 2.4
          const rad = 0.4 + noise1(this.time * 0.07 + f.seed * 4.2) * 0.42
          const t = new Vector3(Math.cos(ang) * rad, home, Math.sin(ang) * rad)
          f.vel.lerp(t.sub(f.pos).multiplyScalar(1.4), 1 - Math.exp(-2.2 * dt))
          break
        }
        case 'approach': {
          // hesitates while the bait is being yanked around; commits when it is still
          const commit = clamp(1 - this.lureMotion * 2.4, 0.05, 1)
          const speed = (0.24 + 0.52 * depthFit) * commit
          const aim = this.baitPos.clone().add(new Vector3(0, -0.05, 0))
          const dir = aim.sub(f.pos)
          const d = dir.length()
          dir.normalize()
          f.vel.lerp(dir.multiplyScalar(speed), 1 - Math.exp(-3.4 * dt))
          if (d < 0.055) {
            f.phase = 'nibble'
            f.timer = 0
            f.nibblesLeft = this.fishIntent > 0.66 ? 3 : 2
            f.nextNibble = 0.05
          }
          if (f.timer > 9) f.phase = 'retreat'
          break
        }
        case 'nibble': {
          f.vel.multiplyScalar(1 - Math.min(1, 6 * dt))
          f.nextNibble -= dt
          if (f.nextNibble <= 0 && f.nibblesLeft > 0) {
            f.nibblesLeft--
            f.nextNibble = 0.3
            this.emitContact(0.75 + 0.25 * (f.size / 0.09))
          }
          if (f.nibblesLeft === 0 && f.nextNibble < -0.35) {
            f.phase = 'retreat'
            f.timer = 0
            this.fishIntent *= 0.4
          }
          break
        }
        case 'retreat': {
          const away = f.pos.clone().sub(this.baitPos).normalize()
          away.y -= 0.25
          f.vel.lerp(away.multiplyScalar(0.5), 1 - Math.exp(-3 * dt))
          if (f.timer > 2.6) f.phase = 'cruise'
          break
        }
        case 'hooked': {
          const aim = this.baitPos.clone()
          // at the hole it hangs from the line, out of the water
          aim.y += this.reelState === 'showing' ? 0.02 : -0.03
          f.vel.copy(aim.sub(f.pos).multiplyScalar(6))
          f.bank = Math.sin(this.time * 9) * 0.5
          break
        }
        case 'landed':
          break
      }
      f.pos.addScaledVector(f.vel, dt)
      if (f.phase !== 'hooked') f.pos.y = clamp(f.pos.y, LAKE_BED + 0.25, -0.18)
      const sp = f.vel.length()
      if (sp > 1e-3) {
        const targetYaw = Math.atan2(f.vel.x, f.vel.z)
        let d = targetYaw - f.yaw
        while (d > Math.PI) d -= Math.PI * 2
        while (d < -Math.PI) d += Math.PI * 2
        f.yaw += d * (1 - Math.exp(-6 * dt))
      }
      f.tailPhase += dt * (5 + sp * 12)
      if (f.phase !== 'hooked') f.bank = approach(f.bank, clamp(-f.vel.x * 0.25, -0.4, 0.4), 4, dt)
      if (dist < 0.4 && f.phase === 'approach') this.fishContact = Math.max(this.fishContact, 0.06)
    }
  }

  /** a fish touches the bait: force leaves from below and travels up the line */
  private emitContact(strength: number) {
    this.fishContact = 1
    this.tensionPulse = 0
    this.tensionPulseAmp = strength
    this.hookWindow = 0.85
    this.contactEvents++
  }

  private stepRod(dt: number) {
    // the pulse reaches the tip after travelling the line
    if (this.tensionPulse >= 0) {
      const travel = 0.05 + Math.abs(this.lurePosition.y) / 6
      if (this.tensionPulse >= travel && this.tensionPulse - dt < travel) {
        this.tipFast.kick(-this.tensionPulseAmp * 2.6)
        this.tipSlow.kick(-this.tensionPulseAmp * 0.16)
      }
    }
    if (this.strikeFlash > 0.9) this.tipSlow.kick(0.9)
    // hull roll shakes the whole blank at its own low frequency
    this.tipSlow.step(dt, this.boatSway * 0.45 + (this.hooked ? -0.5 : 0))
    this.tipFast.step(dt, this.hooked ? -0.1 + Math.sin(this.time * 8.5) * 0.06 : 0)
    const bend = this.tipFast.x + this.tipSlow.x - this.lineTension * 0.15
    this.rodTipDeflection.set(0, bend, 0)
  }

  private stepReel(dt: number) {
    if (this.hooked && this.reelState === 'idle' && this.confirmTimer > 2.9) {
      this.reelState = 'winding'
      this.reelWound = 0
    }
    switch (this.reelState) {
      case 'winding':
        this.reelWound = clamp(this.reelWound + dt / 2.1, 0, 1)
        this.reelSpin += dt * 9
        if (this.reelWound >= 1) {
          this.reelState = 'showing'
          this.reelWound = 0
          this.surfaceBreak = 1
        }
        break
      case 'showing':
        this.reelWound += dt
        this.reelSpin += dt * 1.2
        if (this.reelWound > 2.2) {
          if (this.hooked) {
            this.hooked.phase = 'cruise'
            this.hooked.pos.set(1.5, this.layerDepth, 1.4)
            this.hooked = null
          }
          this.landed++
          this.reelState = 'lowering'
          this.reelWound = 0
          this.surfaceBreak = 0
        }
        break
      case 'lowering':
        this.reelWound = clamp(this.reelWound + dt / 2.0, 0, 1)
        this.reelSpin -= dt * 6
        if (this.reelWound >= 1) {
          this.reelState = 'idle'
          this.reelWound = 0
          this.fishIntent = 0.1
        }
        break
      case 'idle':
        this.reelSpin += this.lureVel * 2.4 * dt
        break
    }
  }

  private stepActs(dt: number) {
    this.actTimer += dt
    if (this.confirm > 0) {
      this.confirmTimer += dt
      if (this.confirmTimer > 3.6) this.confirm = approach(this.confirm, 0, 1.4, dt)
    }
    if (this.act === 1 && this.landed >= 1 && this.reelState === 'idle') {
      this.act = 2
      this.actTimer = 0
    } else if (this.act === 2 && this.landed >= 3 && this.reelState === 'idle' && this.confirm < 0.02) {
      this.act = 3
      this.actTimer = 0
    }

    const c = this.cutawayVisibility
    let deck = 1
    let surface = 1
    let pocket = 1
    if (this.act === 2) {
      deck = 1
      surface = 0.85
      pocket = lerp(0.34, 1, this.confirm)
    } else if (this.act === 3) {
      deck = 0
      surface = 0
      pocket = 0
    }
    const rate = 0.8
    c.deck = approach(c.deck, deck, rate, dt)
    c.surface = approach(c.surface, surface, rate, dt)
    c.pocket = approach(c.pocket, pocket, this.confirm > 0.5 ? 2.6 : rate, dt)
  }
}
