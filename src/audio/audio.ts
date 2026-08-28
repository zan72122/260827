import { clamp, lerp } from '../core/util';

/**
 * All sound is synthesised at run time. Nothing here plays a fixed sample, so
 * every strike of the finished bell differs in brightness, partial balance and
 * decay -- which is the whole point of the last scene.
 */

const BELL_RATIOS = [1.0, 1.508, 2.031, 2.446, 2.985, 3.512, 4.271, 5.093, 6.18];
const BELL_AMPS   = [1.0, 0.72, 0.55, 0.44, 0.34, 0.26, 0.2, 0.14, 0.09];
const BELL_DECAYS = [1.55, 1.25, 1.0, 0.86, 0.7, 0.58, 0.46, 0.36, 0.27];

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private bus!: GainNode;
  private ambienceGain!: GainNode;
  private swishGain!: GainNode;
  private swishFilter!: BiquadFilterNode;
  private noiseBuf!: AudioBuffer;
  private started = false;
  private _muted = false;
  private rngSeed = 1234;

  /** fundamental of the finished bell, set from the bell radius */
  bellF0 = 1750;
  /** per-bell partial detune signature so different sizes are recognisably different bells */
  private detune: number[] = BELL_RATIOS.map(() => 0);

  get muted() { return this._muted; }
  get ready() { return this.started && !!this.ctx; }

  /** Must be called inside a user gesture. Safe to call repeatedly. */
  unlock() {
    if (!this.started) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      const ctx: AudioContext = new AC({ latencyHint: 'interactive' });
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this._muted ? 0 : 0.9;

      // gentle safety limiter -- nothing here should ever startle a small child
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 22;
      comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.22;

      this.bus = ctx.createGain();
      this.bus.gain.value = 1;
      this.bus.connect(comp);
      comp.connect(this.master);
      this.master.connect(ctx.destination);

      this.noiseBuf = makeNoise(ctx, 2.5);
      this.buildAmbience();
      this.buildSwish();
      this.started = true;
    }
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume();
  }

  setMuted(m: boolean) {
    this._muted = m;
    if (this.ctx) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(m ? 0 : 0.9, t, 0.05);
    }
  }

  private rnd() {
    this.rngSeed = (this.rngSeed * 1664525 + 1013904223) >>> 0;
    return this.rngSeed / 4294967296;
  }

  /** Give this bell its own voice (called when a bell size is chosen). */
  tuneBell(radius: number) {
    // smaller shell -> higher, brighter
    this.bellF0 = clamp(1150 * Math.pow(0.185 / radius, 0.92), 900, 3100);
    this.detune = BELL_RATIOS.map(() => (this.rnd() - 0.5) * 0.018);
  }

  private buildAmbience() {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.4;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 70;
    const g = ctx.createGain(); g.gain.value = 0.0;
    src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(this.bus);
    // very slow breathing so the room is not a static hiss
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.055;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.006;
    lfo.connect(lfoG); lfoG.connect(g.gain); lfo.start();
    src.start();
    g.gain.setTargetAtTime(0.022, ctx.currentTime, 2.0);
    this.ambienceGain = g;
  }

  private buildSwish() {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 0.8;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(bp); bp.connect(g); g.connect(this.bus);
    src.start();
    this.swishFilter = bp;
    this.swishGain = g;
  }

  /** Continuous cloth/brush noise, driven by stroke speed (0..1). */
  setSwish(amount: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.swishGain.gain.setTargetAtTime(clamp(amount, 0, 1) * 0.085, t, 0.04);
    this.swishFilter.frequency.setTargetAtTime(1700 + amount * 2600, t, 0.06);
  }

  setAmbience(level: number) {
    if (!this.ctx) return;
    this.ambienceGain.gain.setTargetAtTime(0.022 * level, this.ctx.currentTime, 0.5);
  }

  // ---------------------------------------------------------------- helpers

  private noiseBurst(t0: number, dur: number, gain: number, freq: number, q: number, type: BiquadFilterType = 'bandpass') {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + this.rnd() * 0.5;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(this.bus);
    const off = this.rnd() * 1.5;
    src.start(t0, off, dur + 0.05);
    src.stop(t0 + dur + 0.06);
  }

  private tone(t0: number, freq: number, gain: number, decay: number, type: OscillatorType = 'sine', detune = 0) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = freq; o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t0 + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
    o.connect(g); g.connect(this.bus);
    o.start(t0); o.stop(t0 + decay + 0.05);
    return o;
  }

  // ------------------------------------------------------------- the sounds

  /** finger/object touching the oiled workbench */
  wood(velocity = 1) {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const v = clamp(velocity, 0.05, 1);
    this.noiseBurst(t, 0.09 + v * 0.05, 0.11 * v, 320 + this.rnd() * 90, 1.1);
    this.tone(t, 148 + this.rnd() * 26, 0.09 * v, 0.10 + v * 0.06, 'sine');
    this.tone(t, 236 + this.rnd() * 30, 0.045 * v, 0.07, 'triangle');
  }

  /** pellet landing on the still-open, still-dead metal: a dry click, no ring */
  dullMetal(velocity = 1) {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const v = clamp(velocity, 0.06, 1);
    this.noiseBurst(t, 0.05, 0.13 * v, 2400 + this.rnd() * 900, 1.6);
    // a couple of partials, but damped almost immediately: the shell is open
    this.tone(t, 780 + this.rnd() * 120, 0.10 * v, 0.055, 'sine');
    this.tone(t, 1290 + this.rnd() * 200, 0.06 * v, 0.038, 'sine');
    this.tone(t, 205, 0.05 * v, 0.045, 'sine');
  }

  /** press descending: low motor + linkage */
  pressMotor(on: boolean) {
    if (!this.ready) return;
    if (on && !this.motorNodes) {
      const ctx = this.ctx!;
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 47;
      const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 94;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 240; lp.Q.value = 3;
      const g = ctx.createGain(); g.gain.value = 0.0001;
      o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(this.bus);
      o.start(); o2.start();
      g.gain.setTargetAtTime(0.075, ctx.currentTime, 0.08);
      this.motorNodes = { o, o2, g };
    } else if (!on && this.motorNodes) {
      const { o, o2, g } = this.motorNodes;
      const t = this.ctx!.currentTime;
      g.gain.setTargetAtTime(0.0001, t, 0.09);
      o.stop(t + 0.6); o2.stop(t + 0.6);
      this.motorNodes = null;
    }
  }
  private motorNodes: { o: OscillatorNode; o2: OscillatorNode; g: GainNode } | null = null;

  /** die meets metal */
  pressStrike(v = 1) {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.noiseBurst(t, 0.16, 0.16 * v, 520, 0.9);
    this.tone(t, 88, 0.16 * v, 0.20, 'sine');
    this.tone(t, 132, 0.09 * v, 0.13, 'triangle');
    this.tone(t, 61, 0.13 * v, 0.28, 'sine');
  }

  /** a thick petal bending over the jig: "kakon", not "pera" */
  petalBend(v = 1) {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const s = clamp(v, 0.2, 1);
    const base = 430 + this.rnd() * 130;
    this.noiseBurst(t, 0.06, 0.10 * s, 1500 + this.rnd() * 500, 1.4);
    this.tone(t, base, 0.13 * s, 0.13, 'sine');
    this.tone(t, base * 2.31, 0.075 * s, 0.10, 'sine');
    this.tone(t, base * 3.7, 0.04 * s, 0.07, 'sine');
    this.tone(t + 0.012, 118, 0.10 * s, 0.15, 'sine'); // the jig taking the load
  }

  /** final clinch: jig squeezing the shell round */
  clinch() {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.noiseBurst(t, 0.35, 0.11, 380, 0.7);
    this.tone(t, 72, 0.17, 0.42, 'sine');
    this.tone(t + 0.18, 96, 0.10, 0.3, 'sine');
    this.noiseBurst(t + 0.30, 0.10, 0.13, 1900, 1.5);
    this.tone(t + 0.30, 540, 0.09, 0.16, 'sine');
    this.tone(t + 0.30, 1180, 0.05, 0.12, 'sine');
  }

  /** small mechanical tick used for hints and latches */
  tick(gain = 0.05) {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.noiseBurst(t, 0.035, gain, 2100, 2.0);
    this.tone(t, 640, gain * 0.7, 0.04, 'sine');
  }

  /** leather cord sliding through the loop */
  cord() {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.noiseBurst(t, 0.22, 0.05, 900, 0.8, 'bandpass');
    this.tone(t + 0.16, 300, 0.035, 0.09, 'sine');
  }

  /**
   * The finished bell. Modal synthesis: partial amplitudes and decay times both
   * move with strike strength, and a small random contact offset changes which
   * modes get excited, so repeated shakes never sound identical.
   */
  bellStrike(velocity: number, when = 0) {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + when;
    const v = clamp(velocity, 0.05, 1);
    const contact = this.rnd();           // where on the wall it hit
    const bright = 0.35 + 0.65 * v;
    const overall = 0.20 + 0.55 * Math.pow(v, 0.85);

    this.noiseBurst(t0, 0.03 + 0.02 * v, 0.09 * v, 3200 + contact * 1800, 1.8);

    for (let i = 0; i < BELL_RATIOS.length; i++) {
      // higher modes only really wake up on a firm strike
      const modeGate = clamp(1 - (i / BELL_RATIOS.length) * (1.35 - bright) * 2.2, 0, 1);
      // the contact point mutes some modes and favours others
      const shape = 0.55 + 0.45 * Math.cos((i + 1) * (0.7 + contact * 2.4));
      const amp = BELL_AMPS[i] * modeGate * (0.6 + 0.4 * shape) * overall * 0.16;
      if (amp < 0.0009) continue;
      const f = this.bellF0 * BELL_RATIOS[i] * (1 + this.detune[i] + (this.rnd() - 0.5) * 0.004);
      const dec = BELL_DECAYS[i] * (0.62 + 0.5 * v);
      this.tone(t0, f, amp, dec, 'sine');
      if (i < 3) {
        // a slightly detuned twin gives the characteristic shimmer/beating
        this.tone(t0, f * (1 + 0.0035 + this.rnd() * 0.003), amp * 0.6, dec * 0.92, 'sine');
      }
    }
    // body thump of the shell itself
    this.tone(t0, this.bellF0 * 0.32, overall * 0.05, 0.13, 'sine');
  }

  /** soft attention sound for the idle hint */
  hint() {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 620, 0.035, 0.16, 'sine');
    this.tone(t + 0.10, 830, 0.026, 0.2, 'sine');
  }
}

function makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    // cheap pink-ish shaping so the noise is not a harsh hiss
    b0 = 0.99765 * b0 + w * 0.0990460;
    b1 = 0.96300 * b1 + w * 0.2965164;
    b2 = 0.57000 * b2 + w * 1.0526913;
    d[i] = clamp((b0 + b1 + b2 + w * 0.1848) * 0.22, -1, 1);
  }
  // taper the seam so looping does not click
  const fade = Math.floor(ctx.sampleRate * 0.01);
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    d[i] *= k;
    d[len - 1 - i] = lerp(d[0], d[len - 1 - i], k);
  }
  return buf;
}
