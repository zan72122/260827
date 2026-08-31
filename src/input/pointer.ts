export type DragTarget = 'tree' | 'clip' | 'swatch'

export interface DragHandlers {
  /** CSS px 座標。掴めるものが無ければ null。 */
  hitTest(x: number, y: number): DragTarget | null
  onStart(target: DragTarget, x: number, y: number): void
  onMove(target: DragTarget, x: number, y: number, dx: number, dy: number, dt: number): void
  onEnd(target: DragTarget, vx: number, x: number, y: number): void
  /** 最初の明示的な操作。音声の開始などに使う。 */
  onFirstGesture(): void
}

interface Active {
  id: number
  target: DragTarget
  x: number
  y: number
  t: number
  vx: number
  moved: number
}

/**
 * Pointer Events + pointer capture。
 * pointercancel、画面外への移動、途中の持ち替え、二本目の指を扱う。
 * スクロール抑止は操作面（canvas）だけに掛ける。
 */
export class PointerInput {
  private active: Active | null = null
  private readonly down = new Map<number, { x: number; y: number }>()
  private firstDone = false
  private readonly bound: Array<[string, EventListener]> = []

  constructor(
    private readonly el: HTMLElement,
    private readonly h: DragHandlers,
  ) {
    const on = (type: string, fn: (e: PointerEvent) => void) => {
      const l = fn as unknown as EventListener
      el.addEventListener(type, l, { passive: false })
      this.bound.push([type, l])
    }
    on('pointerdown', (e) => this.onDown(e))
    on('pointermove', (e) => this.onMove(e))
    on('pointerup', (e) => this.onUp(e, false))
    on('pointercancel', (e) => this.onUp(e, true))
    on('lostpointercapture', (e) => this.onLost(e))
    const vis = () => {
      if (document.hidden && this.active) this.finish(true)
    }
    document.addEventListener('visibilitychange', vis)
    this.bound.push(['__doc_visibilitychange', vis as unknown as EventListener])
  }

  private local(e: PointerEvent): { x: number; y: number } {
    const r = this.el.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  private onDown(e: PointerEvent): void {
    const p = this.local(e)
    this.down.set(e.pointerId, p)
    if (!this.firstDone) {
      this.firstDone = true
      this.h.onFirstGesture()
    }
    if (this.active) return // 二本目の指は掴み替え用に覚えるだけ
    const target = this.h.hitTest(p.x, p.y)
    if (!target) return
    e.preventDefault()
    try {
      this.el.setPointerCapture(e.pointerId)
    } catch {
      /* 一部環境では capture できないが、以降の処理は続行する */
    }
    this.active = { id: e.pointerId, target, x: p.x, y: p.y, t: performance.now() / 1000, vx: 0, moved: 0 }
    this.h.onStart(target, p.x, p.y)
  }

  private onMove(e: PointerEvent): void {
    const p = this.local(e)
    if (this.down.has(e.pointerId)) this.down.set(e.pointerId, p)
    const a = this.active
    if (!a || e.pointerId !== a.id) return
    e.preventDefault()
    const now = performance.now() / 1000
    const dt = Math.max(1 / 240, Math.min(0.1, now - a.t))
    const dx = p.x - a.x
    const dy = p.y - a.y
    a.x = p.x
    a.y = p.y
    a.t = now
    a.moved += Math.abs(dx) + Math.abs(dy)
    a.vx = a.vx * 0.6 + (dx / dt) * 0.4
    this.h.onMove(a.target, p.x, p.y, dx, dy, dt)
  }

  private onUp(e: PointerEvent, cancelled: boolean): void {
    this.down.delete(e.pointerId)
    const a = this.active
    if (!a || e.pointerId !== a.id) return
    // 途中の持ち替え: まだ触れている指があればそれに引き継ぐ（位置は飛ばさない）
    if (!cancelled) {
      for (const [id, p] of this.down) {
        try {
          this.el.setPointerCapture(id)
        } catch {
          /* noop */
        }
        a.id = id
        a.x = p.x
        a.y = p.y
        a.t = performance.now() / 1000
        return
      }
    }
    this.finish(cancelled)
  }

  private onLost(e: PointerEvent): void {
    const a = this.active
    if (a && e.pointerId === a.id && !this.down.has(e.pointerId)) this.finish(true)
  }

  private finish(cancelled: boolean): void {
    const a = this.active
    if (!a) return
    this.active = null
    this.h.onEnd(a.target, cancelled ? 0 : a.vx, a.x, a.y)
  }

  get isDragging(): boolean {
    return this.active !== null
  }

  get dragTarget(): DragTarget | null {
    return this.active?.target ?? null
  }

  get dragMoved(): number {
    return this.active?.moved ?? 0
  }

  dispose(): void {
    for (const [type, l] of this.bound) {
      if (type.startsWith('__doc_')) document.removeEventListener(type.slice(6), l)
      else this.el.removeEventListener(type, l)
    }
    this.bound.length = 0
  }
}
