import * as THREE from 'three'
import { CameraRig } from '../camera/rig'
import { Atelier, LAMP_DIR, WINDOW_DIR } from '../world/atelier'
import { GlobeRig } from '../world/globe'
import { createMaterials, type MatKit } from '../world/materials'
import { disposeTextures } from '../world/textures'
import { Audio } from './audio'
import { Input } from './input'
import { makeQuality, type Quality } from './quality'
import { BuildState, type Settings } from './state'
import { loadSettings, saveSettings } from './storage'
import { Hud } from '../ui/hud'
import { Flow } from '../stages/flow'

/** World size of one unit of a particle's `aSize` attribute, in metres. */
const FLAKE_UNIT = 0.0011

export class App {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly rig = new CameraRig()
  readonly input: Input
  readonly audio = new Audio()
  readonly hud: Hud
  readonly quality: Quality
  readonly build = new BuildState()

  mats: MatKit
  atelier: Atelier
  globe: GlobeRig
  settings: Settings

  private flow: Flow
  private raf = 0
  private last = 0
  private running = false
  private sized = { w: 0, h: 0, dpr: 0 }
  private resizePending = false

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    })
    this.quality = makeQuality(this.renderer.getContext())
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.22
    this.renderer.shadowMap.enabled = this.quality.shadows
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.setClearColor(0x191d23, 1)

    this.scene.fog = new THREE.Fog(0x2b3038, 4.2, 11)

    this.settings = loadSettings()
    this.audio.enabled = this.settings.sound

    this.mats = createMaterials()
    this.atelier = new Atelier(this.mats, {
      shadows: this.quality.shadows,
      shadowMapSize: this.quality.shadowMapSize,
      shelfGeometry: this.quality.shelfGeometry,
    })
    this.scene.add(this.atelier.group)

    this.globe = new GlobeRig(this.mats, this.quality, this.build.recipe.seed)
    this.globe.glass.setEnvironment(WINDOW_DIR, LAMP_DIR)
    this.scene.add(this.globe.root, this.globe.worldFx)

    this.input = new Input(canvas)
    this.hud = new Hud((patch) => this.applySettings(patch))
    this.hud.buildSettings(this.settings, motionAvailable())

    this.flow = new Flow(this)

    window.addEventListener('resize', this.onResize)
    window.addEventListener('orientationchange', this.onResize)
    document.addEventListener('visibilitychange', this.onVisibility)
    this.resize()
  }

  get camera(): THREE.PerspectiveCamera {
    return this.rig.camera
  }

  start() {
    if (this.running) return
    this.running = true
    // Audio waits for the first real touch; iOS will not start it otherwise.
    this.last = performance.now()
    this.flow.begin()
    this.raf = requestAnimationFrame(this.frame)
  }

  /** Rebuilds the globe from scratch without touching the renderer. */
  rebuildGlobe(seed: number) {
    this.scene.remove(this.globe.root, this.globe.worldFx)
    this.globe.dispose()
    this.globe = new GlobeRig(this.mats, this.quality, seed)
    this.globe.glass.setEnvironment(WINDOW_DIR, LAMP_DIR)
    this.globe.onBubblePop = () => this.audio.bubble()
    this.scene.add(this.globe.root, this.globe.worldFx)
    this.applyPointScale()
  }

  applySettings(patch: Partial<Settings>) {
    this.settings = { ...this.settings, ...patch }
    saveSettings(this.settings)
    this.audio.enabled = this.settings.sound
    if (!this.settings.sound) this.audio.stopBeds()
    this.rig.travel = this.settings.calmCamera ? 0.45 : 1
    this.flow.onSettings()
    if (patch.motionShake) void requestMotion()
  }

  private onVisibility = () => {
    if (document.hidden) {
      this.audio.suspend()
      this.audio.stopBeds()
    } else {
      this.audio.resume()
      this.last = performance.now()
    }
  }

  private onResize = () => {
    if (this.resizePending) return
    this.resizePending = true
    // Safari reports stale metrics during the rotation animation; one frame of
    // slack is enough and avoids rebuilding anything at all.
    requestAnimationFrame(() => {
      this.resizePending = false
      this.resize()
    })
  }

  resize() {
    const w = Math.max(1, Math.round(this.canvas.clientWidth || window.innerWidth))
    const h = Math.max(1, Math.round(this.canvas.clientHeight || window.innerHeight))
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality.maxDpr)
    if (w === this.sized.w && h === this.sized.h && dpr === this.sized.dpr) return
    this.sized = { w, h, dpr }
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(w, h, false)
    this.rig.setAspect(w / h)
    this.flow.onLayout(w / h)
    this.applyPointScale()
  }

  /** Keeps a flake the same physical size whatever the screen or the FOV. */
  applyPointScale() {
    const h = this.renderer.domElement.height || 800
    const fov = THREE.MathUtils.degToRad(this.camera.fov)
    this.globe.setPointScale((FLAKE_UNIT * h) / Math.tan(fov / 2))
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame)
    const dt = Math.min(0.05, Math.max(0.0005, (now - this.last) / 1000))
    this.last = now

    this.flow.update(dt)
    this.rig.update(dt)
    this.applyPointScale()
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.running = false
    window.removeEventListener('resize', this.onResize)
    window.removeEventListener('orientationchange', this.onResize)
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.input.dispose()
    this.flow.dispose()
    this.globe.dispose()
    this.atelier.dispose()
    this.mats.dispose()
    disposeTextures()
    this.renderer.dispose()
  }
}

type MotionCtor = typeof DeviceMotionEvent & { requestPermission?: () => Promise<PermissionState> }

export function motionAvailable(): boolean {
  return typeof DeviceMotionEvent !== 'undefined'
}

/** Optional extra only: every step is completable with touch alone. */
export async function requestMotion(): Promise<boolean> {
  const C = (globalThis as unknown as { DeviceMotionEvent?: MotionCtor }).DeviceMotionEvent
  if (!C) return false
  if (typeof C.requestPermission !== 'function') return true
  try {
    return (await C.requestPermission()) === 'granted'
  } catch {
    return false
  }
}
