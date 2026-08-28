import * as THREE from 'three'
import type { App } from '../core/app'
import { Winder, type Ptr } from '../core/input'
import {
  MAX_PIECES, MIN_PIECES, STAGE_ORDER, newRecipe,
  type GlobeRecipe, type PieceKind, type Stage,
} from '../core/state'
import { loadGlobes, saveGlobe } from '../core/storage'
import {
  BENCH_CENTER_Y, CRADLE_CENTER_Y, FILL_SEALED, FILL_TO_BRIM,
  GROUND_Y, MOUNTED_CENTER_Y, MOUTH_Y, R_OUT,
} from '../world/dims'
import { PIECE_SPECS } from '../world/pieces'
import type { TrayItem } from '../ui/hud'
import { Ease, Tweens } from './tweens'

/**
 * The eight construction steps, wired to gestures. Each stage owns its input
 * subscriptions and hands them back on exit, so no stage can leave a listener
 * behind that quietly fights the next one.
 */

const PIECE_ORDER: PieceKind[] = ['house', 'fir', 'lamp', 'bridge', 'snowman', 'deer', 'centerTree']

const PIECE_LABEL: Record<PieceKind, string> = {
  house: 'いえ',
  fir: 'き',
  lamp: 'あかり',
  bridge: 'はし',
  snowman: 'だるま',
  deer: 'しか',
  centerTree: 'ツリー',
}

/** How far the plug hovers above the mouth during filling. */
const LIFT_HIGH = 0.42
const LIFT_LOW = 0.1
/** Raised out of the way so the gasket has a clear run down to the rim. */
const LIFT_SEAT = 0.3
/** Travel of the gasket from the player's hand down onto the rim. */
const GASKET_TRAVEL = 0.24

/** Lens used once the camera is inside the globe. */
const INSIDE_FOV = 68

const SNOW_MIN = 0.28
const TILT_LIMIT = 0.2

export class Flow {
  private tw = new Tweens()
  private stage: Stage = 'title'
  private subs: Array<() => void> = []
  private bias = 0.1
  private margin = 1.3

  private paint = new Map<PieceKind, number>()
  private dragId: number | null = null
  private dragOffset = new THREE.Vector2()
  private winder = new Winder()
  private ray = new THREE.Raycaster()
  private v3 = new THREE.Vector3()
  private v3b = new THREE.Vector3()
  private v2 = new THREE.Vector2()
  private screenCenter = new THREE.Vector2()

  private scoopTip = 0
  private pumping = false
  private sealStep = 0
  private sealProgress = 0
  private mountStep = 0
  private mountDrop = 0
  private flipProgress = 0
  private shakeIdle = 0
  private litTarget = 0
  private insideness = 0
  /** Whether the glass shell has been lowered over the town yet. */
  private glassOn = 0
  private interiorTime = 0
  /** Bearing of the lane the camera uses to enter and tour the globe. */
  private bearing = 0.35
  private rearranging = false
  /** True while the camera is on its way back out of the globe. */
  private exiting = false
  /** True while a scripted beat owns the globe; blocks input-driven progress. */
  private beat = false
  private saved: GlobeRecipe[] = []
  private auto = false
  private autoT = 0
  private autoStep = 0
  private motionOn = false
  private lastMotion = 0
  private coachHold = 0
  /** Guards the tray against being rebuilt on every frame. */
  private trayKey = ''

  constructor(private app: App) {
    this.auto = new URLSearchParams(location.search).has('auto')
    this.saved = loadGlobes()
    app.rig.travel = app.settings.calmCamera ? 0.45 : 1
    app.globe.onBubblePop = () => app.audio.bubble()
    app.hud.onStart(() => {
      app.audio.start()
      this.goto('town')
    })
  }

  begin() {
    this.resetToBench()
    this.app.rig.snap()
    this.app.rig.update(0.016)
    if (this.auto) {
      document.getElementById('veil')?.classList.add('gone')
      this.app.audio.start()
      this.goto('town')
    }
  }

  /** Puts the bench back to its opening state without touching the renderer. */
  private resetToBench() {
    this.applyPose('bench')
    this.glassOn = 0
    this.insideness = 0
    this.litTarget = 0
    this.rearranging = false
    this.exiting = false
    this.beat = false
    this.scoopTip = 0
    this.pumping = false
    const t = this.app.atelier.tools
    t.pedestal.visible = false
    t.cradle.visible = false
    t.cradle.position.set(0, 0, 0)
    t.cradle.scale.setScalar(1)
    t.scoop.position.set(-0.72, 0.09, 0.44)
    t.scoop.rotation.set(0, 0.5, 0)
    t.pump.position.set(0.76, 0, 0.42)
    t.pump.rotation.set(0, -0.4, 0)
    t.pumpHandle.position.y = 0.42
    const water = t.pump.getObjectByName('pumpWater')
    if (water) water.scale.y = 1
    const load = t.scoop.getObjectByName('scoopLoad')
    if (load) load.scale.setScalar(1)
    this.app.atelier.setExposure(1)
    this.frameFor('town')
  }

  onLayout(aspect: number) {
    this.bias = aspect < 1 ? 0.12 : 0.04
    this.margin = aspect < 1 ? 1.44 : 1.2
    this.frameFor(this.stage)
  }

  onSettings() {
    this.app.rig.travel = this.app.settings.calmCamera ? 0.45 : 1
    this.motionOn = this.app.settings.motionShake
    if (this.motionOn) window.addEventListener('devicemotion', this.onMotion)
    else window.removeEventListener('devicemotion', this.onMotion)
  }

  // ---------------------------------------------------------------- helpers

  private get globe() {
    return this.app.globe
  }

  private sub(type: Parameters<App['input']['on']>[0], fn: (p: Ptr) => void) {
    this.subs.push(this.app.input.on(type, fn))
  }

  private clearSubs() {
    for (const off of this.subs) off()
    this.subs.length = 0
  }

  private coach(iconName: string | null, text: string, hold = 0) {
    this.app.hud.setCoach(iconName, text)
    this.coachHold = hold
    if (hold > 0) this.app.hud.hideCoachAfter(hold * 1000)
  }

  /** Eight dots for the eight construction steps; the last covers going in. */
  private steps() {
    const idx = STAGE_ORDER.indexOf(this.stage)
    const last = STAGE_ORDER.indexOf('inside')
    const building = idx >= 0 && idx <= last
    this.app.hud.setStepsVisible(building)
    if (building) this.app.hud.setSteps(8, Math.min(idx, 7))
  }

