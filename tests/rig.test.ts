import { describe, it, expect } from 'vitest';
import { HeadRig, rotLocal, threadSag } from '../src/sim/rig';
import { cavityRatio } from '../src/geom/profile';
import {
  BALANCE_BAND,
  CHIN_REST,
  HEAD,
  THREAD_LEN,
  THREAD_PEGS,
  WEIGHT_RAIL,
} from '../src/sim/dims';
import { StepClock, MAX_FRAME_DT, FIXED_DT } from '../src/core/clock';

const DEG = 180 / Math.PI;

function hung(): HeadRig {
  const r = new HeadRig();
  r.supportKind = 'thread';
  r.restPresent = false;
  r.threadLen = THREAD_LEN.min;
  r.pitch = r.restPitch();
  r.pitchVel = 0;
  return r;
}

function run(r: HeadRig, seconds: number, dt = FIXED_DT): void {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) r.step(dt);
}

describe('counterweight -> resting posture', () => {
  it('sweeps from muzzle-down to muzzle-up, monotonically', () => {
    const r = new HeadRig();
    const angles: number[] = [];
    for (let i = 0; i <= 20; i++) {
      r.weightT = i / 20;
      angles.push(r.restPitch());
    }
    expect(angles[0]! * DEG).toBeGreaterThan(12);
    expect(angles[20]! * DEG).toBeLessThan(-12);
    for (let i = 1; i < angles.length; i++) {
      expect(angles[i]!).toBeLessThan(angles[i - 1]!);
    }
  });

  it('starts outside the balanced band and reaches it with a short move', () => {
    const r = new HeadRig();
    r.weightT = 0.2;
    expect(r.balanced(BALANCE_BAND)).toBe(false);
    expect(r.restPitch() * DEG).toBeGreaterThan(8);

    const inBand: number[] = [];
    for (let i = 0; i <= 200; i++) {
      r.weightT = i / 200;
      if (r.balanced(BALANCE_BAND)) inBand.push(i / 200);
    }
    const lo = Math.min(...inBand);
    const hi = Math.max(...inBand);
    // A band, not a single correct point, and close enough to reach quickly.
    expect(hi - lo).toBeGreaterThan(0.15);
    expect(lo - 0.2).toBeLessThan(0.3);
  });

  it('keeps the nod speed consistent with the visible balance', () => {
    const r = new HeadRig();
    const seen: number[] = [];
    for (const t of [0.3, 0.45, 0.6, 0.8]) {
      r.weightT = t;
      const w = r.omega();
      expect(w).toBeGreaterThan(4);
      expect(w).toBeLessThan(30);
      seen.push(w);
    }
    // moving the weight back lengthens the arm below the notch -> stiffer
    expect(seen[3]!).not.toBeCloseTo(seen[0]!, 2);
  });
});

describe('nodding', () => {
  it('nods several times and then stops', () => {
    const r = hung();
    const rest = r.restPitch();
    r.pitch = rest + 0.28;
    let crossings = 0;
    let prev = r.pitch - rest;
    for (let i = 0; i < Math.round(6 / FIXED_DT); i++) {
      r.step(FIXED_DT);
      const d = r.pitch - rest;
      if (prev > 0 !== d > 0) crossings++;
      prev = d;
    }
    expect(crossings).toBeGreaterThanOrEqual(4);
    expect(Math.abs(r.pitch - rest)).toBeLessThan(0.01);
    expect(Math.abs(r.pitchVel)).toBeLessThan(0.05);
  });

  it('answers a small push differently from a big one, and settles from both', () => {
    const peak = (push: number): number => {
      const r = hung();
      const rest = r.restPitch();
      r.pitchVel = push;
      let m = 0;
      for (let i = 0; i < Math.round(2 / FIXED_DT); i++) {
        r.step(FIXED_DT);
        m = Math.max(m, Math.abs(r.pitch - rest));
      }
      return m;
    };
    const small = peak(0.35);
    const big = peak(2.2);
    expect(big).toBeGreaterThan(small * 2.5);

    for (const push of [0.35, 2.2]) {
      const r = hung();
      const rest = r.restPitch();
      r.pitchVel = push;
      run(r, 9);
      expect(Math.abs(r.pitch - rest)).toBeLessThan(0.01);
    }
  });

  it('is frame-rate independent', () => {
    const a = hung();
    const b = hung();
    a.pitch += 0.25;
    b.pitch += 0.25;
    run(a, 1.5, 1 / 240);
    run(b, 1.5, 1 / 480);
    expect(a.pitch).toBeCloseTo(b.pitch, 2);
  });

  it('never pushes any part of the head through the paper shell', () => {
    const r = hung();
    r.weightT = 0.5;
    r.pitchVel = 9; // far harder than a child can push
    const probes = [
      { x: HEAD.armTip.x, y: HEAD.armTip.y },
      { x: HEAD.armTip.x * 0.6, y: HEAD.armTip.y * 0.6 },
      {
        x: WEIGHT_RAIL.x0 + (WEIGHT_RAIL.x1 - WEIGHT_RAIL.x0) * 0.5,
        y: WEIGHT_RAIL.y0 + (WEIGHT_RAIL.y1 - WEIGHT_RAIL.y0) * 0.5,
      },
    ];
    for (let i = 0; i < Math.round(5 / FIXED_DT); i++) {
      r.step(FIXED_DT);
      const s = r.supportWorld();
      for (const p of probes) {
        const q = rotLocal(p, r.pitch);
        expect(cavityRatio(s.x + q.x, s.y + q.y, 0)).toBeLessThan(1.02);
      }
    }
  });
});

