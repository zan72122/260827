/**
 * All sound is synthesised: the clamp thud, the shaker's out-of-balance rumble,
 * branch-on-branch rub, dry leaves hitting the ground, netting under tension and
 * the run of branches opening. Every voice is driven by the same numbers that
 * drive the deformation, so picture and sound cannot drift apart.
 */

export class YardAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noiseBuf!: AudioBuffer;

  // continuous voices
  private motorGain!: GainNode;
  private motorLp!: BiquadFilterNode;
  private thumpGain!: GainNode;
  private rubGain!: GainNode;
  private rubBp!: BiquadFilterNode;
  private netGain!: GainNode;
  private netBp!: BiquadFilterNode;

  private lastTick = 0;
  private started = false;

  /** Must be called from inside a user gesture (iOS unlocks audio only there). */
  start(): void {
    if (this.started) return;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    let ctx: AudioContext;
    try {
      ctx = new Ctor();
    } catch {
      // no audio device (or the browser refused): the game plays on in silence
      this.started = true;
      return;
    }
    this.ctx = ctx;
    this.started = true;

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);

    // shared pink-ish noise bed
    const len = Math.floor(ctx.sampleRate * 2.5);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099;
      b1 = 0.963 * b1 + w * 0.2965;
      b2 = 0.57 * b2 + w * 1.0526;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.16;
    }
    this.noiseBuf = buf;

    // ---- shaker motor: whine + out-of-balance thump ----
    this.motorGain = ctx.createGain();
    this.motorGain.gain.value = 0;
    this.motorLp = ctx.createBiquadFilter();
    this.motorLp.type = 'lowpass';
    this.motorLp.frequency.value = 420;
    const motorOsc = ctx.createOscillator();
    motorOsc.type = 'sawtooth';
    motorOsc.frequency.value = 58;
    const motorOsc2 = ctx.createOscillator();
    motorOsc2.type = 'square';
    motorOsc2.frequency.value = 173;
    const motorOsc2Gain = ctx.createGain();
    motorOsc2Gain.gain.value = 0.18;
    motorOsc.connect(this.motorLp);
    motorOsc2.connect(motorOsc2Gain).connect(this.motorLp);
    this.motorLp.connect(this.motorGain).connect(this.master);
    motorOsc.start();
    motorOsc2.start();

    this.thumpGain = ctx.createGain();
    this.thumpGain.gain.value = 0;
    const thumpOsc = ctx.createOscillator();
    thumpOsc.type = 'sine';
    thumpOsc.frequency.value = 27;
    const thumpLfo = ctx.createOscillator();
    thumpLfo.type = 'sine';
    thumpLfo.frequency.value = 7.4; // the imbalance beat
    const thumpLfoGain = ctx.createGain();
    thumpLfoGain.gain.value = 0.6;
    thumpLfo.connect(thumpLfoGain).connect(this.thumpGain.gain);
    thumpOsc.connect(this.thumpGain).connect(this.master);
    thumpOsc.start();
    thumpLfo.start();

    // ---- branch-on-branch rub ----
    this.rubGain = ctx.createGain();
    this.rubGain.gain.value = 0;
    this.rubBp = ctx.createBiquadFilter();
    this.rubBp.type = 'bandpass';
    this.rubBp.frequency.value = 2600;
    this.rubBp.Q.value = 0.8;
    const rubSrc = ctx.createBufferSource();
    rubSrc.buffer = buf;
    rubSrc.loop = true;
    rubSrc.connect(this.rubBp).connect(this.rubGain).connect(this.master);
    rubSrc.start();

    // ---- netting under tension ----
    this.netGain = ctx.createGain();
    this.netGain.gain.value = 0;
    this.netBp = ctx.createBiquadFilter();
    this.netBp.type = 'bandpass';
    this.netBp.frequency.value = 1400;
    this.netBp.Q.value = 5;
    const netSrc = ctx.createBufferSource();
    netSrc.buffer = buf;
    netSrc.loop = true;
    netSrc.playbackRate.value = 0.6;
    netSrc.connect(this.netBp).connect(this.netGain).connect(this.master);
    netSrc.start();

    // ---- yard air ----
    const ambGain = ctx.createGain();
    ambGain.gain.value = 0.06;
    const ambLp = ctx.createBiquadFilter();
    ambLp.type = 'lowpass';
    ambLp.frequency.value = 500;
    const ambSrc = ctx.createBufferSource();
    ambSrc.buffer = buf;
    ambSrc.loop = true;
    ambSrc.playbackRate.value = 0.35;
    ambSrc.connect(ambLp).connect(ambGain).connect(this.master);
    ambSrc.start();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  private burst(
    dur: number,
    filter: BiquadFilterType,
    freq: number,
    q: number,
    gain: number,
    rate = 1,
    freqEnd?: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = rate;
    const bq = ctx.createBiquadFilter();
    bq.type = filter;
    bq.frequency.setValueAtTime(freq, t);
    if (freqEnd !== undefined) bq.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), t + dur);
    bq.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + Math.min(0.03, dur * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bq).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  /** Trunk dropping into the clamp: a low mechanical seat. */
  clamp(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.28);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.5);
    this.burst(0.2, 'lowpass', 900, 1, 0.34, 0.7);
  }

  /** Steel latch / roller engagement. */
  latch(): void {
    this.burst(0.14, 'bandpass', 1900, 3.5, 0.22, 1.4);
    this.burst(0.3, 'lowpass', 320, 1, 0.2, 0.6);
  }

  /** 0..1 energy from the safety lever. */
  setShake(energy: number): void {
    if (!this.ctx) return;
    const t = this.now();
    this.motorGain.gain.setTargetAtTime(0.16 * energy, t, 0.08);
    this.motorLp.frequency.setTargetAtTime(300 + 460 * energy, t, 0.1);
    this.thumpGain.gain.setTargetAtTime(0.001 + 0.32 * energy, t, 0.09);
  }

  /** 0..1 aggregate branch speed. */
  setRub(amount: number): void {
    if (!this.ctx) return;
    const t = this.now();
    this.rubGain.gain.setTargetAtTime(Math.min(0.3, amount * 0.3), t, 0.06);
    this.rubBp.frequency.setTargetAtTime(1800 + amount * 2600, t, 0.1);
  }

  /** 0..1 tension in the netting while it is being stretched or pulled. */
  setNetTension(amount: number): void {
    if (!this.ctx) return;
    const t = this.now();
    this.netGain.gain.setTargetAtTime(Math.min(0.24, amount * 0.26), t, 0.07);
    this.netBp.frequency.setTargetAtTime(700 + amount * 2200, t, 0.12);
  }

  /** A dry leaf, a twig or a pinch of dust reaching the ground. */
  leafTick(strength = 1): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (t - this.lastTick < 0.028) return;
    this.lastTick = t;
    this.burst(0.09 + Math.random() * 0.06, 'highpass', 2200 + Math.random() * 1800, 0.7, 0.075 * strength, 1.6);
  }

  /** One rank of branches springing outward. */
  openBurst(strength: number): void {
    this.burst(0.34 + strength * 0.25, 'bandpass', 900 + Math.random() * 700, 1.1, 0.3 * strength, 1.25, 320);
    this.burst(0.2, 'highpass', 3200, 0.6, 0.13 * strength, 1.8);
  }

  /** The whole tree finding its rest. */
  settle(): void {
    this.burst(0.9, 'lowpass', 1500, 0.7, 0.12, 0.8, 400);
  }

  /** Truck moving between the yard and the hall. */
  haul(): void {
    this.burst(1.5, 'lowpass', 260, 1.2, 0.22, 0.45, 160);
  }
}
