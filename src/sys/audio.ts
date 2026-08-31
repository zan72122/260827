/**
 * Cutting sound is a function of cutting SPEED. No movement, no sound; a short
 * tail is allowed as the shaving settles, but nothing new is ever generated
 * after the finger stops. The game is fully understandable with sound off.
 */
export class CutAudio {
  private ctx: AudioContext | null = null;
  private src: AudioBufferSourceNode | null = null;
  private band: BiquadFilterNode | null = null;
  private gain: GainNode | null = null;
  private out: GainNode | null = null;
  private level = 0;
  enabled = true;

  start() {
    if (this.ctx || !this.enabled) return;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    const ctx = new AC();
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = last * 0.72 + w * 0.28; d[i] = last; }
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass'; band.frequency.value = 900; band.Q.value = 1.1;
    const gain = ctx.createGain(); gain.gain.value = 0;
    const out = ctx.createGain(); out.gain.value = 0.9;
    src.connect(band); band.connect(gain); gain.connect(out); out.connect(ctx.destination);
    src.start();
    this.ctx = ctx; this.src = src; this.band = band; this.gain = gain; this.out = out;
  }

  resume() { this.ctx?.resume(); }

  /** speed01: cutting speed, normalised. dt in seconds. */
  update(speed01: number, dt: number) {
    if (!this.ctx || !this.gain || !this.band) return;
    const target = Math.min(1, speed01);
    // fast attack so it answers the finger, short release for the settling tail
    const k = target > this.level ? 1 - Math.exp(-dt / 0.012) : 1 - Math.exp(-dt / 0.085);
    this.level += (target - this.level) * k;
    if (this.level < 0.0008) this.level = 0;
    this.gain.gain.value = this.level * 0.20;
    this.band.frequency.value = 780 + 2400 * this.level;
    this.band.Q.value = 0.9 + this.level * 1.4;
  }

  /** the detent dropping into the next notch */
  click(strength = 1) {
    const ctx = this.ctx; if (!ctx || !this.out) return;
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.09);
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 7);
    const s = ctx.createBufferSource(); s.buffer = b;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 430; f.Q.value = 3.2;
    const g = ctx.createGain(); g.gain.value = 0.28 * strength;
    s.connect(f); f.connect(g); g.connect(this.out);
    s.start(t);
    s.onended = () => { s.disconnect(); f.disconnect(); g.disconnect(); };
  }

  dispose() {
    this.src?.stop(); this.src?.disconnect();
    this.band?.disconnect(); this.gain?.disconnect(); this.out?.disconnect();
    this.ctx?.close();
    this.ctx = null; this.src = null; this.band = null; this.gain = null; this.out = null;
  }
}