  /** Positions the globe on the bench, in the cradle or on the pedestal. */
  private applyPose(pose: 'bench' | 'cradle' | 'pedestal') {
    const g = this.globe
    if (pose === 'bench') {
      g.root.position.set(0, BENCH_CENTER_Y, 0.06)
      g.flip = 1
      g.plateLift = 0
    } else if (pose === 'cradle') {
      g.root.position.set(0, CRADLE_CENTER_Y, 0)
      g.flip = 0
      g.plateLift = LIFT_HIGH
    } else {
      g.root.position.set(0, MOUNTED_CENTER_Y, 0)
      g.flip = 1
      g.plateLift = 0
    }
    g.applyTransforms()
  }

  private frameFor(stage: Stage) {
    const g = this.globe
    const c = g.root.position
    const t = this.v3
    const rig = this.app.rig
    const m = this.margin
    switch (stage) {
      case 'town':
        t.set(0, c.y + GROUND_Y + 0.06 - this.bias * 0.5, 0.06)
        rig.frame({ target: t, radius: 0.34, yaw: 0.28, pitch: -0.56, fov: 46, margin: m })
        break
      case 'snow':
      case 'liquid':
        // Framed to hold the whole assembly: the open sphere and the plug
        // hanging above it, which is where the action is during filling.
        t.set(0, c.y + 0.16 - this.bias, 0)
        rig.frame({ target: t, radius: 0.68, yaw: 0.18, pitch: -0.18, fov: 48, margin: m })
        break
      case 'seal':
        t.set(0, c.y + 0.14 - this.bias, 0)
        rig.frame({ target: t, radius: 0.6, yaw: 0.12, pitch: -0.12, fov: 46, margin: m })
        break
      case 'invert':
        t.set(0, c.y - this.bias, 0)
        rig.frame({ target: t, radius: 0.6, yaw: 0.1, pitch: -0.14, fov: 48, margin: m })
        break
      case 'mount':
        t.set(0, 0.42 - this.bias, 0)
        rig.frame({ target: t, radius: 0.72, yaw: 0.14, pitch: -0.2, fov: 48, margin: m })
        break
      case 'shake':
        t.set(0, MOUNTED_CENTER_Y - this.bias * 0.8, 0)
        rig.frame({ target: t, radius: 0.56, yaw: 0.07, pitch: -0.16, fov: 46, margin: m })
        break
      case 'finale':
        t.set(-0.06, 0.5 - this.bias * 0.6, -0.05)
        rig.frame({ target: t, radius: 0.7, yaw: 0.3, pitch: -0.18, fov: 46, margin: m })
        break
      default:
        break
    }
  }

  private setRay(p: Ptr) {
    this.v2.set(p.nx, p.ny)
    this.ray.setFromCamera(this.v2, this.app.camera)
  }

  /** Forgiving pick: nearest placed piece within a generous screen radius. */
  private pickScreen(p: Ptr, maxPx = 78, kinds?: PieceKind[]): number | null {
    const el = this.app.renderer.domElement
    const w = el.clientWidth
    const h = el.clientHeight
    let best: number | null = null
    let bestD = maxPx
    for (const piece of this.globe.town.pieces) {
      if (kinds && !kinds.includes(piece.kind)) continue
      if (!this.globe.town.worldPos(piece.id, this.v3b)) continue
      this.v3b.y += PIECE_SPECS[piece.kind].radius
      this.app.rig.project(this.v3b, this.v2)
      const sx = ((this.v2.x + 1) / 2) * w
      const sy = ((1 - this.v2.y) / 2) * h
      const d = Math.hypot(sx - p.x, sy - p.y)
      if (d < bestD) {
        bestD = d
        best = piece.id
      }
    }
    return best
  }

  private globeScreenCenter(): THREE.Vector2 {
    const el = this.app.renderer.domElement
    this.app.rig.project(this.globe.root.position, this.v2)
    this.screenCenter.set(
      ((this.v2.x + 1) / 2) * el.clientWidth,
      ((1 - this.v2.y) / 2) * el.clientHeight,
    )
    return this.screenCenter
  }

  // ---------------------------------------------------------------- stages

  private goto(next: Stage) {
    this.clearSubs()
    this.app.hud.clearTray()
    this.trayKey = ''
    this.autoT = 0
    this.autoStep = 0
    this.stage = next
    // Also surfaces the step to CSS and to automated runs.
    document.documentElement.dataset.step = next
    this.steps()
    this.frameFor(next)
    switch (next) {
      case 'town': this.enterTown(); break
      case 'snow': this.enterSnow(); break
      case 'liquid': this.enterLiquid(); break
      case 'seal': this.enterSeal(); break
      case 'invert': this.enterInvert(); break
      case 'mount': this.enterMount(); break
      case 'shake': this.enterShake(); break
      case 'dive': this.enterDive(); break
      case 'inside': this.enterInside(); break
      case 'finale': this.enterFinale(); break
      default: break
    }
  }

  // --- step 1: the miniature town ----------------------------------------

  private enterTown() {
    const g = this.globe
    if (!this.rearranging) {
      this.applyPose('bench')
      this.glassOn = 0
      this.app.atelier.tools.cradle.visible = false
      this.app.atelier.tools.pedestal.visible = false
      this.app.atelier.tools.scoop.visible = true
    }
    this.coach('house', 'すきな ものを えらんで おいてね')
    this.refreshTownTray()

    this.sub('down', (p) => {
      this.setRay(p)
      let id = this.pickScreen(p)
      if (id === null && g.groundHit(this.ray.ray, this.v3)) {
        id = g.town.pick(this.v3.x, this.v3.z, 0.14)
      }
      this.dragId = id
      if (id !== null && g.groundHit(this.ray.ray, this.v3)) {
        const piece = g.town.pieces.find((q) => q.id === id)
        if (piece) this.dragOffset.set(piece.x - this.v3.x, piece.z - this.v3.z)
        else this.dragOffset.set(0, 0)
      }
    })
    this.sub('move', (p) => {
      if (this.dragId === null) return
      this.setRay(p)
      if (!g.groundHit(this.ray.ray, this.v3)) return
      g.town.dragTo(this.dragId, this.v3.x + this.dragOffset.x, this.v3.z + this.dragOffset.y)
    })
    this.sub('up', () => {
      if (this.dragId === null) return
      g.town.snap(this.dragId)
      this.app.audio.placePiece()
      this.dragId = null
      this.refreshTownTray()
    })
  }

