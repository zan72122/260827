import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { SPEC } from './design'
import { HoneycombTree } from './honeycomb/tree'
import { createMaterials, type MaterialSet } from './scene/materials'
import { createWorkshop, type Workshop } from './scene/workshop'
import { Clip } from './scene/clip'
import { Swatches } from './scene/swatches'
import { CameraRig } from './camera/rig'
import { PointerInput, type DragTarget } from './input/pointer'
import { Sound } from './audio/audio'
import { OPEN_COMPLETE, PAPER_COLORS, Store, type PaperColor } from './state/store'
import { RealClock, type GameClock } from './util/clock'
import { seedFromLocation } from './util/rng'

export interface AppOptions {
  canvas: HTMLCanvasElement
  hud: HTMLElement
  clock?: GameClock
  search?: string
}

/** つかみ代の当たり領域の半径 (CSS px)。直径 68px は要件の 48〜64px を満たす。 */
const GRAB_RADIUS = 34
const CLIP_RADIUS = 36
/** これ以上動いたら「色を選ぶタップ」ではなく「紙を開くドラッグ」とみなす (CSS px) */
const SWATCH_TAP_SLOP = 12
const HINT_IDLE = 3.2

export class App {
  readonly store = new Store()
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly rig = new CameraRig()
  readonly tree: HoneycombTree
  readonly clip: Clip
  readonly swatches: Swatches
  readonly workshop: Workshop
  readonly sound = new Sound()

  private readonly mats: MaterialSet
  private readonly input: PointerInput
  private readonly clock: GameClock
  private readonly canvas: HTMLCanvasElement
  private readonly hud: HTMLElement
  private readonly hint: HTMLElement
  private readonly muteBtn: HTMLButtonElement
  private readonly pmrem: THREE.PMREMGenerator
  private readonly envRT: THREE.WebGLRenderTarget

  private raf = 0
  private disposed = false
  private cssW = 1
  private cssH = 1
  private idle = 0
  private frames = 0
  private frameAcc = 0
  private degrade = 0
  private baseDpr = 1.5
  private clipGrabOffset = 0
  private openPerPx = 1 / 520
  private devControls: { update(): void; dispose(): void } | null = null
  private fixedQuality = false
  /** 検査用の軽量描画。ソフトウェアGLでも操作を確認できるようにするだけで、
   *  ジオメトリ・当たり判定・状態遷移・カメラは通常と同一。 */
  private lite = false

  private readonly v1 = new THREE.Vector3()
  private readonly v2 = new THREE.Vector3()
  private readonly v3 = new THREE.Vector3()
  private readonly ray = new THREE.Raycaster()
  private traceOn = false
  private traceArr: Array<{ t: number; open: number; clipT: number; x: number; drag: number }> = []
  private lastPointerX = -1
  private movedThisFrame = false
  private clipDisplay = 0
  /** 紙見本の上で始まったドラッグが、色選びなのか紙を開く操作なのかの見分け */
  private swatchMoved = 0
  private readonly ndc = new THREE.Vector2()

