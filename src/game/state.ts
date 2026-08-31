/**
 * state.ts — the three moves, and nothing else.
 *
 *  1. feed the saw inwards until the wedge is parted
 *  2. pull the parted wedge out of the ring
 *  3. turn it on the table until you can read it
 *
 * Rules that matter and are enforced here, not by animation:
 *   - the kerf never runs ahead of the blade  (cut = min over time of bladeR)
 *   - pulling back the saw never re-joins the wood (cut only decreases)
 *   - the wedge cannot move until it is completely parted
 *   - the wedge cannot turn until it is completely clear of the ring
 *   - the wedge cannot slide back in once it has been turned
 */

import { R_INNER, R_OUTER } from '../core/profile'
import {
  SAW_CARRIAGE_END,
  SAW_CARRIAGE_START,
  SAW_LEAD,
  SLIDE_MAX,
  SLIDE_TURN_UNLOCK,
} from '../core/layout'

export type Phase = 'title' | 'cut' | 'pull' | 'turn' | 'done' | 'reset'

export const NO_CUT = Number.POSITIVE_INFINITY

export class GameState {
  phase: Phase = 'title'
  /** Radius of the saw carriage centre. */
  carriage = SAW_CARRIAGE_START
  /** Radius the kerf has reached. Monotonically non-increasing. */
  cut = NO_CUT
  /** How far the wedge has been pulled out, in metres. */
  slide = 0
  /** How far the wedge has been turned, in radians. */
  yaw = 0
  /** Yaw at which the sawn face squarely faces the camera. Set from the shot. */
  yawTarget = Math.PI / 2
  /** Time in the current phase. */
  t = 0
  /** 0..1 progress of the reset animation. */
  resetT = 0
  /** Set for one frame when the wedge comes free. */
  justParted = false
  /** Cut speed in metres per second, for the saw sound. */
  cutSpeed = 0
  plays = 0

  get parted() {
    return this.cut <= R_INNER
  }
  get clear() {
    return this.slide >= SLIDE_TURN_UNLOCK
  }
  get bladeR() {
    return this.carriage - SAW_LEAD
  }
  /** 0..1, only for diagnostics and the hint pulse. */
  get cutProgress() {
    if (this.cut === NO_CUT) return 0
    return Math.min(1, (R_OUTER - this.cut) / (R_OUTER - R_INNER))
  }

  setCarriage(r: number, dt: number) {
    const next = clamp(r, SAW_CARRIAGE_END, SAW_CARRIAGE_START)
    this.carriage = next
    const blade = next - SAW_LEAD
    if (blade < R_OUTER) {
      const before = this.cut
      // The kerf only ever follows the blade; it never runs ahead of it and
      // pulling the saw back out does not close it again.
      this.cut = Math.min(this.cut === NO_CUT ? R_OUTER : this.cut, blade)
      const moved = (before === NO_CUT ? R_OUTER : before) - this.cut
      this.cutSpeed = dt > 0 ? moved / dt : 0
      if (before > R_INNER && this.cut <= R_INNER) {
        this.justParted = true
        this.phase = 'pull'
        this.t = 0
      }
    } else {
      this.cutSpeed = 0
    }
  }

  setSlide(s: number) {
    if (!this.parted) return
    // once it has been turned it is off the ring's axis; it must not slide back
    const lo = this.yaw > 1e-3 ? this.slide : 0
    this.slide = clamp(s, lo, SLIDE_MAX)
    if (this.phase === 'pull' && this.clear) {
      this.phase = 'turn'
      this.t = 0
    }
  }

  setYaw(y: number) {
    if (!this.clear) return
    this.yaw = clamp(y, 0, this.yawTarget)
  }

  tick(dt: number) {
    this.t += dt
    this.cutSpeed *= Math.exp(-dt * 9)
    this.justParted = false
  }

  reset() {
    this.carriage = SAW_CARRIAGE_START
    this.cut = NO_CUT
    this.slide = 0
    this.yaw = 0
    this.t = 0
    this.cutSpeed = 0
  }
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