describe('thread and the rim gap', () => {
  it('lifts the head off the wooden rest as the thread is pulled in', () => {
    const r = new HeadRig();
    r.supportKind = 'thread';
    r.restPresent = true;
    r.weightT = 0.55;
    r.threadLen = THREAD_LEN.max;
    run(r, 1.0); // let it settle into the cradle first
    expect(r.resting).toBe(true);
    const gapDown = r.rimGap();

    let last = -Infinity;
    for (let i = 0; i <= 40; i++) {
      r.threadLen = THREAD_LEN.max + (THREAD_LEN.min - THREAD_LEN.max) * (i / 40);
      run(r, 0.05);
      const g = r.rimGap();
      expect(g).toBeGreaterThan(last - 0.25); // rises, bar the live nod wobble
      last = Math.max(last, g);
    }
    expect(r.resting).toBe(false);
    expect(r.liftOffRest()).toBeGreaterThan(3);
    expect(r.rimGap() - gapDown).toBeGreaterThan(4);
  });

  it('cannot be pulled past its stop', () => {
    expect(threadSag(THREAD_LEN.min, THREAD_PEGS.hz * 2)).toBeGreaterThan(0);
    // fully straight would be span; the stop keeps a real sag
    expect(THREAD_LEN.min).toBeGreaterThan(THREAD_PEGS.hz * 2);
  });

  it('leaves the head standing on the rest before it is hung', () => {
    const r = new HeadRig();
    r.supportKind = 'thread';
    r.restPresent = true;
    r.threadLen = THREAD_LEN.max;
    run(r, 1.0);
    const s = r.supportWorld();
    const chin = rotLocal(HEAD.chin, r.pitch);
    expect(s.y + chin.y).toBeCloseTo(CHIN_REST.y, 3);
    expect(r.pitch).toBeCloseTo(CHIN_REST.cradle, 2);
  });

  it('always hangs from the thread, never in mid-air', () => {
    const r = hung();
    r.weightT = 0.55;
    run(r, 2);
    const s = r.supportWorld();
    const sag = threadSag(r.threadLen, THREAD_PEGS.hz * 2);
    expect(s.y).toBeCloseTo(THREAD_PEGS.y - sag, 6);
    expect(sag).toBeGreaterThan(0.5);
  });
});

describe('clock', () => {
  it('drops a long background gap instead of exploding the sim', () => {
    let t = 0;
    const c = new StepClock(() => t);
    c.frame();
    t += 0.0167;
    expect(c.frame().steps).toBeGreaterThan(0);
    t += 300; // tab was hidden for five minutes
    const f = c.frame();
    expect(f.frameDt).toBeLessThanOrEqual(MAX_FRAME_DT + 1e-9);
    expect(f.steps * FIXED_DT).toBeLessThanOrEqual(MAX_FRAME_DT + 1e-9);
  });

  it('contributes nothing on the frame after a resync', () => {
    let t = 0;
    const c = new StepClock(() => t);
    c.frame();
    t += 1;
    c.resync();
    t += 5;
    expect(c.frame().steps).toBe(0);
  });
});
