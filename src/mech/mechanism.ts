import { TAU, clamp, smoothstep } from '../core/units';

/**
 * 作中のオルゴール機構 (the movement, as designed for this game).
 *
 * One vertical shaft carries everything: the trunk's axle above, the mainspring
 * barrel and its great wheel below.  Because the tree *is* the winding key, the
 * tree's yaw, the barrel's angle and the pin drum's angle are all the same
 * angle.  A fan governor geared off the great wheel holds the unwinding speed
 * constant, so winding more makes the music last longer — it never makes it
 * faster or higher.  At full wind a friction clutch slips instead of breaking.
 *
 * Sign convention used everywhere in this game:
 *   winding   = clockwise seen from above = decreasing yaw (three.js +Y up)
 *   playing   = counter-clockwise seen from above = increasing yaw
 * (This is a convention chosen for this game, not a claim about any real product.)
 */

export const REV_SECONDS = 9.6; // regulated: one shaft revolution per 9.6 s
export const MAX_TURNS = 4.0; // stored revolutions at full wind
export const SPINUP_SECONDS = 0.3; // the governor fan has to come up to speed
export const CLUTCH_SLIP_RATIO = 0.08; // how much of an over-wind creeps through
export const RATCHET_STEPS = 18; // clicks per revolution while winding
export const PHRASE_REVOLUTIONS = 1; // the pin drum plays one phrase per turn

export type MechState = 'idle' | 'winding' | 'playing';

export interface MechEvents {
  /** ratchet clicks passed this step (winding) */
  ratchetClicks: number;
  /** true while the over-wind clutch is slipping */
  slipping: boolean;
  /** playback started this step */
  started: boolean;
  /** the spring just ran down this step */
  ranDown: boolean;
}

const noEvents = (): MechEvents => ({
  ratchetClicks: 0,
  slipping: false,
  started: false,
  ranDown: false,
});

export class Mechanism {
  state: MechState = 'idle';
  /** stored revolutions, 0 .. MAX_TURNS */
  turns = 0;
  /** shaft yaw in radians; the tree, the barrel and the pin drum all use it */
  shaftYaw = 0;
  /** yaw the shaft would sit at with the spring fully run down */
  restYaw = 0;
  /** seconds the governor has been running, for the spin-up ramp */
  private runTime = 0;
  private ratchetAccum = 0;

  reset() {
    this.state = 'idle';
    this.turns = 0;
    this.shaftYaw = 0;
    this.restYaw = 0;
    this.runTime = 0;
    this.ratchetAccum = 0;
  }

  /** Fraction of full wind, 0..1 — drives the wind gauge and the barrel look. */
  get charge(): number {
    return this.turns / MAX_TURNS;
  }

  /** Seconds of music left at the regulated speed. */
  get remainingSeconds(): number {
    return this.turns * REV_SECONDS;
  }

  /** Where the pin drum is within one phrase, 0..1. */
  get drumPhase(): number {
    const period = TAU * PHRASE_REVOLUTIONS;
    return (((this.shaftYaw % period) + period) % period) / period;
  }

  /** Current regulated angular speed while playing, rad/s. */
  get angularSpeed(): number {
    if (this.state !== 'playing' || this.turns <= 0) return 0;
    return (TAU / REV_SECONDS) * smoothstep(this.runTime / SPINUP_SECONDS);
  }

  /** The hand takes hold of the trunk.  Playback stops; stored wind is kept. */
  grab() {
    this.state = 'winding';
    this.runTime = 0;
  }

  /** The hand lets go.  If anything is stored, the movement runs. */
  release(): MechEvents {
    const ev = noEvents();
    if (this.turns > 0.02) {
      this.state = 'playing';
      this.runTime = 0;
      ev.started = true;
    } else {
      this.state = 'idle';
    }
    return ev;
  }

  /**
   * Hand input while winding.  `deltaYaw` is the yaw the hand turned the tree
   * through this step, in radians, in the same sign convention as `shaftYaw`
   * (negative = winding).  The shaft is rigidly coupled to the barrel arbor, so
   * turning the tree back the other way genuinely lets the spring down again.
   */
  applyHandTurn(deltaYaw: number): MechEvents {
    const ev = noEvents();
    if (this.state !== 'winding' || deltaYaw === 0) return ev;

    const wanted = this.turns - deltaYaw / TAU;
    if (wanted > MAX_TURNS) {
      const overflow = wanted - MAX_TURNS;
      this.turns = MAX_TURNS;
      // the clutch slips: the tree creeps a little, the spring takes nothing
      this.restYaw -= overflow * TAU * CLUTCH_SLIP_RATIO;
      ev.slipping = true;
    } else {
      this.turns = Math.max(0, wanted);
    }
    this.syncShaft();

    this.ratchetAccum += Math.abs(deltaYaw) / TAU;
    const steps = Math.floor(this.ratchetAccum * RATCHET_STEPS);
    if (steps > 0) {
      ev.ratchetClicks = steps;
      this.ratchetAccum -= steps / RATCHET_STEPS;
    }
    return ev;
  }

  /** Advance the movement.  `dt` must already be clamped by the caller. */
  step(dt: number): MechEvents {
    const ev = noEvents();
    if (this.state !== 'playing') return ev;
    this.runTime += dt;
    const omega = this.angularSpeed;
    const spent = (omega * dt) / TAU;
    if (spent >= this.turns) {
      this.turns = 0;
      this.syncShaft();
      this.state = 'idle';
      ev.ranDown = true;
    } else {
      this.turns -= spent;
      this.syncShaft();
    }
    return ev;
  }

  private syncShaft() {
    this.shaftYaw = this.restYaw - this.turns * TAU;
  }
}

/** Seconds of music a given amount of stored wind will produce. */
export function playbackSeconds(turns: number): number {
  const t = clamp(turns, 0, MAX_TURNS);
  // the spin-up ramp costs a little time but does not change the tempo
  return t * REV_SECONDS + SPINUP_SECONDS * 0.5;
}
