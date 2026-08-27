import { clamp, lerp } from './util';

/**
 * All sound is generated procedurally with WebAudio so the game needs no
 * asset downloads. Each sound is tied to a physical cause: coupling clank,
 * pump start, hose tension, nozzle open, continuous stream, impact wash,
 * steam hiss, fire crackle that fades with intensity, and after-drips.
 */

interface LoopVoice {
  gain: GainNode;
  target: number;
}

export class AudioSys {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noiseBuf!: AudioBuffer;
  private stream!: LoopVoice;
  private impact!: LoopVoice;
  private steam!: LoopVoice;
  private fireBed!: LoopVoice;
  private fireLow!: LoopVoice;
  private pumpGain: GainNode | null = null;
  private crackleAccum = 0;

  get ready(): boolean { return this.ctx !== null; }

  init(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(ctx.destination);

    // shared white noise buffer
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.stream = this.makeNoiseLoop([
      { type: 'bandpass', freq: 750, q: 0.6 },
      { type: 'lowpass', freq: 4200, q: 0.5 },
    ]);
    this.impact = this.makeNoiseLoop([
      { type: 'lowpass', freq: 480, q: 0.7 },
    ]);
    this.steam = this.makeNoiseLoop([
      { type: 'highpass', freq: 2800, q: 0.6 },
    ]);
    this.fireBed = this.makeNoiseLoop([
      { type: 'bandpass', freq: 950, q: 0.45 },
    ]);
    this.fireLow = this.makeNoiseLoop([
      { type: 'lowpass', freq: 180, q: 0.6 },
    ]);
    void ctx.resume();
  }

  resume(): void { if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume(); }

  private makeNoiseLoop(filters: { type: BiquadFilterType; freq: number; q: number }[]): LoopVoice {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    let node: AudioNode = src;
    for (const f of filters) {
      const biq = ctx.createBiquadFilter();
      biq.type = f.type;
      biq.frequency.value = f.freq;
      biq.Q.value = f.q;
      node.connect(biq);
      node = biq;
    }
    const gain = ctx.createGain();
    gain.gain.value = 0;
    node.connect(gain);
    gain.connect(this.master);
    src.start();
    return { gain, target: 0 };
  }

  /** per-frame gain smoothing + fire crackle scheduling */
  update(dt: number, s: { spray: number; heatHit: number; fireTotal: number }): void {
    if (!this.ctx) return;
    this.stream.target = 0.16 * s.spray;
    this.impact.target = 0.11 * s.spray;
    this.steam.target = clamp(0.14 * s.heatHit, 0, 0.14);
    const fire = clamp(s.fireTotal, 0, 3) / 3;
    this.fireBed.target = 0.055 * fire;
    this.fireLow.target = 0.075 * fire;
    for (const v of [this.stream, this.impact, this.steam, this.fireBed, this.fireLow]) {
      const cur = v.gain.gain.value;
      v.gain.gain.value = lerp(cur, v.target, clamp(dt * 9, 0, 1));
    }
    // random crackle bursts, denser + louder while fire is strong
    this.crackleAccum += dt * (2 + 16 * fire);
    while (this.crackleAccum > 1) {
      this.crackleAccum -= 1;
      if (fire > 0.01 && Math.random() < 0.85) {
        this.burst(600 + Math.random() * 2200, 0.02 + Math.random() * 0.05, 0.05 * fire * (0.4 + Math.random()));
      }
    }
  }

  private burst(freq: number, dur: number, gainV: number, type: BiquadFilterType = 'bandpass'): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const biq = ctx.createBiquadFilter();
    biq.type = type;
    biq.frequency.value = freq;
    biq.Q.value = 2.5;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gainV, t);
    g.gain.exponentialRampToValueAtTime(0.0004, t + dur);
    src.connect(biq); biq.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  /** metallic coupling clank */
  clank(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    for (const f of [1780, 2420, 3390]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f * (0.97 + Math.random() * 0.06);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.055, t);
      g.gain.exponentialRampToValueAtTime(0.0004, t + 0.16);
      osc.connect(g); g.connect(this.master);
      osc.start(t); osc.stop(t + 0.2);
    }
    this.burst(3800, 0.03, 0.14, 'highpass');
  }

  /** pump spin-up; leaves a quiet hum running */
  pumpStart(): void {
    if (!this.ctx || this.pumpGain) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(28, t);
    osc.frequency.linearRampToValueAtTime(55, t + 1.4);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 9;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 2.5;
    lfo.connect(lfoG); lfoG.connect(osc.frequency);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 240;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.075, t + 1.2);
    g.gain.exponentialRampToValueAtTime(0.028, t + 3.2);
    osc.connect(lp); lp.connect(g); g.connect(this.master);
    osc.start(t); lfo.start(t);
    this.pumpGain = g;
  }

  /** hose stiffening under pressure */
  hoseTension(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const biq = ctx.createBiquadFilter();
    biq.type = 'lowpass';
    const t = ctx.currentTime;
    biq.frequency.setValueAtTime(90, t);
    biq.frequency.linearRampToValueAtTime(320, t + 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.14, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 1.1);
    src.connect(biq); biq.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 1.2);
  }

  nozzleOpen(): void { this.burst(900, 0.12, 0.16); }
  nozzleClose(): void { this.burst(500, 0.16, 0.08, 'lowpass'); }

  drip(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const f0 = 700 + Math.random() * 500;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.45, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.035, t);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 0.1);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + 0.12);
  }
}
