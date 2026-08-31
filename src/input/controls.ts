/**
 * 一指の操作 / one-finger pointer handling.
 *
 * 調整つまみ・試し回しハンドル・ねじ回しを、順番に一本の指で扱えます。
 * 二本目の指は無視し、pointercapture・pointercancel・範囲外移動・持ち替えを
 * すべて受け止めます。画面回転で状態は失われません。
 */

import * as THREE from 'three'

export type TargetId = 'knob' | 'handle' | 'tool'

export interface Target {
  id: TargetId
  /** 画面上の中心 (CSS px) */
  centre: THREE.Vector2
  /** 当たり半径 (CSS px) */
  radius: number
  /** 回転の中心 (円弧操作のとき)。ハンドル/工具で使う。 */
  pivot: THREE.Vector2
  /** 直線ドラッグの向き (ドラムで使う。正の向きに動かすと値が増える) */
  axis: THREE.Vector2
  enabled: boolean
}

export interface DragEvent {
  id: TargetId
  /** ドラムの場合: 正の向きへ動いた CSS px */
  alongPx: number
  /** ハンドル/工具の場合: 中心まわりに回った角度 (rad, 反時計回りが正) */
  turn: number
}

export class Controls {
  private active: number | null = null
  private activeId: TargetId | null = null
  private last = new THREE.Vector2()
  private lastAngle = 0
  readonly targets: Record<TargetId, Target> = {
    knob: makeTarget('knob'),
    handle: makeTarget('handle'),
    tool: makeTarget('tool'),
  }

  /** 触れている操作子 (見た目のハイライト用)。 */
  get grabbed(): TargetId | null {
    return this.activeId
  }

  constructor(
    private readonly el: HTMLElement,
    private readonly onDrag: (e: DragEvent) => void,
    private readonly onFirstTouch: () => void,
    private readonly onGrabChange: () => void,
  ) {
    el.addEventListener('pointerdown', this.down, { passive: false })
    el.addEventListener('pointermove', this.move, { passive: false })
    el.addEventListener('pointerup', this.up)
    el.addEventListener('pointercancel', this.up)
    el.addEventListener('lostpointercapture', this.up)
  }

  dispose(): void {
    this.el.removeEventListener('pointerdown', this.down)
    this.el.removeEventListener('pointermove', this.move)
    this.el.removeEventListener('pointerup', this.up)
    this.el.removeEventListener('pointercancel', this.up)
    this.el.removeEventListener('lostpointercapture', this.up)
  }

  private local(e: PointerEvent): THREE.Vector2 {
    const r = this.el.getBoundingClientRect()
    return new THREE.Vector2(e.clientX - r.left, e.clientY - r.top)
  }

  private pick(p: THREE.Vector2): TargetId | null {
    let best: TargetId | null = null
    let bestD = Infinity
    for (const id of ['tool', 'knob', 'handle'] as const) {
      const t = this.targets[id]
      if (!t.enabled) continue
      const d = p.distanceTo(t.centre)
      if (d <= t.radius && d < bestD) {
        bestD = d
        best = id
      }
    }
    return best
  }

  private down = (e: PointerEvent): void => {
    this.onFirstTouch()
    // 二本目の指は受け付けない。持ち替えは一本目を離してから。
    if (this.active !== null) return
    const p = this.local(e)
    const id = this.pick(p)
    if (!id) return
    e.preventDefault()
    this.active = e.pointerId
    this.activeId = id
    this.last.copy(p)
    const t = this.targets[id]
    this.lastAngle = Math.atan2(p.y - t.pivot.y, p.x - t.pivot.x)
    try {
      this.el.setPointerCapture(e.pointerId)
    } catch {
      /* 一部の環境では捕捉できないことがある */
    }
    this.onGrabChange()
  }

  private move = (e: PointerEvent): void => {
    if (this.active !== e.pointerId || !this.activeId) return
    e.preventDefault()
    const p = this.local(e)
    const t = this.targets[this.activeId]
    if (this.activeId === 'knob') {
      const dx = p.x - this.last.x
      const dy = p.y - this.last.y
      this.onDrag({ id: 'knob', alongPx: dx * t.axis.x + dy * t.axis.y, turn: 0 })
    } else {
      const a = Math.atan2(p.y - t.pivot.y, p.x - t.pivot.x)
      let d = a - this.lastAngle
      while (d > Math.PI) d -= Math.PI * 2
      while (d < -Math.PI) d += Math.PI * 2
      this.lastAngle = a
      this.onDrag({ id: this.activeId, alongPx: 0, turn: -d })
    }
    this.last.copy(p)
  }

  private up = (e: PointerEvent): void => {
    if (this.active !== e.pointerId) return
    this.active = null
    this.activeId = null
    try {
      if (this.el.hasPointerCapture(e.pointerId)) this.el.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    this.onGrabChange()
  }
}

function makeTarget(id: TargetId): Target {
  return {
    id,
    centre: new THREE.Vector2(-999, -999),
    radius: 0,
    pivot: new THREE.Vector2(-999, -999),
    axis: new THREE.Vector2(0, -1),
    enabled: false,
  }
}
