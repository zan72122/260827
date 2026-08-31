import type { FlowerRecord } from './FlowerRecord';

export type SeatId = 'petal' | 'leaf';

export type Stage =
  | 'welcome'
  | 'smoothing'
  | 'piping'
  | 'placing'
  | 'serving'
  | 'cutting'
  | 'after';

/**
 * The game state, kept deliberately separate from anything that draws. The
 * renderer reads this; it never stores the truth about the cake itself.
 */
export class CakeState {
  stage: Stage = 'welcome';
  seat: SeatId = 'petal';

  /** 0 = as it came off the crumb coat, 1 = fully smoothed. Per column. */
  readonly SIDE_COLUMNS = 128;
  readonly roughness: Float32Array;

  /** Flowers already resting on the cake. */
  flowers: FlowerRecord[] = [];
  /** The flower currently being piped on the nail, if any. */
  working: FlowerRecord | null = null;

  candleLit = false;
  candlePresent = false;
  /**
   * Angular ranges of cake that are still on the board. A whole cake is one
   * range spanning a full turn; each slice taken splits a range.
   */
  remaining: Array<{ from: number; to: number }> = [{ from: 0, to: Math.PI * 2 }];
  /** The wedge most recently taken, in the same angles. */
  cut: { from: number; to: number } | null = null;

  sessionsServed = 0;

  constructor() {
    this.roughness = new Float32Array(this.SIDE_COLUMNS);
  }

  /** Fresh cake: an uneven coat of buttercream down the side. */
  resetCoat(amplitudes: Float32Array): void {
    this.roughness.set(amplitudes);
  }

  /** Mean roughness, used to decide when smoothing has clearly "worked". */
  meanRoughness(): number {
    let s = 0;
    for (let i = 0; i < this.roughness.length; i++) s += this.roughness[i];
    return s / this.roughness.length;
  }

  /** Take a wedge out of the remaining cake, returning the new ranges. */
  takeWedge(from: number, to: number): void {
    const out: Array<{ from: number; to: number }> = [];
    for (const r of this.remaining) {
      const full = r.to - r.from >= Math.PI * 2 - 1e-6;
      if (full) {
        // A whole cake leaves exactly one arc behind.
        if (to > from) out.push({ from: to, to: from + Math.PI * 2 });
        continue;
      }
      if (to <= r.from || from >= r.to) {
        out.push(r);
        continue;
      }
      if (from - r.from > 0.06) out.push({ from: r.from, to: from });
      if (r.to - to > 0.06) out.push({ from: to, to: r.to });
    }
    this.remaining = out;
    this.cut = { from, to };
  }

  /** Flowers on the cake plus the one on the nail. */
  allFlowers(): FlowerRecord[] {
    return this.working ? [...this.flowers, this.working] : this.flowers;
  }
}
