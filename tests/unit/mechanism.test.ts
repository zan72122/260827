import { describe, expect, it } from 'vitest';
import {
  MAX_TURNS,
  Mechanism,
  REV_SECONDS,
  SPINUP_SECONDS,
  playbackSeconds,
} from '../../src/mech/mechanism';
import { TAU } from '../../src/core/units';

/** Wind by hand, in turns, the way the winder does it. */
function wind(m: Mechanism, turns: number, steps = 60) {
  m.grab();
  for (let i = 0; i < steps; i++) m.applyHandTurn((-turns * TAU) / steps);
}

/** Play until the spring runs down, returning seconds elapsed. */
function playOut(m: Mechanism, dt = 1 / 60, limit = 200) {
  let t = 0;
  while (m.state === 'playing' && t < limit) {
    m.step(dt);
    t += dt;
  }
  return t;
}

describe('the movement', () => {
  it('stores what the hand winds in, and turns the tree as it goes', () => {
    const m = new Mechanism();
    wind(m, 2);
    expect(m.turns).toBeCloseTo(2, 5);
    // winding is clockwise seen from above, which is decreasing yaw
    expect(m.shaftYaw).toBeCloseTo(-2 * TAU, 5);
  });

  it('does nothing until the hand takes hold', () => {
    const m = new Mechanism();
    m.applyHandTurn(-TAU);
    expect(m.turns).toBe(0);
  });

  it('starts playing when the hand lets go, and only if something is stored', () => {
    const m = new Mechanism();
    m.grab();
    m.release();
    expect(m.state).toBe('idle');

    wind(m, 1);
    const ev = m.release();
    expect(ev.started).toBe(true);
    expect(m.state).toBe('playing');
  });

  it('plays longer the more it is wound, at the same speed', () => {
    const speeds: number[] = [];
    const times: number[] = [];
    for (const turns of [0.5, 1, 2, 4]) {
      const m = new Mechanism();
      wind(m, turns);
      m.release();
      // measure the speed once the governor is up to speed
      for (let i = 0; i < Math.ceil(SPINUP_SECONDS * 60) + 6; i++) m.step(1 / 60);
      speeds.push(m.angularSpeed);
      times.push(playOut(m) + SPINUP_SECONDS);
    }
    // duration scales with the wind
    expect(times[1] / times[0]).toBeGreaterThan(1.7);
    expect(times[3] / times[1]).toBeGreaterThan(3.4);
    // ...and the speed does not: the governor holds it
    const spread = (Math.max(...speeds) - Math.min(...speeds)) / Math.max(...speeds);
    expect(spread).toBeLessThan(0.02);
    expect(speeds[0]).toBeCloseTo(TAU / REV_SECONDS, 3);
  });

  it('matches the advertised playing time', () => {
    const m = new Mechanism();
    wind(m, 3);
    m.release();
    const t = playOut(m);
    expect(t).toBeGreaterThan(playbackSeconds(3) - 0.6);
    expect(t).toBeLessThan(playbackSeconds(3) + 0.6);
  });

  it('slips instead of breaking when it is wound past full', () => {
    const m = new Mechanism();
    wind(m, MAX_TURNS + 6, 200);
    expect(m.turns).toBeCloseTo(MAX_TURNS, 5);
    m.grab();
    const ev = m.applyHandTurn(-TAU);
    expect(ev.slipping).toBe(true);
    expect(m.turns).toBeCloseTo(MAX_TURNS, 5);
    expect(m.state).toBe('winding');
  });

  it('keeps the stored wind when the hand lets go and takes hold again', () => {
    const m = new Mechanism();
    wind(m, 1.5);
    m.release();
    m.step(0.5);
    const before = m.turns;
    m.grab(); // playback stops, nothing is lost
    expect(m.state).toBe('winding');
    expect(m.turns).toBeCloseTo(before, 6);
    m.applyHandTurn(-TAU);
    expect(m.turns).toBeCloseTo(before + 1, 6);
    m.release();
    expect(m.state).toBe('playing');
  });

  it('runs down to a stop and stays there', () => {
    const m = new Mechanism();
    wind(m, 0.3);
    m.release();
    playOut(m);
    expect(m.state).toBe('idle');
    expect(m.turns).toBe(0);
    expect(m.angularSpeed).toBe(0);
  });

  it('turns the tree back the other way while it plays', () => {
    const m = new Mechanism();
    wind(m, 1);
    const start = m.shaftYaw;
    m.release();
    for (let i = 0; i < 120; i++) m.step(1 / 60);
    expect(m.shaftYaw).toBeGreaterThan(start);
  });

  it('lets the hand turn the tree back, letting the spring down', () => {
    const m = new Mechanism();
    wind(m, 2);
    m.grab();
    m.applyHandTurn(TAU); // the other way
    expect(m.turns).toBeCloseTo(1, 5);
    expect(m.turns).toBeGreaterThanOrEqual(0);
    m.applyHandTurn(TAU * 5);
    expect(m.turns).toBe(0);
  });

  it('gives a ratchet click at a steady rate while winding', () => {
    const m = new Mechanism();
    m.grab();
    let clicks = 0;
    for (let i = 0; i < 90; i++) clicks += m.applyHandTurn(-TAU / 90).ratchetClicks;
    expect(clicks).toBeGreaterThanOrEqual(17);
    expect(clicks).toBeLessThanOrEqual(19);
  });
});
