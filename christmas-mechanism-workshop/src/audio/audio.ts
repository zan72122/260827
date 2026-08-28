import { clamp } from '../util/math';

/* ------------------------------------------------------------------ *
 * Everything you hear is synthesised here at run time.  No recordings,
 * no music files, nothing licensed.  The bells are modal syntheses whose
 * partials are inharmonic the way real cast brass is, and every strike is
 * fired by the rotor's own angle - not by a metronome.
 * ------------------------------------------------------------------ */

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted = false;
  private started = false;

  private fireGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private roomGain: GainNode | null = null;
  private rotorGains: GainNode[] = [];
  private rotorFilters: BiquadFilterNode[] = [];
  private crackleTimer = 0;
  private fireLevel = 0;

  get available() { return this.ctx !== null && this.ctx.state === 'running'; }

  /** Must be called from a user gesture (iOS). Safe to call repeatedly. */
  async unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.buildGraph();
    }
    if (this.ctx.state !== 'running') {
      try { await this.ctx.resume(); } catch { /* user may deny; game still plays silently */ }
    }
    if (!this.started && this.ctx.state === 'running') {
      this.started = true;
      this.startBeds();
    }
  }

  private buildGraph() {
    const ctx = this.ctx!;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 22;
    comp.ratio.value = 3.2;
    comp.attack.value = 0.005;
    comp.release.value = 0.24;
    comp.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(comp);

    // one shared noise buffer for fire, wind, wood, air
    const len = Math.floor(ctx.sampleRate * 2.5);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      // light pink shaping: a plain white hiss sounds like a broken speaker
      b0 = 0.99765 * b0 + w * 0.0990460;
      b1 = 0.96300 * b1 + w * 0.2965164;
      b2 = 0.57000 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
    }
    this.noise = buf;
  }

  private noiseSource(loop = true): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = loop;
    return s;
  }

  private startBeds() {
    const ctx = this.ctx!;
    // room tone: the low hush of a wooden building
    const room = this.noiseSource();
    const rf = ctx.createBiquadFilter();
    rf.type = 'lowpass'; rf.frequency.value = 190; rf.Q.value = 0.5;
    this.roomGain = ctx.createGain();
    this.roomGain.gain.value = 0.055;
    room.connect(rf).connect(this.roomGain).connect(this.master!);
    room.start();

    // wind past the frosted window
    const wind = this.noiseSource();
    const wf = ctx.createBiquadFilter();
    wf.type = 'bandpass'; wf.frequency.value = 420; wf.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.035;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.028;
    lfo.connect(lfoGain).connect(this.windGain.gain);
    lfo.start();
    wind.connect(wf).connect(this.windGain).connect(this.master!);
    wind.start();

    // fire bed, silent until a wick is lit
    const fire = this.noiseSource();
    const ff = ctx.createBiquadFilter();
    ff.type = 'bandpass'; ff.frequency.value = 640; ff.Q.value = 0.55;
    this.fireGain = ctx.createGain();
    this.fireGain.gain.value = 0;
    fire.connect(ff).connect(this.fireGain).connect(this.master!);
    fire.start();

    // two rotor air beds (pyramid, chimes), silent until they turn
    for (let i = 0; i < 2; i++) {
      const src = this.noiseSource();
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 380; f.Q.value = 0.8;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master!);
      src.start();
      this.rotorGains.push(g);
      this.rotorFilters.push(f);
    }
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx)
      this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }
  get isMuted() { return this.muted; }

  /* ---------------- bells ---------------- */

  /**
   * Modal bell: inharmonic partials with independent decays, plus the tick
   * of brass being touched. `strength` follows how hard the striker arrived,
   * `size` (0..1) makes the big bells darker and longer.
   */
  bell(freq: number, strength: number, size = 0.5) {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const s = clamp(strength, 0.05, 1);
    const out = ctx.createGain();
    out.gain.value = 0.28 * s;
    out.connect(this.master);

    const partials: [number, number, number][] = [
      [0.5, 0.20, 1.35],   // hum
      [1.0, 1.00, 1.10],   // prime
      [2.02, 0.52, 0.66],
      [2.76, 0.40, 0.44],
      [4.07, 0.22, 0.28],
      [5.42, 0.14, 0.19],
      [8.21, 0.07, 0.12],
    ];
    const lenScale = 0.62 + (1 - size) * 0.5;
    for (const [ratio, gain, decay] of partials) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      // a touch of random detune per strike: no two chimes are identical
      osc.frequency.value = freq * ratio * (1 + (Math.random() - 0.5) * 0.006);
      const g = ctx.createGain();
      const peak = gain * (0.55 + s * 0.55);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay * lenScale * (0.7 + s * 0.6));
      osc.connect(g).connect(out);
      osc.start(t);
      osc.stop(t + decay * lenScale * 1.4 + 0.1);
    }
    // the physical contact: a very short bright tick
    const tick = this.noiseSource(false);
    const tf = ctx.createBiquadFilter();
    tf.type = 'highpass'; tf.frequency.value = 2600;
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.16 * s, t);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    tick.connect(tf).connect(tg).connect(out);
    tick.start(t);
    tick.stop(t + 0.06);
  }

  /* ---------------- handling sounds ---------------- */

  /** Wood meeting wood: a body resonance plus a dry knock. */
  woodPlace(strength = 0.7, pitch = 200) {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.value = 0.5 * strength;
    g.connect(this.master);

    const n = this.noiseSource(false);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = pitch * 2.2; f.Q.value = 2.4;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    n.connect(f).connect(ng).connect(g);
    n.start(t); n.stop(t + 0.12);

    for (const [r, a, d] of [[1, 0.5, 0.16], [1.94, 0.22, 0.1], [3.1, 0.1, 0.06]]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = pitch * r;
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(a, t + 0.004);
      og.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(og).connect(g);
      o.start(t); o.stop(t + d + 0.05);
    }
  }

  /** Brass seating into brass: brighter, shorter, with a metallic ring. */
  metalSeat(strength = 0.7) {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.value = 0.32 * strength;
    g.connect(this.master);
    const n = this.noiseSource(false);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 3400; f.Q.value = 1.4;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.55, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    n.connect(f).connect(ng).connect(g);
    n.start(t); n.stop(t + 0.1);
    const o = ctx.createOscillator();
    o.type = 'sine'; o.frequency.value = 1180;
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.2, t + 0.003);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(og).connect(g);
    o.start(t); o.stop(t + 0.2);
  }

  /** Dry slide of a part along a shaft. */
  slide(dur = 0.28) {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this.noiseSource(false);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(380, t + dur);
    f.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.1, t + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f).connect(g).connect(this.master);
    n.start(t); n.stop(t + dur + 0.05);
  }

  /** The adult lighter: a piezo click, then gas catching. */
  lighterClick() {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this.noiseSource(false);
    const f = ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 3000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    n.connect(f).connect(g).connect(this.master);
    n.start(t); n.stop(t + 0.08);
  }

  igniteWhoosh() {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this.noiseSource(false);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(320, t);
    f.frequency.exponentialRampToValueAtTime(1500, t + 0.16);
    f.frequency.exponentialRampToValueAtTime(520, t + 0.5);
    f.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.2, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    n.connect(f).connect(g).connect(this.master);
    n.start(t); n.stop(t + 0.6);
  }

  /* ---------------- continuous beds ---------------- */

  /** `level` is roughly "how many flames are burning", 0..6. */
  setFire(level: number) {
    this.fireLevel = level;
    if (!this.ctx || !this.fireGain) return;
    const target = clamp(level, 0, 6) * 0.021;
    this.fireGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.4);
  }

  /** Airy note of a rotor turning; `speed` in rad/s. */
  setRotor(index: number, speed: number) {
    if (!this.ctx || !this.rotorGains[index]) return;
    const s = clamp(Math.abs(speed), 0, 6);
    this.rotorGains[index].gain.setTargetAtTime(s * 0.011, this.ctx.currentTime, 0.35);
    this.rotorFilters[index].frequency.setTargetAtTime(
      260 + s * 130, this.ctx.currentTime, 0.35);
  }

  /** One revolution of a wooden bearing: a soft creak-tick. */
  bearingTick(strength = 0.4, pitch = 150) {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(pitch * 1.2, t);
    o.frequency.exponentialRampToValueAtTime(pitch * 0.75, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05 * strength, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.22);
  }

  /** Random fire crackle, driven from the frame loop so it never loops. */
  update(dt: number) {
    if (!this.ctx || this.muted || this.fireLevel <= 0) return;
    this.crackleTimer -= dt * (0.5 + this.fireLevel * 0.55);
    if (this.crackleTimer > 0) return;
    this.crackleTimer = 0.25 + Math.random() * 0.9;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this.noiseSource(false);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1400 + Math.random() * 2600;
    f.Q.value = 3.5;
    const g = ctx.createGain();
    const amp = 0.02 + Math.random() * 0.05;
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03 + Math.random() * 0.05);
    n.connect(f).connect(g).connect(this.master!);
    n.start(t); n.stop(t + 0.12);
  }

  /** Ember breathing on the incense cone. */
  emberBreath() {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this.noiseSource(false);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 1.1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    n.connect(f).connect(g).connect(this.master);
    n.start(t); n.stop(t + 1.2);
  }

  /**
   * Small original figure for "that worked" - a pentatonic rise on soft
   * sines. Three notes, no melody worth calling a song.
   */
  chime(step: number) {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const scale = [523.25, 587.33, 659.25, 783.99, 880.0];
    const base = clamp(step, 0, 2);
    const notes = [scale[base], scale[base + 1], scale[base + 2]];
    notes.forEach((f, i) => {
      const t = ctx.currentTime + i * 0.13;
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = f;
      const o2 = ctx.createOscillator();
      o2.type = 'sine'; o2.frequency.value = f * 2.01;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      const g2 = ctx.createGain();
      g2.gain.value = 0.22;
      o.connect(g); o2.connect(g2).connect(g);
      g.connect(this.master!);
      o.start(t); o.stop(t + 1.0);
      o2.start(t); o2.stop(t + 1.0);
    });
  }

  /** A soft cue that a target is ready to receive something. */
  tick(pitch = 880) {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine'; o.frequency.value = pitch;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.2);
  }
}

export const audio = new AudioEngine();
