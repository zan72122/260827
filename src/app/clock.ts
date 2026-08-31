import { TICK } from '../sim/engine';

/**
 * 2 種類の時間を分けて管理する。
 *  A. 操作時間（opSec）: 指の動き、ラックの速度、滴下、カバーガラスの動き。常に等倍。
 *  B. 教材内モデル時間（modelSec）: 化学処理の進行。長い浸漬の時計だけを明示的に加速する。
 *
 * 全体に timeScale を掛けることはしない。加速はラックが静止して全面浸漬しているときだけ働き、
 * ディップの回数は加速では水増しされない（回数は浸漬レベルの往復から数えるため）。
 */
export class GameClock {
  opSec = 0;
  modelSec = 0;
  /** 現在の加速率（表示用）。 */
  accel = 1;
  paused = false;
  private residual = 0;
  /** 1 フレームで進める実時間の上限。復帰時に時間が飛ばないようにする。 */
  private static readonly MAX_FRAME = 0.1;
  /** 長い浸漬の最大加速率。[教材係数] */
  static readonly MAX_ACCEL = 10;

  /**
   * 実時間 dt を渡し、消費すべきモデル tick 数を返す。
   */
  advance(realDt: number, accel: number): number {
    if (this.paused) return 0;
    const dt = Math.min(GameClock.MAX_FRAME, Math.max(0, realDt));
    this.opSec += dt;
    this.accel = accel;
    this.residual += dt * accel;
    let n = 0;
    while (this.residual >= TICK) {
      this.residual -= TICK;
      this.modelSec += TICK;
      n++;
      if (n > 400) {
        this.residual = 0;
        break;
      }
    }
    return n;
  }

  reset(): void {
    this.opSec = 0;
    this.modelSec = 0;
    this.residual = 0;
    this.accel = 1;
    this.paused = false;
  }
}

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