  constructor(opts: AppOptions) {
    this.canvas = opts.canvas
    this.hud = opts.hud
    this.clock = opts.clock ?? new RealClock()
    const search = opts.search ?? (typeof location !== 'undefined' ? location.search : '')
    const seed = seedFromLocation(search)

    const gl = this.canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' })
    if (!gl) throw new Error('WebGL2 が使えません')
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, context: gl, antialias: true })
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.0
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap

    this.scene.background = new THREE.Color(0x2a2723)

    this.mats = createMaterials(seed)
    this.workshop = createWorkshop(this.mats, seed)
    this.scene.add(this.workshop.group)

    this.tree = new HoneycombTree(this.mats)
    this.scene.add(this.tree.group)

    this.clip = new Clip(this.mats)
    this.scene.add(this.clip.group)

    this.swatches = new Swatches()
    this.scene.add(this.swatches.group)

    // 金属に映り込む環境。外部画像は使わず、その場で生成する。
    this.pmrem = new THREE.PMREMGenerator(this.renderer)
    this.envRT = this.pmrem.fromScene(new RoomEnvironment(), 0.04)
    this.scene.environment = this.envRT.texture
    this.scene.environmentIntensity = 0.30

    this.hint = this.hud.querySelector('#hint') as HTMLElement
    this.muteBtn = this.hud.querySelector('#mute') as HTMLButtonElement
    this.muteBtn.addEventListener('click', () => {
      this.sound.start()
      this.store.setMuted(!this.store.muted)
      this.sound.setMuted(this.store.muted)
      this.muteBtn.dataset.muted = String(this.store.muted)
      this.muteBtn.setAttribute('aria-label', this.store.muted ? 'おとを だす' : 'おとを けす')
    })

    this.input = new PointerInput(this.canvas, {
      hitTest: (x, y) => this.hitTest(x, y),
      onStart: (t, x, y) => this.onDragStart(t, x, y),
      onMove: (t, x, y, dx, dy, dt) => this.onDragMove(t, x, y, dx, dy, dt),
      onEnd: (t, vx, x, y) => this.onDragEnd(t, vx, x, y),
      onFirstGesture: () => {
        this.sound.start()
        this.sound.setMuted(this.store.muted)
      },
    })

    const m = /(?:^|[?&])open=([0-9.]+)/.exec(search)
    if (m) this.store.forceOpen(Number(m[1]))
    if (/(?:^|[?&])dev=1/.test(search)) void this.enableDevCamera()
    // 画面証拠の撮影では品質の自動調整を止め、背景と影を常に出す
    this.fixedQuality = /(?:^|[?&])fixq=1/.test(search)
    this.lite = /(?:^|[?&])lite=1/.test(search)
    if (this.lite) {
      this.fixedQuality = true
      this.renderer.shadowMap.enabled = false
      this.workshop.background.visible = false
    }

    this.resize()
    this.tree.setOpen(this.store.open)
  }

  private async enableDevCamera(): Promise<void> {
    const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js')
    const c = new OrbitControls(this.rig.camera, this.canvas)
    c.target.set(0, 0.14, 0)
    c.enableDamping = true
    this.devControls = c
    ;(window as unknown as { __dev: unknown }).__dev = {
      view: (name: 'front' | 'side' | 'back' | 'top') => {
        const d = 0.62
        const p: Record<string, [number, number, number]> = {
          front: [0.05, 0.24, -d],
          side: [d, 0.22, 0.02],
          back: [-0.02, 0.24, d],
          top: [0.02, d, 0.06],
        }
        c.object.position.set(...p[name])
        c.target.set(0, name === 'top' ? 0.12 : 0.14, 0)
        c.update()
      },
    }
  }

  // ---- 入力 --------------------------------------------------------------

  private project(v: THREE.Vector3, out: THREE.Vector2): THREE.Vector2 {
    this.v3.copy(v).project(this.rig.camera)
    out.set(((this.v3.x + 1) / 2) * this.cssW, ((1 - this.v3.y) / 2) * this.cssH)
    return out
  }

  private readonly p2 = new THREE.Vector2()

  private frontBandTop(): number {
    return this.cssH - Math.max(120, this.cssH * 0.26)
  }

  private hitTest(x: number, y: number): DragTarget | null {
    if (this.store.everCompleted && this.swatchAt(x, y) !== null) return 'swatch'
    if (this.store.canClip() || this.store.clipAttached) {
      this.clip.worldPosition(this.v1)
      const p = this.project(this.v1, this.p2)
      if (Math.hypot(p.x - x, p.y - y) < CLIP_RADIUS) return 'clip'
    }
    if (this.store.clipAttached) return null
    this.tree.tabWorldPosition(this.v1)
    const p = this.project(this.v1, this.p2)
    if (Math.hypot(p.x - x, p.y - y) < GRAB_RADIUS) return 'tree'
    // 手前の広いドラッグ領域は端台紙の代理。指で開くセルを隠さない位置に置く。
    if (y >= this.frontBandTop()) return 'tree'
    return null
  }

  private swatchAt(x: number, y: number): PaperColor | null {
    if (!this.swatches.group.visible) return null
    this.ndc.set((x / this.cssW) * 2 - 1, -(y / this.cssH) * 2 + 1)
    this.ray.setFromCamera(this.ndc, this.rig.camera)
    const hits = this.ray.intersectObjects(this.swatches.tiles, false)
    if (hits.length === 0) return null
    return hits[0].object.userData.colorIndex as PaperColor
  }

  private onDragStart(target: DragTarget, x: number, y: number): void {
    this.idle = 0
    this.lastPointerX = x
    this.hint.classList.remove('show')
    if (target === 'clip') {
      this.clipGrabOffset = this.store.clipT - this.nearestClipParam(x, y)
    } else if (target === 'swatch') {
      this.swatchMoved = 0
    }
  }

  private nearestClipParam(x: number, y: number): number {
    let best = 0
    let bestD = Infinity
    for (let i = 0; i <= 24; i++) {
      const k = i / 24
      this.clip.positionAt(k, this.v1)
      const p = this.project(this.v1, this.p2)
      const d = Math.hypot(p.x - x, p.y - y)
      if (d < bestD) {
        bestD = d
        best = k
      }
    }
    return best
  }

  private onDragMove(target: DragTarget, x: number, y: number, dx: number, _dy: number, dt: number): void {
    this.idle = 0
    this.lastPointerX = x
    this.movedThisFrame = true
    if (target === 'tree') {
      // 画面右へ引くと開く。短いストロークを継ぎ足せる。方向はいつも同じ。
      this.store.applyDrag(dx * this.openPerPx, dt)
    } else if (target === 'clip') {
      const want = this.nearestClipParam(x, y) + this.clipGrabOffset
      this.store.applyClipDrag(want - this.store.clipT)
    } else if (target === 'swatch') {
      // 紙見本は手前の操作帯の中にある。触ってすぐ動かしたなら、それは色選びではなく
      // 紙を開く操作なので、そのまま開閉に渡す。
      this.swatchMoved += Math.abs(dx) + Math.abs(_dy)
      if (this.swatchMoved > SWATCH_TAP_SLOP) this.store.applyDrag(dx * this.openPerPx, dt)
    }
  }

  private onDragEnd(target: DragTarget, vx: number, x: number, y: number): void {
    if (target === 'tree') {
      this.store.releaseDrag(vx * this.openPerPx)
    } else if (target === 'clip') {
      if (this.store.releaseClip()) this.sound.click()
    } else if (target === 'swatch') {
      if (this.swatchMoved > SWATCH_TAP_SLOP) {
        this.store.releaseDrag(vx * this.openPerPx)
        return
      }
      const c = this.swatchAt(x, y)
      if (c !== null) {
        this.store.setPaperColor(c)
        this.tree.setPaperColor(PAPER_COLORS[c].hex)
        this.swatches.setSelected(c)
      }
    }
  }

  // ---- ループ ------------------------------------------------------------

  resize(): void {
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth)
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight)
    this.cssW = w
    this.cssH = h
    this.openPerPx = 1 / Math.min(820, Math.max(400, w * 1.35))
    this.rig.setViewport(w, h)
    const dpr = this.lite ? 0.32 : Math.min(this.baseDpr, window.devicePixelRatio || 1)
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(w, h, false)
  }

  start(): void {
    const loop = () => {
      if (this.disposed) return
      this.raf = requestAnimationFrame(loop)
      this.frame()
    }
    this.raf = requestAnimationFrame(loop)
  }

  frame(): void {
    const dt = this.clock.step()
    if (!this.input.isDragging) this.store.settle(dt)
    else if (!this.movedThisFrame) this.store.decaySpeed(dt)
    this.movedThisFrame = false
    this.tree.setOpen(this.store.open)

    this.tree.seamAnchor(SPEC.H * 0.42, this.v1, this.v2)
    this.clip.setTarget(this.v1, this.v2)
    // クリップは常に机の上にある。留められないうちは掴めないだけで、出たり消えたりしない。
    this.clipDisplay += (this.store.clipT - this.clipDisplay) * (1 - Math.exp(-dt / 0.07))
    if (Math.abs(this.store.clipT - this.clipDisplay) < 1e-4) this.clipDisplay = this.store.clipT
    this.clip.setProgress(this.clipDisplay)

    this.swatches.group.visible = this.store.everClipped
    this.rig.setPulledBack(this.store.clipAttached)
    // 開発用の視点確認中は作業カメラの復元を止める（通常プレイでは常に固定カメラ）
    if (!this.devControls) this.rig.update(dt)

    this.sound.setRustle(this.store.openSpeed)
    this.updateHint(dt)
    this.devControls?.update()
    if (this.traceOn && this.traceArr.length < 4000) {
      this.traceArr.push({
        t: this.clock.now(),
        open: this.store.open,
        clipT: this.store.clipT,
        x: this.lastPointerX,
        drag: this.input.isDragging ? 1 : 0,
      })
    }
    this.renderer.render(this.scene, this.rig.camera)
    this.adapt(dt)
  }

  private updateHint(dt: number): void {
    if (this.input.isDragging) {
      this.idle = 0
      return
    }
    this.idle += dt
    const wantTab = this.store.open < 0.03 && !this.store.clipAttached
    const wantClip = this.store.canClip() && this.store.clipT < 0.05
    const want = (wantTab || wantClip) && this.idle > HINT_IDLE
    if (!want) {
      this.hint.classList.remove('show')
      return
    }
    if (wantClip) this.clip.worldPosition(this.v1)
    else this.tree.tabWorldPosition(this.v1)
    const p = this.project(this.v1, this.p2)
    this.hint.style.transform = `translate(${p.x - 26}px, ${p.y - 62}px)`
    this.hint.classList.add('show')
  }

  /** 計測して段階的に削る: 背景 → 影の解像度 → 描画解像度。セル構造と入力応答は残す。 */
  private adapt(dt: number): void {
    if (this.fixedQuality) return
    this.frameAcc += dt
    this.frames++
    if (this.frames < 70) return
    const fps = this.frames / this.frameAcc
    this.frames = 0
    this.frameAcc = 0
    if (fps < 27 && this.degrade < 3) {
      this.degrade++
      this.applyDegrade()
    } else if (fps > 55 && this.degrade > 0) {
      this.degrade--
      this.applyDegrade()
    }
  }

  private applyDegrade(): void {
    this.workshop.background.visible = this.degrade < 1
    const size = this.degrade >= 2 ? 512 : 1024
    if (this.workshop.sun.shadow.mapSize.x !== size) {
      this.workshop.sun.shadow.mapSize.setScalar(size)
      this.workshop.sun.shadow.map?.dispose()
      this.workshop.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget
    }
    this.baseDpr = this.degrade >= 3 ? 1.0 : 1.5
    this.resize()
  }

  startTrace(): void {
    this.traceOn = true
    this.traceArr = []
  }

  trace(): Array<{ t: number; open: number; clipT: number; x: number; drag: number }> {
    return this.traceArr
  }

  /** 紙見本の画面座標（検査用） */
  swatchScreen(i: number, out: THREE.Vector2): THREE.Vector2 {
    return this.project(this.swatches.tiles[i].position, out)
  }

  /** クリップ経路上の点の画面座標（検査用） */
  clipScreenAt(k: number, out: THREE.Vector2): THREE.Vector2 {
    this.clip.positionAt(k, this.v1)
    return this.project(this.v1, out)
  }

  get viewportCss(): { w: number; h: number } {
    return { w: this.cssW, h: this.cssH }
  }

  stats(): { triangles: number; calls: number; geometries: number; textures: number; programs: number } {
    const i = this.renderer.info
    return {
      triangles: i.render.triangles,
      calls: i.render.calls,
      geometries: i.memory.geometries,
      textures: i.memory.textures,
      programs: i.programs?.length ?? 0,
    }
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.input.dispose()
    this.devControls?.dispose()
    this.tree.dispose()
    this.clip.dispose()
    this.swatches.dispose()
    this.workshop.dispose()
    this.mats.dispose()
    this.envRT.dispose()
    this.pmrem.dispose()
    this.sound.dispose()
    this.renderer.dispose()
  }
}

export { OPEN_COMPLETE }
