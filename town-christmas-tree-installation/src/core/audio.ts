/**
 * Fully procedural WebAudio sound design. No sampled/licensed recordings.
 * The context is created lazily and only resumed from a real user gesture,
 * which is what iOS Safari requires.
 */

type Loop = {
  gain: GainNode;
  setLevel(v: number, time?: number): void;
  setRate(v: number): void;
};

export class AudioKit {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private started = false;
  private _muted = false;

  private diesel: Loop | null = null;
  private hydraulic: Loop | null = null;
  private winch: Loop | null = null;

  get ready(): boolean {
    return this.started && this.ctx !== null && this.ctx.state === 'running';
  }

  get muted(): boolean {
    return this._muted;
  }

  setMuted(v: boolean): void {
    this._muted = v;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(v ? 0 : 0.9, this.ctx.currentTime, 0.05);
    }
  }

  /** Must be called from inside a user gesture handler. */
  async unlock(): Promise<void> {
    if (this.started) {
      if (this.ctx && this.ctx.state !== 'running') await this.ctx.resume().catch(() => undefined);
      return;
    }
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.started = true;

    const master = ctx.createGain();
    master.gain.value = this._muted ? 0 : 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    master.connect(comp).connect(ctx.destination);
    this.master = master;

    // Shared pink-ish noise buffer.
    const len = Math.floor(ctx.sampleRate * 2);
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
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
    }
    this.noise = buf;

    await ctx.resume().catch(() => undefined);
    this.buildLoops();
  }

  private noiseSource(loop = true): AudioBufferSourceNode | null {
    if (!this.ctx || !this.noise) return null;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = loop;
    return s;
  }

  private buildLoops(): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    // --- Diesel idle: low saw stack with a lumpy amplitude LFO. -----------
    {
      const g = ctx.createGain();
      g.gain.value = 0;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 420;
      const o1 = ctx.createOscillator();
      o1.type = 'sawtooth';
      o1.frequency.value = 34;
      const o2 = ctx.createOscillator();
      o2.type = 'square';
      o2.frequency.value = 17.5;
      const og = ctx.createGain();
      og.gain.value = 0.34;
      const rumble = this.noiseSource();
      const rg = ctx.createGain();
      rg.gain.value = 0.16;
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 8.5;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.11;
      lfo.connect(lfoGain).connect(og.gain);
      o1.connect(og);
      o2.connect(og);
      og.connect(lp);
      rumble?.connect(rg).connect(lp);
      lp.connect(g).connect(master);
      o1.start();
      o2.start();
      lfo.start();
      rumble?.start();
      this.diesel = {
        gain: g,
        setLevel: (v, t = 0.4) => g.gain.setTargetAtTime(v, ctx.currentTime, t),
        setRate: (v) => {
          o1.frequency.setTargetAtTime(28 + v * 26, ctx.currentTime, 0.25);
          o2.frequency.setTargetAtTime(14 + v * 13, ctx.currentTime, 0.25);
          lp.frequency.setTargetAtTime(360 + v * 520, ctx.currentTime, 0.25);
        },
      };
    }

    // --- Hydraulic: band-passed hiss + a faint pump whine. ---------------
    {
      const g = ctx.createGain();
      g.gain.value = 0;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1650;
      bp.Q.value = 1.1;
      const src = this.noiseSource();
      src?.connect(bp);
      const whine = ctx.createOscillator();
      whine.type = 'triangle';
      whine.frequency.value = 730;
      const wg = ctx.createGain();
      wg.gain.value = 0.05;
      whine.connect(wg).connect(g);
      bp.connect(g).connect(master);
      src?.start();
      whine.start();
      this.hydraulic = {
        gain: g,
        setLevel: (v, t = 0.08) => g.gain.setTargetAtTime(v, ctx.currentTime, t),
        setRate: (v) => {
          bp.frequency.setTargetAtTime(1200 + v * 1400, ctx.currentTime, 0.1);
          whine.frequency.setTargetAtTime(620 + v * 400, ctx.currentTime, 0.1);
        },
      };
    }

    // --- Winch drum: motor hum + rope-over-sheave texture. ---------------
    {
      const g = ctx.createGain();
      g.gain.value = 0;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 96;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      const og = ctx.createGain();
      og.gain.value = 0.2;
      const src = this.noiseSource();
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 2400;
      const ng = ctx.createGain();
      ng.gain.value = 0.05;
      o.connect(og).connect(lp).connect(g);
      src?.connect(hp).connect(ng).connect(g);
      g.connect(master);
      o.start();
      src?.start();
      this.winch = {
        gain: g,
        setLevel: (v, t = 0.06) => g.gain.setTargetAtTime(v, ctx.currentTime, t),
        setRate: (v) => o.frequency.setTargetAtTime(72 + v * 90, ctx.currentTime, 0.12),
      };
    }
  }

  setDiesel(level: number, rate = 0): void {
    this.diesel?.setLevel(level);
    this.diesel?.setRate(rate);
  }

  setHydraulic(level: number, rate = 0.5): void {
    this.hydraulic?.setLevel(level);
    this.hydraulic?.setRate(rate);
  }

  setWinch(level: number, rate = 0.5): void {
    this.winch?.setLevel(level);
    this.winch?.setRate(rate);
  }

  private env(node: AudioNode, gain: number, attack: number, decay: number): GainNode | null {
    const ctx = this.ctx;
    if (!ctx || !this.master) return null;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    node.connect(g).connect(this.master);
    return g;
  }

  /** Wide webbing sling taking load: creaking fibres. */
  slingCreak(strength = 1): void {
    const ctx = this.ctx;
    const src = this.noiseSource(false);
    if (!ctx || !src) return;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(340, ctx.currentTime);
    bp.frequency.linearRampToValueAtTime(520 + strength * 220, ctx.currentTime + 0.7);
    bp.Q.value = 6;
    src.connect(bp);
    this.env(bp, 0.24 * strength, 0.14, 0.85);
    src.start();
    src.stop(ctx.currentTime + 1.2);
  }

  /** Needles and small branches brushing each other. */
  branchRustle(strength = 1): void {
    const ctx = this.ctx;
    const src = this.noiseSource(false);
    if (!ctx || !src) return;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2600;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 8200;
    src.connect(hp).connect(lp);
    this.env(lp, 0.16 * strength, 0.05, 0.55 + strength * 0.4);
    src.start();
    src.stop(ctx.currentTime + 1.4);
  }

  /** Heavy mass meeting ground / socket: the "ゴトン". */
  heavyThud(strength = 1): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(88, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(31, ctx.currentTime + 0.32);
    this.env(o, 0.62 * strength, 0.012, 0.85);
    o.start();
    o.stop(ctx.currentTime + 1.1);

    const src = this.noiseSource(false);
    if (src) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 260;
      src.connect(lp);
      this.env(lp, 0.4 * strength, 0.006, 0.42);
      src.start();
      src.stop(ctx.currentTime + 0.7);
    }
    // Steel socket ring.
    const ring = ctx.createOscillator();
    ring.type = 'triangle';
    ring.frequency.value = 196 + strength * 40;
    this.env(ring, 0.09 * strength, 0.005, 0.5);
    ring.start();
    ring.stop(ctx.currentTime + 0.8);
  }

  /** Outrigger pad settling on its timber mat. */
  padSet(): void {
    this.heavyThud(0.55);
    const ctx = this.ctx;
    const src = this.noiseSource(false);
    if (!ctx || !src) return;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.9;
    src.connect(bp);
    this.env(bp, 0.2, 0.01, 0.3);
    src.start();
    src.stop(ctx.currentTime + 0.5);
  }

  /** Shackle / hook metal contact. */
  clank(pitch = 1): void {
    const ctx = this.ctx;
    if (!ctx) return;
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = (620 + i * 430) * pitch * (0.96 + Math.random() * 0.08);
      this.env(o, 0.11 / (i + 1), 0.004, 0.22 + i * 0.06);
      o.start();
      o.stop(ctx.currentTime + 0.4);
    }
  }

  /** Guy wire coming up to tension. */
  wireTension(t: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120 + t * 90, ctx.currentTime);
    o.frequency.linearRampToValueAtTime(180 + t * 260, ctx.currentTime + 0.35);
    this.env(o, 0.07, 0.03, 0.4);
    o.start();
    o.stop(ctx.currentTime + 0.6);
  }

  /** Ratchet click of the capstan. */
  ratchet(): void {
    const ctx = this.ctx;
    const src = this.noiseSource(false);
    if (!ctx || !src) return;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400 + Math.random() * 700;
    bp.Q.value = 8;
    src.connect(bp);
    this.env(bp, 0.1, 0.002, 0.05);
    src.start();
    src.stop(ctx.currentTime + 0.12);
  }

  /** The ceremonial switch. */
  bigSwitch(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(240, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(70, ctx.currentTime + 0.09);
    this.env(o, 0.25, 0.003, 0.16);
    o.start();
    o.stop(ctx.currentTime + 0.3);
    this.clank(1.6);
  }

  /** Small bulb group coming alive. */
  chime(index: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const scale = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];
    const f = scale[index % scale.length];
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    this.env(o, 0.16, 0.01, 0.9);
    o.start();
    o.stop(ctx.currentTime + 1.1);
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f * 2.01;
    this.env(o2, 0.05, 0.01, 0.6);
    o2.start();
    o2.stop(ctx.currentTime + 0.8);
  }

  /** Short town bell. */
  bell(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const partials = [1, 2.02, 2.98, 4.1, 5.4];
    partials.forEach((p, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 294 * p;
      this.env(o, 0.18 / (i + 1.2), 0.006, 2.4 / (i * 0.5 + 1));
      o.start();
      o.stop(ctx.currentTime + 3);
    });
  }

  /** Distant crowd cheer, synthesised (filtered noise swell + voiced formants). */
  cheer(): void {
    const ctx = this.ctx;
    const src = this.noiseSource(false);
    if (!ctx || !src) return;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(700, ctx.currentTime);
    bp.frequency.linearRampToValueAtTime(1500, ctx.currentTime + 0.5);
    bp.frequency.linearRampToValueAtTime(900, ctx.currentTime + 2.2);
    bp.Q.value = 0.7;
    src.connect(bp);
    this.env(bp, 0.3, 0.35, 2.1);
    src.start();
    src.stop(ctx.currentTime + 3);
    for (let i = 0; i < 5; i++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      const base = 300 + Math.random() * 260;
      o.frequency.setValueAtTime(base, ctx.currentTime + i * 0.06);
      o.frequency.linearRampToValueAtTime(base * 1.25, ctx.currentTime + 0.6 + i * 0.06);
      const g = this.env(o, 0.035, 0.3 + i * 0.05, 1.3);
      if (!g) break;
      o.start(ctx.currentTime + i * 0.06);
      o.stop(ctx.currentTime + 2.4);
    }
  }

  /** Soft confirmation blip for UI. */
  tick(up = true): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(up ? 620 : 480, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(up ? 940 : 320, ctx.currentTime + 0.09);
    this.env(o, 0.13, 0.006, 0.16);
    o.start();
    o.stop(ctx.currentTime + 0.3);
  }

  /** Air brake sigh as the trailer stops. */
  airBrake(): void {
    const ctx = this.ctx;
    const src = this.noiseSource(false);
    if (!ctx || !src) return;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    src.connect(hp);
    this.env(hp, 0.3, 0.02, 0.75);
    src.start();
    src.stop(ctx.currentTime + 1);
  }

  suspend(): void {
    void this.ctx?.suspend().catch(() => undefined);
  }

  resume(): void {
    void this.ctx?.resume().catch(() => undefined);
  }
}