  private refreshTownTray() {
    const g = this.globe
    const full = g.town.count >= MAX_PIECES
    const items: TrayItem[] = PIECE_ORDER.map((k) => ({
      id: k,
      icon: k,
      label: PIECE_LABEL[k],
      disabled: full,
    }))
    if (g.town.count > 0) items.push({ id: 'undo', icon: 'undo', label: 'もどす' })
    if (g.town.count >= MIN_PIECES) items.push({ id: 'ok', icon: 'ok', label: 'できた' })

    this.app.hud.setTray(items, (id) => {
      if (id === 'undo') {
        g.town.removeLast()
        this.app.audio.placePiece()
        this.refreshTownTray()
        return
      }
      if (id === 'ok') {
        this.app.hud.clearTray()
        this.clearSubs()
        if (this.rearranging) this.resealBeat()
        else this.coverBeat()
        return
      }
      const kind = id as PieceKind
      const idx = (this.paint.get(kind) ?? Math.floor(Math.random() * 3)) % PIECE_SPECS[kind].palette.length
      this.paint.set(kind, idx + 1)
      const newId = g.town.add(kind, idx)
      if (newId < 0) return
      this.app.audio.placePiece()
      this.popPiece(newId)
      if (g.town.count >= MIN_PIECES) {
        this.coach('ok', 'いいね！ できたら みどりの ボタン')
      }
      this.refreshTownTray()
    })
  }

  /** A short drop-in so the child sees exactly where the piece landed. */
  private popPiece(id: number) {
    const obj = this.globe.town.pieceObject(id)
    if (!obj) return
    this.tw.add(0.42, (k) => obj.scale.setScalar(0.2 + 0.8 * k), {
      ease: Ease.outBack,
      done: () => obj.scale.setScalar(1),
    })
  }

  /** Lowers the glass over the town, then rolls the assembly mouth-up. */
  private coverBeat() {
    const g = this.globe
    this.beat = true
    this.coach('flip', 'ガラスを かぶせるよ')
    this.app.atelier.tools.cradle.visible = true
    const cradle = this.app.atelier.tools.cradle
    cradle.scale.setScalar(0.001)
    this.tw.add(0.5, (k) => cradle.scale.setScalar(0.2 + 0.8 * k), { ease: Ease.outBack })
    this.tw.add(0.7, (k) => (this.glassOn = k))
    this.tw.add(
      1.5,
      (k) => {
        g.root.position.y = THREE.MathUtils.lerp(BENCH_CENTER_Y, CRADLE_CENTER_Y, k)
        g.root.position.z = THREE.MathUtils.lerp(0.06, 0, k)
        g.flip = 1 - k
        g.plateLift = LIFT_HIGH * k
        this.frameFor(k > 0.5 ? 'snow' : 'town')
      },
      { delay: 0.35, done: () => { this.beat = false; this.goto('snow') } },
    )
    this.app.audio.thud()
  }

  // --- step 2: snow -------------------------------------------------------

  private enterSnow() {
    const scoop = this.app.atelier.tools.scoop
    this.coach('scoop', 'スコップを かたむけて ゆきを いれよう')
    scoop.visible = true
    const from = scoop.position.clone()
    const to = new THREE.Vector3(-0.34, CRADLE_CENTER_Y + 0.36, 0.18)
    this.tw.add(0.9, (k) => {
      scoop.position.lerpVectors(from, to, k)
      scoop.rotation.y = 0.5 + k * 0.6
    })

    this.sub('move', (p) => {
      if (!this.app.input.down) return
      // Swiping toward the globe tips the scoop; swiping back rights it. Any
      // wiggle still pours a little, so a four-year-old cannot get stuck.
      const speed = Math.min(1, Math.abs(p.dx) / 22)
      const push = p.dx > 0 ? speed * 0.09 : -speed * 0.05
      this.scoopTip = THREE.MathUtils.clamp(this.scoopTip + push, 0, 1)
    })
    this.sub('up', () => {
      this.app.audio.setBed('pour', 'snow', 5200, 0.6, 0)
    })
    this.refreshSnowTray()
  }

  private refreshSnowTray() {
    const enough = this.app.build.recipe.snow >= SNOW_MIN
    const key = `snow:${enough}`
    if (key === this.trayKey) return
    this.trayKey = key
    this.app.hud.setTray(
      enough ? [{ id: 'ok', icon: 'ok', label: 'できた' }] : [],
      () => this.goto('liquid'),
    )
  }

  private updateSnow(dt: number) {
    const g = this.globe
    const scoop = this.app.atelier.tools.scoop
    const b = this.app.build
    if (!this.app.input.down) this.scoopTip = Math.max(0, this.scoopTip - dt * 1.6)
    scoop.rotation.z = -this.scoopTip * 1.25

    if (this.scoopTip > 0.3 && b.recipe.snow < 1) {
      const rate = (this.scoopTip - 0.3) * 0.62
      b.recipe.snow = Math.min(1, b.recipe.snow + rate * dt)
      g.snow.amount = b.recipe.snow
      scoop.getWorldPosition(this.v3)
      this.v3.y -= 0.06
      const dir = this.v3b.set(0.25, -1, -0.1).normalize()
      g.pour.emit(this.v3, dir, Math.ceil(rate * 34 * dt * 60))
      // The near-field pour and the in-globe flakes are separate systems, kept
      // in step by feeding both from the same rate.
      g.snow.pour(Math.ceil(rate * 26 * dt * 60), g.mouthEntry(this.v3b), 0.22)
      this.app.audio.setBed('pour', 'snow', 5200, 0.6, 0.35 + this.scoopTip * 0.5, 0.5)
      if (Math.random() < dt * 4) this.app.audio.scoop()
    } else {
      this.app.audio.setBed('pour', 'snow', 5200, 0.6, 0)
    }

    const load = scoop.getObjectByName('scoopLoad')
    if (load) load.scale.setScalar(Math.max(0.001, 1 - b.recipe.snow * 0.85))

    if (b.recipe.snow >= SNOW_MIN) this.refreshSnowTray()
    if (b.recipe.snow >= 0.999) this.goto('liquid')
  }

  // --- step 3: liquid -----------------------------------------------------

