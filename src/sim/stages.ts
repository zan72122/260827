/**
 * The explicit order of work. Six named states, no hidden flags.
 *
 * The head arrives already formed, dried, grounded and painted -- this piece is
 * only the neck assembly, which is what the child is here to do.
 */
import { CHIN_REST, HEAD, JIG, THREAD_LEN, THREAD_PEGS, BALANCE_BAND } from './dims';
import { HeadRig, rotLocal } from './rig';

export type Stage =
  | 'balance' // set the counterweight until the head hangs level on the jig
  | 'insert' // carry the head in, rear of the neck first, through the opening
  | 'thread' // pull the thread until the head lifts clear of its rest
  | 'tie' // one short action to knot the length that was chosen
  | 'firstNod' // rest and jig gone: press the head and let it go
  | 'play'; // a toy from here on

/** Where the support notch sits once the head is seated on the chin rest. */
export function seatedNotch(): { x: number; y: number; z: number } {
  return {
    x: THREAD_PEGS.x,
    y: CHIN_REST.y - rotLocal(HEAD.chin, CHIN_REST.cradle).y,
    z: 0,
  };
}

/**
 * The route the head really travels into the body.
 *
 * The last third runs straight down the axis of the neck opening, which is the
 * direction the stem and the inner arm already point, so the rear of the neck
 * goes in through the hole rather than through the side of the shell.
 */
function insertWaypoints(): { x: number; y: number; z: number }[] {
  const seat = seatedNotch();
  const tilt = 0.62;
  const ax = Math.sin(tilt);
  const ay = Math.cos(tilt);
  const along = (d: number) => ({ x: seat.x + ax * d, y: seat.y + ay * d, z: 0 });
  return [
    { x: JIG.hookX, y: JIG.hookY, z: JIG.hookZ },
    { x: JIG.hookX + 22, y: JIG.hookY + 16, z: JIG.hookZ - 12 },
    { x: -4, y: JIG.hookY + 22, z: 34 },
    { x: 34, y: JIG.hookY + 16, z: 8 },
    along(46),
    along(30),
    along(15),
    along(0),
  ];
}

const WAYPOINTS = insertWaypoints();

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/** Position of the support notch at `s` along the insertion route, 0..1. */
export function insertPoint(s: number): { x: number; y: number; z: number } {
  const n = WAYPOINTS.length;
  const f = Math.max(0, Math.min(1, s)) * (n - 1);
  const i = Math.min(n - 2, Math.floor(f));
  const t = f - i;
  const at = (k: number) => WAYPOINTS[Math.max(0, Math.min(n - 1, k))]!;
  const a = at(i - 1);
  const b = at(i);
  const c = at(i + 1);
  const d = at(i + 2);
  return {
    x: catmull(a.x, b.x, c.x, d.x, t),
    y: catmull(a.y, b.y, c.y, d.y, t),
    z: catmull(a.z, b.z, c.z, d.z, t),
  };
}

/**
 * How much the head's own tilt is guided along the way in.
 *
 * Near the opening the head is brought to the angle the stem needs; further out
 * the child's chosen balance is what it hangs at. This is the alignment help
 * the brief allows, and it is a blend of the head's real angle, not a snap.
 */
export function insertGuide(s: number): number {
  return Math.max(0, Math.min(1, (s - 0.42) / 0.3));
}

export interface StageState {
  stage: Stage;
  /** progress along the insertion route */
  insertS: number;
  /** seconds the head has been balanced and settled */
  balanceHold: number;
  /** seconds spent in the current stage */
  elapsed: number;
  /** the tie action is offered once a workable length has been let go of */
  tieOffered: boolean;
  /** the first nod has happened */
  nodded: boolean;
}

export function initialState(): StageState {
  return {
    stage: 'balance',
    insertS: 0,
    balanceHold: 0,
    elapsed: 0,
    tieOffered: false,
    nodded: false,
  };
}

/** A workable hanging length: the head is clear of its rest but not jammed up. */
export function threadReady(rig: HeadRig): boolean {
  return rig.liftOffRest() > 2.2;
}

/** Fraction of the thread that has been drawn in, for drawing the free end. */
export function pullFraction(rig: HeadRig): number {
  return (THREAD_LEN.max - rig.threadLen) / (THREAD_LEN.max - THREAD_LEN.min);
}

/**
 * Advance the stage. Returns the name of anything that just happened, so the
 * caller can make the one sound it deserves.
 */
export function advance(
  st: StageState,
  rig: HeadRig,
  dt: number,
  input: { grabbing: boolean },
): string | null {
  st.elapsed += dt;
  switch (st.stage) {
    case 'balance': {
      const level = rig.balanced(BALANCE_BAND);
      const settled = rig.activity() < 0.55;
      st.balanceHold = level && settled && !input.grabbing ? st.balanceHold + dt : 0;
      if (st.balanceHold > 0.9) {
        st.stage = 'insert';
        st.elapsed = 0;
        return 'balanced';
      }
      return null;
    }
    case 'insert': {
      if (st.insertS >= 0.999 && !input.grabbing) {
        st.stage = 'thread';
        st.elapsed = 0;
        rig.supportKind = 'thread';
        rig.restPresent = true;
        return 'seated';
      }
      return null;
    }
    case 'thread': {
      const ok = threadReady(rig);
      st.tieOffered = ok && !input.grabbing;
      return null;
    }
    case 'tie':
      return null;
    case 'firstNod': {
      if (st.nodded && rig.activity() < 0.35 && st.elapsed > 1.4) {
        st.stage = 'play';
        st.elapsed = 0;
        return 'finished';
      }
      return null;
    }
    case 'play':
      return null;
  }
}

/** The tie action: knot the chosen length, take away the rest and the jig. */
export function tieOff(st: StageState, rig: HeadRig): void {
  if (st.stage !== 'thread' || !st.tieOffered) return;
  st.stage = 'tie';
  st.elapsed = 0;
  rig.restPresent = false;
}
