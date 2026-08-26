// Synthesised WebAudio soundscape — no assets, fails silently if unavailable.
// Depth ambience vs surface wind matters more than any melody.
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private winchGain!: GainNode;
  private frictionGain!: GainNode;
  private windGain!: GainNode;
  private humGain!: GainNode;
  private noiseBuf!: AudioBuffer;
  private started = false;

  /** Must be called from a user gesture. */
  start(): void {
    if (this.started) return;
    try {
      const AC = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(ctx.destination);

      // shared looped noise
      const len = ctx.sampleRate * 2;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

      // deep borehole hum (very low, quiet)
      const hum = ctx.createOscillator();
      hum.type = 'sine';
      hum.frequency.value = 46;
      this.humGain = ctx.createGain();
      this.humGain.gain.value = 0.05;
      hum.connect(this.humGain).connect(this.master);
      hum.start();

      // winch drive: detuned saw pair through a lowpass
      const w1 = ctx.createOscillator(); w1.type = 'sawtooth'; w1.frequency.value = 82;
      const w2 = ctx.createOscillator(); w2.type = 'sawtooth'; w2.frequency.value = 83.7;
      const wf = ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 260; wf.Q.value = 2;
      this.winchGain = ctx.createGain(); this.winchGain.gain.value = 0;
      w1.connect(wf); w2.connect(wf); wf.connect(this.winchGain).connect(this.master);
      w1.start(); w2.start();

      // drill-vs-wall friction: bandpassed noise
      const fs = ctx.createBufferSource(); fs.buffer = this.noiseBuf; fs.loop = true;
      const ff = ctx.createBiquadFilter(); ff.type = 'bandpass'; ff.frequency.value = 420; ff.Q.value = 1.2;
      this.frictionGain = ctx.createGain(); this.frictionGain.gain.value = 0;
      fs.connect(ff).connect(this.frictionGain).connect(this.master);
      fs.start();

      // surface wind: lowpassed noise with slow wobble
      const ws = ctx.createBufferSource(); ws.buffer = this.noiseBuf; ws.loop = true;
      const wlp = ctx.createBiquadFilter(); wlp.type = 'lowpass'; wlp.frequency.value = 480;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.17;
      const lfoG = ctx.createGain(); lfoG.gain.value = 160;
      lfo.connect(lfoG).connect(wlp.frequency); lfo.start();
      this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
      ws.connect(wlp).connect(this.windGain).connect(this.master);
      ws.start();

      this.started = true;
    } catch {
      this.ctx = null;
    }
  }

  /** vel: |dp/dt| scaled ~0..1. depth: 1 deep, 0 surface. wind: 0..1. */
  update(vel: number, depth: number, wind: number, dt: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const move = Math.min(vel * 14, 1);
    this.winchGain.gain.setTargetAtTime(move * 0.10, t, 0.08);
    this.frictionGain.gain.setTargetAtTime(move * 0.075 * depth, t, 0.1);
    this.windGain.gain.setTargetAtTime(wind * 0.16, t, 0.35);
    this.humGain.gain.setTargetAtTime(0.05 * depth, t, 0.4);
  }

  private blip(freq: number, dur: number, gain: number, type: OscillatorType = 'sine'): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  private noiseBurst(freq: number, q: number, dur: number, gain: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t); s.stop(t + dur + 0.02);
  }

  /** cable tension + the core snapping off its base */
  crack(): void {
    this.noiseBurst(180, 2.5, 0.28, 0.35);
    this.blip(70, 0.35, 0.25, 'triangle');
    setTimeout(() => this.noiseBurst(900, 3, 0.1, 0.2), 90);
  }

  /** short bright ice sound when the drill breaks through the snow surface */
  breakthrough(): void {
    this.noiseBurst(1600, 1.2, 0.35, 0.3);
    this.noiseBurst(500, 2, 0.5, 0.2);
    this.blip(660, 0.4, 0.12);
  }

  /** hard clear tone: the core comes to rest on the cradle */
  corePlace(): void {
    this.blip(880, 0.9, 0.22);
    this.blip(1318, 0.7, 0.12);
    setTimeout(() => this.blip(660, 1.1, 0.15), 120);
  }

  hintTick(): void {
    this.noiseBurst(300, 4, 0.12, 0.08);
  }
}
