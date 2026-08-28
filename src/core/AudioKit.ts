/**
 * Every sound is synthesised at runtime: no audio files, no network, no analytics.
 * The context stays suspended until the child's first touch, as iOS requires.
 */
export type SoundName =
  | 'clasp'
  | 'slide'
  | 'leverUp'
  | 'inkTouch'
  | 'strike'
  | 'springBack'
  | 'gate'
  | 'snap'
  | 'reject'
  | 'chute'
  | 'window'
  | 'cord'
  | 'shutter'
  | 'engine'
  | 'lamp'
  | 'wheel';

export class AudioKit {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private beltGain: GainNode | null = null;
  private unlocked = false;
  private noiseBuffer: AudioBuffer | null = null;

  /** Must be called from a real user gesture. */
  unlock(): void {
    if (this.unlocked) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      this.noiseBuffer = this.makeNoise();
      this.startRoomTone();
      void this.ctx.resume();
      this.unlocked = true;
    } catch {
      this.ctx = null;
    }
  }

  get ready(): boolean {
    return this.unlocked && this.ctx !== null;
  }

  private makeNoise(): AudioBuffer {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * 1.2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.2;
    }
    return buf;
  }

  /** A hall has a floor of sound: rollers, a distant fan. */
  private startRoomTone(): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    src.connect(lp).connect(g).connect(this.master!);
    src.start();
    this.beltGain = g;
  }

  setBeltRunning(on: boolean): void {
    if (!this.beltGain || !this.ctx) return;
    this.beltGain.gain.setTargetAtTime(on ? 0.12 : 0.05, this.ctx.currentTime, 0.4);
  }

  private env(node: AudioNode, t0: number, attack: number, decay: number, peak: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    node.connect(g);
    g.connect(this.master!);
    return g;
  }

  private tone(freq: number, t0: number, dur: number, peak: number, type: OscillatorType = 'sine', detune = 0): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    o.detune.value = detune;
    this.env(o, t0, 0.006, dur, peak);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  private thud(t0: number, dur: number, freq: number, peak: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq * 2.2, t0);
    o.frequency.exponentialRampToValueAtTime(freq, t0 + dur * 0.6);
    this.env(o, t0, 0.004, dur, peak);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  private hiss(t0: number, dur: number, cutoff: number, peak: number, q = 1): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = cutoff;
    f.Q.value = q;
    src.connect(f);
    this.env(f, t0, 0.008, dur, peak);
    src.start(t0);
    src.stop(t0 + dur + 0.1);
  }

  play(name: SoundName): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + 0.005;
    switch (name) {
      case 'clasp':
        this.tone(880, t, 0.08, 0.12, 'triangle');
        this.tone(1320, t + 0.02, 0.06, 0.07, 'triangle');
        this.hiss(t, 0.12, 2600, 0.05);
        break;
      case 'slide':
        this.hiss(t, 0.34, 1500, 0.06, 0.7);
        break;
      case 'leverUp':
        this.tone(320, t, 0.14, 0.07, 'triangle');
        this.hiss(t, 0.1, 900, 0.03);
        break;
      case 'inkTouch':
        this.hiss(t, 0.16, 700, 0.05, 0.6);
        this.thud(t, 0.1, 90, 0.06);
        break;
      case 'strike':
        this.thud(t, 0.22, 74, 0.4);
        this.tone(210, t, 0.09, 0.12, 'square');
        this.hiss(t, 0.16, 1800, 0.1);
        break;
      case 'springBack':
        this.tone(430, t, 0.2, 0.07, 'triangle');
        this.tone(640, t + 0.03, 0.14, 0.04, 'triangle');
        break;
      case 'gate':
        this.thud(t, 0.14, 130, 0.14);
        this.tone(760, t + 0.05, 0.1, 0.06, 'triangle');
        break;
      case 'snap':
        this.tone(660, t, 0.09, 0.1, 'sine');
        this.tone(990, t + 0.04, 0.1, 0.07, 'sine');
        break;
      case 'reject':
        this.tone(240, t, 0.1, 0.06, 'sine');
        break;
      case 'chute':
        this.hiss(t, 0.5, 1100, 0.07, 0.5);
        break;
      case 'window':
        this.tone(1180, t, 0.07, 0.07, 'triangle');
        this.hiss(t, 0.09, 3200, 0.04);
        break;
      case 'cord':
        this.hiss(t, 0.3, 620, 0.07, 0.8);
        break;
      case 'shutter':
        this.hiss(t, 0.9, 380, 0.1, 0.5);
        this.thud(t + 0.85, 0.16, 60, 0.16);
        break;
      case 'engine':
        this.thud(t, 0.7, 52, 0.16);
        this.hiss(t, 1.4, 240, 0.07, 0.4);
        break;
      case 'lamp':
        this.tone(1480, t, 0.16, 0.05, 'sine');
        break;
      case 'wheel':
        for (let i = 0; i < 3; i++) this.tone(900 + i * 60, t + i * 0.07, 0.05, 0.05, 'square');
        break;
    }
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.unlocked = false;
  }
}
