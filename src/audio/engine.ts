/**
 * Audio foundation: one context, one master chain, two convolution spaces and
 * a shared noise buffer. Nothing here plays a pre-recorded loop; every sound
 * in the game is generated from these primitives.
 */

export type Space = 'room' | 'outdoor';

function renderImpulse(
  ctx: BaseAudioContext,
  seconds: number,
  decay: number,
  brightness: number,
): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buf = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const env = Math.pow(1 - t, decay);
      const white = Math.random() * 2 - 1;
      lp += (white - lp) * brightness;
      // a couple of early reflections keep the space from sounding like a wash
      const early =
        (i === Math.floor(rate * 0.011) ? 0.6 : 0) + (i === Math.floor(rate * 0.019) ? 0.4 : 0);
      d[i] = (lp * env + early) * (c === 0 ? 1 : 0.92);
    }
  }
  return buf;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  /** dry destination for close, direct sound */
  dry!: GainNode;
  /** everything routed here also feeds the room */
  wet!: GainNode;
  private convolver!: ConvolverNode;
  private roomIR!: AudioBuffer;
  private outdoorIR!: AudioBuffer;
  noise!: AudioBuffer;

  private muted = false;
  private volume = 0.85;
  private started = false;
  private listeners: Array<() => void> = [];

  get ready(): boolean {
    return this.started && this.ctx !== null && this.ctx.state === 'running';
  }

  onReady(fn: () => void): void {
    if (this.ready) fn();
    else this.listeners.push(fn);
  }

  /** Must be called from inside a user gesture. Safe to call repeatedly. */
  async ensure(): Promise<void> {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      this.build();
    }
    if (this.ctx.state !== 'running') {
      try {
        await this.ctx.resume();
      } catch {
        return;
      }
    }
    if (!this.started && this.ctx.state === 'running') {
      this.started = true;
      const fns = this.listeners.slice();
      this.listeners.length = 0;
      for (const fn of fns) fn();
    }
  }

  private build(): void {
    const ctx = this.ctx!;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;

    // A gentle bus compressor keeps a dense trot from clipping on a phone.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 22;
    comp.ratio.value = 3.2;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;

    this.master.connect(comp);
    comp.connect(ctx.destination);

    this.dry = ctx.createGain();
    this.dry.gain.value = 1;
    this.dry.connect(this.master);

    this.convolver = ctx.createConvolver();
    this.roomIR = renderImpulse(ctx, 0.85, 3.4, 0.42);
    this.outdoorIR = renderImpulse(ctx, 1.5, 6.5, 0.16);
    this.convolver.buffer = this.roomIR;

    this.wet = ctx.createGain();
    this.wet.gain.value = 0.3;
    this.wet.connect(this.convolver);
    const wetOut = ctx.createGain();
    wetOut.gain.value = 0.8;
    this.convolver.connect(wetOut);
    wetOut.connect(this.master);

    // 2 s of white noise, reused by every foley voice
    const len = Math.floor(ctx.sampleRate * 2);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setSpace(space: Space): void {
    if (!this.ctx) return;
    this.convolver.buffer = space === 'room' ? this.roomIR : this.outdoorIR;
    this.wet.gain.setTargetAtTime(space === 'room' ? 0.32 : 0.16, this.ctx.currentTime, 0.4);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.ctx && !this.muted) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
    }
  }

  get currentVolume(): number {
    return this.volume;
  }

  get now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  noiseSource(): AudioBufferSourceNode | null {
    if (!this.ctx) return null;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.loopEnd = 2;
    return s;
  }
}
