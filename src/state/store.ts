/**
 * 明示的な状態管理。
 *
 * 完成条件は「指で開いた量」だけで決まる。クリック回数や経過時間では進まない。
 * 変化は必ず applyDrag / releaseDrag / settle / clip 系のメソッドを通す。
 */

export type Phase = 'unfolding' | 'clipReady' | 'clipped'
export type PaperColor = 0 | 1 | 2

export const PAPER_COLORS: Array<{ name: string; hex: number }> = [
  { name: '深緑', hex: 0x37674f },
  { name: '生成り', hex: 0xd8cdb6 },
  { name: 'くすんだ赤', hex: 0x8f4038 },
]

export const OPEN_COMPLETE = 0.995
/** 離した後に許す弾性戻り（全開量に対する割合） */
const SETTLE_LIMIT = 0.03

export interface StateSnapshot {
  open: number
  openSpeed: number
  clipT: number
  clipAttached: boolean
  phase: Phase
  paperColor: PaperColor
  muted: boolean
  everCompleted: boolean
  everClipped: boolean
}

export class Store {
  open = 0
  /** 直近の開閉速度 (1/秒)。紙の擦れ音と手ごたえに使う。 */
  openSpeed = 0
  clipT = 0
  clipAttached = false
  paperColor: PaperColor = 0
  muted = false
  everCompleted = false
  everClipped = false

  private settleVel = 0
  private settleBudget = 0
  private listeners: Array<(s: StateSnapshot) => void> = []

  get phase(): Phase {
    if (this.clipAttached) return 'clipped'
    if (this.open >= OPEN_COMPLETE) return 'clipReady'
    return 'unfolding'
  }

  snapshot(): StateSnapshot {
    return {
      open: this.open,
      openSpeed: this.openSpeed,
      clipT: this.clipT,
      clipAttached: this.clipAttached,
      phase: this.phase,
      paperColor: this.paperColor,
      muted: this.muted,
      everCompleted: this.everCompleted,
      everClipped: this.everClipped,
    }
  }

  subscribe(fn: (s: StateSnapshot) => void): () => void {
    this.listeners.push(fn)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn)
    }
  }

  private emit(): void {
    const s = this.snapshot()
    for (const l of this.listeners) l(s)
  }

  /** 指の移動量（正規化済み）を開閉に足す。止めれば止まり、逆に引けば戻る。 */
  applyDrag(deltaOpen: number, dt: number): void {
    if (this.clipAttached) return
    const before = this.open
    this.open = Math.min(1, Math.max(0, this.open + deltaOpen))
    this.settleBudget = 0
    this.settleVel = 0
    this.openSpeed = dt > 0 ? (this.open - before) / dt : 0
    if (this.open >= OPEN_COMPLETE) this.everCompleted = true
    this.emit()
  }

  /** 指を離したときの小さな弾性戻り。全開へ勝手に進む演出はしない。 */
  releaseDrag(velocity: number): void {
    if (this.clipAttached) return
    this.settleVel = Math.max(-1.2, Math.min(1.2, velocity)) * 0.18
    this.settleBudget = SETTLE_LIMIT
    this.emit()
  }

  /** 指が触れていても動いていなければ、擦れ音のもとになる速度は消える。 */
  decaySpeed(dt: number): void {
    this.openSpeed *= Math.exp(-dt / 0.06)
    if (Math.abs(this.openSpeed) < 1e-4) this.openSpeed = 0
  }

  /** 入力が無いときの減衰。移動量は SETTLE_LIMIT を超えない。 */
  settle(dt: number): void {
    if (this.settleBudget <= 0 || this.clipAttached) {
      this.openSpeed *= Math.exp(-dt / 0.08)
      if (Math.abs(this.openSpeed) < 1e-4) this.openSpeed = 0
      return
    }
    const k = Math.exp(-dt / 0.11)
    const step = this.settleVel * dt
    const use = Math.max(-this.settleBudget, Math.min(this.settleBudget, step))
    const before = this.open
    this.open = Math.min(1, Math.max(0, this.open + use))
    this.settleBudget -= Math.abs(this.open - before)
    this.settleVel *= k
    this.openSpeed = dt > 0 ? (this.open - before) / dt : 0
    if (Math.abs(this.settleVel) < 1e-3) this.settleBudget = 0
    if (this.open >= OPEN_COMPLETE) this.everCompleted = true
    if (before !== this.open) this.emit()
  }

  canClip(): boolean {
    return this.open >= OPEN_COMPLETE && !this.clipAttached
  }

  applyClipDrag(delta: number): void {
    if (!this.clipAttached && !this.canClip()) return
    this.clipT = Math.min(1, Math.max(0, this.clipT + delta))
    if (this.clipAttached && this.clipT < 0.75) {
      this.clipAttached = false
    }
    this.emit()
  }

  /** 指を離したときにだけ留まる/外れる。触れた瞬間には決めない。 */
  releaseClip(): boolean {
    let clicked = false
    if (!this.clipAttached && this.clipT >= 0.9 && this.canClip()) {
      this.clipAttached = true
      this.everClipped = true
      this.clipT = 1
      clicked = true
    } else if (this.clipAttached) {
      this.clipT = 1
    } else {
      this.clipT = 0
    }
    this.emit()
    return clicked
  }

  setPaperColor(c: PaperColor): void {
    this.paperColor = c
    this.emit()
  }

  setMuted(m: boolean): void {
    this.muted = m
    this.emit()
  }

  /** 検査/開発用。通常プレイでは呼ばれない。 */
  forceOpen(v: number): void {
    this.open = Math.min(1, Math.max(0, v))
    if (this.open >= OPEN_COMPLETE) this.everCompleted = true
    this.emit()
  }
}
