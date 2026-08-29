/** All sound is synthesised: nothing is loaded, nothing is licensed. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private pipeSrc: AudioBufferSourceNode | null = null;
  private pipeGain: GainNode | null = null;

  resume() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 2);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        last = last * 0.72 + white * 0.28;
        d[i] = last;
      }
      this.noiseBuf = buf;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private noise(dur: number, gain: number, freq: number, q: number, sweepTo?: number, type: BiquadFilterType = 'bandpass') {
    if (!this.ctx || !this.noiseBuf || !this.master) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.16);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine') {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Blade entering cream and sponge: soft, damp, no crunch. */
  cut() {
    this.noise(0.42, 0.16, 900, 1.1, 240);
    this.noise(0.3, 0.06, 2600, 2.5, 1400);
  }
  /** Turntable bearing. */
  bearing() {
    this.noise(0.05, 0.05, 4200, 8);
  }
  /** A slice settling on to the server. */
  settle() {
    this.noise(0.24, 0.13, 320, 1.4, 120, 'lowpass');
    this.tone(96, 0.16, 0.05, 'sine');
  }
  /** Slice separating from the wall. */
  release() {
    this.noise(0.55, 0.11, 620, 0.9, 180);
  }
  place() {
    this.noise(0.16, 0.1, 700, 1.6, 300, 'lowpass');
  }
  tap() {
    this.noise(0.08, 0.07, 1800, 3.5);
  }
  pipeStart() {
    if (!this.ctx || !this.noiseBuf || !this.master || this.pipeSrc) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 620;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(0.11, this.ctx.currentTime + 0.09);
    src.connect(f).connect(g).connect(this.master);
    src.start();
    this.pipeSrc = src;
    this.pipeGain = g;
  }
  pipeStop() {
    if (!this.ctx || !this.pipeSrc || !this.pipeGain) return;
    const t = this.ctx.currentTime;
    this.pipeGain.gain.linearRampToValueAtTime(0, t + 0.12);
    this.pipeSrc.stop(t + 0.2);
    this.pipeSrc = null;
    this.pipeGain = null;
  }
  spread() {
    this.noise(0.7, 0.07, 1100, 0.8, 500);
  }
}
