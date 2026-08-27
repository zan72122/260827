// ---------------------------------------------------------------------------
// WebAudio による全効果音の合成。外部音源ファイルは使わない。
// ノードは使い捨て（再生ごとに生成し、終了後に自動 GC）だが、
// 常設ノード（風・滑走ループ、マスター系）は一度だけ作り再利用する。
// ---------------------------------------------------------------------------

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private windGain: GainNode | null = null;
  private glideGain: GainNode | null = null;
  private glideFilter: BiquadFilterNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private started = false;
  /** 検証用: これまでに生成した一時ノードの概算数 */
  public transientNodes = 0;
  /** 検証用: 常設ノード数 */
  public persistentNodes = 0;

  /** 最初のユーザー操作で呼ぶ（iOS の自動再生制限解除） */
  unlock(): void {
    if (this.started) {
      if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    this.started = true;
    const AC = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.ctx.destination);

    // ホワイトノイズバッファ（各種に共用）
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // 風のループ（常設）
    const windSrc = this.ctx.createBufferSource();
    windSrc.buffer = this.noiseBuf;
    windSrc.loop = true;
    const windFilter = this.ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 320;
    windFilter.Q.value = 0.6;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0.014;
    windSrc.connect(windFilter).connect(this.windGain).connect(this.master);
    windSrc.start();
    // 風の揺らぎ
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.008;
    lfo.connect(lfoGain).connect(this.windGain.gain);
    lfo.start();

    // そり滑走音のループ（常設・ゲインで開閉）
    const gSrc = this.ctx.createBufferSource();
    gSrc.buffer = this.noiseBuf;
    gSrc.loop = true;
    gSrc.playbackRate.value = 0.7;
    this.glideFilter = this.ctx.createBiquadFilter();
    this.glideFilter.type = 'bandpass';
    this.glideFilter.frequency.value = 900;
    this.glideFilter.Q.value = 0.8;
    this.glideGain = this.ctx.createGain();
    this.glideGain.gain.value = 0;
    gSrc.connect(this.glideFilter).connect(this.glideGain).connect(this.master);
    gSrc.start();
    this.persistentNodes = 9;
  }

  get ready(): boolean {
    return !!this.ctx;
  }

  /** そり滑走音の強さ 0..1（速度に応じて呼ぶ） */
  setGlide(level: number): void {
    if (!this.ctx || !this.glideGain || !this.glideFilter) return;
    const t = this.ctx.currentTime;
    this.glideGain.gain.setTargetAtTime(Math.min(0.12, level * 0.12), t, 0.12);
    this.glideFilter.frequency.setTargetAtTime(700 + level * 900, t, 0.2);
  }

  /** 風の強さ（飛行時に増す） */
  setWind(level: number): void {
    if (!this.ctx || !this.windGain) return;
    this.windGain.gain.setTargetAtTime(0.014 + level * 0.05, this.ctx.currentTime, 0.3);
  }

  /**
   * 鈴。size: 0=小(高音) 1=中 2=大(低音)。vel: 打撃の強さ 0..1。
   * pan: -1..1 の簡易定位。
   */
  bell(size: number, vel: number, pan = 0): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const base = [2093, 1568, 1175][Math.max(0, Math.min(2, Math.round(size)))];
    const v = Math.max(0.05, Math.min(1, vel));
    const out = this.ctx.createGain();
    out.gain.value = 0;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    out.connect(panner).connect(this.master);
    // クロタル鈴: 非整数倍音のパーシャル
    const partials = [1, 1.51, 2.32, 2.95];
    const gains = [1, 0.55, 0.32, 0.18];
    for (let i = 0; i < partials.length; i++) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      const detune = 1 + (Math.random() - 0.5) * 0.006;
      o.frequency.value = base * partials[i] * detune;
      const g = this.ctx.createGain();
      g.gain.value = gains[i];
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.9);
      this.transientNodes += 2;
    }
    // 中の玉が転がるシャラという短いノイズ
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuf!;
    const nf = this.ctx.createBiquadFilter();
    nf.type = 'highpass';
    nf.frequency.value = 5000;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.12 * v, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    n.connect(nf).connect(ng).connect(out);
    n.start(t);
    n.stop(t + 0.1);
    this.transientNodes += 3;

    out.gain.setValueAtTime(0.16 * v, t);
    out.gain.exponentialRampToValueAtTime(0.0001, t + 0.55 + v * 0.3);
    this.transientNodes += 2;
  }

  /** 金具のカチン（接続成立） */
  click(strong = 1): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    // 金属接触: 高い短音2つ + こもった打撃
    const mk = (freq: number, delay: number, amp: number, dur: number) => {
      const o = this.ctx!.createOscillator();
      o.type = 'triangle';
      o.frequency.value = freq;
      const g = this.ctx!.createGain();
      g.gain.setValueAtTime(amp, t + delay);
      g.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur);
      o.connect(g).connect(this.master!);
      o.start(t + delay);
      o.stop(t + delay + dur);
      this.transientNodes += 2;
    };
    mk(3400, 0, 0.11 * strong, 0.05);
    mk(2500, 0.018, 0.09 * strong, 0.07);
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuf!;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 700;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.18 * strong, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    n.connect(f).connect(g).connect(this.master);
    n.start(t);
    n.stop(t + 0.1);
    this.transientNodes += 3;
  }

  /** 雪を踏む足音 */
  step(weight = 1, pan = 0): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuf!;
    n.playbackRate.value = 0.8 + Math.random() * 0.3;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 500 + Math.random() * 300;
    f.Q.value = 0.8;
    const g = this.ctx.createGain();
    const amp = 0.07 * weight;
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1 + Math.random() * 0.05);
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    n.connect(f).connect(g).connect(p).connect(this.master);
    n.start(t);
    n.stop(t + 0.18);
    this.transientNodes += 4;
  }

  /** ブラシで雪を払うシュッ */
  brush(vel = 1): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuf!;
    n.playbackRate.value = 1.1;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(1200, t);
    f.frequency.linearRampToValueAtTime(2400, t + 0.18);
    f.Q.value = 0.7;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.08 * vel, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    n.connect(f).connect(g).connect(this.master);
    n.start(t);
    n.stop(t + 0.3);
    this.transientNodes += 3;
  }

  /** 革が張るときのきしみ */
  leatherCreak(): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(140, t);
    o.frequency.linearRampToValueAtTime(210, t + 0.22);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.045, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(f).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.32);
    this.transientNodes += 3;
  }

  /** トナカイの鼻息 */
  snort(): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuf!;
    n.playbackRate.value = 0.6;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(300, t + 0.25);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    n.connect(f).connect(g).connect(this.master);
    n.start(t);
    n.stop(t + 0.32);
    this.transientNodes += 3;
  }

  /** そりが雪を押して動き出すズッ */
  sledShove(): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuf!;
    n.playbackRate.value = 0.5;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(400, t);
    f.frequency.linearRampToValueAtTime(900, t + 0.3);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.14, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    n.connect(f).connect(g).connect(this.master);
    n.start(t);
    n.stop(t + 0.55);
    this.transientNodes += 3;
  }
}

export const audio = new GameAudio();
