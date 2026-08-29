/**
 * Small procedural sound kit (no asset files, no network).
 * Everything is short, soft and low - it is aimed at a 4 year old.
 */
export class AudioKit {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private pourGain: GainNode | null = null;
  private pourSrc: AudioBufferSourceNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  muted = false;

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.ctx.destination);
    // 2 s of pink-ish noise reused by every noisy sound.
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099;
      b1 = 0.963 * b1 + w * 0.2965;
      b2 = 0.57 * b2 + w * 1.0526;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
    }
    this.noiseBuf = buf;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType, glideTo?: number, delay = 0) {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.now() + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, glideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(dur: number, gain: number, freq: number, q = 1, delay = 0, type: BiquadFilterType = 'bandpass') {
    if (!this.ctx || !this.master || !this.noiseBuf || this.muted) return;
    const t = this.now() + delay;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t);
    s.stop(t + dur + 0.05);
  }

  /** "コトン" - the inner mould settling onto the spacers. */
  thunk() {
    this.tone(196, 0.16, 0.24, 'sine', 148);
    this.tone(96, 0.26, 0.2, 'sine', 74);
    this.noise(0.07, 0.1, 900, 0.8);
  }

  /** "カチッ" - the LED clicking into its seat. */
  click() {
    this.noise(0.045, 0.16, 2600, 3);
    this.tone(1180, 0.05, 0.08, 'square', 900);
  }

  /** "スポン" - the outer mould releasing. */
  pop() {
    this.tone(260, 0.34, 0.3, 'sine', 82);
    this.tone(130, 0.4, 0.2, 'triangle', 60);
    this.noise(0.22, 0.09, 420, 0.7, 0.01, 'lowpass');
  }

  pourStart() {
    if (!this.ctx || !this.master || !this.noiseBuf || this.muted || this.pourSrc) return;
    const t = this.now();
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 780;
    f.Q.value = 0.7;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.13, t + 0.09);
    s.connect(f).connect(g).connect(this.master);
    s.start(t);
    this.pourSrc = s;
    this.pourGain = g;
  }

  pourStop() {
    if (!this.ctx || !this.pourSrc || !this.pourGain) return;
    const t = this.now();
    this.pourGain.gain.cancelScheduledValues(t);
    this.pourGain.gain.setValueAtTime(Math.max(0.0002, this.pourGain.gain.value), t);
    this.pourGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    this.pourSrc.stop(t + 0.14);
    this.pourSrc = null;
    this.pourGain = null;
    this.noise(0.16, 0.05, 320, 0.9, 0.02, 'lowpass');
  }

  /** water drop / ripple */
  drop() {
    this.tone(680, 0.12, 0.06, 'sine', 320);
  }

  /** frost crawling - a soft airy sweep used during the freeze lapse */
  frost() {
    this.noise(1.6, 0.045, 3200, 0.5, 0, 'highpass');
  }

  /** warm light coming on */
  chime(step = 0) {
    const scale = [523.25, 659.25, 783.99, 1046.5];
    this.tone(scale[step % scale.length], 0.55, 0.09, 'sine');
    this.tone(scale[step % scale.length] * 2, 0.3, 0.03, 'sine', undefined, 0.02);
  }

  slide() {
    this.noise(0.5, 0.07, 520, 0.6, 0, 'lowpass');
  }

  twist() {
    this.noise(0.3, 0.05, 1500, 1.6);
  }
}

export const audio = new AudioKit();
