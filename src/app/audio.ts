/**
 * 効果音。外部素材を使わず、WebAudio で合成する。
 * ラックの接触、液への出入り、滴下、ガラスの接地に同期させる。
 * 無音でも最後まで遊べる（音は補助であり、判断には使わせない）。
 */
export class Audio {
  private ctx: AudioContext | null = null;
  enabled = true;

  private ensure(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!C) return null;
      try {
        this.ctx = new C();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** 金属の接触音（ラックが槽の底や縁に当たる）。 */
  metalTick(gain = 0.18): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [f, g, d] of [
      [2100, 1, 0.09],
      [3400, 0.5, 0.06],
      [5200, 0.25, 0.04],
    ] as const) {
      const o = ctx.createOscillator();
      const v = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      v.gain.setValueAtTime(gain * g, t);
      v.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(v).connect(ctx.destination);
      o.start(t);
      o.stop(t + d + 0.02);
    }
  }

  /** ガラスの接地（カバーガラス・スライド）。 */
  glassTick(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const v = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(5200, t);
    o.frequency.exponentialRampToValueAtTime(3600, t + 0.05);
    v.gain.setValueAtTime(0.09, t);
    v.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(v).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.11);
  }

  /** 液に入る／出るときの音。 */
  liquid(intensity = 1): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const dur = 0.22;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      last = last * 0.86 + w * 0.14;
      d[i] = last * Math.pow(1 - i / d.length, 2.2);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 700;
    f.Q.value = 0.8;
    const v = ctx.createGain();
    v.gain.value = 0.28 * Math.min(1.4, intensity);
    src.connect(f).connect(v).connect(ctx.destination);
    src.start(t);
  }

  /** 滴が液面に落ちる音。 */
  drip(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const v = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(360, t + 0.07);
    v.gain.setValueAtTime(0.12, t);
    v.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    o.connect(v).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.13);
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (!v && this.ctx) void this.ctx.suspend();
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
  }
}
