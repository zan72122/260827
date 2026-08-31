import { midiToHz } from '../mech/melody';
import { clamp } from '../core/units';

/**
 * オルゴールの発音 — every sound in this game is synthesised here at run time.
 * There are no recordings of any kind in the build.
 *
 * A comb tooth is a struck steel bar: a fast attack, a set of inharmonic
 * partials that die away much sooner than the fundamental, and the whole thing
 * heard through a small wooden box.  The box is a short impulse response that is
 * generated procedurally when the context opens.
 */

const PARTIALS: Array<[ratio: number, gain: number, decayScale: number]> = [
  [1.0, 1.0, 1.0],
  [2.76, 0.34, 0.3],
  [5.4, 0.16, 0.16],
  [8.93, 0.08, 0.1],
  [13.34, 0.04, 0.07],
];

export class MusicBoxAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private dry!: GainNode;
  private send!: GainNode;
  private box!: ConvolverNode;
  private whir!: GainNode;
  private whirOsc!: OscillatorNode;
  private whirNoise!: AudioBufferSourceNode;
  private whirFilter!: BiquadFilterNode;
  private clickBuffer!: AudioBuffer;
  private muted = false;
  private lastClick = 0;

  get running() {
    return this.ctx?.state === 'running';
  }
  get created() {
    return this.ctx !== null;
  }
  get isMuted() {
    return this.muted;
  }

  /** Must be called from inside a user gesture the first time. */
  async unlock(): Promise<void> {
    if (!this.ctx) {
      const Ctor: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      this.build();
    }
    if (this.ctx.state !== 'running') {
      try {
        await this.ctx.resume();
      } catch {
        /* iOS can reject outside a gesture; the next tap tries again */
      }
    }
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.02);
    }
  }

  private build() {
    const ctx = this.ctx!;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(ctx.destination);

    this.dry = ctx.createGain();
    this.dry.gain.value = 0.82;
    this.dry.connect(this.master);

    this.box = ctx.createConvolver();
    this.box.buffer = this.makeBoxImpulse(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.34;
    this.box.connect(wet);
    wet.connect(this.master);

    this.send = ctx.createGain();
    this.send.gain.value = 1;
    this.send.connect(this.box);

    // governor / winding noise bed, silent until asked for
    this.whir = ctx.createGain();
    this.whir.gain.value = 0;
    this.whirFilter = ctx.createBiquadFilter();
    this.whirFilter.type = 'bandpass';
    this.whirFilter.frequency.value = 420;
    this.whirFilter.Q.value = 1.6;
    this.whirFilter.connect(this.whir);
    this.whir.connect(this.dry);

    this.whirNoise = ctx.createBufferSource();
    this.whirNoise.buffer = this.makeNoise(ctx, 2);
    this.whirNoise.loop = true;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.55;
    this.whirNoise.connect(noiseGain);
    noiseGain.connect(this.whirFilter);
    this.whirNoise.start();

    this.whirOsc = ctx.createOscillator();
    this.whirOsc.type = 'triangle';
    this.whirOsc.frequency.value = 74;
    const oscGain = ctx.createGain();
    oscGain.gain.value = 0.09;
    this.whirOsc.connect(oscGain);
    oscGain.connect(this.whirFilter);
    this.whirOsc.start();

    this.clickBuffer = this.makeNoise(ctx, 0.06);
  }

  private makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      last = last * 0.72 + w * 0.28; // gently coloured, not hissy
      d[i] = last;
    }
    return buf;
  }

  /** A small oiled wooden box: a few early reflections and a short warm tail. */
  private makeBoxImpulse(ctx: AudioContext): AudioBuffer {
    const dur = 0.42;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    const taps = [0.0031, 0.0057, 0.0089, 0.0134, 0.0191];
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / ctx.sampleRate;
        const env = Math.exp(-t * 11) * (1 - t / dur);
        const w = (Math.random() * 2 - 1) * env;
        lp = lp * 0.6 + w * 0.4;
        d[i] = lp * 0.6;
      }
      taps.forEach((tap, k) => {
        const idx = Math.floor(tap * ctx.sampleRate) + ch * 7;
        if (idx < n) d[idx] += (k % 2 ? -1 : 1) * 0.5 * Math.pow(0.72, k);
      });
      // a low body resonance around 190 Hz, the air inside the box
      for (let i = 0; i < n; i++) {
        const t = i / ctx.sampleRate;
        d[i] += Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 24) * 0.18;
      }
    }
    return buf;
  }

  /** One pin lifting one comb tooth. */
  pluck(midi: number, vel: number, voice: 'lead' | 'low' | 'sparkle' = 'lead') {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.muted) return;
    const t = ctx.currentTime + 0.002;
    const hz = midiToHz(midi);
    const baseDecay = voice === 'low' ? 3.4 : hz > 900 ? 1.25 : 2.3;
    const count = voice === 'lead' ? 5 : voice === 'low' ? 4 : 3;
    const amp = clamp(vel, 0, 1) * (voice === 'low' ? 0.2 : voice === 'sparkle' ? 0.11 : 0.17);

    const bus = ctx.createGain();
    bus.gain.value = 1;
    bus.connect(this.dry);
    bus.connect(this.send);

    let longest = 0;
    for (let i = 0; i < count; i++) {
      const [ratio, g, ds] = PARTIALS[i];
      const f = hz * ratio;
      if (f > ctx.sampleRate * 0.45) continue;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      // a struck bar sags a few cents as it settles
      osc.detune.setValueAtTime(6, t);
      osc.detune.exponentialRampToValueAtTime(0.01, t + 0.12);
      const gn = ctx.createGain();
      const decay = baseDecay * ds;
      longest = Math.max(longest, decay);
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(Math.max(0.0002, amp * g), t + 0.003);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      osc.connect(gn);
      gn.connect(bus);
      osc.start(t);
      osc.stop(t + decay + 0.05);
    }

    // the pin itself touching the tooth
    const click = ctx.createBufferSource();
    click.buffer = this.clickBuffer;
    const cf = ctx.createBiquadFilter();
    cf.type = 'bandpass';
    cf.frequency.value = clamp(hz * 3.2, 300, 6000);
    cf.Q.value = 1.1;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(amp * 0.5, t);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    click.connect(cf);
    cf.connect(cg);
    cg.connect(bus);
    click.start(t);
    click.stop(t + 0.07);

    setTimeout(() => bus.disconnect(), (longest + 0.3) * 1000);
  }

  /** The winding ratchet. */
  ratchet(strength = 1) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.muted) return;
    const t = ctx.currentTime;
    if (t - this.lastClick < 0.018) return;
    this.lastClick = t;
    const src = ctx.createBufferSource();
    src.buffer = this.clickBuffer;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1500 + Math.random() * 500;
    f.Q.value = 3.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.09 * strength, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    src.connect(f);
    f.connect(g);
    g.connect(this.dry);
    g.connect(this.send);
    src.start(t);
    src.stop(t + 0.06);
  }

  /** Wood landing on wood: a leaf board seating in its groove. */
  seatKnock(pitch = 1) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.muted) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.clickBuffer;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 260 * pitch;
    f.Q.value = 4.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.32, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.connect(f);
    f.connect(g);
    g.connect(this.dry);
    g.connect(this.send);
    src.start(t);
    src.stop(t + 0.2);

    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(196 * pitch, t);
    body.frequency.exponentialRampToValueAtTime(150 * pitch, t + 0.1);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.16, t);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    body.connect(bg);
    bg.connect(this.dry);
    body.start(t);
    body.stop(t + 0.18);
  }

  /** The over-wind clutch letting go. */
  slip() {
    this.ratchet(0.5);
  }

  /**
   * Level of the running-noise bed.  `speed` is 0..1 of the regulated speed,
   * `winding` adds the drier sound of the spring being wound.  When both are
   * zero this settles to silence — nothing here drones on its own.
   */
  setRunning(speed: number, winding: number) {
    const ctx = this.ctx;
    if (!ctx || !this.whir) return;
    const target = clamp(speed, 0, 1) * 0.05 + clamp(winding, 0, 1) * 0.035;
    this.whir.gain.setTargetAtTime(target, ctx.currentTime, 0.08);
    this.whirFilter.frequency.setTargetAtTime(
      340 + clamp(speed, 0, 1) * 260 + clamp(winding, 0, 1) * 120,
      ctx.currentTime,
      0.1,
    );
    this.whirOsc.frequency.setTargetAtTime(62 + clamp(speed, 0, 1) * 26, ctx.currentTime, 0.1);
  }
}
