import type { AudioEngine } from './engine';

/**
 * Everything that is not a bell: hooves, leather, iron, the sleigh's runners
 * hissing over packed snow, the horse's breath and a thin winter wind.
 *
 * The runner hiss, the wind and the breath are continuous nodes whose filters
 * are driven by the simulation; hoof falls, buckles and creaks are one-shots.
 */

export type Ground = 'snow' | 'wood';

export class FoleyBus {
  private input!: GainNode;
  private runner: { src: AudioBufferSourceNode; bp: BiquadFilterNode; gain: GainNode } | null =
    null;
  private wind: { src: AudioBufferSourceNode; lp: BiquadFilterNode; gain: GainNode } | null = null;
  private ready = false;

  constructor(private engine: AudioEngine) {}

  prepare(): void {
    const ctx = this.engine.ctx;
    if (!ctx || this.ready) return;
    this.input = ctx.createGain();
    this.input.gain.value = 1;
    this.input.connect(this.engine.dry);
    const send = ctx.createGain();
    send.gain.value = 0.35;
    this.input.connect(send);
    send.connect(this.engine.wet);

    // continuous runner hiss
    const rs = this.engine.noiseSource()!;
    const rbp = ctx.createBiquadFilter();
    rbp.type = 'bandpass';
    rbp.frequency.value = 900;
    rbp.Q.value = 0.55;
    const rg = ctx.createGain();
    rg.gain.value = 0;
    rs.connect(rbp);
    rbp.connect(rg);
    rg.connect(this.input);
    rs.start();
    this.runner = { src: rs, bp: rbp, gain: rg };

    // wind bed: barely there, and only outdoors
    const ws = this.engine.noiseSource()!;
    const wlp = ctx.createBiquadFilter();
    wlp.type = 'lowpass';
    wlp.frequency.value = 380;
    const wg = ctx.createGain();
    wg.gain.value = 0;
    ws.connect(wlp);
    wlp.connect(wg);
    wg.connect(this.input);
    ws.start();
    this.wind = { src: ws, lp: wlp, gain: wg };

    this.ready = true;
  }

