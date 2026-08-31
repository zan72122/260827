/**
 * Paper rustle driven by how fast the finger is moving. The whole game works
 * with the sound switched off or blocked - nothing here can stall it, and the
 * context is only created after a real touch.
 */
export class PaperAudio {
  private ctx: AudioContext | null = null;
  private noise: AudioBufferSourceNode | null = null;
  private band: BiquadFilterNode | null = null;
  private gain: GainNode | null = null;
  private grainBuf: AudioBuffer | null = null;
  private lastGrain = 0;
  private lastCell = 0;
  private lastResume = 0;
  private lastGain = -1;
  private lastFreq = -1;
  private failed = false;
  enabled = true;

  /** Safe to call on every touch; only the first one does anything. */
  start() {
    if (this.ctx || this.failed || !this.enabled) return;
    try {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) {
        this.failed = true;
        return;
      }
      const ctx = new Ctor();
      const sr = ctx.sampleRate;

      const buf = ctx.createBuffer(1, Math.floor(sr * 2.5), sr);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        last = last * 0.68 + w * 0.32; // slightly brown: fibre, not hiss
        d[i] = last * 2.4;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;

      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 2100;
      band.Q.value = 0.6;

      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 700;

      const gain = ctx.createGain();
      gain.gain.value = 0;

      src.connect(band).connect(hp).connect(gain).connect(ctx.destination);
      src.start();

      const gb = ctx.createBuffer(1, Math.floor(sr * 0.03), sr);
      const gd = gb.getChannelData(0);
      for (let i = 0; i < gd.length; i++) {
        gd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / gd.length, 4);
      }

      this.ctx = ctx;
      this.noise = src;
      this.band = band;
      this.gain = gain;
      this.grainBuf = gb;
    } catch {
      this.failed = true;
    }
    void this.ctx?.resume().catch(() => undefined);
  }

  /** speed is |d(openness)/dt| in units of full-open per second. */
  update(speed: number, openness: number) {
    if (!this.ctx || !this.gain || !this.band) return;
    const t = this.ctx.currentTime;

    // A context that is not running has a clock that does not advance, so
    // scheduling into it would pile events onto the parameter timeline for
    // ever. Nudge it back awake now and then and otherwise stay out of it.
    if (this.ctx.state !== 'running') {
      if (t - this.lastResume > 0.5 || this.lastResume === 0) {
        this.lastResume = t;
        void this.ctx.resume().catch(() => undefined);
      }
      return;
    }

    const s = Math.min(1, speed / 1.5);
    const target = this.enabled ? Math.min(0.16, s * 0.19) : 0;
    // Only touch the parameter when it has actually moved.
    if (Math.abs(target - this.lastGain) > 0.004) {
      this.lastGain = target;
      this.gain.gain.setTargetAtTime(target, t, 0.045);
    }
    const freq = 1500 + s * 2600;
    if (Math.abs(freq - this.lastFreq) > 40) {
      this.lastFreq = freq;
      this.band.frequency.setTargetAtTime(freq, t, 0.06);
    }

    // one small tick per cell that passes: the sound of cells letting go
    const cell = Math.floor(openness * 46);
    if (cell !== this.lastCell && this.enabled) {
      const n = Math.min(3, Math.abs(cell - this.lastCell));
      this.lastCell = cell;
      if (t - this.lastGrain > 0.028 && s > 0.05) {
        this.lastGrain = t;
        this.grain(0.05 + s * 0.16, 1 + n * 0.15);
      }
    }
  }

  private grain(level: number, rate: number) {
    if (!this.ctx || !this.grainBuf) return;
    try {
      const s = this.ctx.createBufferSource();
      s.buffer = this.grainBuf;
      s.playbackRate.value = rate * (0.85 + Math.random() * 0.3);
      const g = this.ctx.createGain();
      g.gain.value = level;
      const f = this.ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 2600 + Math.random() * 2200;
      f.Q.value = 1.1;
      s.connect(f).connect(g).connect(this.ctx.destination);
      s.start();
      s.onended = () => {
        s.disconnect();
        f.disconnect();
        g.disconnect();
      };
    } catch {
      /* a missed tick is never worth an interruption */
    }
  }

  clasp() {
    if (!this.ctx || !this.enabled) return;
    this.grain(0.14, 2.6);
  }

  dispose() {
    try {
      this.noise?.stop();
    } catch {
      /* ignore */
    }
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.noise = null;
    this.gain = null;
    this.band = null;
  }
}
