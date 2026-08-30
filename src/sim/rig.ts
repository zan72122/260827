/**
 * The head rig: one rigid body hanging from one support point.
 *
 * Everything the child does feeds the same small parameter set:
 *
 *   - the handle slides the counterweight along its rail, which moves the
 *     assembly's centre of mass in the head's own frame;
 *   - the resting posture is simply the angle at which that centre of mass
 *     hangs directly below the support notch;
 *   - the same offset sets the restoring torque, so the nod slows down and
 *     speeds up with the balance the child chose. There is no separate
 *     "success animation": the nod is the integration of these numbers.
 *
 * Units: millimetres for geometry (matching dims.ts), SI for the dynamics.
 */
import {
  GRAVITY,
  HEAD,
  HEAD_PARTS,
  NOD_ZETA,
  SHELL_RESTITUTION,
  SWAY_FREQ_RATIO,
  SWAY_ZETA,
  THREAD_LEN,
  THREAD_PEGS,
  WEIGHT_MASS,
  WEIGHT_RAIL,
  CHIN_REST,
  COLLAR,
} from './dims';
import { cavityRatio } from '../geom/profile';

export interface Vec2 {
  x: number;
  y: number;
}
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Rotate a head-local point by pitch (positive = muzzle swings down). */
export function rotLocal(p: Vec2, pitch: number): Vec2 {
  const c = Math.cos(pitch);
  const s = Math.sin(pitch);
  return { x: p.x * c + p.y * s, y: -p.x * s + p.y * c };
}

/** Sag of a thread of length `len` tied between pegs `span` apart. */
export function threadSag(len: number, span: number): number {
  const half = len / 2;
  const h = span / 2;
  if (half <= h) return 0;
  return Math.sqrt(half * half - h * h);
}

export type SupportKind = 'jig' | 'carry' | 'thread';

/** Points on the head assembly that must never leave the paper cavity. */
function probePoints(weightT: number): Vec2[] {
  const wx = WEIGHT_RAIL.x0 + (WEIGHT_RAIL.x1 - WEIGHT_RAIL.x0) * weightT;
  const wy = WEIGHT_RAIL.y0 + (WEIGHT_RAIL.y1 - WEIGHT_RAIL.y0) * weightT;
  const pts: Vec2[] = [];
  // the inner arm, sampled along its length
  for (let i = 1; i <= 5; i++) {
    const t = i / 5;
    pts.push({ x: HEAD.armTip.x * t, y: HEAD.armTip.y * t });
  }
  // the weight bead: four points around its rim so its girth counts
  const r = WEIGHT_RAIL.r;
  pts.push({ x: wx + r, y: wy }, { x: wx - r, y: wy }, { x: wx, y: wy + r }, { x: wx, y: wy - r });
  return pts;
}

/** Bisect between a known-free angle and a known-blocked one. */
function refine(freeA: number, blockedA: number, free: (a: number) => boolean): number {
  let a = freeA;
  let b = blockedA;
  for (let i = 0; i < 7; i++) {
    const m = (a + b) / 2;
    if (free(m)) a = m;
    else b = m;
  }
  return a;
}

export class HeadRig {
  /** Counterweight position along its rail, 0 = forward, 1 = back. */
  weightT = 0.2;
  /** Free thread length between the pegs, mm. */
  threadLen = THREAD_LEN.start;

  /** Nod angle, radians, positive = muzzle down. */
  pitch = 0;
  pitchVel = 0;
  /** Small sideways sway (twist of the thread), radians. */
  yaw = 0;
  yawVel = 0;

  /** Where the support notch is right now. */
  supportKind: SupportKind = 'jig';
  /** Used when supportKind is 'jig' or 'carry'. */
  supportPos: Vec3 = { x: 0, y: 0, z: 0 };

  /** The wooden chin rest is in place (removed once the thread is tied). */
  restPresent = false;
  /** True while the head is propped by the chin rest rather than the thread. */
  resting = false;

  /** While the child presses the head, the pitch is driven, not free. */
  held = false;
  heldPitch = 0;

  private limitLo = -0.9;
  private limitHi = 0.9;
  private limitKey = '';

  constructor(pitchStart?: number) {
    this.pitch = pitchStart ?? this.restPitch();
  }

  /* ------------------------------------------------------------ masses --- */