  private enterLiquid() {
    const scoop = this.app.atelier.tools.scoop
    const pump = this.app.atelier.tools.pump
    this.coach('pump', 'ながおしして みずを いれよう')
    const sFrom = scoop.position.clone()
    this.tw.add(0.7, (k) => {
      scoop.position.lerpVectors(sFrom, new THREE.Vector3(-0.78, 0.09, 0.5), k)
      scoop.rotation.z = -this.scoopTip * (1 - k)
    })
    const pFrom = pump.position.clone()
    const pTo = new THREE.Vector3(0.5, 0.16, 0.3)
    this.tw.add(0.9, (k) => {
      pump.position.lerpVectors(pFrom, pTo, k)
      pump.rotation.y = -0.4 - k * 0.5
    })

    this.sub('hold', () => {
      this.pumping = true
      this.app.audio.setBed('flow', 'water', 900, 1.1, 0.7, 0.5)
    })
    this.sub('down', () => {
      this.pumping = true
    })
    this.sub('up', () => {
      this.pumping = false
      this.app.audio.setBed('flow', 'water', 900, 1.1, 0)
    })
    this.refreshLiquidTray()
  }

  private refreshLiquidTray() {
    const enough = this.globe.liquid.fill >= FILL_TO_BRIM * 0.8
    const key = `liquid:${enough}`
    if (key === this.trayKey) return
    this.trayKey = key
    this.app.hud.setTray(
      enough ? [{ id: 'ok', icon: 'ok', label: 'できた' }] : [],
      () => this.startSeal(),
    )
  }

  private updateLiquid(dt: number) {
    const g = this.globe
    const handle = this.app.atelier.tools.pumpHandle
    const target = this.pumping ? 0.36 : 0.42
    handle.position.y += (target - handle.position.y) * Math.min(1, dt * 12)

    if (this.pumping && g.liquid.fill < FILL_TO_BRIM) {
      const next = Math.min(FILL_TO_BRIM, g.liquid.fill + dt * 0.3)
      g.liquid.setFill(next)
      // The plug — and the hanging town with it — is lowered into the sphere
      // as the water climbs, so the miniatures submerge instead of appearing.
      g.plateLift = THREE.MathUtils.lerp(
        LIFT_HIGH, LIFT_LOW, THREE.MathUtils.smoothstep(next / FILL_TO_BRIM, 0, 0.55),
      )
      if (Math.random() < dt * 9) {
        this.v3.set(0, g.centerWorld.y - 0.3, 0)
        g.liquid.spawnBubbles(2, this.v3, 0.2)
      }
      const water = this.app.atelier.tools.pump.getObjectByName('pumpWater')
      if (water) water.scale.y = Math.max(0.05, 1 - g.liquid.fill * 0.8)
      this.app.audio.setBed(
        'flow', 'water', 700 + g.liquid.fill * 900, 1.1, 0.65, 0.45,
      )
    } else if (!this.pumping) {
      this.app.audio.setBed('flow', 'water', 900, 1.1, 0)
    }

    if (g.liquid.fill >= FILL_TO_BRIM * 0.8) this.refreshLiquidTray()
    if (g.liquid.fill >= FILL_TO_BRIM - 1e-4) this.startSeal()
  }

  private startSeal() {
    this.globe.liquid.setFill(FILL_TO_BRIM)
    this.goto('seal')
  }

  // --- step 4: bubble, gasket, plug, collar -------------------------------

  private enterSeal() {
    const g = this.globe
    const pump = this.app.atelier.tools.pump
    const pFrom = pump.position.clone()
    this.tw.add(0.7, (k) => pump.position.lerpVectors(pFrom, new THREE.Vector3(0.8, 0.02, 0.42), k))
    this.sealStep = 0
    this.sealProgress = 0
    g.town.gasket.visible = false
    this.coach('flip', 'そっと かたむけて あわを みてみよう')

    this.sub('move', (p) => this.onSealMove(p))
    this.sub('down', () => {
      if (this.sealStep === 3) this.winder.begin()
    })
    this.sub('up', () => {
      if (this.sealStep === 0) this.tw.add(0.5, (k) => (g.tilt.y = g.tilt.y * (1 - k)))
    })
  }

  private onSealMove(p: Ptr) {
    const g = this.globe
    const el = this.app.renderer.domElement
    if (this.sealStep === 0) {
      g.tilt.y = THREE.MathUtils.clamp(g.tilt.y + p.dx * 0.0018, -TILT_LIMIT, TILT_LIMIT)
      this.sealProgress += Math.abs(p.dx) / el.clientWidth
      if (Math.random() < 0.06) {
        this.v3.set(0, g.centerWorld.y - 0.25, 0)
        g.liquid.spawnBubbles(1, this.v3, 0.25)
      }
      this.app.audio.slosh(Math.min(1, Math.abs(p.dx) * 0.02))
      if (this.sealProgress > 1.1) this.nextSealStep()
    } else if (this.sealStep === 1) {
      // Drag the rubber ring down onto the rim: finger down, ring down.
      this.sealProgress = THREE.MathUtils.clamp(
        this.sealProgress + p.dy / (el.clientHeight * 0.32), 0, 1,
      )
      const ring = g.town.gasket
      ring.visible = true
      ring.position.y = MOUTH_Y + 0.03 - (1 - this.sealProgress) * GASKET_TRAVEL
      if (Math.random() < 0.05) this.app.audio.gasketSqueeze(this.sealProgress * 0.4)
      if (this.sealProgress >= 0.999) this.nextSealStep()
    } else if (this.sealStep === 2) {
      this.sealProgress = THREE.MathUtils.clamp(
        this.sealProgress + p.dy / (el.clientHeight * 0.42), 0, 1,
      )
      g.plateLift = THREE.MathUtils.lerp(LIFT_SEAT, 0, this.sealProgress)
      g.gasketSeat = this.sealProgress
      g.liquid.setFill(THREE.MathUtils.lerp(FILL_TO_BRIM, FILL_SEALED, this.sealProgress))
      if (Math.random() < 0.09) {
        this.app.audio.gasketSqueeze(this.sealProgress)
        this.v3.set(0, g.centerWorld.y - 0.1, 0)
        g.liquid.spawnBubbles(2, this.v3, 0.3)
      }
      if (this.sealProgress >= 0.999) this.nextSealStep()
    } else if (this.sealStep === 3) {
      const c = this.globeScreenCenter()
      const d = this.winder.feed(p.x, p.y, c.x, c.y)
      const before = this.sealProgress
      this.sealProgress = THREE.MathUtils.clamp(this.sealProgress + Math.abs(d) / 4.2, 0, 1)
      g.collarTurn = this.sealProgress
      if (Math.floor(before * 12) !== Math.floor(this.sealProgress * 12)) this.app.audio.collarTick()
      if (this.sealProgress >= 0.999) this.nextSealStep()
    }
  }

