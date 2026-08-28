import { clamp } from '../core/rng';

/**
 * Everything is synthesised, so every sound can follow the deformation frame by
 * frame instead of being a canned clip: the motor's imbalance beats at the same
 * rate the tree wobbles, branches rub while they fold, the net creaks while it is
 * being pulled.
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  private motorGain: GainNode | null = null;
  private motorLfo: OscillatorNode | null = null;
  private rollerGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private stretchGain: GainNode | null = null;
  private stretchFilter: BiquadFilterNode | null = null;
  private lastTick = 0;
  private tickBudget = 0;

  get enabled(): boolean {
    return this.ctx !== null;
  }

  async start(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    await ctx.resume().catch(() => undefined);

    const master = ctx.createGain();
    master.gain.value = 0.85;
    master.connect(ctx.destination);
    this.master = master;

    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buf;

    this.buildMotor();
    this.buildRollers();
    this.buildWind();
    this.buildEngine();
    this.buildStretch();
  }

  private loopNoise(filter: BiquadFilterNode): GainNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise!;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(filter).connect(g).connect(this.master!);
    src.start();
    return g;
  }

  private buildMotor(): void {
    const ctx = this.ctx!;
    // motor body: a low saw through a lowpass
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 58;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    const g = ctx.createGain();
    g.gain.value = 0;
    osc.connect(lp).connect(g).connect(this.master!);
    osc.start();

    // rotational imbalance: the same 11.5 Hz beat the tree is shaken at
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 11.5;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.55;
    lfo.connect(lfoGain).connect(g.gain);
    lfo.start();
    this.motorLfo = lfo;
    this.motorGain = g;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.9;
    const rattle = this.loopNoise(bp);
    const rattleLfo = ctx.createOscillator();
    rattleLfo.frequency.value = 23;
    const rl = ctx.createGain();
    rl.gain.value = 0.1;
    rattleLfo.connect(rl).connect(rattle.gain);
    rattleLfo.start();
    this.motorRattle = rattle;
  }

  private motorRattle: GainNode | null = null;

  private buildRollers(): void {
    const ctx = this.ctx!;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    this.rollerGain = this.loopNoise(lp);
  }

  private buildWind(): void {
    const ctx = this.ctx!;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    this.windGain = this.loopNoise(lp);
    this.windGain.gain.value = 0.03;
  }

  private buildEngine(): void {
    const ctx = this.ctx!;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    this.engineGain = this.loopNoise(lp);
  }

  private buildStretch(): void {
    const ctx = this.ctx!;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400;
    bp.Q.value = 3.2;
    this.stretchFilter = bp;
    this.stretchGain = this.loopNoise(bp);
  }

  private ramp(node: GainNode | null, value: number, time = 0.08): void {
    if (!node || !this.ctx) return;
    const t = this.ctx.currentTime;
    node.gain.cancelScheduledValues(t);
    node.gain.setTargetAtTime(value, t, Math.max(0.01, time));
  }

  /** Shaker motor level, 0..1. */
  setMotor(level: number): void {
    const v = clamp(level, 0, 1);
    this.ramp(this.motorGain, v * 0.16);
    this.ramp(this.motorRattle, v * 0.05);
    if (this.motorLfo && this.ctx) {
      this.motorLfo.frequency.setTargetAtTime(9.5 + v * 2.6, this.ctx.currentTime, 0.1);
    }
  }

  setRollers(level: number): void {
    this.ramp(this.rollerGain, clamp(level, 0, 1) * 0.09);
  }

  setEngine(level: number): void {
    this.ramp(this.engineGain, clamp(level, 0, 1) * 0.14, 0.25);
  }

  setWind(level: number): void {
    this.ramp(this.windGain, clamp(level, 0, 1) * 0.05, 0.6);
  }

  /** Net under tension: level 0..1, tightness raises the creak. */
  setNetStretch(level: number, tightness: number): void {
    this.ramp(this.stretchGain, clamp(level, 0, 1) * 0.14, 0.05);
    if (this.stretchFilter && this.ctx) {
      this.stretchFilter.frequency.setTargetAtTime(900 + tightness * 1900, this.ctx.currentTime, 0.08);
    }
  }

  private burst(
    freq: number,
    q: number,
    duration: number,
    gain: number,
    type: BiquadFilterType = 'bandpass',
    sweepTo?: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise || !this.master) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.5;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + Math.min(0.02, duration * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + duration);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + duration + 0.05);
  }

  private tone(freq: number, duration: number, gain: number, type: OscillatorType = 'sine', to?: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  /** Trunk dropping into the clamp, then the jaws closing. */
  clampThunk(): void {
    this.tone(74, 0.34, 0.34, 'sine', 46);
    this.burst(420, 1.1, 0.16, 0.16, 'lowpass');
    window.setTimeout(() => this.burst(1200, 2.4, 0.1, 0.06), 130);
  }

  /** Branches sliding across one another. */
  branchRub(intensity: number): void {
    if (intensity <= 0.02) return;
    this.burst(1800 + Math.random() * 1400, 1.6, 0.12 + Math.random() * 0.1, 0.045 * intensity);
  }

  /** A dry needle hitting the ground. Rate-limited so it stays a patter. */
  needleTick(count: number, dt: number): void {
    if (!this.ctx) return;
    this.tickBudget = Math.min(6, this.tickBudget + count);
    this.lastTick += dt;
    if (this.tickBudget >= 1 && this.lastTick > 0.035) {
      this.lastTick = 0;
      this.tickBudget -= 1;
      this.burst(3400 + Math.random() * 2600, 5, 0.035, 0.055, 'bandpass');
    }
  }

  /** A tension strand letting go. */
  netSnap(): void {
    this.burst(2600, 6, 0.09, 0.16, 'bandpass', 900);
    this.tone(320, 0.09, 0.05, 'triangle', 180);
  }

  /** A branch springing back out - the "basa" itself. */
  branchOpen(strength: number): void {
    const s = clamp(strength, 0.2, 1);
    this.burst(1500 + Math.random() * 900, 1.1, 0.24 + s * 0.2, 0.1 * s, 'bandpass', 420);
    this.tone(150 + Math.random() * 60, 0.14, 0.05 * s, 'triangle', 90);
  }

  /** Whole-tree settle at the very end. */
  settle(): void {
    this.burst(900, 0.8, 0.7, 0.05, 'lowpass', 260);
  }

  /** Soft confirmation when a stage completes. */
  chime(): void {
    this.tone(523.25, 0.5, 0.06, 'sine');
    window.setTimeout(() => this.tone(783.99, 0.6, 0.05, 'sine'), 110);
  }

  suspend(): void {
    this.ctx?.suspend().catch(() => undefined);
  }

  resume(): void {
    this.ctx?.resume().catch(() => undefined);
  }
}
