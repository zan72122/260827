/**
 * Procedural kitchen sound. Everything is synthesised, so there is nothing to
 * download and nothing to wait for: cream is filtered noise, the knife is a
 * short downward sweep through the crumb, and the reveal is two soft wooden
 * notes rather than a fanfare.
 */
export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private pipeSource: AudioBufferSourceNode | null = null;
  private pipeGain: GainNode | null = null;
  enabled = true;

  /** Must be called from inside a user gesture on iOS. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);

    const len = Math.floor(this.ctx.sampleRate * 2);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = last * 0.72 + white * 0.28;
      data[i] = last;
    }
    this.noise = buf;
  }

  private burst(
    opts: {
      type: BiquadFilterType;
      from: number;
      to: number;
      q: number;
      gain: number;
      attack: number;
      decay: number;
    },
  ): void {
    if (!this.ctx || !this.master || !this.noise || !this.enabled) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = opts.type;
    filter.Q.value = opts.q;
    filter.frequency.setValueAtTime(opts.from, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, opts.to), t + opts.decay);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.gain, t + opts.attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.attack + opts.decay);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + opts.attack + opts.decay + 0.05);
  }

  private tone(freq: number, gain: number, decay: number, delay = 0): void {
    if (!this.ctx || !this.master || !this.enabled) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + decay + 0.05);
  }

  /** A slice lifted off the tray. */
  pick(): void {
    this.burst({ type: 'bandpass', from: 1800, to: 900, q: 1.2, gain: 0.05, attack: 0.004, decay: 0.07 });
  }

  /** A berry settling into the cream. */
  settle(): void {
    this.burst({ type: 'lowpass', from: 900, to: 180, q: 0.9, gain: 0.14, attack: 0.006, decay: 0.13 });
    this.tone(128, 0.05, 0.1);
  }

  /** Turning a berry in place. */
  turn(): void {
    this.burst({ type: 'bandpass', from: 700, to: 420, q: 2.2, gain: 0.06, attack: 0.005, decay: 0.08 });
  }

  /** Continuous piping. */
  pipe(on: boolean): void {
    if (!this.ctx || !this.master || !this.noise || !this.enabled) return;
    if (on && !this.pipeSource) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 520;
      filter.Q.value = 0.7;
      const g = this.ctx.createGain();
      g.gain.value = 0.0001;
      g.gain.linearRampToValueAtTime(0.075, this.ctx.currentTime + 0.14);
      src.connect(filter).connect(g).connect(this.master);
      src.start();
      this.pipeSource = src;
      this.pipeGain = g;
    } else if (!on && this.pipeSource && this.pipeGain) {
      const t = this.ctx.currentTime;
      this.pipeGain.gain.cancelScheduledValues(t);
      this.pipeGain.gain.setValueAtTime(this.pipeGain.gain.value, t);
      this.pipeGain.gain.linearRampToValueAtTime(0.0001, t + 0.16);
      this.pipeSource.stop(t + 0.2);
      this.pipeSource = null;
      this.pipeGain = null;
    }
  }

  /** Palette knife across the cream. */
  scrape(): void {
    this.burst({ type: 'bandpass', from: 2600, to: 700, q: 0.8, gain: 0.07, attack: 0.03, decay: 0.34 });
  }

  /** The blade going down through crumb. */
  cut(): void {
    this.burst({ type: 'lowpass', from: 3400, to: 320, q: 1.1, gain: 0.13, attack: 0.02, decay: 0.62 });
  }

  /** The slice coming free. */
  lift(): void {
    this.burst({ type: 'bandpass', from: 1200, to: 380, q: 1.4, gain: 0.09, attack: 0.02, decay: 0.3 });
  }

  /** Two warm notes when the cut face turns to the camera. */
  reveal(): void {
    this.tone(392, 0.055, 0.5);
    this.tone(587.33, 0.045, 0.62, 0.14);
  }
}
