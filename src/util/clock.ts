/**
 * 差し替え可能な時計。テストでは手で時刻を進められる。
 * ゲームの進行はすべて「入力」で決まり、時間では完成しないが、
 * 減衰や音のエンベロープには時間が要る。
 */
export interface GameClock {
  now(): number
  /** 前回からの経過秒。上限を掛けてタブ復帰時の飛びを防ぐ。 */
  step(): number
}

export class RealClock implements GameClock {
  private last: number
  constructor(private readonly src: () => number = () => performance.now() / 1000) {
    this.last = src()
  }
  now(): number {
    return this.src()
  }
  step(): number {
    const t = this.src()
    const dt = Math.min(0.05, Math.max(0, t - this.last))
    this.last = t
    return dt
  }
}

export class TestClock implements GameClock {
  private t = 0
  private last = 0
  now(): number {
    return this.t
  }
  advance(dt: number): void {
    this.t += dt
  }
  step(): number {
    const dt = Math.min(0.05, Math.max(0, this.t - this.last))
    this.last = this.t
    return dt
  }
}
