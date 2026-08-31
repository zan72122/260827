import { Vector2 as Vector2Ctor, Vector3 as Vector3Ctor } from 'three'
import { App } from './app'

const canvas = document.getElementById('view') as HTMLCanvasElement
const hud = document.getElementById('hud') as HTMLElement
const boot = document.getElementById('boot') as HTMLElement
const fallback = document.getElementById('fallback') as HTMLElement
const fallbackMsg = document.getElementById('fallback-msg') as HTMLElement
const retry = document.getElementById('retry') as HTMLButtonElement

let app: App | null = null

function fail(err: unknown): void {
  boot.classList.add('done')
  fallbackMsg.textContent =
    err instanceof Error && /WebGL2/.test(err.message)
      ? 'この ブラウザでは えが だせません'
      : 'よみこみに しっぱいしました'
  fallback.classList.add('show')
  // eslint-disable-next-line no-console
  console.error(err)
}

function boot_(): void {
  fallback.classList.remove('show')
  try {
    app?.dispose()
    app = new App({ canvas, hud })
    app.start()
    ;(window as unknown as { __game: unknown }).__game = makeTestApi(app)
    requestAnimationFrame(() => boot.classList.add('done'))
  } catch (err) {
    app = null
    fail(err)
  }
}

function makeTestApi(a: App) {
  return {
    state: () => a.store.snapshot(),
    stats: () => a.stats(),
    startTrace: () => a.startTrace(),
    trace: () => a.trace(),
    swatchScreen: (i: number) => {
      const v = new Vector2Ctor()
      a.swatchScreen(i, v)
      return { x: v.x, y: v.y }
    },
    clipScreenAt: (k: number) => {
      const v = new Vector2Ctor()
      a.clipScreenAt(k, v)
      return { x: v.x, y: v.y }
    },
    /** 検査用: 展開量を直接置く。通常プレイの経路ではない。 */
    setOpen: (v: number) => {
      a.store.forceOpen(v)
      a.frame()
    },
    setClip: (v: number) => {
      a.store.applyClipDrag(v - a.store.clipT)
      a.frame()
    },
    releaseClip: () => a.store.releaseClip(),
    frame: () => a.frame(),
    tabScreen: () => {
      const v = new Vector3Ctor()
      a.tree.tabWorldPosition(v)
      v.project(a.rig.camera)
      return {
        x: ((v.x + 1) / 2) * (canvas.clientWidth || window.innerWidth),
        y: ((1 - v.y) / 2) * (canvas.clientHeight || window.innerHeight),
      }
    },
    clipScreen: () => {
      const v = new Vector3Ctor()
      a.clip.worldPosition(v)
      v.project(a.rig.camera)
      return {
        x: ((v.x + 1) / 2) * (canvas.clientWidth || window.innerWidth),
        y: ((1 - v.y) / 2) * (canvas.clientHeight || window.innerHeight),
      }
    },
    frontBandY: () => (canvas.clientHeight || window.innerHeight) - Math.max(120, (canvas.clientHeight || window.innerHeight) * 0.26) / 2,
  }
}

retry.addEventListener('click', boot_)
window.addEventListener('resize', () => app?.resize())
window.addEventListener('orientationchange', () => setTimeout(() => app?.resize(), 60))
window.addEventListener('error', (e) => {
  if (!app) fail(e.error ?? new Error(e.message))
})

boot_()
