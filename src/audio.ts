// Tiny procedural WebAudio sounds — no assets. Everything is soft and short,
// tuned for a 4-year-old: no harsh transients, no failure sounds.

class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private slideNoise: AudioBufferSourceNode | null = null;
  private slideGain: GainNode | null = null;
  private slideFilter: BiquadFilterNode | null = null;
  private scrapeTimer = 0;

  // Must be called from a user gesture (mobile Safari requirement).
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.startSlideLoop();
    } catch {
      this.ctx = null;
    }
  }

  private noiseBuffer(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // Continuous filtered-noise loop whose gain/filter track descent speed —
  // slow = fabric rustle, fast = whoosh.
  private startSlideLoop(): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(2);
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 500;
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master!);
    src.start();
    this.slideNoise = src;
    this.slideGain = gain;
    this.slideFilter = filter;
  }

  // speed: 0..1 normalized descent speed
  setSlide(speed: number, dt: number): void {
    if (!this.ctx || !this.slideGain || !this.slideFilter) return;
    const t = this.ctx.currentTime;
    const target = Math.min(0.4, speed * 0.5);
    this.slideGain.gain.setTargetAtTime(target, t, 0.06);
    this.slideFilter.frequency.setTargetAtTime(300 + speed * 1900, t, 0.08);
    // slow speeds: occasional soft brick-scrape ticks (koro-koro)
    if (speed > 0.02 && speed < 0.3) {
      this.scrapeTimer -= dt;
      if (this.scrapeTimer <= 0) {
        this.scrapeTimer = 0.12 + Math.random() * 0.2;
        this.tick(160 + Math.random() * 120, 0.05, 0.05);
      }
    }
  }

  private tick(freq: number, dur: number, vol: number): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g).connect(this.master);
    o.start();
    o.stop(ctx.currentTime + dur + 0.02);
  }

  private blip(freqs: number[], dur: number, vol: number, type: OscillatorType = 'sine'): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const g = ctx.createGain();
      const t0 = ctx.currentTime + i * 0.09;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(this.master!);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    });
  }

  landThump(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(45, ctx.currentTime + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    o.connect(g).connect(this.master);
    o.start();
    o.stop(ctx.currentTime + 0.3);
  }

  softLand(): void {
    this.blip([180, 90], 0.2, 0.16, 'sine');
  }

  giftPluck(idx: number): void {
    this.blip([523 * Math.pow(1.19, idx)], 0.35, 0.2, 'triangle');
  }

  stockingPop(): void {
    this.blip([320, 480], 0.18, 0.14, 'sine');
  }

  noseChime(): void {
    this.blip([784, 988, 1319], 0.5, 0.14, 'sine');
  }

  whooshUp(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(0.8);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(300, ctx.currentTime);
    f.frequency.exponentialRampToValueAtTime(2600, ctx.currentTime + 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.28, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.8);
    src.connect(f).connect(g).connect(this.master);
    src.start();
  }

  hintChime(): void {
    this.blip([659, 880], 0.4, 0.08, 'sine');
  }

  sleighBell(): void {
    this.blip([1568, 2093, 1568], 0.3, 0.06, 'sine');
  }
}

export const audio = new GameAudio();
