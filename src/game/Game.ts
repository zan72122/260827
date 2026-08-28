import * as THREE from 'three'
import { CameraRig, type ShotView } from '../core/CameraRig'
import type { Input } from '../core/Input'
import type { GameAudio } from '../core/Audio'
import { Pier, CurrentTells } from '../scene/Pier'
import { BaitContainer } from '../scene/BaitContainer'
import { Rig } from '../scene/Rig'
import { Tackle } from '../scene/Tackle'
import { Attendant, Releaser } from '../scene/Station'
import { WATER_Y, waterUniforms } from '../scene/Water'
import { BaitSnow } from '../sim/BaitSnow'
import { School } from '../sim/School'
import { DensityField } from '../sim/DensityField'
import { createFishGeometry, createFishMaterial, attachPhase, fishTime } from '../sim/Fish'

export type Phase =
  | 'title' | 'seat' | 'lower' | 'watch' | 'retrieve'
  | 'bait' | 'descend' | 'snow' | 'bite' | 'hooked' | 'reelup' | 'deliver' | 'settle'

type Shot =
  | 'wide' | 'seat' | 'tub' | 'macro' | 'baitedRig' | 'cutaway'
  | 'snowSide' | 'schoolWide' | 'rise' | 'tip' | 'reelShot' | 'tank'

export interface Quality {
  particles: number
  fish: number
  shadows: boolean
  label: string
}

const HOOK_LOAD_PER_GRAIN = 0.012

export class Game {
  phase: Phase = 'title'
  trial = 1
  private phaseT = 0
  private shot: Shot = 'wide'
  private shotT = 0
  private portrait = false

  readonly scene: THREE.Scene
  readonly rigRoot = new THREE.Group()
  readonly pier: Pier
  readonly tells: CurrentTells
  readonly tub: BaitContainer
  readonly rig: Rig
  readonly tackle: Tackle
  readonly attendant: Attendant
  readonly releaser: Releaser
  readonly school: School
  readonly snow: BaitSnow
  readonly field = new DensityField()

  /** y of the top of the rig */
  private rigTopY = 1.30
  private rigDrift = new THREE.Vector2()
  private baited = false
  private passes = 0
  private lastEdge = -1
  private showBaitT = 0
  private cutawayDone = false
  private cutAmount = 0
  private idleT = 0
  private jigT = -1
  private biteWindow = 0
  private caught: { mesh: THREE.Mesh; hook: number; t: number }[] = []
  private tankFish: { mesh: THREE.Mesh; p: THREE.Vector3; v: THREE.Vector3; phase: number }[] = []
  private deliverT = 0
  private deliverCurve: THREE.CatmullRomCurve3 | null = null
  private reelHeld = false
  private dragMode: 'none' | 'guide' | 'lower' | 'jig' = 'none'
  private time = 0
  private flowTarget = 0.03
  private lastFirstTurn = false
  private hintT = 0
  private assistT = 0