  private nextSealStep() {
    const g = this.globe
    this.sealStep++
    this.sealProgress = 0
    if (this.sealStep === 1) {
      this.tw.add(0.45, (k) => (g.tilt.y = g.tilt.y * (1 - k)))
      // The lid lifts clear so the ring has somewhere to travel from.
      const from = g.plateLift
      this.tw.add(0.5, (k) => (g.plateLift = THREE.MathUtils.lerp(from, LIFT_SEAT, k)))
      this.coach('gasket', 'ゴムの わっかを したに おろしてね')
      g.town.gasket.visible = true
      g.town.gasket.position.y = MOUTH_Y + 0.03 - GASKET_TRAVEL
    } else if (this.sealStep === 2) {
      g.town.gasket.position.y = MOUTH_Y + 0.03
      this.app.audio.gasketSeat()
      this.coach('gasket', 'ふたを ぐっと おしこもう')
    } else if (this.sealStep === 3) {
      g.plateLift = 0
      g.gasketSeat = 1
      g.liquid.setFill(FILL_SEALED)
      this.app.audio.gasketSeat()
      this.coach('collar', 'くるっと まわして しめよう')
      this.winder.begin()
    } else {
      g.collarTurn = 1
      this.app.audio.collarLocked()
      this.app.build.gasket = 1
      this.app.build.collar = 1
      this.coach('flip', 'しまった！ つぎは さかさに するよ', 3)
      this.goto('invert')
    }
  }

  // --- step 5: inverting --------------------------------------------------

  private enterInvert() {
    const g = this.globe
    this.flipProgress = 0
    g.tilt.set(0, 0)
    this.coach('flip', 'ゆびで おおきく まわして さかさに してね')
    this.sub('down', () => this.winder.begin())
    this.sub('move', (p) => {
      const el = this.app.renderer.domElement
      const c = this.globeScreenCenter()
      const wind = Math.abs(this.winder.feed(p.x, p.y, c.x, c.y)) / Math.PI
      const swipe = Math.abs(p.dx) / (el.clientWidth * 0.85)
      this.flipProgress = Math.min(1, this.flipProgress + wind * 0.8 + swipe)
      g.flip = this.flipProgress
      this.app.audio.slosh(Math.min(1, (Math.abs(p.dx) + Math.abs(p.dy)) * 0.016))
      if (this.flipProgress >= 0.999) this.finishInvert()
    })
    this.sub('up', () => {
      this.app.audio.slosh(0)
      if (this.flipProgress > 0.55 && this.flipProgress < 0.999) {
        const from = this.flipProgress
        this.tw.add(0.7, (k) => {
          this.flipProgress = THREE.MathUtils.lerp(from, 1, k)
          g.flip = this.flipProgress
        }, { done: () => this.finishInvert() })
      }
    })
  }

  private finishInvert() {
    if (this.stage !== 'invert') return
    this.globe.flip = 1
    this.app.build.invert = 1
    this.app.audio.thud()
    this.goto('mount')
  }

  // --- step 6: the pedestal ------------------------------------------------

  private enterMount() {
    const ped = this.app.atelier.tools.pedestal
    const cradle = this.app.atelier.tools.cradle
    ped.visible = true
    ped.position.y = -0.4
    this.app.atelier.setPedestalKind(this.app.build.recipe.pedestal, this.app.mats)
    this.mountStep = 0
    this.mountDrop = 0
    this.coach('mount', 'だいの うえに そっと おろそう')
    this.tw.add(0.8, (k) => {
      ped.position.y = THREE.MathUtils.lerp(-0.4, 0, k)
      cradle.position.y = -k * 0.55
      cradle.scale.setScalar(1 - k * 0.4)
    }, { done: () => (cradle.visible = false) })

    this.sub('down', () => {
      if (this.mountStep === 1) this.winder.begin()
    })
    this.sub('move', (p) => {
      const g = this.globe
      const el = this.app.renderer.domElement
      if (this.mountStep === 0) {
        this.mountDrop = THREE.MathUtils.clamp(this.mountDrop + p.dy / (el.clientHeight * 0.36), 0, 1)
        g.root.position.y = THREE.MathUtils.lerp(CRADLE_CENTER_Y, MOUNTED_CENTER_Y, this.mountDrop)
        if (this.mountDrop >= 0.999) {
          this.mountStep = 1
          this.app.audio.thud()
          this.coach('collar', 'くるっと まわして ぴったり とめよう')
          this.winder.begin()
        }
      } else if (this.mountStep === 1) {
        const c = this.globeScreenCenter()
        const d = Math.abs(this.winder.feed(p.x, p.y, c.x, c.y))
        const before = this.mountDrop
        this.mountDrop = Math.min(2, this.mountDrop + d / 3.4)
        if (Math.floor(before * 8) !== Math.floor(this.mountDrop * 8)) this.app.audio.collarTick()
        this.globe.town.collar.rotation.y = -(1 + (this.mountDrop - 1)) * 2.6
        if (this.mountDrop >= 1.999) {
          this.app.build.mounted = true
          this.app.audio.collarLocked()
          this.goto('shake')
        }
      }
    })
    this.refreshPedestalTray()
  }

  private refreshPedestalTray() {
    const kinds: Array<[string, string]> = [
      ['oak', 'き'],
      ['ceramic', 'とうき'],
      ['brass', 'しんちゅう'],
    ]
    this.app.hud.setTray(
      kinds.map(([id, label]) => ({
        id,
        icon: 'mount',
        label,
        selected: this.app.build.recipe.pedestal === id,
      })),
      (id) => {
        this.app.build.recipe.pedestal = id as 'oak' | 'ceramic' | 'brass'
        this.app.atelier.setPedestalKind(this.app.build.recipe.pedestal, this.app.mats)
        this.globe.town.setPedestalStyle(this.app.build.recipe.pedestal)
        this.app.audio.placePiece()
        this.refreshPedestalTray()
      },
    )
  }

  // --- step 7: shaking -----------------------------------------------------

