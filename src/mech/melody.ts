/**
 * ピンドラム — the pins on the drum, written out as an original tune for this
 * game.  Nothing here is transcribed from any existing recording or arrangement.
 *
 * The drum sits on the same shaft as the tree, so a pin's angle *is* its place in
 * the music.  One revolution = one phrase = REV_SECONDS at the regulated speed
 * (four bars of 4/4 at 100 bpm).  Because the drum only ever runs forward while
 * the spring is unwinding, the tune cannot run fast or slow: winding more only
 * buys more revolutions.
 */

export interface Pin {
  /** position around the drum, 0..1 of one revolution */
  phase: number;
  /** MIDI note number of the comb tooth this pin plucks */
  midi: number;
  /** how hard the pin lifts the tooth, 0..1 */
  vel: number;
  voice: 'lead' | 'low' | 'sparkle';
}

const SLOTS = 32; // eighth notes in one revolution

function pin(slot: number, midi: number, vel: number, voice: Pin['voice']): Pin {
  return { phase: slot / SLOTS, midi, vel, voice };
}

const lead: [number, number][] = [
  [0, 77], [2, 81], [3, 84], [4, 81], [6, 79], [7, 77],
  [8, 79], [10, 82], [11, 81], [12, 79], [14, 77],
  [16, 81], [18, 84], [19, 86], [20, 84], [22, 81], [23, 79],
  [24, 77], [26, 79], [27, 81], [28, 77], [30, 72],
];

const low: [number, number][] = [
  [0, 53], [4, 60], [8, 58], [12, 53], [16, 53], [20, 57], [24, 58], [28, 60],
];

const sparkle: [number, number][] = [[5, 89], [21, 89], [31, 81]];

/** Every pin on the drum, sorted by angle. */
export const PINS: Pin[] = [
  ...lead.map(([s, m], i) => pin(s, m, i % 4 === 0 ? 0.92 : 0.74, 'lead')),
  ...low.map(([s, m]) => pin(s, m, 0.5, 'low')),
  ...sparkle.map(([s, m]) => pin(s, m, 0.3, 'sparkle')),
].sort((a, b) => a.phase - b.phase);

/** The comb, low tooth first — one tooth per distinct note on the drum. */
export const COMB_NOTES: number[] = [...new Set(PINS.map((p) => p.midi))].sort((a, b) => a - b);

export const combIndexOf = (midi: number) => COMB_NOTES.indexOf(midi);

/**
 * Which pins pass the comb as the drum turns from `fromPhase` to `toPhase`
 * (forward only, wrapping is handled).  `revolutions` is how far the drum moved,
 * in turns; it may be more than one, and it may be zero.
 */
export function pinsBetween(fromPhase: number, revolutions: number): Pin[] {
  if (revolutions <= 0) return [];
  const out: Pin[] = [];
  const full = Math.min(Math.floor(revolutions), 4); // guard against long tab-away jumps
  const start = fromPhase;
  const end = fromPhase + revolutions;
  // one extra turn so pins just past the seam are not dropped
  for (let turn = 0; turn <= full + 1; turn++) {
    for (const p of PINS) {
      const at = Math.floor(start) + turn + p.phase;
      if (at > start && at <= end) out.push(p);
    }
  }
  return out;
}

export const midiToHz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