  private env(
    when: number,
    attack: number,
    decay: number,
    peak: number,
  ): { g: GainNode; stop: number } | null {
    const ctx = this.engine.ctx;
    if (!ctx) return null;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(peak, when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
    return { g, stop: when + attack + decay + 0.02 };
  }

  private burst(
    when: number,
    freq: number,
    q: number,
    attack: number,
    decay: number,
    peak: number,
    pan: number,
    type: BiquadFilterType = 'bandpass',
  ): void {
    const ctx = this.engine.ctx;
    if (!ctx || !this.ready) return;
    const src = this.engine.noiseSource();
    if (!src) return;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const e = this.env(when, attack, decay, peak);
    if (!e) return;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(f);
    f.connect(e.g);
    e.g.connect(p);
    p.connect(this.input);
    src.start(when);
    src.stop(e.stop);
    src.onended = () => {
      src.disconnect();
      f.disconnect();
      e.g.disconnect();
      p.disconnect();
    };
  }

  private tone(
    when: number,
    f0: number,
    f1: number,
    decay: number,
    peak: number,
    pan: number,
    type: OscillatorType = 'sine',
  ): void {
    const ctx = this.engine.ctx;
    if (!ctx || !this.ready) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, when);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), when + decay);
    const e = this.env(when, 0.002, decay, peak);
    if (!e) return;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    osc.connect(e.g);
    e.g.connect(p);
    p.connect(this.input);
    osc.start(when);
    osc.stop(e.stop);
    osc.onended = () => {
      osc.disconnect();
      e.g.disconnect();
      p.disconnect();
    };
  }

  /** A hoof landing. Snow packs and squeaks; a plank floor knocks. */
  hoof(ground: Ground, weight: number, pan: number, when = 0): void {
    const ctx = this.engine.ctx;
    if (!ctx || !this.ready) return;
    const t = ctx.currentTime + Math.max(0, when);
    const w = Math.max(0.12, Math.min(1, weight));
    if (ground === 'snow') {
      this.burst(t, 1750 + Math.random() * 900, 0.7, 0.004, 0.075 + w * 0.06, 0.1 * w, pan);
      this.burst(t + 0.004, 480, 1.4, 0.004, 0.1, 0.075 * w, pan);
      this.tone(t, 96 + Math.random() * 18, 52, 0.1, 0.12 * w, pan);
    } else {
      this.burst(t, 2600, 1.5, 0.002, 0.045, 0.09 * w, pan);
      this.tone(t, 168 + Math.random() * 24, 78, 0.16, 0.2 * w, pan);
      this.tone(t + 0.006, 320, 210, 0.09, 0.07 * w, pan, 'triangle');
    }
  }

  /** Leather flexing, or a strap sliding against a coat. */
  leather(strength: number, pan = 0, when = 0): void {
    const ctx = this.engine.ctx;
    if (!ctx || !this.ready) return;
    const t = ctx.currentTime + Math.max(0, when);
    const s = Math.max(0.1, Math.min(1, strength));
    this.burst(t, 900 + Math.random() * 700, 3.5, 0.02, 0.13 + s * 0.12, 0.055 * s, pan);
    this.burst(t + 0.03, 2400, 2.2, 0.01, 0.07, 0.022 * s, pan);
  }

  /** The moment a bell shank seats and the keeper turns: a small, dry clack. */
  seat(pan = 0, when = 0): void {
    const ctx = this.engine.ctx;
    if (!ctx || !this.ready) return;
    const t = ctx.currentTime + Math.max(0, when);
    this.burst(t, 3200, 1.2, 0.001, 0.028, 0.3, pan, 'highpass');
    this.tone(t, 1650, 900, 0.05, 0.16, pan, 'triangle');
    this.tone(t + 0.002, 420, 300, 0.06, 0.11, pan);
    // the keeper turning against the leather
    this.burst(t + 0.055, 700, 4, 0.03, 0.16, 0.045, pan);
  }

  /** Iron buckle: tongue through the hole, then the frame settling. */
  buckle(pan = 0, when = 0): void {
    const ctx = this.engine.ctx;
    if (!ctx || !this.ready) return;
    const t = ctx.currentTime + Math.max(0, when);
    this.burst(t, 4200, 1, 0.001, 0.035, 0.26, pan, 'highpass');
    this.tone(t, 2400, 1500, 0.09, 0.13, pan, 'triangle');
    this.tone(t + 0.004, 780, 520, 0.12, 0.1, pan);
    this.burst(t + 0.09, 1200, 3, 0.02, 0.14, 0.05, pan);
  }

  /** A warm exhale through the nose; louder when the horse is working. */
  breath(effort: number, pan = 0, when = 0): void {
    const ctx = this.engine.ctx;
    if (!ctx || !this.ready) return;
    const t = ctx.currentTime + Math.max(0, when);
    const e = Math.max(0.1, Math.min(1, effort));
    this.burst(t, 520 + e * 420, 0.9, 0.05 + (1 - e) * 0.06, 0.24 + e * 0.2, 0.05 + e * 0.075, pan);
    this.burst(t + 0.02, 1600, 0.6, 0.06, 0.2, 0.014 * e, pan);
  }

  /** Wood creak of the sleigh body working over a bump. */
  sleighCreak(strength: number, pan = 0): void {
    const ctx = this.engine.ctx;
    if (!ctx || !this.ready) return;
    const t = ctx.currentTime;
    this.burst(t, 300 + Math.random() * 220, 8, 0.05, 0.22, 0.05 * strength, pan);
  }

  /** Runner hiss follows speed in both level and colour. */
  setRunner(speed: number, contact: number): void {
    const ctx = this.engine.ctx;
    if (!ctx || !this.runner) return;
    const s = Math.max(0, Math.min(1, speed));
    this.runner.gain.gain.setTargetAtTime(s * 0.14 * contact, ctx.currentTime, 0.12);
    this.runner.bp.frequency.setTargetAtTime(600 + s * 2600, ctx.currentTime, 0.2);
    this.runner.bp.Q.setTargetAtTime(0.4 + s * 0.5, ctx.currentTime, 0.3);
  }

  setWind(level: number): void {
    const ctx = this.engine.ctx;
    if (!ctx || !this.wind) return;
    this.wind.gain.gain.setTargetAtTime(level * 0.05, ctx.currentTime, 0.9);
    this.wind.lp.frequency.setTargetAtTime(260 + level * 260, ctx.currentTime, 1.2);
  }
}
