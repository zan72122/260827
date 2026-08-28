import * as THREE from 'three'
import { CameraRig } from './CameraRig'
import { Input } from './Input'
import { GameAudio } from './Audio'
import { createSky, SUN_DIR } from '../scene/Sky'
import { SeaSurface, createMurk, createSeabed, WATER_Y } from '../scene/Water'
import { buildHarbor } from '../scene/Harbor'
import { Game, type Quality } from '../game/Game'

function pickQuality(): Quality {
  const mem = (navigator as any).deviceMemory ?? 4
  const cores = navigator.hardwareConcurrency ?? 4
  // WebGPU-capable hardware gets the enhanced tier: more krill in the
  // water and a bigger shoal. Everything below runs the same WebGL 2 path.
  if ('gpu' in navigator && mem >= 4) return { particles: 150, fish: 96, shadows: true, label: 'enhanced' }
  if (mem <= 2 || cores <= 4) return { particles: 55, fish: 44, shadows: false, label: 'light' }
  return { particles: 95, fish: 66, shadows: true, label: 'standard' }
}

export class App {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly rig: CameraRig
  readonly game: Game
  readonly audio = new GameAudio()
  readonly quality: Quality
  private sea: SeaSurface
  private sun: THREE.DirectionalLight
  private input: Input
  private dprCap: number
  private dpr: number
  private frameAcc = 0
  private frameCount = 0
  private lastT = 0
  private far: THREE.Group | null = null
  private running = false
  fps = 60

  constructor(canvas: HTMLCanvasElement, touch: HTMLElement) {
    this.quality = pickQuality()
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this.quality.label !== 'light',
      powerPreference: 'high-performance',
      stencil: false,
    })
    this.dprCap = Math.min(window.devicePixelRatio || 1, this.quality.label === 'light' ? 1.5 : 2)
    this.dpr = this.dprCap
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.shadowMap.enabled = this.quality.shadows
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap

    const sky = createSky()
    this.scene.add(sky)
    // one PMREM pass over the sky dome: without it every metal surface in
    // the scene renders black
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    const skyScene = new THREE.Scene()
    const skyProbe = sky.clone()
    skyScene.add(skyProbe)
    const env = pmrem.fromScene(skyScene, 0, 0.1, 1000)
    this.scene.environment = env.texture
    this.scene.environmentIntensity = 0.85
    pmrem.dispose()
    skyProbe.geometry.dispose()
    this.sea = new SeaSurface()
    this.scene.add(this.sea.mesh)

    // morning sun, low over the water, plus sky and ground bounce
    this.sun = new THREE.DirectionalLight(0xffe3bd, 2.45)
    this.sun.position.copy(SUN_DIR).multiplyScalar(12).add(new THREE.Vector3(0, 0.9, 0.8))
    this.sun.target.position.set(0, 0.9, 0.8)
    this.scene.add(this.sun, this.sun.target)
    if (this.quality.shadows) {
      this.sun.castShadow = true
      const c = this.sun.shadow.camera
      c.left = -2.4; c.right = 2.4; c.top = 2.4; c.bottom = -2.4
      c.near = 1; c.far = 22
      this.sun.shadow.mapSize.set(1024, 1024)
      this.sun.shadow.bias = -0.0012
      this.sun.shadow.normalBias = 0.012
    }
    const hemi = new THREE.HemisphereLight(0xa9bccb, 0x6b6658, 1.15)
    this.scene.add(hemi)
    // sky fill from the landward side: the near field is backlit by a low
    // sun over the water and would otherwise read as a black box
    const fill = new THREE.DirectionalLight(0xbcccd6, 0.55)
    fill.position.set(3.0, 2.0, -4.0)
    this.scene.add(fill)
    const bounce = new THREE.DirectionalLight(0xa89e88, 0.30)
    bounce.position.set(1.5, -2.0, 1.0)
    this.scene.add(bounce)

    this.rig = new CameraRig(window.innerWidth / window.innerHeight)
    this.input = new Input(touch)
    this.game = new Game(this.scene, this.rig, this.input, this.audio, this.quality)

    window.addEventListener('resize', this.onResize)
    window.addEventListener('orientationchange', this.onResize)
  }

  /** Far field and the water column arrive after the seat is playable. */
  loadFarField() {
    if (this.far) return
    this.far = buildHarbor()
    this.scene.add(this.far)
    this.scene.add(createMurk())
    this.scene.add(createSeabed())
    this.game.school.activateAll()
  }

  startGame() {
    this.audio.init()
    this.audio.resume()
    this.game.start()
  }

  private onResize = () => {
    const w = window.innerWidth, h = window.innerHeight
    this.renderer.setSize(w, h)
    this.rig.resize(w / h)
  }

  run() {
    if (this.running) return
    this.running = true
    this.lastT = performance.now()
    const loop = (now: number) => {
      requestAnimationFrame(loop)
      const dt = Math.min(0.05, (now - this.lastT) / 1000)
      this.lastT = now
      const t0 = performance.now()
      this.game.update(dt, window.innerWidth / window.innerHeight)
      // the surface must draw behind the krill when the camera is under it
      this.sea.mesh.renderOrder = this.rig.camera.position.y < WATER_Y ? -50 : 10
      this.renderer.render(this.scene, this.rig.camera)
      this.adapt(performance.now() - t0)
      this.fps = this.fps * 0.9 + (1 / Math.max(0.001, dt)) * 0.1
      this.input.consume()
    }
    requestAnimationFrame(loop)
  }

  /** Adaptive resolution: hold the frame budget before anything else. */
  private adapt(ms: number) {
    this.frameAcc += ms
    this.frameCount++
    if (this.frameCount < 45) return
    const avg = this.frameAcc / this.frameCount
    this.frameAcc = 0
    this.frameCount = 0
    if (avg > 20 && this.dpr > 1.0) {
      this.dpr = Math.max(1.0, this.dpr - 0.2)
      this.renderer.setPixelRatio(this.dpr)
    } else if (avg < 11 && this.dpr < this.dprCap) {
      this.dpr = Math.min(this.dprCap, this.dpr + 0.15)
      this.renderer.setPixelRatio(this.dpr)
    }
  }
}
