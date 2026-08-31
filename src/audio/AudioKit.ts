import { clamp } from '../util/math';

/**
 * Sound is synthesised, so nothing is downloaded and nothing needs attributing.
 *
 * Nothing starts until the child's first touch, as Safari requires, and every
 * sound is optional: with the volume off the game plays exactly the same, and
 * no instruction is carried by audio alone.
 */
export class AudioKit {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private pipeGain: GainNode | null = null;
  private pipeFilter: BiquadFilterNode | null = null;
  private turnGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private started = false;
  muted = false;

  /** Call from inside a real user gesture. */
  start(): void {
    if (this.started) return;
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;
      this.started = true;

      const master = ctx.createGain();
      master.gain.value = 0.85;
      master.connect(ctx.destination);
      this.master = master;

      // shared noise source
      const len = Math.floor(ctx.sampleRate * 2);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      let v = 0;
      for (let i = 0; i < len; i++) {
        v = v * 0.86 + (Math.random() * 2 - 1) * 0.14;
        data[i] = v * 3.2;
      }
      this.noiseBuffer = buf;

      // continuous room tone
      const room = ctx.createBufferSource();
      room.buffer = buf;
      room.loop = true;
      const roomFilter = ctx.createBiquadFilter();
      roomFilter.type = 'lowpass';
      roomFilter.frequency.value = 320;
      const roomGain = ctx.createGain();
      roomGain.gain.value = 0.012;
      room.connect(roomFilter).connect(roomGain).connect(master);
      room.start();

      // piping hiss, gated by how much cream is actually moving
      const pipe = ctx.createBufferSource();
      pipe.buffer = buf;
      pipe.loop = true;
      const pf = ctx.createBiquadFilter();
      pf.type = 'bandpass';
      pf.frequency.value = 900;
      pf.Q.value = 0.7;
      const pg = ctx.createGain();
      pg.gain.value = 0;
      pipe.connect(pf).connect(pg).connect(master);
      pipe.start();
      this.pipeFilter = pf;
      this.pipeGain = pg;

      // turntable rumble
      const turn = ctx.createBufferSource();
      turn.buffer = buf;
      turn.loop = true;
      const tf = ctx.createBiquadFilter();
      tf.type = 'lowpass';
      tf.frequency.value = 180;
      const tg = ctx.createGain();
      tg.gain.value = 0;
      turn.connect(tf).connect(tg).connect(master);
      turn.start();
      this.turnGain = tg;
    } catch {
      this.ctx = null;
    }
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.05);
    }
  }

  /** 0..1, how hard the cream is being pushed out right now. */
  setPiping(amount: number, brightness = 0): void {
    if (!this.pipeGain || !this.ctx) return;
    const a = clamp(amount, 0, 1);
    this.pipeGain.gain.setTargetAtTime(a * 0.05, this.ctx.currentTime, 0.04);
    if (this.pipeFilter) {
      this.pipeFilter.frequency.setTargetAtTime(700 + brightness * 900, this.ctx.currentTime, 0.08);
    }
  }

  setTurning(amount: number): void {
    if (!this.turnGain || !this.ctx) return;
    this.turnGain.gain.setTargetAtTime(clamp(amount, 0, 1) * 0.05, this.ctx.currentTime, 0.06);
  }

  private tone(freq: number, when: number, dur: number, gain: number, type: OscillatorType = 'sine'): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime + when);
    g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + when + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + when + dur);
    osc.connect(g).connect(master);
    osc.start(ctx.currentTime + when);
    osc.stop(ctx.currentTime + when + dur + 0.05);
  }

  private puff(when: number, dur: number, gain: number, freq: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || !this.noiseBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime + when);
    g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + when + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + when + dur);
    src.connect(f).connect(g).connect(master);
    src.start(ctx.currentTime + when);
    src.stop(ctx.currentTime + when + dur + 0.05);
  }

  petalDone(index: number): void {
    const scale = [523.25, 587.33, 659.25, 783.99, 880.0];
    this.tone(scale[index % scale.length], 0, 0.5, 0.08, 'triangle');
    this.tone(scale[index % scale.length] * 2, 0.005, 0.28, 0.02, 'sine');
  }

  flowerDone(): void {
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((n, i) => {
      this.tone(n, i * 0.11, 0.6, 0.075, 'triangle');
      this.tone(n * 2, i * 0.11 + 0.004, 0.3, 0.018, 'sine');
    });
  }

  tap(): void {
    this.tone(880, 0, 0.14, 0.05, 'triangle');
  }

  place(): void {
    this.puff(0, 0.14, 0.05, 420);
    this.tone(392, 0.02, 0.35, 0.05, 'sine');
  }

  scrape(amount: number): void {
    this.setTurning(amount);
  }

  blow(): void {
    this.puff(0, 0.42, 0.09, 620);
  }

  flameOut(): void {
    this.puff(0, 0.2, 0.06, 300);
    this.tone(196, 0.02, 0.45, 0.04, 'sine');
  }

  cut(): void {
    this.puff(0, 0.3, 0.045, 1400);
  }

  given(): void {
    this.tone(523.25, 0, 0.7, 0.07, 'triangle');
    this.tone(659.25, 0.13, 0.75, 0.07, 'triangle');
    this.tone(783.99, 0.26, 0.9, 0.07, 'triangle');
    this.tone(1046.5, 0.4, 1.0, 0.05, 'sine');
  }

  dispose(): void {
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
    this.started = false;
  }
}