  private enterShake() {
    const g = this.globe
    this.app.hud.clearTray()
    this.shakeIdle = 0
    this.litTarget = 0.35
    g.town.installLights(2)
    this.coach('shake', 'ひだり みぎに ふってみて')

    this.sub('move', (p) => {
      if (!this.app.input.down) return
      const el = this.app.renderer.domElement
      const speed = Math.abs(p.vx) / el.clientWidth
      if (speed < 0.15) return
      const power = Math.min(2.6, speed * 3.2)
      this.applyShake(Math.sign(p.vx), power)
    })
    this.sub('tap', (p) => {
      this.setRay(p)
      if (g.glassHit(this.ray.ray) && this.app.build.shakes > 0) this.goto('dive')
    })
    this.sub('up', () => {
      this.app.audio.slosh(0)
      if (this.app.build.shakes > 0) this.refreshShakeTray()
    })
  }

  private applyShake(dir: number, power: number) {
    const g = this.globe
    // A vertical-axis swirl plus a lateral kick: enough for a real vortex,
    // never enough to throw the globe off its base.
    this.v3.set(0, dir * power * 1.5, 0)
    g.toLocalDirection(this.v3, this.v3b)
    g.snow.shake(this.v3b, power)
    g.tilt.y = THREE.MathUtils.clamp(g.tilt.y - dir * power * 0.03, -0.11, 0.11)
    g.liquid.disturb(power * 0.2)
    this.app.audio.slosh(Math.min(1, power * 0.45))
    this.app.build.shakes++
    this.shakeIdle = 0
  }

  private refreshShakeTray() {
    if (this.trayKey === 'shake') return
    this.trayKey = 'shake'
    this.app.hud.setTray(
      [
        { id: 'enter', icon: 'enter', label: 'なかへ' },
        { id: 'done', icon: 'save', label: 'かんせい' },
      ],
      (id) => (id === 'enter' ? this.goto('dive') : this.goto('finale')),
    )
  }

  private updateShake(dt: number) {
    const g = this.globe
    g.tilt.y *= Math.exp(-dt * 3.4)
    g.tilt.x *= Math.exp(-dt * 3.4)
    if (!this.app.input.down) {
      this.shakeIdle += dt
      if (this.shakeIdle > 2.6 && this.app.build.shakes > 0 && this.coachHold === 0) {
        this.coach('tap', 'ガラスを タップして なかへ', 5)
        this.coachHold = 5
        this.refreshShakeTray()
      }
    }
    this.app.audio.snowFall(g.snow.agitation * 0.8)
  }


  // --- step 8: inside the globe -------------------------------------------

  /**
   * Picks the bearing the camera will fly in on: the direction, kept roughly
   * frontal so the dive still reads as "through the glass I just tapped",
   * whose nearest miniature is furthest away. Without this the camera can end
   * up nose to nose with a street lamp.
   */
  private clearBearing(): number {
    const blocked = this.globe.town.blockedAzimuths()
    let best = 0.35
    let bestScore = -1
    for (let deg = -75; deg <= 75; deg += 5) {
      const a = THREE.MathUtils.degToRad(deg)
      let nearest = Math.PI
      for (const b of blocked) {
        let d = Math.abs(a - b)
        if (d > Math.PI) d = Math.PI * 2 - d
        nearest = Math.min(nearest, d)
      }
      // A small pull toward the front breaks ties in favour of a frontal entry.
      const score = nearest - Math.abs(a) * 0.12
      if (score > bestScore) {
        bestScore = score
        best = a
      }
    }
    return best
  }

  /** Point inside the globe at a bearing and radius, in world space. */
  private inner(bearing: number, radius: number, y: number, out: THREE.Vector3): THREE.Vector3 {
    const c = this.globe.root.position
    return out.set(
      c.x + Math.sin(bearing) * radius,
      c.y + y,
      c.z + Math.cos(bearing) * radius,
    )
  }

  private enterDive() {
    const g = this.globe
    this.app.hud.clearTray()
    this.coach(null, '')
    this.litTarget = 1
    // The lane is chosen to clear whatever the player actually placed, and it
    // stays a few centimetres inside the glass so the fence and the near trees
    // sweep past the lens on the way down.
    this.bearing = this.clearBearing()
    // Keep a little drift alive: the globe was just shaken, and the near-field
    // flakes crossing the lens are half of what makes being inside work.
    g.snow.shake(this.v3.set(0, 1, 0), 0.7)
    const b = this.bearing
    const at = (bear: number, r: number, y: number) => this.inner(bear, r, y, new THREE.Vector3())
    const eye = GROUND_Y + 0.1
    const keys = [
      { pos: this.app.camera.position.clone(), look: g.root.position.clone() },
      { pos: at(b, 1.0, 0.12), look: at(b, 0, -0.02) },
      { pos: at(b, 0.55, 0.02), look: at(b + 0.3, 0.1, -0.12) },
      { pos: at(b, 0.46, -0.1), look: at(b + 1.2, 0.14, -0.18) },
      { pos: at(b, 0.41, -0.19), look: at(b + 2.6, 0.2, eye - 0.01) },
      { pos: at(b, 0.385, eye), look: at(b + Math.PI + 0.45, 0.14, eye - 0.008) },
    ]
    const dur = this.app.settings.calmCamera ? 6.5 : 5.2
    const fov0 = this.app.camera.fov
    this.tw.add(dur * 0.8, (k) => this.app.rig.setFov(THREE.MathUtils.lerp(fov0, INSIDE_FOV, k)))
    this.app.rig.playPath(keys, dur, () => this.goto('inside'))
  }

  private enterInside() {
    const g = this.globe
    this.interiorTime = 0
    this.litTarget = 1
    const b = this.bearing
    const at = (bear: number, r: number, y: number) => this.inner(bear, r, y, new THREE.Vector3())
    const eye = GROUND_Y + 0.1
    // A slow drift along the rim, always looking across the town.
    const keys = [0, 0.16, 0.34, 0.52].map((d) => ({
      pos: at(b + d, 0.385, eye),
      look: at(b + d + Math.PI + 0.45, 0.14, eye - 0.008),
    }))
    this.app.rig.playPath(keys, this.app.settings.calmCamera ? 20 : 15, () => this.exitGlobe())
    this.coach('tap', 'あかりを タップしてみて', 4)
    this.app.hud.setTray([{ id: 'out', icon: 'enter', label: 'そとへ' }], () => this.exitGlobe())

    this.sub('tap', (p) => {
      const lampId = this.pickScreen(p, 96, ['lamp', 'centerTree', 'house'])
      if (lampId !== null) {
        this.litTarget = this.litTarget > 0.6 ? 0.25 : 1
        this.app.audio.lampOn()
        return
      }
      const snowyId = this.pickScreen(p, 110, ['bridge', 'fir', 'snowman', 'deer'])
      if (snowyId !== null && g.town.worldPos(snowyId, this.v3b)) {
        g.toLocal(this.v3b, this.v3)
        this.v3.y += 0.03
        const woke = g.snow.dislodge(this.v3, 0.1)
        if (woke > 0) this.app.audio.scoop()
      }
    })
  }

