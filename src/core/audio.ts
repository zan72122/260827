/**
 * Small sounds with causes.
 *
 * Everything here is synthesised on the spot -- no files to load, nothing to
 * fetch. A sound plays because something happened: thread sliding through a
 * peg, a wooden part set down, the jaw touching its rest. The head nodding is
 * not a bell; it is a paper doll, and mostly it is quiet.
 *
 * Nothing starts until the child's first deliberate touch, and the whole piece
 * is playable with the sound off.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;
  private lastAt: Record<string, number> = {};

  /**
   * Called from a real user gesture. Safe to call more than once, and safe on
   * a device with no audio at all -- a failure here must never stop a touch
   * from reaching the doll.
   */
  start(): void {
    try {
      this.open();
    } catch {
      this.ctx = null;
    }
  }

  private open(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    type WithWebkit = typeof globalThis & { webkitAudioContext?: typeof AudioContext };
    const Ctor = window.AudioContext ?? (globalThis as WithWebkit).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch {
      return;
    }
    const g = this.ctx.createGain();
    g.gain.value = 0.5;
    g.connect(this.ctx.destination);
    this.master = g;
    const len = Math.floor(this.ctx.sampleRate * 0.7);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let v = 0;
    for (let i = 0; i < len; i++) {
      v = v * 0.86 + (Math.random() * 2 - 1) * 0.14;
      d[i] = v;
    }
    this.noise = buf;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  get ready(): boolean {
    return this.ctx !== null && !this.muted;
  }

  private gate(key: string, minGap: number): boolean {
    if (!this.ready) return false;
    const t = this.ctx!.currentTime;
    if ((this.lastAt[key] ?? -99) > t - minGap) return false;
    this.lastAt[key] = t;
    return true;
  }

  /** Fibre sliding over wood: a soft, breathy rasp while the thread moves. */
  rub(intensity: number): void {
    if (!this.gate('rub', 0.09)) return;
    const c = this.ctx!;
    const s = c.createBufferSource();
    s.buffer = this.noise!;
    s.playbackRate.value = 0.7 + intensity * 0.5;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1700 + intensity * 900;
    bp.Q.value = 1.1;
    const g = c.createGain();
    const a = Math.min(0.1, 0.02 + intensity * 0.07);
    g.gain.setValueAtTime(0, c.currentTime);
    g.gain.linearRampToValueAtTime(a, c.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0005, c.currentTime + 0.17);
    s.connect(bp).connect(g).connect(this.master!);
    s.start();
    s.stop(c.currentTime + 0.2);
  }

  /** A wooden or paper part meeting another: a short, low knock. */
  knock(pitch = 1, level = 0.22): void {
    if (!this.gate(`knock${Math.round(pitch * 10)}`, 0.05)) return;
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(230 * pitch, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(120 * pitch, c.currentTime + 0.09);
    const n = c.createBufferSource();
    n.buffer = this.noise!;
    const nf = c.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = 1200 * pitch;
    const ng = c.createGain();
    ng.gain.setValueAtTime(level * 0.5, c.currentTime);
    ng.gain.exponentialRampToValueAtTime(0.0005, c.currentTime + 0.06);
    const g = c.createGain();
    g.gain.setValueAtTime(level, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0005, c.currentTime + 0.16);
    o.connect(g).connect(this.master!);
    n.connect(nf).connect(ng).connect(this.master!);
    o.start();
    n.start();
    o.stop(c.currentTime + 0.18);
    n.stop(c.currentTime + 0.08);
  }

  /** The tiny paper rustle when the head settles onto its thread. */
  settle(): void {
    if (!this.gate('settle', 0.4)) return;
    const c = this.ctx!;
    const s = c.createBufferSource();
    s.buffer = this.noise!;
    s.playbackRate.value = 1.4;
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 2600;
    const g = c.createGain();
    g.gain.setValueAtTime(0.05, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0004, c.currentTime + 0.22);
    s.connect(f).connect(g).connect(this.master!);
    s.start();
    s.stop(c.currentTime + 0.25);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }
  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }
}
