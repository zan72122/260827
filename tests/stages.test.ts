import { describe, it, expect } from 'vitest';
import {
  advance,
  initialState,
  insertGuide,
  insertPoint,
  pullFraction,
  seatedNotch,
  threadReady,
  tieOff,
} from '../src/sim/stages';
import { HeadRig } from '../src/sim/rig';
import { BALANCE_BAND, CHIN_REST, HEAD, THREAD_LEN } from '../src/sim/dims';
import { FIXED_DT } from '../src/core/clock';

function balanced(): HeadRig {
  const r = new HeadRig();
  r.weightT = 0.45;
  r.pitch = r.restPitch();
  r.pitchVel = 0;
  return r;
}

function run(st: ReturnType<typeof initialState>, r: HeadRig, secs: number, grabbing = false) {
  const events: string[] = [];
  for (let i = 0; i < Math.round(secs / FIXED_DT); i++) {
    r.step(FIXED_DT);
    const e = advance(st, r, FIXED_DT, { grabbing });
    if (e) events.push(e);
  }
  return events;
}

describe('the order of work', () => {
  it('starts at the counterweight, not at the doll', () => {
    expect(initialState().stage).toBe('balance');
  });

  it('waits for the head to be level and still, and for the hand to let go', () => {
    const st = initialState();
    const r = balanced();
    expect(r.balanced(BALANCE_BAND)).toBe(true);

    // still being held: it does not move on, however level the head is
    run(st, r, 3, true);
    expect(st.stage).toBe('balance');

    // let go, and it moves on after the head has settled
    const ev = run(st, r, 2, false);
    expect(st.stage).toBe('insert');
    expect(ev).toContain('balanced');
  });

  it('does not move on while the head is still leaning', () => {
    const st = initialState();
    const r = new HeadRig();
    r.weightT = 0.05;
    r.pitch = r.restPitch();
    run(st, r, 4);
    expect(st.stage).toBe('balance');
  });

  it('seats the head only at the end of the route, and only on release', () => {
    const st = initialState();
    st.stage = 'insert';
    const r = balanced();
    r.supportKind = 'carry';
    st.insertS = 0.8;
    run(st, r, 1);
    expect(st.stage).toBe('insert');
    st.insertS = 1;
    run(st, r, 0.2, true);
    expect(st.stage).toBe('insert');
    const ev = run(st, r, 0.2, false);
    expect(st.stage).toBe('thread');
    expect(ev).toContain('seated');
    expect(r.restPresent).toBe(true);
  });

  it('offers the knot only once the head is clear of its rest', () => {
    const st = initialState();
    st.stage = 'thread';
    const r = balanced();
    r.supportKind = 'thread';
    r.restPresent = true;

    r.threadLen = THREAD_LEN.max;
    run(st, r, 0.4);
    expect(threadReady(r)).toBe(false);
    expect(st.tieOffered).toBe(false);
    tieOff(st, r);
    expect(st.stage).toBe('thread'); // refused: nothing to knot yet

    r.threadLen = THREAD_LEN.min;
    run(st, r, 0.4);
    expect(threadReady(r)).toBe(true);
    expect(st.tieOffered).toBe(true);
    tieOff(st, r);
    expect(st.stage).toBe('tie');
    // the wooden rest is taken away: from here the thread is what holds it
    expect(r.restPresent).toBe(false);
  });

  it('finishes only after the head has actually nodded', () => {
    const st = initialState();
    st.stage = 'firstNod';
    const r = balanced();
    r.supportKind = 'thread';
    run(st, r, 3);
    expect(st.stage).toBe('firstNod'); // nobody has touched it

    st.nodded = true;
    r.pitchVel = 2;
    run(st, r, 6);
    expect(st.stage).toBe('play');
  });
});

describe('the route in', () => {
  it('starts at the jig and ends seated on the chin rest', () => {
    const a = insertPoint(0);
    const b = insertPoint(1);
    const seat = seatedNotch();
    expect(b.x).toBeCloseTo(seat.x, 6);
    expect(b.y).toBeCloseTo(seat.y, 6);
    expect(a.y).toBeGreaterThan(b.y + 30);
    expect(seat.y + HEAD.chin.y * Math.cos(CHIN_REST.cradle) - HEAD.chin.x * Math.sin(CHIN_REST.cradle))
      .toBeCloseTo(CHIN_REST.y, 6);
  });

  it('moves without doubling back on itself', () => {
    // The route is deliberately an arc -- lift, carry across, lower in -- so it
    // is longer than the straight line. What it must not do is reverse.
    let prev = insertPoint(0);
    let lastDir: [number, number, number] | null = null;
    for (let i = 1; i <= 120; i++) {
      const p = insertPoint(i / 120);
      const d: [number, number, number] = [p.x - prev.x, p.y - prev.y, p.z - prev.z];
      const len = Math.hypot(...d) || 1;
      const unit: [number, number, number] = [d[0] / len, d[1] / len, d[2] / len];
      if (lastDir) {
        const dot = unit[0] * lastDir[0] + unit[1] * lastDir[1] + unit[2] * lastDir[2];
        expect(dot).toBeGreaterThan(0.55);
      }
      lastDir = unit;
      prev = p;
    }
  });

  it('only guides the tilt near the opening', () => {
    expect(insertGuide(0)).toBe(0);
    expect(insertGuide(0.4)).toBe(0);
    expect(insertGuide(1)).toBe(1);
  });
});

describe('the free end of the thread', () => {
  it('reads zero when nothing has been pulled and one at the stop', () => {
    const r = new HeadRig();
    r.threadLen = THREAD_LEN.max;
    expect(pullFraction(r)).toBeCloseTo(0, 6);
    r.threadLen = THREAD_LEN.min;
    expect(pullFraction(r)).toBeCloseTo(1, 6);
  });
});
