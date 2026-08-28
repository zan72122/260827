/**
 * One-finger gesture layer. Everything the game needs (tap, drag, swipe with
 * velocity, press-and-hold, circular winding) is derived from a single active
 * pointer, so no step ever requires a second finger or a device shake.
 */

export interface Ptr {
  /** CSS pixels, canvas-relative. */
  x: number
  y: number
  /** Normalised device coords for raycasting. */
  nx: number
  ny: number
  /** Delta since the previous move event, CSS px. */
  dx: number
  dy: number
  /** Low-passed velocity, CSS px per second. */
  vx: number
  vy: number
  downX: number
  downY: number
  /** Seconds since pointerdown. */
  age: number
  /** Total path length travelled, CSS px. */
  travel: number
}

export type PtrEvent = 'down' | 'move' | 'up' | 'tap' | 'hold' | 'holdend'
type Handler = (p: Ptr) => void

const TAP_SLOP = 14
const TAP_TIME = 0.45
const HOLD_TIME = 0.2

export class Input {
  readonly ptr: Ptr = {
    x: 0, y: 0, nx: 0, ny: 0, dx: 0, dy: 0, vx: 0, vy: 0,
    downX: 0, downY: 0, age: 0, travel: 0,
  }

  down = false
  holding = false

  private handlers = new Map<PtrEvent, Set<Handler>>()
  private id: number | null = null
  private downT = 0
  private lastT = 0
  private holdTimer = 0

  constructor(private el: HTMLElement) {
    el.addEventListener('pointerdown', this.onDown, { passive: false })
    el.addEventListener('pointermove', this.onMove, { passive: false })
    el.addEventListener('pointerup', this.onUp, { passive: false })
    el.addEventListener('pointercancel', this.onUp, { passive: false })
    el.addEventListener('contextmenu', this.block)
    el.addEventListener('touchstart', this.block, { passive: false })
  }

  dispose() {
    this.el.removeEventListener('pointerdown', this.onDown)
    this.el.removeEventListener('pointermove', this.onMove)
    this.el.removeEventListener('pointerup', this.onUp)
    this.el.removeEventListener('pointercancel', this.onUp)
    this.el.removeEventListener('contextmenu', this.block)
    this.el.removeEventListener('touchstart', this.block)
    this.handlers.clear()
    window.clearTimeout(this.holdTimer)
  }

  on(type: PtrEvent, fn: Handler): () => void {
    let set = this.handlers.get(type)
    if (!set) this.handlers.set(type, (set = new Set()))
    set.add(fn)
    return () => set!.delete(fn)
  }

  /** Drops every subscriber — used when a stage hands over to the next. */
  clear() {
    this.handlers.clear()
  }

  private emit(type: PtrEvent) {
    const set = this.handlers.get(type)
    if (!set) return
    for (const fn of [...set]) fn(this.ptr)
  }

  private block = (e: Event) => {
    // Prevents Safari's double-tap zoom and long-press callout on the canvas.
    if (e.cancelable) e.preventDefault()
  }

  private read(e: PointerEvent) {
    const r = this.el.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    const p = this.ptr
    p.dx = x - p.x
    p.dy = y - p.y
    p.x = x
    p.y = y
    p.nx = (x / Math.max(1, r.width)) * 2 - 1
    p.ny = -(y / Math.max(1, r.height)) * 2 + 1
  }

  private onDown = (e: PointerEvent) => {
    if (this.id !== null) return
    if (e.cancelable) e.preventDefault()
    this.id = e.pointerId
    this.el.setPointerCapture?.(e.pointerId)
    this.read(e)
    const p = this.ptr
    p.dx = p.dy = p.vx = p.vy = 0
    p.downX = p.x
    p.downY = p.y
    p.age = 0
    p.travel = 0
    this.down = true
    this.downT = this.lastT = performance.now()
    this.emit('down')
    window.clearTimeout(this.holdTimer)
    this.holdTimer = window.setTimeout(() => {
      if (this.down && this.ptr.travel < TAP_SLOP) {
        this.holding = true
        this.emit('hold')
      }
    }, HOLD_TIME * 1000)
  }

  private onMove = (e: PointerEvent) => {
    if (this.id !== e.pointerId) return
    if (e.cancelable) e.preventDefault()
    const now = performance.now()
    const dt = Math.max(1e-3, (now - this.lastT) / 1000)
    this.lastT = now
    this.read(e)
    const p = this.ptr
    p.age = (now - this.downT) / 1000
    p.travel += Math.hypot(p.dx, p.dy)
    // Exponential smoothing keeps flick velocity readable without spikes.
    const k = Math.min(1, dt * 18)
    p.vx += (p.dx / dt - p.vx) * k
    p.vy += (p.dy / dt - p.vy) * k
    this.emit('move')
  }

  private onUp = (e: PointerEvent) => {
    if (this.id !== e.pointerId) return
    if (e.cancelable) e.preventDefault()
    window.clearTimeout(this.holdTimer)
    this.read(e)
    const p = this.ptr
    p.age = (performance.now() - this.downT) / 1000
    this.id = null
    this.down = false
    this.el.releasePointerCapture?.(e.pointerId)
    if (this.holding) {
      this.holding = false
      this.emit('holdend')
    }
    this.emit('up')
    if (p.travel < TAP_SLOP && p.age < TAP_TIME) this.emit('tap')
    p.vx = p.vy = 0
  }
}

/** Accumulates signed turn around a screen point — used to tighten the collar. */
export class Winder {
  private last = 0
  private started = false
  /** Total signed radians wound since begin(). */
  total = 0

  begin() {
    this.started = false
    this.total = 0
  }

  feed(px: number, py: number, cx: number, cy: number): number {
    const a = Math.atan2(py - cy, px - cx)
    if (!this.started) {
      this.started = true
      this.last = a
      return 0
    }
    let d = a - this.last
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    this.last = a
    this.total += d
    return d
  }
}