  private exitGlobe() {
    if (this.stage !== 'inside' || this.exiting) return
    // The step only becomes 'finale' once the camera is actually back outside.
    this.exiting = true
    this.clearSubs()
    this.app.hud.clearTray()
    this.coach(null, '')
    this.frameFor('finale')
    const c = this.globe.root.position.clone()
    const b = this.bearing + 0.52
    const at = (bear: number, r: number, y: number) => this.inner(bear, r, y, new THREE.Vector3())
    const out = this.app.rig.restingPosition(new THREE.Vector3())
    const keys = [
      { pos: this.app.camera.position.clone(), look: at(b + Math.PI, 0.16, GROUND_Y + 0.09) },
      { pos: at(b, 0.42, -0.12), look: at(b + Math.PI, 0.1, -0.1) },
      { pos: at(b, 0.95, 0.12), look: c.clone() },
      { pos: out, look: c.clone() },
    ]
    const dur = this.app.settings.calmCamera ? 5.5 : 4.2
    const fov0 = this.app.camera.fov
    this.tw.add(dur * 0.75, (k) => this.app.rig.setFov(THREE.MathUtils.lerp(fov0, 46, k)))
    this.app.rig.playPath(keys, dur, () => {
      this.exiting = false
      this.goto('finale')
    })
  }

  // --- finale --------------------------------------------------------------

  private enterFinale() {
    this.app.rig.cancelPath()
    this.frameFor('finale')
    this.litTarget = 1
    this.app.hud.setStepsVisible(false)
    this.app.build.recipe.pieces = this.globe.town.pieces
    this.saved = saveGlobe(this.app.build.recipe)
    this.app.audio.chime()
    this.coach('save', 'かんせい！ たなに しまったよ')
    this.app.hud.setTray(
      [
        { id: 'shake', icon: 'again', label: 'もういちど' },
        { id: 'rearrange', icon: 'rearrange', label: 'ならべかえ' },
        { id: 'new', icon: 'newGlobe', label: 'あたらしく' },
        { id: 'shelf', icon: 'shelf', label: 'たな' },
      ],
      (id) => this.onFinaleChoice(id),
    )
  }

  private onFinaleChoice(id: string) {
    switch (id) {
      case 'shake':
        this.goto('shake')
        break
      case 'rearrange':
        this.beginRearrange()
        break
      case 'new':
        this.beginNewGlobe()
        break
      case 'shelf':
        this.app.hud.openShelf(this.saved, (r) => this.loadSaved(r))
        break
      default:
        break
    }
  }

  /** Opens the finished globe again so the layout can be nudged. */
  private beginRearrange() {
    const g = this.globe
    this.rearranging = true
    this.beat = true
    this.app.hud.clearTray()
    this.coach('rearrange', 'ふたを あけるよ')
    this.app.atelier.tools.cradle.visible = true
    this.app.atelier.tools.cradle.position.y = 0
    this.app.atelier.tools.cradle.scale.setScalar(1)
    const ped = this.app.atelier.tools.pedestal
    this.tw.add(1.6, (k) => {
      g.flip = 1 - k
      g.root.position.y = THREE.MathUtils.lerp(MOUNTED_CENTER_Y, CRADLE_CENTER_Y, k)
      g.collarTurn = 1 - k
      g.gasketSeat = 1 - k
      g.plateLift = LIFT_HIGH * k
      g.liquid.setFill(THREE.MathUtils.lerp(FILL_SEALED, 0, k * 0.9))
      ped.position.y = -k * 0.4
      this.frameFor(k > 0.5 ? 'town' : 'finale')
    }, {
      done: () => {
        ped.visible = false
        this.glassOn = 0
        g.flip = 1
        g.plateLift = 0
        g.root.position.set(0, BENCH_CENTER_Y, 0.06)
        this.app.atelier.tools.cradle.visible = false
        this.beat = false
        this.goto('town')
      },
    })
  }

  /** Closes the globe back up after a rearrange, skipping the filled steps. */
  private resealBeat() {
    const g = this.globe
    this.rearranging = false
    this.beat = true
    this.coach('flip', 'また とじるよ')
    this.app.atelier.tools.cradle.visible = true
    this.app.atelier.tools.cradle.scale.setScalar(1)
    this.app.atelier.tools.cradle.position.y = 0
    const ped = this.app.atelier.tools.pedestal
    ped.visible = true
    this.tw.add(0.5, (k) => (this.glassOn = k))
    this.tw.add(2.2, (k) => {
      g.root.position.y = THREE.MathUtils.lerp(BENCH_CENTER_Y, MOUNTED_CENTER_Y, k)
      g.root.position.z = 0.06 * (1 - k)
      g.plateLift = 0
      g.collarTurn = k
      g.gasketSeat = k
      g.liquid.setFill(FILL_SEALED * k)
      ped.position.y = 0
      this.frameFor(k > 0.4 ? 'shake' : 'town')
    }, {
      done: () => {
        this.app.atelier.tools.cradle.visible = false
        g.snow.amount = this.app.build.recipe.snow
        g.snow.settleImmediately()
        this.app.audio.collarLocked()
        this.beat = false
        this.goto('shake')
      },
    })
  }

  private beginNewGlobe() {
    this.app.hud.clearTray()
    this.clearSubs()
    this.tw.clear()
    this.app.rig.cancelPath()
    const recipe = newRecipe()
    this.app.build.reset(recipe)
    this.app.rebuildGlobe(recipe.seed)
    this.resetToBench()
    this.goto('town')
  }

  private loadSaved(r: GlobeRecipe) {
    this.app.hud.clearTray()
    this.clearSubs()
    this.tw.clear()
    this.app.rig.cancelPath()
    this.app.build.loadFinished(r)
    this.app.rebuildGlobe(r.seed)
    const g = this.globe
    g.town.restore(r.pieces)
    g.town.setPedestalStyle(r.pedestal)
    g.snow.amount = r.snow
    g.snow.settleImmediately()
    g.liquid.setFill(FILL_SEALED)
    this.glassOn = 1
    g.gasketSeat = 1
    g.collarTurn = 1
    g.town.gasket.visible = true
    this.applyPose('pedestal')
    this.app.atelier.tools.pedestal.visible = true
    this.app.atelier.tools.pedestal.position.y = 0
    this.app.atelier.setPedestalKind(r.pedestal, this.app.mats)
    this.app.atelier.tools.cradle.visible = false
    this.rearranging = false
    this.exiting = false
    this.litTarget = 0.7
    this.goto('shake')
  }

