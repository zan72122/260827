/**
 * Frame clock with a fixed simulation step.
 *
 * Two jobs:
 *  - keep physics frame-rate independent (fixed sub-steps + accumulator),
 *  - refuse to hand a huge dt to the simulation after a backgrounded tab
 *    (`visibilitychange` on iOS can produce minutes-long gaps).
 *
 * `now` is injectable so tests can drive it without real time.
 */
export type NowFn = () => number;

export const FIXED_DT = 1 / 240;
/** Longest wall-clock gap fed to the sim in one frame. Anything more is dropped. */
export const MAX_FRAME_DT = 1 / 12;

export class StepClock {
  private acc = 0;
  private last: number | null = null;
  private readonly nowFn: NowFn;
  /** Wall seconds since construction, advanced only by accepted frames. */
  simTime = 0;

  constructor(now: NowFn = () => performance.now() / 1000) {
    this.nowFn = now;
  }

  /** Forget the last timestamp: the next frame contributes no elapsed time. */
  resync(): void {
    this.last = null;
    this.acc = 0;
  }

  /**
   * Returns the number of fixed steps to run this frame plus the raw (clamped)
   * frame dt, for things that are allowed to be frame-rate dependent (camera
   * smoothing, UI fades).
   */
  frame(): { steps: number; frameDt: number } {
    const t = this.nowFn();
    if (this.last === null) {
      this.last = t;
      return { steps: 0, frameDt: 0 };
    }
    let dt = t - this.last;
    this.last = t;
    if (!(dt > 0)) return { steps: 0, frameDt: 0 };
    if (dt > MAX_FRAME_DT) dt = MAX_FRAME_DT;
    this.simTime += dt;
    this.acc += dt;
    // Hard cap on catch-up work so a slow device cannot spiral.
    const maxSteps = Math.ceil(MAX_FRAME_DT / FIXED_DT);
    let steps = Math.floor(this.acc / FIXED_DT);
    if (steps > maxSteps) steps = maxSteps;
    this.acc -= steps * FIXED_DT;
    if (this.acc > FIXED_DT * 4) this.acc = 0;
    return { steps, frameDt: dt };
  }
}