  weightPos(): Vec2 {
    return {
      x: WEIGHT_RAIL.x0 + (WEIGHT_RAIL.x1 - WEIGHT_RAIL.x0) * this.weightT,
      y: WEIGHT_RAIL.y0 + (WEIGHT_RAIL.y1 - WEIGHT_RAIL.y0) * this.weightT,
    };
  }

  totalMassG(): number {
    let m = WEIGHT_MASS;
    for (const p of HEAD_PARTS) m += p.m;
    return m;
  }

  /** Centre of mass in head-local millimetres, relative to the support notch. */
  comLocal(): Vec2 {
    let mx = 0;
    let my = 0;
    let m = 0;
    for (const p of HEAD_PARTS) {
      mx += p.m * p.x;
      my += p.m * p.y;
      m += p.m;
    }
    const w = this.weightPos();
    mx += WEIGHT_MASS * w.x;
    my += WEIGHT_MASS * w.y;
    m += WEIGHT_MASS;
    return { x: mx / m, y: my / m };
  }

  /** Moment of inertia about the support notch, kg*m^2. */
  inertia(): number {
    let sum = 0; // g*mm^2
    for (const p of HEAD_PARTS) sum += p.m * (p.x * p.x + p.y * p.y + p.k * p.k);
    const w = this.weightPos();
    const kw = WEIGHT_RAIL.r * 0.63;
    sum += WEIGHT_MASS * (w.x * w.x + w.y * w.y + kw * kw);
    return sum * 1e-9; // g*mm^2 -> kg*m^2
  }

  /** Angle at which the centre of mass hangs straight below the notch. */
  restPitch(): number {
    const c = this.comLocal();
    return Math.atan2(c.x, -c.y);
  }

  /** Restoring torque coefficient at the resting angle, N*m/rad. */
  stiffness(): number {
    const c = this.comLocal();
    const r = Math.hypot(c.x, c.y) * 1e-3;
    return (this.totalMassG() * 1e-3) * GRAVITY * r;
  }

  /** Undamped nod frequency, rad/s -- what the child sees as nod speed. */
  omega(): number {
    return Math.sqrt(this.stiffness() / this.inertia());
  }

  /* ----------------------------------------------------------- support --- */

  /** World position of the support notch, millimetres. */
  supportWorld(): Vec3 {
    if (this.supportKind === 'thread') {
      const sag = threadSag(this.threadLen, THREAD_PEGS.hz * 2);
      const y = THREAD_PEGS.y - sag;
      const rest = this.restSupportY();
      return { x: THREAD_PEGS.x, y: rest !== null && rest > y ? rest : y, z: 0 };
    }
    return this.supportPos;
  }

  /**
   * Notch height implied by the chin sitting on the wooden rest, or null.
   * It follows the current pitch, so the jaw stays exactly on the block while
   * the head settles into the cradle instead of hovering above it.
   */
  private restSupportY(): number | null {
    if (!this.restPresent) return null;
    return CHIN_REST.y - rotLocal(HEAD.chin, this.pitch).y;
  }

  /** Clear height between the head's neck flange and the top of the body rim. */
  rimGap(): number {
    const s = this.supportWorld();
    return s.y + HEAD.flangeY * Math.cos(this.pitch) - COLLAR.y;
  }

  /* -------------------------------------------------- shell contact limits */

  /** Pitch range in which no part of the assembly reaches the inner wall. */
  limits(): { lo: number; hi: number } {
    if (this.supportKind !== 'thread') return { lo: -1.1, hi: 1.1 };
    const s = this.supportWorld();
    const key = `${Math.round(s.y * 4)}|${Math.round(this.weightT * 40)}`;
    if (key !== this.limitKey) {
      this.limitKey = key;
      const pts = probePoints(this.weightT);
      const free = (a: number): boolean => {
        for (const p of pts) {
          const r = rotLocal(p, a);
          if (cavityRatio(s.x + r.x, s.y + r.y, 0) > 0.97) return false;
        }
        return true;
      };
      // Seed from the assembled neutral pose, which the dimensions guarantee
      // is clear, then walk outwards to the first contact on each side.
      const centre = 0;
      const stepA = 0.035;
      let lo = centre;
      let hi = centre;
      if (!free(centre)) {
        // Should not happen with the authored dimensions; fail open but bounded.
        this.limitLo = centre - 0.25;
        this.limitHi = centre + 0.25;
        return { lo: this.limitLo, hi: this.limitHi };
      }
      while (lo > -0.95 && free(lo - stepA)) lo -= stepA;
      while (hi < 0.95 && free(hi + stepA)) hi += stepA;
      // Bisect the last step so the clamp sits on the wall, not a step short
      // of it -- otherwise a hard swing can end up a degree inside the paper.
      this.limitLo = refine(lo, lo - stepA, free);
      this.limitHi = refine(hi, hi + stepA, free);
    }
    return { lo: this.limitLo, hi: this.limitHi };
  }

