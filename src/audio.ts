/**
 * All sound is synthesized with WebAudio — low, weighty, no cartoon effects.
 * The engine communicates mass: hydraulic idle, rope tension creaks, air
 * displacement tied to ball speed, material-specific impacts, and debris
 * clatter that arrives a beat after the hit.
 */
import { clamp } from './math';

export type WallKind = 'brick' | 'block' | 'concrete';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private whooshGain: GainNode | null = null;
  private whooshFilter: BiquadFilterNode | null = null;
  private lastCreak = 0;
  private lastClatter = 0;
  private clatterBudget = 0;

  /** Must be called from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(ctx.destination);

    // shared noise buffer
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    this.startAmbience();
    this.startWhoosh();
  }

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  private now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /** Low hydraulic idle of the machine, very quiet, continuous. */
  private startAmbience(): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = 0.028;
    g.connect(this.master!);

    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    o1.frequency.value = 46;
    const f1 = ctx.createBiquadFilter();
    f1.type = 'lowpass';
    f1.frequency.value = 120;
    o1.connect(f1).connect(g);
    o1.start();

    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = 92.5;
    const g2 = ctx.createGain();
    g2.gain.value = 0.4;
    o2.connect(g2).connect(g);
    o2.start();

    // slow engine wobble
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.7;
    const lg = ctx.createGain();
    lg.gain.value = 3.2;
    lfo.connect(lg).connect(o1.frequency);
    lfo.start();

    // airy noise floor
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    n.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = 240;
    const ng = ctx.createGain();
    ng.gain.value = 0.16;
    n.connect(nf).connect(ng).connect(g);
    n.start();
  }

  /** Continuous band-passed noise whose gain/pitch track ball speed. */
  private startWhoosh(): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 160;
    f.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master!);
    src.start();
    this.whooshGain = g;
    this.whooshFilter = f;
  }

  /** Call each frame with ball speed (m/s). */
  updateWhoosh(speed: number, dt: number): void {
    if (!this.whooshGain || !this.whooshFilter || !this.ctx) return;
    const t = clamp((speed - 1.6) / 8, 0, 1);
    const target = t * t * 0.22;
    const cur = this.whooshGain.gain.value;
    const k = 1 - Math.exp(-10 * dt);
    this.whooshGain.gain.value = cur + (target - cur) * k;
    this.whooshFilter.frequency.value = 120 + t * 320;
  }

  /** Small metallic creak while rope tension builds during the pull. */
  ropeCreak(intensity: number): void {
    if (!this.ready) return;
    const t = this.now();
    if (t - this.lastCreak < 0.28 + Math.random() * 0.2) return;
    this.lastCreak = t;
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.4 + Math.random() * 0.3;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 700 + Math.random() * 900;
    f.Q.value = 14;
    const g = ctx.createGain();
    const a = clamp(intensity, 0, 1) * 0.06;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(a, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t);
    src.stop(t + 0.3);
  }

  /** Short deep metallic ring when the rope snaps taut at release. */
  ropeTaut(): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = this.now();
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(320, t);
    o.frequency.exponentialRampToValueAtTime(180, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + 0.25);
  }

  /** Material-specific impact. energy 0..1. */
  impact(kind: WallKind, energy: number): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = this.now();
    const e = clamp(energy, 0.05, 1);

    // Common deep body thud — the ball's mass.
    const o = ctx.createOscillator();
    o.type = 'sine';
    const f0 = kind === 'concrete' ? 52 : kind === 'block' ? 68 : 62;
    o.frequency.setValueAtTime(f0 * (1 + e * 0.4), t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.6, t + 0.28);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.34 * e, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.4 + e * 0.25);
    o.connect(og).connect(this.master!);
    o.start(t);
    o.stop(t + 0.8);

    // Material voice
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    const nf = ctx.createBiquadFilter();
    const ng = ctx.createGain();
    if (kind === 'brick') {
      // dry crumble, mid band
      n.playbackRate.value = 0.9;
      nf.type = 'bandpass';
      nf.frequency.value = 620;
      nf.Q.value = 1.1;
      ng.gain.setValueAtTime(0.22 * e, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    } else if (kind === 'block') {
      // hollow knock with a resonant ring
      n.playbackRate.value = 0.7;
      nf.type = 'bandpass';
      nf.frequency.value = 260;
      nf.Q.value = 6;
      ng.gain.setValueAtTime(0.3 * e, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
      const ring = ctx.createOscillator();
      ring.type = 'triangle';
      ring.frequency.value = 210;
      const rg = ctx.createGain();
      rg.gain.setValueAtTime(0.05 * e, t + 0.01);
      rg.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      ring.connect(rg).connect(this.master!);
      ring.start(t);
      ring.stop(t + 0.35);
    } else {
      // concrete: sharp crack + heavy rumble
      n.playbackRate.value = 1.3;
      nf.type = 'highpass';
      nf.frequency.value = 1400;
      ng.gain.setValueAtTime(0.16 * e, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      const rum = ctx.createBufferSource();
      rum.buffer = this.noiseBuf;
      rum.playbackRate.value = 0.32;
      const rf = ctx.createBiquadFilter();
      rf.type = 'lowpass';
      rf.frequency.value = 160;
      const rg = ctx.createGain();
      rg.gain.setValueAtTime(0.4 * e, t + 0.015);
      rg.gain.exponentialRampToValueAtTime(0.0001, t + 0.65 + e * 0.3);
      rum.connect(rf).connect(rg).connect(this.master!);
      rum.start(t);
      rum.stop(t + 1.1);
    }
    n.connect(nf).connect(ng).connect(this.master!);
    n.start(t);
    n.stop(t + 0.7);
  }

  /** One piece of debris landing. size 0..1 roughly by mass. Rate limited. */
  debrisLand(kind: WallKind, size: number): void {
    if (!this.ready) return;
    const t = this.now();
    if (t - this.lastClatter > 0.5) this.clatterBudget = 0;
    if (this.clatterBudget > 7) return;
    if (t - this.lastClatter < 0.035) return;
    this.lastClatter = t;
    this.clatterBudget++;
    const ctx = this.ctx!;
    const s = clamp(size, 0.1, 1);
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    n.playbackRate.value = 0.6 + Math.random() * 0.5;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    const base = kind === 'concrete' ? 300 : kind === 'block' ? 380 : 520;
    f.frequency.value = base * (1.5 - s) + Math.random() * 160;
    f.Q.value = 2.2;
    const g = ctx.createGain();
    const a = 0.02 + s * 0.1;
    g.gain.setValueAtTime(a, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1 + s * 0.15);
    n.connect(f).connect(g).connect(this.master!);
    n.start(t);
    n.stop(t + 0.3);
    // heavier pieces add a floor thump
    if (s > 0.55) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(70, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.15);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.1 * s, t);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(og).connect(this.master!);
      o.start(t);
      o.stop(t + 0.3);
    }
  }

  /** Soft hiss as a dust cloud settles. */
  dustSettle(amount: number): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = this.now();
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    n.loop = true;
    n.playbackRate.value = 0.5;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    const g = ctx.createGain();
    const a = clamp(amount, 0, 1) * 0.045;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(a, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    n.connect(f).connect(g).connect(this.master!);
    n.start(t);
    n.stop(t + 2);
  }

  /** Low dusty swish when the ball skims the ground. */
  groundSkim(intensity: number): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = this.now();
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    n.playbackRate.value = 0.45;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500;
    const g = ctx.createGain();
    const a = clamp(intensity, 0, 1) * 0.08;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(a, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    n.connect(f).connect(g).connect(this.master!);
    n.start(t);
    n.stop(t + 0.6);
  }
}
