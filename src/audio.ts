/** Web Audio only: motor, spool, line, drips and water are driven from the same
 *  state as the visuals, and panned by where their source sits on screen. */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private motorGain!: GainNode;
  private motorOsc!: OscillatorNode;
  private motorSub!: OscillatorNode;
  private motorFilter!: BiquadFilterNode;
  private whineGain!: GainNode;
  private whineOsc!: OscillatorNode;
  private lineGain!: GainNode;
  private lineFilter!: BiquadFilterNode;
  private ambientGain!: GainNode;
  private motorPan!: StereoPannerNode;
  private noiseBuffer!: AudioBuffer;
  ready = false;

  async start(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    this.ctx = ctx;
    await ctx.resume();

    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(ctx.destination);

    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = last * 0.72 + w * 0.28;
      d[i] = last;
    }
    this.noiseBuffer = buf;

    // hull and water outside
    const amb = ctx.createBufferSource();
    amb.buffer = buf;
    amb.loop = true;
    const ambF = ctx.createBiquadFilter();
    ambF.type = 'lowpass';
    ambF.frequency.value = 320;
    this.ambientGain = ctx.createGain();
    this.ambientGain.gain.value = 0.05;
    amb.connect(ambF).connect(this.ambientGain).connect(this.master);
    amb.start();

    // motor
    this.motorPan = ctx.createStereoPanner();
    this.motorGain = ctx.createGain();
    this.motorGain.gain.value = 0;
    this.motorFilter = ctx.createBiquadFilter();
    this.motorFilter.type = 'lowpass';
    this.motorFilter.frequency.value = 420;
    this.motorFilter.Q.value = 3.2;
    this.motorOsc = ctx.createOscillator();
    this.motorOsc.type = 'sawtooth';
    this.motorOsc.frequency.value = 58;
    this.motorSub = ctx.createOscillator();
    this.motorSub.type = 'triangle';
    this.motorSub.frequency.value = 29;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.55;
    this.motorOsc.connect(this.motorFilter);
    this.motorSub.connect(subGain).connect(this.motorFilter);
    this.motorFilter.connect(this.motorGain).connect(this.motorPan).connect(this.master);
    this.motorOsc.start();
    this.motorSub.start();

    this.whineOsc = ctx.createOscillator();
    this.whineOsc.type = 'sine';
    this.whineOsc.frequency.value = 430;
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whineOsc.connect(this.whineGain).connect(this.motorPan);
    this.whineOsc.start();

    // line running through the guides
    const lineSrc = ctx.createBufferSource();
    lineSrc.buffer = buf;
    lineSrc.loop = true;
    this.lineFilter = ctx.createBiquadFilter();
    this.lineFilter.type = 'bandpass';
    this.lineFilter.frequency.value = 2600;
    this.lineFilter.Q.value = 1.4;
    this.lineGain = ctx.createGain();
    this.lineGain.gain.value = 0;
    lineSrc.connect(this.lineFilter).connect(this.lineGain).connect(this.master);
    lineSrc.start();

    this.ready = true;
  }

  setMotor(level: number, pan: number): void {
    if (!this.ready || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.motorGain.gain.setTargetAtTime(0.16 * level, t, 0.06);
    this.motorOsc.frequency.setTargetAtTime(46 + 44 * level, t, 0.09);
    this.motorSub.frequency.setTargetAtTime(23 + 22 * level, t, 0.09);
    this.motorFilter.frequency.setTargetAtTime(300 + 520 * level, t, 0.1);
    this.whineGain.gain.setTargetAtTime(0.012 * level * level, t, 0.08);
    this.whineOsc.frequency.setTargetAtTime(360 + 300 * level, t, 0.09);
    this.lineGain.gain.setTargetAtTime(0.032 * level, t, 0.08);
    this.lineFilter.frequency.setTargetAtTime(2100 + 1900 * level, t, 0.1);
    this.motorPan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.12);
  }

  private burst(
    freq: number,
    dur: number,
    gain: number,
    pan: number,
    type: 'noise' | 'tone',
    sweep = 0.4,
  ): void {
    if (!this.ready || !this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p).connect(this.master);
    if (type === 'noise') {
      const s = ctx.createBufferSource();
      s.buffer = this.noiseBuffer;
      s.playbackRate.value = 0.7 + Math.random() * 0.9;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.setValueAtTime(freq, t);
      f.frequency.exponentialRampToValueAtTime(Math.max(120, freq * sweep), t + dur);
      f.Q.value = 1.6;
      s.connect(f).connect(g);
      s.start(t);
      s.stop(t + dur + 0.02);
    } else {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(60, freq * sweep), t + dur);
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 0.02);
    }
  }

  drip(pan: number, size: number): void {
    this.burst(900 + size * 1400, 0.07 + size * 0.05, 0.05 + size * 0.05, pan, 'tone', 0.35);
    this.burst(2600, 0.035, 0.022, pan, 'noise', 0.5);
  }

  surfaceBreak(pan: number): void {
    this.burst(1400, 0.2, 0.1, pan, 'noise', 0.25);
    this.burst(300, 0.16, 0.05, pan, 'tone', 0.5);
  }

  bite(pan: number, strength: number): void {
    this.burst(150 + strength * 90, 0.1 + strength * 0.06, 0.05 * strength, pan, 'tone', 0.55);
    this.burst(1800, 0.045, 0.02 * strength, pan, 'noise', 0.4);
  }

  tankSplash(pan: number): void {
    this.burst(1100, 0.25, 0.07, pan, 'noise', 0.3);
  }

  suspend(): void {
    void this.ctx?.suspend();
  }
  resume(): void {
    void this.ctx?.resume();
  }
}
