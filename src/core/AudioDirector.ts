import { clamp } from './math';

/**
 * All sound is synthesised at runtime — no audio files, no licensing tail.
 * The palette is deliberately industrial and low: a hydraulic hum that
 * follows the load, ratchet clicks, one low seating thud, three ceremony
 * chimes, and a crowd bed that can be hushed.
 */
export class AudioDirector {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private humGain: GainNode | null = null;
  private winchGain: GainNode | null = null;
  private crowdGain: GainNode | null = null;
  private crowdFilter: BiquadFilterNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private started = false;
  muted = false;

  /** Must be called from a user gesture. */
  async start(): Promise<void> {
    if (this.started) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.started = true;
    const ctx = new Ctor();
    this.ctx = ctx;
    await ctx.resume().catch(() => undefined);

    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(ctx.destination);

    const length = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      // Brown-ish noise: closer to machinery and crowd than white noise.
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    this.noiseBuffer = buffer;

    // Hydraulic / diesel bed for the crane.
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    const humFilter = ctx.createBiquadFilter();
    humFilter.type = 'lowpass';
    humFilter.frequency.value = 180;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 46;
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = 92;
    osc.connect(humFilter);
    osc2.connect(humFilter);
    humFilter.connect(this.humGain);
    this.humGain.connect(this.master);
    osc.start();
    osc2.start();

    // Winch: filtered noise with a whine on top.
    this.winchGain = ctx.createGain();
    this.winchGain.gain.value = 0;
    const winchSrc = ctx.createBufferSource();
    winchSrc.buffer = buffer;
    winchSrc.loop = true;
    const winchFilter = ctx.createBiquadFilter();
    winchFilter.type = 'bandpass';
    winchFilter.frequency.value = 900;
    winchFilter.Q.value = 2.5;
    winchSrc.connect(winchFilter);
    winchFilter.connect(this.winchGain);
    this.winchGain.connect(this.master);
    winchSrc.start();

    // Crowd bed outside the fence.
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0;
    this.crowdFilter = ctx.createBiquadFilter();
    this.crowdFilter.type = 'bandpass';
    this.crowdFilter.frequency.value = 620;
    this.crowdFilter.Q.value = 0.7;
    const crowdSrc = ctx.createBufferSource();
    crowdSrc.buffer = buffer;
    crowdSrc.loop = true;
    crowdSrc.connect(this.crowdFilter);
    this.crowdFilter.connect(this.crowdGain);
    this.crowdGain.connect(this.master);
    crowdSrc.start();
  }

  private ramp(param: AudioParam | undefined | null, value: number, time = 0.25): void {
    if (!this.ctx || !param) return;
    const now = this.ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setTargetAtTime(this.muted ? 0 : value, now, Math.max(0.02, time / 3));
  }

  setCraneLoad(active: boolean, load: number): void {
    this.ramp(this.humGain?.gain, active ? 0.045 + load * 0.075 : 0.012, 0.4);
  }

  setWinch(active: boolean): void {
    this.ramp(this.winchGain?.gain, active ? 0.035 : 0, 0.2);
  }

  setCrowd(level: number, brightness = 620): void {
    this.ramp(this.crowdGain?.gain, clamp(level, 0, 1) * 0.09, 0.6);
    if (this.crowdFilter) this.ramp(this.crowdFilter.frequency, brightness, 0.6);
  }

  /** Low seating impact through the foundation. */
  thud(strength = 1): void {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(78, now);
    osc.frequency.exponentialRampToValueAtTime(34, now + 0.45);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.5 * strength, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 1);

    if (this.noiseBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 420;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.22 * strength, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
      src.connect(f).connect(g).connect(this.master);
      src.start(now);
      src.stop(now + 0.4);
    }
  }

  /** Ratchet, latch and connector clicks. */
  click(pitch = 1400, level = 0.16): void {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = pitch;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.08);
  }

  /** The low ceremony signal, one tone per indicator lamp. */
  chime(index: number): void {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const freqs = [174, 220, 262];
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freqs[clamp(index, 0, 2)];
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.3, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 1.6);
  }

  /** Switch-on: a soft swell rather than a bang. */
  swell(): void {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    for (const [i, f] of [131, 196, 262, 392].entries()) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now + i * 0.22);
      gain.gain.exponentialRampToValueAtTime(0.16, now + i * 0.22 + 0.25);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.22 + 2.6);
      osc.connect(gain).connect(this.master);
      osc.start(now + i * 0.22);
      osc.stop(now + i * 0.22 + 2.8);
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.05);
    }
  }
}
