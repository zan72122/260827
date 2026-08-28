/**
 * Pointer gestures. Everything the child does is one of: drag the guide
 * sideways, swipe the rig down, hold still, flick up, or press and hold
 * the reel. Targets are deliberately huge -- the whole screen drives the
 * guide, and the reel accepts anything within a fat radius of the button.
 */
export interface GestureState {
  active: boolean
  x: number
  y: number
  startX: number
  startY: number
  dx: number
  dy: number
  totalDx: number
  totalDy: number
  duration: number
  /** px/s at release */
  vx: number
  vy: number
  held: boolean
}

export class Input {
  readonly state: GestureState = {
    active: false, x: 0, y: 0, startX: 0, startY: 0, dx: 0, dy: 0,
    totalDx: 0, totalDy: 0, duration: 0, vx: 0, vy: 0, held: false,
  }
  onDown?: (x: number, y: number) => void
  onMove?: (s: GestureState) => void
  onUp?: (s: GestureState) => void
  onHold?: (x: number, y: number) => void

  private startTime = 0
  private lastTime = 0
  private lastX = 0
  private lastY = 0
  private holdTimer = 0
  private pointerId: number | null = null

  constructor(private el: HTMLElement) {
    el.addEventListener('pointerdown', this.down, { passive: false })
    el.addEventListener('pointermove', this.move, { passive: false })
    el.addEventListener('pointerup', this.up, { passive: false })
    el.addEventListener('pointercancel', this.up, { passive: false })
    el.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  private down = (e: PointerEvent) => {
    if (this.pointerId !== null) return
    e.preventDefault()
    this.pointerId = e.pointerId
    this.el.setPointerCapture(e.pointerId)
    const s = this.state
    s.active = true
    s.held = false
    s.x = s.startX = this.lastX = e.clientX
    s.y = s.startY = this.lastY = e.clientY
    s.dx = s.dy = s.totalDx = s.totalDy = s.vx = s.vy = 0
    s.duration = 0
    this.startTime = this.lastTime = performance.now()
    this.holdTimer = window.setTimeout(() => {
      if (s.active && Math.hypot(s.totalDx, s.totalDy) < 26) {
        s.held = true
        this.onHold?.(s.x, s.y)
      }
    }, 200)
    this.onDown?.(s.x, s.y)
  }

  private move = (e: PointerEvent) => {
    if (this.pointerId !== e.pointerId) return
    e.preventDefault()
    const s = this.state
    const now = performance.now()
    const dt = Math.max(1, now - this.lastTime) / 1000
    s.dx = e.clientX - this.lastX
    s.dy = e.clientY - this.lastY
    s.vx = s.dx / dt
    s.vy = s.dy / dt
    s.x = e.clientX
    s.y = e.clientY
    s.totalDx = s.x - s.startX
    s.totalDy = s.y - s.startY
    s.duration = (now - this.startTime) / 1000
    this.lastX = s.x
    this.lastY = s.y
    this.lastTime = now
    this.onMove?.(s)
  }

  private up = (e: PointerEvent) => {
    if (this.pointerId !== e.pointerId) return
    e.preventDefault()
    clearTimeout(this.holdTimer)
    const s = this.state
    s.duration = (performance.now() - this.startTime) / 1000
    s.active = false
    this.pointerId = null
    this.onUp?.(s)
    s.held = false
    s.dx = s.dy = 0
  }

  /** Zero the per-frame deltas after the game has consumed them. */
  consume() {
    this.state.dx = 0
    this.state.dy = 0
  }
}