  /* ------------------------------------------------------------- update --- */

  /** One fixed sub-step. `dt` must be small and constant. */
  step(dt: number): void {
    const support = this.supportWorld();
    const threadY = THREAD_PEGS.y - threadSag(this.threadLen, THREAD_PEGS.hz * 2);
    const restY = this.restSupportY();
    this.resting = this.supportKind === 'thread' && restY !== null && restY > threadY;

    if (this.held) {
      // Position-driven while a finger holds it; velocity is tracked so the
      // release carries the speed the finger had.
      const target = this.heldPitch;
      const next = this.pitch + (target - this.pitch) * Math.min(1, dt * 60);
      this.pitchVel = (next - this.pitch) / dt;
      this.pitch = next;
      this.clampToShell(0);
      return;
    }

    if (this.resting) {
      // Propped on the wooden rest: it holds the posture, it does not swing.
      const k = 60;
      const target = CHIN_REST.cradle;
      this.pitchVel += (target - this.pitch) * k * dt;
      this.pitchVel *= Math.exp(-14 * dt);
      this.pitch += this.pitchVel * dt;
      this.yawVel *= Math.exp(-18 * dt);
      this.yaw += this.yawVel * dt;
      this.clampToShell(0);
      return;
    }

    const I = this.inertia();
    const c = this.comLocal();
    const M = this.totalMassG() * 1e-3;
    const cx = c.x * 1e-3;
    const cy = c.y * 1e-3;

    // Gravity torque about the notch, in the same sign convention as `pitch`.
    const rx = cx * Math.cos(this.pitch) + cy * Math.sin(this.pitch);
    const torque = M * GRAVITY * rx;

    const w = this.omega();
    const damp = 2 * NOD_ZETA * w * I;
    const acc = (torque - damp * this.pitchVel) / I;
    this.pitchVel += acc * dt;
    this.pitch += this.pitchVel * dt;
    this.clampToShell(SHELL_RESTITUTION);

    // Sideways sway: the thread resists twisting, stiffer and shorter-lived.
    const ws = w * SWAY_FREQ_RATIO;
    const yawAcc = -ws * ws * this.yaw - 2 * SWAY_ZETA * ws * this.yawVel;
    this.yawVel += yawAcc * dt;
    this.yaw += this.yawVel * dt;
    if (Math.abs(this.yaw) > 0.22) {
      this.yaw = Math.sign(this.yaw) * 0.22;
      this.yawVel *= -0.3;
    }
    void support;
  }

  private clampToShell(restitution: number): void {
    const { lo, hi } = this.limits();
    if (this.pitch < lo) {
      this.pitch = lo;
      if (this.pitchVel < 0) this.pitchVel = -this.pitchVel * restitution;
    } else if (this.pitch > hi) {
      this.pitch = hi;
      if (this.pitchVel > 0) this.pitchVel = -this.pitchVel * restitution;
    }
  }

  /** True when the resting posture is level enough to hang the head. */
  balanced(band: number): boolean {
    return Math.abs(this.restPitch()) <= band;
  }

  /** How far the head has risen off the wooden rest, mm (0 while propped). */
  liftOffRest(): number {
    const restY = this.restSupportY();
    if (restY === null) return 0;
    const threadY = THREAD_PEGS.y - threadSag(this.threadLen, THREAD_PEGS.hz * 2);
    return Math.max(0, threadY - restY);
  }

  /** Nudge used by the "press and let go" interaction. */
  release(velocity: number): void {
    this.held = false;
    this.pitchVel = velocity;
  }

  /** Total energy proxy: used to tell "still nodding" from "settled". */
  activity(): number {
    return Math.abs(this.pitchVel) + Math.abs(this.pitch - this.restPitch()) * 4;
  }
}
