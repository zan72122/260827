/**
 * audio.ts — the sound of a microscope, synthesised. No audio files ship with this.
 *
 * Everything you hear is mechanical or electrical: the lamp transformer humming under
 * the stand, the rack-and-pinion of the mechanical stage while the slide is walked
 * about, the detent of the nosepiece when an objective clicks home, and the fine
 * focus ticking. The only concession to game feel is that the illumination hum rises
 * very slightly with magnification, because the field really does get dimmer and the
 * lamp is turned up.
 */

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private hum: { osc: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private rack: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private enabled = false;

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Must be called from a real user gesture or iOS will refuse to start. */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    this.noiseBuffer = this.makeNoise(ctx, 2.2);

    // Lamp transformer: a quiet mains-ish hum with the edge filtered off.
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 60;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 190;
    filter.Q.value = 0.6;
    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    osc.connect(filter).connect(gain).connect(this.master);
    osc.start();
    this.hum = { osc, gain, filter };

    // Stage movement: broadband noise, gated by how fast the slide is actually moving.
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const rf = ctx.createBiquadFilter();
    rf.type = 'bandpass';
    rf.frequency.value = 480;
    rf.Q.value = 0.9;
    const rg = ctx.createGain();
    rg.gain.value = 0;
    src.connect(rf).connect(rg).connect(this.master);
    src.start();
    this.rack = { src, gain: rg, filter: rf };

    void ctx.resume();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (on) this.unlock();
    const m = this.master;
    if (!m || !this.ctx) return;
    m.gain.cancelScheduledValues(this.ctx.currentTime);
    m.gain.linearRampToValueAtTime(on ? 0.7 : 0.0, this.ctx.currentTime + 0.18);
  }

  /**
   * @param mag       total magnification, used only for a very small timbre shift
   * @param travel    absolute rate of change of progress, drives the stage noise
   * @param fieldOpen how far inside the microscope we are
   */
  update(mag: number, travel: number, fieldOpen: number): void {
    if (!this.ctx || !this.hum || !this.rack) return;
    const now = this.ctx.currentTime;
    const lift = Math.min(1, Math.log10(Math.max(mag, 10) / 10) / 2.2);
    this.hum.filter.frequency.setTargetAtTime(170 + lift * 130, now, 0.25);
    this.hum.gain.gain.setTargetAtTime(0.035 + fieldOpen * 0.035, now, 0.3);

    const speed = Math.min(1, travel * 5.5);
    this.rack.gain.gain.setTargetAtTime(speed * (0.05 + 0.05 * (1 - fieldOpen)), now, 0.05);
    // Coarse movement rumbles; fine movement whispers.
    this.rack.filter.frequency.setTargetAtTime(320 + speed * 900 + lift * 700, now, 0.08);
  }

  /** The detent of the revolving nosepiece: a wooden knock with a metal ring after it. */
  objectiveClick(index: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuffer) return;
    const now = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1500 + index * 260;
    bp.Q.value = 1.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.5, now + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);
    src.connect(bp).connect(g).connect(this.master);
    src.start(now);
    src.stop(now + 0.1);

    const ring = ctx.createOscillator();
    ring.type = 'triangle';
    // Each objective is a different mass, so each detent rings at its own pitch.
    ring.frequency.setValueAtTime(430 - index * 42, now);
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(0.0001, now);
    rg.gain.exponentialRampToValueAtTime(0.14, now + 0.006);
    rg.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    ring.connect(rg).connect(this.master);
    ring.start(now);
    ring.stop(now + 0.26);
  }

  /** The fine focus knob, ticking as the stage creeps toward the lens. */
  focusTick(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuffer) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.10, now + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    src.connect(hp).connect(g).connect(this.master);
    src.start(now);
    src.stop(now + 0.07);
  }

  dispose(): void {
    this.hum?.osc.stop();
    this.rack?.src.stop();
    void this.ctx?.close();
    this.ctx = null;
  }

  private makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      // Slightly brown noise sits better under a hum than flat white.
      last = (last + 0.035 * white) / 1.035;
      data[i] = last * 3.2;
    }
    return buf;
  }
}