  private aspect = 1
  private tmp3 = new THREE.Vector3()
  private sideDir = new THREE.Vector3(0.95, 0.26, 0.16).normalize()
  private sideDirWide = new THREE.Vector3(0.92, 0.30, 0.20).normalize()
  private tipW = new THREE.Vector3()
  private tmp = new THREE.Vector3()
  private tmp2 = new THREE.Vector3()
  private grooveW = new THREE.Vector3()
  private hookW = new THREE.Vector3()
  private view: ShotView = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 45 }
  private fishGeoHigh: THREE.BufferGeometry
  private fishMat: THREE.MeshStandardMaterial

  constructor(
    scene: THREE.Scene,
    private rigCam: CameraRig,
    private input: Input,
    private audio: GameAudio,
    quality: Quality,
  ) {
    this.scene = scene
    this.pier = new Pier()
    this.tells = new CurrentTells()
    this.tub = new BaitContainer()
    this.rig = new Rig()
    this.tackle = new Tackle()
    this.attendant = new Attendant()
    this.releaser = new Releaser()
    this.school = new School(quality.fish, 3)
    this.snow = new BaitSnow(quality.particles)

    this.tub.group.position.set(0.02, 0.8775, 1.10)
    this.rigRoot.add(this.rig.group)

    scene.add(this.pier.group, this.tells.group, this.tub.group, this.rigRoot,
      this.tackle.group, this.attendant.group, this.releaser.group,
      this.school.group, this.snow.mesh)

    this.fishGeoHigh = createFishGeometry('high')
    this.fishMat = createFishMaterial()

    this.school.onFirstTurn = () => { this.audio.schoolTurn() }
    this.school.onBite = () => { if (this.phase === 'snow') this.startBite() }

    this.bindInput()
    this.setPhase('title')
  }

  /* ------------------------------ input ----------------------------- */

  private bindInput() {
    this.input.onDown = (x, y) => {
      this.idleT = 0
      this.dragMode = 'none'
      if (this.isReelPhase() && this.nearReel(x, y)) this.reelHeld = true
    }
    this.input.onHold = (x, y) => {
      if (this.isReelPhase() && this.nearReel(x, y)) {
        this.reelHeld = true
        if (this.phase === 'watch') this.setPhase('retrieve')
        if (this.phase === 'hooked') this.setPhase('reelup')
      }
    }
    this.input.onMove = (s) => {
      this.idleT = 0
      if (this.dragMode === 'none') {
        const ax = Math.abs(s.totalDx), ay = Math.abs(s.totalDy)
        if (this.phase === 'bait') {
          if (ay > 42 && ay > ax * 1.7) this.dragMode = 'lower'
          else if (ax > 8) this.dragMode = 'guide'
        } else if (this.phase === 'snow' && ay > 12 && ay < 200) {
          this.dragMode = 'jig'
        } else if ((this.phase === 'seat' || this.phase === 'lower' || this.phase === 'descend' || this.phase === 'watch' || this.phase === 'snow') && ay > 14 && ay > ax * 0.7) {
          this.dragMode = 'lower'
        }
      }
      if (this.dragMode === 'guide') this.dragGuide(s.dx)
      else if (this.dragMode === 'lower') this.dragLower(s.dy)
      else if (this.dragMode === 'jig') this.dragJig(s.dy)
    }
    this.input.onUp = (s) => {
      this.reelHeld = false
      if (this.dragMode === 'jig' || (this.phase === 'snow' && this.jigT > 0)) this.releaseJig()
      if (this.dragMode === 'lower' && (this.phase === 'lower' || this.phase === 'descend')) {
        this.settleRig()
      }
      if (this.phase === 'bite') {
        // a short flick upward sets the hook
        if ((s.vy < -180 || s.totalDy < -40) && s.totalDy < -18 && s.duration < 0.9) this.setHook()
      }
      this.dragMode = 'none'
      this.audio.setScrape(0, 0)
    }
  }

  private isReelPhase() {
    return this.phase === 'watch' || this.phase === 'hooked' || this.phase === 'retrieve' || this.phase === 'reelup' || this.phase === 'snow'
  }

  private nearReel(x: number, y: number) {
    this.tackle.getReelButtonWorld(this.tmp)
    this.tmp.project(this.rigCam.camera)
    const sx = (this.tmp.x * 0.5 + 0.5) * window.innerWidth
    const sy = (-this.tmp.y * 0.5 + 0.5) * window.innerHeight
    // if the reel is not on screen, any long press is taken as the reel:
    // a child holding down anywhere should never be ignored
    const onScreen = this.tmp.z < 1 && sx > 0 && sx < window.innerWidth && sy > 0 && sy < window.innerHeight
    if (!onScreen) return true
    const r = Math.min(window.innerWidth, window.innerHeight) * 0.34
    return Math.hypot(x - sx, y - sy) < Math.max(130, r)
  }

  /** Gains are expressed in screen fractions so portrait and landscape
   *  need the same size of gesture from a small hand. */
  private get guideGain() { return (this.tub.travel * 2) / (window.innerWidth * 0.46) }
  private get depthGain() { return 6.0 / window.innerHeight }

  private dragGuide(dx: number) {
    const before = this.tub.guideX
    this.tub.setGuideX(before + dx * this.guideGain)
    const moved = this.tub.guideX - before
    if (Math.abs(moved) > 1e-5) {
      this.tub.ploughAt(this.tub.guideX, Math.abs(moved) * 0.16)
      this.audio.setScrape(Math.min(1, Math.abs(moved) * 26), Math.min(1, Math.abs(moved) * 40))
      this.checkPass()
    }
  }

  private checkPass() {
    const x = this.tub.guideX
    const edge = x > 0.062 ? 1 : x < -0.062 ? -1 : 0
    if (edge !== 0 && edge !== this.lastEdge) {
      if (this.lastEdge !== 0 && this.passes < 2) {
        this.passes++
        this.rig.addLoad(1.0)
        this.showBaitT = 1.7
        this.audio.lineTick()
      }
      this.lastEdge = edge
    }
  }

  private dragLower(dy: number) {
    if (this.phase === 'seat') this.setPhase('lower')
    if (this.phase === 'bait') { this.launch(); return }
    if (this.phase !== 'lower' && this.phase !== 'descend' && this.phase !== 'watch' && this.phase !== 'snow') return
    if (dy <= 0 && this.rigTopY > WATER_Y) return
    const min = -6.6
    const max = this.tipW.y - 0.12
    this.rigTopY = THREE.MathUtils.clamp(this.rigTopY - dy * this.depthGain, min, max)
    if (dy > 0) this.audio.setScrape(Math.min(0.5, dy * 0.02), 0.2)
  }

  private dragJig(dy: number) {
    if (this.jigT < 0) this.jigT = 0
    this.rigTopY = THREE.MathUtils.clamp(this.rigTopY - dy * this.depthGain * 0.38, -6.6, WATER_Y - 0.3)
  }

  private releaseJig() {
    if (this.jigT < 0) return
    this.jigT = -1
    this.school.armBite()
    this.audio.lineTick()
  }

  private settleRig() {
    // releasing stops the rig; the descend phase holds until the
    // cross-section shot has played out
    if (this.rigTopY < WATER_Y - 0.15 && this.phase === 'lower') this.setPhase('watch')
  }

  private launch() {
    this.tackle.setPose('sea')
    this.setPhase('descend')
    this.rigTopY = this.tipW.y - 0.15
  }

  /* ------------------------------ phases ---------------------------- */

  setPhase(p: Phase) {
    this.phase = p
    this.phaseT = 0
    this.idleT = 0
    this.hintT = 0
    this.assistT = 0
    switch (p) {
      case 'title': this.setShot('wide', 1.0); break
      case 'seat': this.setShot('seat', 1.1); break
      case 'bait':
        this.tackle.setPose('bait')
        this.passes = 0
        this.baited = false
        this.rig.setLoad(0)
        this.tub.setGuideX(-this.tub.travel)
        // the guide starts parked at one end: that end counts as the
        // starting side, so the first full sweep across is one pass
        this.lastEdge = -1
        this.attendant.setAnchor(new THREE.Vector3(-0.06, 1.60, 1.06), new THREE.Euler(0.28, 0.30, -0.42))
        this.setShot('tub', 1.4)
        break
      case 'descend':
        this.baited = this.rig.totalLoad > 0.05
        this.school.disarmBite()
        this.setShot('baitedRig', 1.6)
        break
      case 'snow': this.setShot('snowSide', 1.3); break
      case 'watch': this.setShot('schoolWide', 1.2); break
      case 'retrieve': this.setShot('rise', 1.6); break
      case 'bite': this.setShot('tip', 2.4); this.biteWindow = 5.0; break
      case 'hooked': this.setShot('tip', 2.2); this.tackle.setLoad(0.85); break
      case 'reelup': this.setShot('reelShot', 1.8); break
      case 'deliver': this.startDeliver(); break
      case 'settle': this.setShot('tank', 1.4); break
    }
  }

  private setShot(s: Shot, rate: number) {
    if (this.shot !== s) { this.shot = s; this.shotT = 0 }
    this.rigCam.setRate(rate)
  }

  start() {
    this.setPhase('seat')
    this.rigTopY = this.tackle.getTipWorld(this.tipW).y - 0.15
  }

  private startBite() {
    this.school.disarmBite()
    this.setPhase('bite')
    this.tackle.twitch(1)
    this.audio.bite()
    // the fish takes some of the krill off that hook
    this.rig.consume(1, 0.25)
    this.rig.refreshBait()
  }

  private setHook() {
    if (this.phase !== 'bite') return
    this.tackle.twitch(1.6)
    this.audio.lineTick()
    const n = this.school.atHook >= 3 && Math.random() < 0.6 ? 2 : 1
    this.rig.hookWorld(1, this.tmp)
    const taken = this.school.takeAt(this.tmp, n)
    for (let i = 0; i < taken.length; i++) {
      const g = attachPhase(this.fishGeoHigh.clone(), Math.random() * 6.28, 1.5)
      const m = new THREE.Mesh(g, this.fishMat)
      m.frustumCulled = false
      this.scene.add(m)
      this.caught.push({ mesh: m, hook: i === 0 ? 1 : 0, t: 0 })
    }
    this.setPhase('hooked')
  }

  private startDeliver() {
    this.deliverT = 0
    this.setShot('reelShot', 1.8)
    const gate = this.releaser.gateWorld
    this.deliverCurve = new THREE.CatmullRomCurve3([
      this.tackle.getTipWorld(new THREE.Vector3()).setY(1.15),
      new THREE.Vector3(gate.x + 0.15, gate.y + 0.10, gate.z + 0.02),
      new THREE.Vector3(gate.x, gate.y + 0.02, gate.z + 0.03),
      new THREE.Vector3(-0.99, 0.92, 0.62),
      new THREE.Vector3(-1.20, 0.78, 0.84),
      new THREE.Vector3(this.releaser.tankWorld.x, 0.60, this.releaser.tankWorld.z),
    ])
    this.audio.splashOut()
  }

  private nextTrial() {
    this.trial++
    this.snow.clear()
    this.field.reset()
    this.school.reset(WATER_Y - 2.5)
    this.cutAmount = 0
    waterUniforms.uCut.value.w = 0
    // one variable at a time: bait amount (t2), depth (t3), then flow (t4+)
    this.flowTarget = this.trial >= 4 ? (this.trial % 2 === 0 ? 0.30 : 0.02) : 0.03
    this.setPhase('bait')
  }

  /* ------------------------------ update ---------------------------- */

  update(dt: number, aspect: number) {
    this.time += dt
    this.phaseT += dt
    this.shotT += dt
    this.idleT += dt
    fishTime.value = this.time
    this.portrait = aspect < 1
    this.aspect = aspect

    waterUniforms.uTime.value = this.time
    const flow = waterUniforms.uFlow.value as THREE.Vector2
    flow.x += (this.flowTarget - flow.x) * Math.min(1, dt * 0.5)
    flow.y += (this.flowTarget * 0.35 - flow.y) * Math.min(1, dt * 0.5)
    this.snow.flow.set(flow.x, flow.y)
    this.school.flow.set(flow.x * 0.5, flow.y * 0.5)
    this.tells.setFlow(Math.abs(flow.x) / 0.3)
    this.tells.update(this.time)

    this.tackle.update(dt)
    this.tackle.getTipWorld(this.tipW)
    this.attendant.update(dt, this.time)
    this.releaser.update(this.time)
    this.tub.settle(dt)

    this.updateRigTransform(dt)
    this.updatePhase(dt)

    this.snow.update(dt, this.field)
    this.rig.hookWorld(1, this.hookW)
    this.school.update(dt, this.field, this.hookW, this.baited && this.rig.totalLoad > 0.02)
    this.rig.update(this.rigCam.camera)
    this.updateCaught(dt)
    this.updateTank(dt)

    // camera
    this.buildView(this.shot)
    this.rigCam.update(dt, this.view)
    this.audio.setSubmerged(this.rigCam.camera.position.y < WATER_Y)
  }

  private updateRigTransform(dt: number) {
    if (this.phase === 'bait') {
      this.tub.getGrooveWorld(this.grooveW)
      const lift = this.showBaitT > 0 ? Math.sin(Math.min(1, (1.7 - this.showBaitT) / 0.4) * Math.PI * 0.5) * 0.30 : 0
      this.rigRoot.position.set(this.grooveW.x, this.grooveW.y + lift, this.grooveW.z)
      this.tackle.updateLine(this.rigRoot.position, null, this.rigCam.camera)
      if (this.showBaitT > 0) {
        this.showBaitT -= dt
        if (this.showBaitT <= 0) this.setShot('macro', 1.5)
        else if (this.showBaitT < 1.55) this.setShot('baitedRig', 2.0)
      }
      // the rig ploughs the krill wherever it is dragged
      if (this.dragMode === 'guide' && lift === 0) this.tub.ploughAt(this.tub.guideX, dt * 0.02)
      return
    }
    // hanging from the rod tip, drifting a little with the water
    const depth = Math.max(0, WATER_Y - this.rigTopY)
    const flow = waterUniforms.uFlow.value as THREE.Vector2
    const k = Math.min(1, dt * 1.2)
    this.rigDrift.x += (flow.x * depth * 0.30 - this.rigDrift.x) * k
    this.rigDrift.y += (flow.y * depth * 0.30 - this.rigDrift.y) * k
    this.rigRoot.position.set(this.tipW.x + this.rigDrift.x, this.rigTopY, this.tipW.z + this.rigDrift.y)
    this.tackle.updateLine(this.rigRoot.position, null, this.rigCam.camera)
  }

  private shedBait(dt: number, moving: boolean) {
    if (this.rigTopY > WATER_Y - 0.05) return
    for (let i = 0; i < 3; i++) {
      const load = this.rig.hooks[i].load
      if (load <= 0.001) continue
      const rate = (0.22 + 1.35 * load) * (moving ? 2.0 : 1.0)
      this.shedAcc[i] += rate * dt
      while (this.shedAcc[i] >= 1) {
        this.shedAcc[i] -= 1
        this.rig.hookWorld(i, this.tmp)
        // a heavier load sheds bigger pieces over a wider spread, so two
        // passes read as thicker snow and not merely as more of it
        this.snow.spawn(this.tmp.x, this.tmp.y, this.tmp.z, 0.028 + 0.022 * load, 0.82 + 0.3 * load)
        this.rig.consume(i, HOOK_LOAD_PER_GRAIN)
      }
    }
    this.baitRefreshT += dt
    if (this.baitRefreshT > 0.4) { this.baitRefreshT = 0; this.rig.refreshBait() }
  }
  private shedAcc = [0, 0, 0]
  private baitRefreshT = 0

  private updatePhase(dt: number) {
    const underwater = this.rigTopY < WATER_Y - 0.05
    switch (this.phase) {
      case 'title':
        break

      case 'seat':
        this.hint(dt, 5, () => { this.attendant.steady(); this.audio.lineTick() })
        break

      case 'lower':
        if (this.rigTopY > WATER_Y - 0.75 && this.dragMode !== 'lower') this.rigTopY -= dt * 0.55
        if (underwater) this.setShot('schoolWide', 1.5)
        if (this.crossedSurface()) this.audio.splashIn()
        if (this.rigTopY < WATER_Y - 0.45 && this.dragMode !== 'lower' && this.phaseT > 1.0) this.setPhase('watch')
        break

      case 'watch':
        // a bare rig is just an object in the water: the shoal notices it
        // and carries on. no failure, no sound of failure.
        // after a good look at the shoal ignoring it, come back up so the
        // reel is in frame and in reach
        if (this.phaseT > 6.5) this.setShot('reelShot', 1.0)
        this.hint(dt, 9, () => {
          this.attendant.setAnchor(new THREE.Vector3(-0.12, 1.30, 0.86), new THREE.Euler(0.5, 0.2, -0.3))
        })
        if (this.phaseT > 26 && !this.reelHeld) { this.reelHeld = true; this.setPhase('retrieve') }
        break

      case 'retrieve': {
        const up = this.reelHeld || this.phaseT > 3.2
        if (up) {
          this.rigTopY = Math.min(this.tipW.y - 0.12, this.rigTopY + dt * 0.85)
          this.tackle.spinSpool(dt, 9)
          this.audio.setMotor(true, 0.2)
          if (this.crossedSurfaceUp()) this.audio.splashOut()
        } else this.audio.setMotor(false, 0)
        if (this.rigTopY >= this.tipW.y - 0.13) {
          this.audio.setMotor(false, 0)
          this.setPhase('bait')
        }
        break
      }

      case 'bait':
        this.audio.setMotor(false, 0)
        if (this.shot === 'tub' && this.phaseT > 1.6 && this.showBaitT <= 0) this.setShot('macro', 1.5)
        // hesitation: the environment answers, nothing is spelled out
        this.hint(dt, 4.5, () => {
          this.attendant.steady()
          this.tub.nudge(0.0025)
          this.tub.setGuideX(this.tub.guideX + (this.tub.guideX < 0 ? 0.004 : -0.004))
          this.audio.bucketKnock()
        })
        break

      case 'descend':
        this.shedBait(dt, true)
        if (this.crossedSurface()) {
          this.audio.splashIn()
          // hitting the water knocks a first handful of krill off the hooks
          for (let i = 0; i < 3; i++) {
            if (this.rig.hooks[i].load <= 0.02) continue
            this.rig.hookWorld(i, this.tmp)
            for (let k = 0; k < 4; k++) this.snow.spawn(this.tmp.x, this.tmp.y - 0.02, this.tmp.z, 0.05)
            this.rig.consume(i, 0.03)
          }
          if (!this.cutawayDone) { this.cutawayDone = true; this.setShot('cutaway', 1.5); this.shotT = 0 }
        }
        // the sinker keeps taking line: a short swipe still gets the rig
        // into the water, it just goes in slowly
        if (this.rigTopY > WATER_Y - 0.75 && this.dragMode !== 'lower') {
          this.rigTopY -= dt * 0.55
        }
        if (this.shot === 'cutaway') {
          this.cutAmount = Math.min(1, this.cutAmount + dt * 1.4)
          if (this.shotT > 4.2) this.setShot('snowSide', 1.1)
        } else if (underwater && this.shot !== 'snowSide' && this.shotT > 1.2) {
          this.setShot('snowSide', 1.2)
        } else if (!underwater && this.shot === 'baitedRig' && this.shotT > 1.6) {
          this.setShot('rise', 1.4)
        }
        this.cutAmount *= this.shot === 'cutaway' ? 1 : 1 - Math.min(1, dt * 0.9)
        waterUniforms.uCut.value.set(this.rigRoot.position.x, WATER_Y, this.rigRoot.position.z, this.cutAmount)
        if (this.rigTopY < WATER_Y - 0.45 && this.dragMode !== 'lower' && this.phaseT > 1.2 && this.shot !== 'cutaway') this.setPhase('snow')
        break

      case 'snow': {
        this.shedBait(dt, this.dragMode === 'lower' || this.jigT >= 0)
        this.cutAmount *= 1 - Math.min(1, dt * 0.9)
        waterUniforms.uCut.value.w = this.cutAmount
        // hold on the pair -- krill and shoal -- then widen as it bends
        if (this.school.firstTurnAge >= 0 && !this.lastFirstTurn) {
          this.lastFirstTurn = true
          this.shotT = 0
        }
        if (this.lastFirstTurn) {
          if (this.school.firstTurnAge > 2.4 && this.school.firstTurnAge < 9) this.setShot('schoolWide', 0.85)
          else if (this.school.firstTurnAge >= 9) this.setShot('snowSide', 1.0)
        }
        // the shoal is on the bait: a jig, then let go, and a fish commits
        if (this.school.atHook > 0) {
          this.assistT += dt
          if (this.assistT > 18) this.school.armBite()
        }
        this.hint(dt, 14, () => { this.attendant.steady() })
        break
      }

      case 'bite':
        this.shedBait(dt, false)
        this.biteWindow -= dt
        if (this.biteWindow < 4.2 && this.biteWindow > 4.1) this.tackle.twitch(0.7)
        if (this.biteWindow < 3.0 && this.biteWindow > 2.9) { this.tackle.twitch(0.9); this.audio.rodTwitch() }
        if (this.biteWindow <= 0) {
          // missed: the fish simply comes back. nothing is lost.
          this.setPhase('snow')
          this.school.armBite()
        }
        break

      case 'hooked':
        this.shedBait(dt, false)
        this.tackle.setLoad(0.8 + Math.sin(this.time * 5) * 0.12)
        this.hint(dt, 4, () => {
          this.attendant.setAnchor(new THREE.Vector3(-0.12, 1.30, 0.86), new THREE.Euler(0.5, 0.2, -0.3))
        })
        if (this.phaseT > 9) this.setPhase('reelup')
        break

      case 'reelup': {
        const winding = this.reelHeld || this.phaseT > 2.6
        if (winding) {
          this.rigTopY = Math.min(this.tipW.y - 0.12, this.rigTopY + dt * 1.1)
          this.tackle.spinSpool(dt, 11)
          this.audio.setMotor(true, 0.8)
          this.tackle.setLoad(0.9)
          if (this.crossedSurfaceUp()) this.audio.splashOut()
        } else {
          this.audio.setMotor(false, 0)
        }
        if (this.rigTopY >= this.tipW.y - 0.13) {
          this.audio.setMotor(false, 0)
          this.tackle.setLoad(0.15)
          this.setPhase('deliver')
        }
        break
      }

      case 'deliver': {
        this.deliverT += dt
        if (this.deliverT > 1.1 && this.deliverT - dt <= 1.1) this.audio.lineTick()
        if (this.deliverT > 2.5 && this.deliverT - dt <= 2.5) this.audio.tankSplash()
        if (this.deliverT > 1.9) this.setShot('tank', 1.5)
        if (this.deliverT > 3.1) {
          for (const c of this.caught) this.moveToTank(c.mesh)
          this.caught.length = 0
          this.deliverCurve = null
          this.setPhase('settle')
        }
        break
      }

      case 'settle':
        this.tackle.setLoad(0)
        if (this.phaseT > 3.4) this.nextTrial()
        break
    }
  }

  private hint(dt: number, after: number, fn: () => void) {
    void dt
    if (this.idleT > after && this.time - this.hintT > 6.5) {
      this.hintT = this.time
      fn()
    }
  }

  private lastRigY = 1.3
  private crossedSurface() {
    const c = this.lastRigY > WATER_Y && this.rigTopY <= WATER_Y
    this.lastRigY = this.rigTopY
    return c
  }
  private crossedSurfaceUp() {
    const c = this.lastRigY < WATER_Y && this.rigTopY >= WATER_Y
    this.lastRigY = this.rigTopY
    return c
  }

  private updateCaught(dt: number) {
    if (!this.caught.length) return
    for (const c of this.caught) {
      c.t += dt
      if (this.deliverCurve) {
        const p = THREE.MathUtils.clamp((this.deliverT - 0.3 - c.hook * 0.25) / 2.1, 0, 1)
        this.deliverCurve.getPoint(p, this.tmp)
        c.mesh.position.lerp(this.tmp, Math.min(1, dt * 9))
        this.deliverCurve.getTangent(Math.min(0.99, p), this.tmp2)
        c.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.tmp2.normalize())
        c.mesh.rotateZ(Math.sin(c.t * 22) * 0.5)
      } else {
        this.rig.hookWorld(c.hook, this.tmp)
        this.tmp.y -= 0.035
        c.mesh.position.lerp(this.tmp, Math.min(1, dt * 10))
        c.mesh.rotation.set(Math.sin(c.t * 9) * 0.5, Math.sin(c.t * 13) * 0.9, Math.sin(c.t * 17) * 0.6)
      }
    }
  }

  private moveToTank(mesh: THREE.Mesh) {
    mesh.scale.setScalar(1.15)
    const t = this.releaser.tankWorld
    this.tankFish.push({
      mesh,
      p: new THREE.Vector3(t.x + (Math.random() - 0.5) * 0.2, 0.52, t.z + (Math.random() - 0.5) * 0.12),
      v: new THREE.Vector3(0.08, 0, 0.02),
      phase: Math.random() * 6.28,
    })
    if (this.tankFish.length > 6) {
      const old = this.tankFish.shift()!
      this.scene.remove(old.mesh)
      old.mesh.geometry.dispose()
    }
  }

  private updateTank(dt: number) {
    const c = this.releaser.tankWorld
    for (const f of this.tankFish) {
      f.v.x += (Math.sin(this.time * 0.9 + f.phase) * 0.10 - f.v.x) * dt * 2
      f.v.z += (Math.cos(this.time * 0.7 + f.phase * 1.7) * 0.07 - f.v.z) * dt * 2
      f.v.y += ((0.53 - f.p.y) * 0.5 - f.v.y) * dt * 2
      if (f.p.x < c.x - 0.17) f.v.x += dt * 1.2
      if (f.p.x > c.x + 0.17) f.v.x -= dt * 1.2
      if (f.p.z < c.z - 0.10) f.v.z += dt * 1.2
      if (f.p.z > c.z + 0.10) f.v.z -= dt * 1.2
      f.p.addScaledVector(f.v, dt)
      f.mesh.position.copy(f.p)
      this.tmp.copy(f.v)
      if (this.tmp.lengthSq() > 1e-8) {
        this.tmp.normalize()
        f.mesh.quaternion.slerp(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.tmp), Math.min(1, dt * 4))
      }
    }
  }

  /* ------------------------------ camera ---------------------------- */

  /** Jump the camera to the current shot (used by the headless driver). */
  snapCamera() {
    this.buildView(this.shot)
    this.rigCam.snapTo(this.view)
  }

  /**
   * Put two things in one frame -- the krill coming off the rig and the
   * shoal. The whole point of the underwater shots is that the child
   * sees both at once, so the distance is solved from their separation
   * and the current aspect rather than fixed per shot.
   */
  private frameTwo(a: THREE.Vector3, b: THREE.Vector3, fov: number, margin: number, side: THREE.Vector3) {
    const mid = this.tmp2.copy(a).add(b).multiplyScalar(0.5)
    const sep = a.distanceTo(b)
    const vfov = THREE.MathUtils.degToRad(fov)
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * Math.max(0.35, this.aspect))
    const use = Math.min(vfov, hfov)
    // beyond about six metres the water eats the contrast anyway, so the
    // shot pulls back only that far and lets the shoal run off frame
    const dist = THREE.MathUtils.clamp((sep * margin) / Math.tan(use / 2), 2.3, 6.0)
    this.view.fov = fov
    this.view.target.copy(mid)
    // an underwater subject must not be framed from above the surface
    const maxY = mid.y < WATER_Y - 0.2 ? WATER_Y - 0.30 : 3.0
    this.seaCam(mid.x + side.x * dist, mid.y + side.y * dist, mid.z + side.z * dist, maxY)
  }

  /** Keep an underwater camera in the water: off the quay face, off the bed. */
  private seaCam(x: number, y: number, z: number, maxY = 3.0) {
    this.view.pos.set(
      THREE.MathUtils.clamp(x, -6.5, 6.5),
      THREE.MathUtils.clamp(y, WATER_Y - 7.4, maxY),
      Math.min(z, -0.85),
    )
  }

  /** Where the shoal actually is, weighted toward the fish that turned. */
  private schoolFocus(out: THREE.Vector3) {
    let n = 0
    out.set(0, 0, 0)
    for (let i = 0; i < this.school.activeCount; i++) {
      const f = this.school.fish[i]
      if (f.caught) continue
      const w = f.interest > 0 ? 3 : 1
      out.addScaledVector(f.p, w)
      n += w
    }
    if (n > 0) out.multiplyScalar(1 / n)
    else out.copy(this.school.center)
    return out
  }

  private buildView(shot: Shot) {
    const p = this.view.pos, t = this.view.target
    const port = this.portrait
    const rig = this.rigRoot.position
    switch (shot) {
      case 'wide':
        // the whole station: bench and bait tub, the rod at the rail, the
        // attendant, and the water and far quay beyond
        p.set(port ? 4.4 : 5.0, port ? 2.7 : 2.5, port ? 4.4 : 4.6)
        t.set(-0.50, port ? 0.62 : 0.58, -0.55)
        this.view.fov = port ? 58 : 47
        break
      case 'seat':
        // stand to the left of the bait tub: rod, water and the shoal
        // beyond, with the tub in the corner of the near field
        p.set(-0.46, port ? 1.70 : 1.66, port ? 1.62 : 1.54)
        t.set(0.16, port ? -0.55 : -0.40, -3.2)
        this.view.fov = port ? 60 : 48
        break
      case 'tub':
        p.set(0.12, port ? 1.99 : 1.92, port ? 1.52 : 1.48)
        t.set(0.02, port ? 1.20 : 1.23, 1.11)
        this.view.fov = port ? 50 : 40
        break
      case 'macro': {
        const gx = 0.02 + this.tub.guideX * 0.55
        p.set(gx + 0.07, port ? 1.88 : 1.83, port ? 1.34 : 1.31)
        // aim below the contact point so the rig entering the krill sits
        // in the upper third, clear of the finger dragging the guide
        t.set(gx, port ? 1.19 : 1.21, 1.10)
        this.view.fov = port ? 46 : 37
        break
      }
      case 'baitedRig': {
        const inTub = this.phase === 'bait'
        const gx = inTub ? 0.02 + this.tub.guideX : rig.x
        const zc = inTub ? 1.10 : rig.z
        // level with the hooks just after they leave the krill, so the
        // krill stuck to them reads against the water beyond
        const y = rig.y - 0.24
        const d = inTub ? 0.40 : 0.78
        p.set(gx + (inTub ? 0.11 : 0.30), y + 0.02, zc + d)
        t.set(gx + 0.045, y, zc)
        this.view.fov = port ? 40 : 33
        break
      }
      case 'cutaway':
        // just above the water, looking down through the open patch of
        // surface: air above the line, the sinking krill below it
        this.seaCam(rig.x + (port ? 1.20 : 1.45), WATER_Y + 0.82, rig.z + (port ? 1.05 : 0.98))
        t.set(rig.x, THREE.MathUtils.clamp(rig.y - 0.35, WATER_Y - 2.1, WATER_Y - 0.45), rig.z)
        this.view.fov = port ? 56 : 46
        break
      case 'snowSide': {
        this.rig.hookWorld(1, this.tmp)
        this.tmp.y = Math.min(this.tmp.y, WATER_Y - 0.35)
        this.schoolFocus(this.tmp3)
        this.frameTwo(this.tmp, this.tmp3, port ? 62 : 48, port ? 0.64 : 0.56, this.sideDir)
        break
      }
      case 'schoolWide': {
        this.rig.hookWorld(1, this.tmp)
        this.tmp.y = Math.min(this.tmp.y, WATER_Y - 0.35)
        this.schoolFocus(this.tmp3)
        this.frameTwo(this.tmp, this.tmp3, port ? 66 : 54, port ? 0.86 : 0.74, this.sideDirWide)
        break
      }
      case 'rise':
        this.seaCam(rig.x + 1.05, WATER_Y + 0.60, rig.z + 1.05)
        t.set(rig.x, THREE.MathUtils.clamp(rig.y + 0.05, WATER_Y - 0.9, WATER_Y + 0.75), rig.z)
        this.view.fov = port ? 56 : 45
        break
      case 'tip':
        // the rod tip against the water: the twitch has to be readable
        p.set(0.86, 1.80, port ? 0.34 : 0.26)
        t.set(0.12, port ? 1.56 : 1.60, -1.12)
        this.view.fov = port ? 54 : 44
        break
      case 'reelShot':
        // reel, rail and the patch of water the rig comes out of
        p.set(1.48, 1.62, 1.42)
        t.set(0.04, port ? 1.12 : 1.18, -0.78)
        this.view.fov = port ? 62 : 52
        break
      case 'tank':
        p.set(-0.96, 1.20, 1.66)
        t.set(-1.32, 0.57, 1.00)
        this.view.fov = port ? 50 : 40
        break
    }
  }

  dispose() {
    this.pier.dispose(); this.tub.dispose(); this.rig.dispose(); this.tackle.dispose()
    this.attendant.dispose(); this.releaser.dispose(); this.school.dispose(); this.snow.dispose()
    this.fishGeoHigh.dispose(); this.fishMat.dispose()
  }
}