  // ---------------------------------------------------------------- frame

  update(dt: number) {
    this.tw.update(dt)
    this.interiorTime += dt
    if (this.coachHold > 0) this.coachHold = Math.max(0, this.coachHold - dt)

    switch (this.stage) {
      case 'snow': this.updateSnow(dt); break
      case 'liquid': this.updateLiquid(dt); break
      case 'shake': this.updateShake(dt); break
      default: break
    }

    const g = this.globe
    const submerged = THREE.MathUtils.clamp(g.liquid.fill / 0.45, 0, 1)
    g.update(dt, submerged)

    // How far inside the glass the camera has travelled; drives every optical
    // change in one place so the entry and the exit stay symmetrical.
    const d = this.app.camera.position.distanceTo(g.centerWorld)
    const target = 1 - THREE.MathUtils.smoothstep(d, R_OUT - 0.12, R_OUT + 0.05)
    this.insideness += (target - this.insideness) * Math.min(1, dt * 6)
    const inside = this.insideness

    g.glass.setOpacity(this.glassOn * (1 - 0.74 * inside))
    g.glass.setInterior(inside)
    g.liquid.setOpacity(1 - 0.72 * inside)
    this.app.atelier.setExposure(1 - 0.62 * inside)

    const flicker =
      this.app.settings.steadyLight ? 0 : Math.sin(this.interiorTime * 5.1) * 0.012
    g.town.setLit(THREE.MathUtils.lerp(g.town.litAmount, Math.max(this.litTarget, inside * 0.9) + flicker, Math.min(1, dt * 2.4)))

    // Contact shadow follows the globe so it never reads as floating.
    const lift = THREE.MathUtils.clamp(g.root.position.y - 0.3, 0, 0.6)
    const spread = this.stage === 'town' ? 0.42 : 0.52
    this.app.atelier.setContact(0, g.root.position.z * 0.7, lift, spread, (1 - inside) * 0.72)

    if (this.auto) this.autoTick(dt)
  }

  // ---------------------------------------------------------------- auto

  /** Drives the same values the gestures drive, for end-to-end verification. */
  private autoTick(dt: number) {
    if (this.beat || this.app.rig.inPath) return
    this.autoT += dt
    const g = this.globe
    switch (this.stage) {
      case 'title':
        break
      case 'town': {
        const want: PieceKind[] = ['centerTree', 'house', 'fir', 'lamp', 'snowman']
        if (this.autoT > 0.5 && this.autoStep < want.length) {
          const kind = want[this.autoStep]
          g.town.add(kind, this.autoStep % 3)
          this.autoStep++
          this.autoT = 0
          this.refreshTownTray()
        } else if (this.autoStep >= want.length && this.autoT > 1.2) {
          this.autoStep = 0
          this.autoT = 0
          this.app.hud.clearTray()
          this.clearSubs()
          if (this.rearranging) this.resealBeat()
          else this.coverBeat()
        }
        break
      }
      case 'snow':
        this.scoopTip = 1
        if (this.app.build.recipe.snow > 0.62) {
          this.scoopTip = 0
          this.goto('liquid')
        }
        break
      case 'liquid':
        this.pumping = true
        break
      case 'seal':
        if (this.sealStep === 0) {
          g.tilt.y = Math.sin(this.autoT * 3) * TILT_LIMIT
          this.sealProgress += dt * 0.9
          if (this.sealProgress > 1.1) this.nextSealStep()
        } else if (this.sealStep === 1 || this.sealStep === 2) {
          this.sealProgress = Math.min(1, this.sealProgress + dt * 0.85)
          if (this.sealStep === 1) {
            g.town.gasket.visible = true
            g.town.gasket.position.y =
              MOUTH_Y + 0.03 - (1 - this.sealProgress) * GASKET_TRAVEL
          } else {
            g.plateLift = THREE.MathUtils.lerp(LIFT_SEAT, 0, this.sealProgress)
            g.gasketSeat = this.sealProgress
            g.liquid.setFill(THREE.MathUtils.lerp(FILL_TO_BRIM, FILL_SEALED, this.sealProgress))
          }
          if (this.sealProgress >= 1) this.nextSealStep()
        } else {
          this.sealProgress = Math.min(1, this.sealProgress + dt * 0.8)
          g.collarTurn = this.sealProgress
          if (this.sealProgress >= 1) this.nextSealStep()
        }
        break
      case 'invert':
        this.flipProgress = Math.min(1, this.flipProgress + dt * 0.45)
        g.flip = this.flipProgress
        if (this.flipProgress >= 1) this.finishInvert()
        break
      case 'mount':
        if (this.mountStep === 0) {
          this.mountDrop = Math.min(1, this.mountDrop + dt * 0.8)
          g.root.position.y = THREE.MathUtils.lerp(CRADLE_CENTER_Y, MOUNTED_CENTER_Y, this.mountDrop)
          if (this.mountDrop >= 1) {
            this.mountStep = 1
            this.app.audio.thud()
          }
        } else {
          this.mountDrop = Math.min(2, this.mountDrop + dt * 0.9)
          if (this.mountDrop >= 2) {
            this.app.build.mounted = true
            this.goto('shake')
          }
        }
        break
      case 'shake':
        if (this.autoT < 1.6) {
          if (this.autoT % 0.3 < dt) this.applyShake(this.autoT % 0.6 < 0.3 ? 1 : -1, 2.2)
        } else if (this.autoT > 5.5) {
          this.autoT = 0
          this.goto('dive')
        }
        break
      default:
        break
    }
  }

  // ---------------------------------------------------------------- motion

  private onMotion = (e: DeviceMotionEvent) => {
    if (this.stage !== 'shake' || !this.motionOn) return
    const a = e.accelerationIncludingGravity
    if (!a) return
    const now = performance.now()
    if (now - this.lastMotion < 90) return
    const mag = Math.hypot(a.x ?? 0, a.y ?? 0) - 9.4
    if (mag > 4) {
      this.lastMotion = now
      this.applyShake((a.x ?? 0) > 0 ? 1 : -1, Math.min(2.4, mag * 0.2))
    }
  }

  dispose() {
    this.clearSubs()
    this.tw.clear()
    window.removeEventListener('devicemotion', this.onMotion)
  }
}
