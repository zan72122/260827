import { describe, expect, it } from 'vitest';
import { COMB_NOTES, PINS, combIndexOf, midiToHz, pinsBetween } from '../../src/mech/melody';

describe('the pin drum', () => {
  it('has every pin inside one revolution, in order', () => {
    expect(PINS.length).toBeGreaterThan(20);
    for (const p of PINS) {
      expect(p.phase).toBeGreaterThanOrEqual(0);
      expect(p.phase).toBeLessThan(1);
      expect(p.vel).toBeGreaterThan(0);
    }
    for (let i = 1; i < PINS.length; i++) expect(PINS[i].phase).toBeGreaterThanOrEqual(PINS[i - 1].phase);
  });

  it('gives every pin a tooth on the comb', () => {
    for (const p of PINS) expect(combIndexOf(p.midi)).toBeGreaterThanOrEqual(0);
    expect(COMB_NOTES.length).toBeLessThanOrEqual(PINS.length);
    // a music-box comb spans a couple of octaves, not more
    expect(COMB_NOTES[COMB_NOTES.length - 1] - COMB_NOTES[0]).toBeLessThanOrEqual(40);
  });

  it('plays every pin exactly once per revolution', () => {
    const notes = pinsBetween(0, 1);
    expect(notes.length).toBe(PINS.length);
  });

  it('plays nothing when the drum is not moving forward', () => {
    expect(pinsBetween(0.3, 0)).toEqual([]);
    expect(pinsBetween(0.3, -0.5)).toEqual([]);
  });

  it('wraps across the seam without dropping or repeating a pin', () => {
    let total = 0;
    let phase = 0;
    const stepTurns = 0.017;
    for (let i = 0; i < Math.round(2 / stepTurns); i++) {
      total += pinsBetween(phase, stepTurns).length;
      phase = (phase + stepTurns) % 1;
    }
    // two revolutions of small steps: two passes of every pin, give or take the
    // partial revolution the rounding leaves
    expect(total).toBeGreaterThanOrEqual(2 * PINS.length - 2);
    expect(total).toBeLessThanOrEqual(2 * PINS.length + 2);
  });

  it('is in tune', () => {
    expect(midiToHz(69)).toBeCloseTo(440, 6);
    expect(midiToHz(81)).toBeCloseTo(880, 6);
  });
});
