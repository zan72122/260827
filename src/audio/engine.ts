/**
 * 発音 / sound.
 *
 * 音は必ず「解放イベント」から鳴ります。曲を鳴らすためのタイマーは存在せず、
 * ハンドルが止まれば新しい音符は生まれません (既に鳴った音の余韻だけが残る)。
 *
 * 櫛歯は片持ちの鋼片なので、倍音は整数比になりません。短い立ち上がり、
 * 非整数倍音、自然な減衰、木の響板ぶんの控えめな共鳴で作ります。
 */

import { TOOTH_HZ } from '../core/song.ts'

/** 片持ち鋼片らしい非整数倍音。先端の質量で低めに寄せた設計値。 */
const PARTIALS: ReadonlyArray<{ ratio: number; gain: number; decay: number }> = [
  { ratio: 1.0, gain: 1.0, decay: 1.0 },
  { ratio: 4.19, gain: 0.26, decay: 0.42 },
  { ratio: 8.63, gain: 0.1, decay: 0.26 },
  { ratio: 13.4, gain: 0.042, decay: 0.16 },
]

const MAX_VOICES = 26
/** 描画フレームと音声フレームのずれを吸収する先読み (秒)。 */
const LOOKAHEAD = 0.014

export class AudioEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private dry: GainNode | null = null
  private wet: GainNode | null = null
  private noise: AudioBuffer | null = null
  private voices = 0
  private muted = false
  private startFailed = false

  get started(): boolean {
    return this.ctx !== null
  }

  get isMuted(): boolean {
    return this.muted
  }

  get unavailable(): boolean {
    return this.startFailed
  }

  /** 音声時計の現在値。毎フレーム読み直して描画時計とのずれを溜めない。 */
  now(): number {
    return this.ctx ? this.ctx.currentTime : 0
  }

  /** 初回の明示的な操作 (pointerdown) からだけ開始・再開する。 */
  async start(): Promise<void> {
    if (this.startFailed) return
    try {
      if (!this.ctx) {
        const Ctor: typeof AudioContext =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        if (!Ctor) {
          this.startFailed = true
          return
        }
        const ctx = new Ctor({ latencyHint: 'interactive' })
        this.build(ctx)
        this.ctx = ctx
      }
      if (this.ctx.state !== 'running') await this.ctx.resume()
    } catch {
      this.startFailed = true
    }
  }

  suspend(): void {
    void this.ctx?.suspend().catch(() => undefined)
  }

  async resume(): Promise<void> {
    if (!this.ctx) return
    try {
      if (this.ctx.state !== 'running') await this.ctx.resume()
    } catch {
      /* ignore */
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (this.master && this.ctx) {
      const t = this.ctx.currentTime
      this.master.gain.cancelScheduledValues(t)
      this.master.gain.setTargetAtTime(muted ? 0 : 1, t, 0.02)
    }
  }

  private build(ctx: AudioContext): void {
    const master = ctx.createGain()
    master.gain.value = 1

    // 耳に痛い高域を落とす。子どもが顔の近くで持つ前提。
    const tone = ctx.createBiquadFilter()
    tone.type = 'lowpass'
    tone.frequency.value = 6200
    tone.Q.value = 0.6

    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -14
    limiter.knee.value = 12
    limiter.ratio.value = 6
    limiter.attack.value = 0.004
    limiter.release.value = 0.18

    const out = ctx.createGain()
    out.gain.value = 0.5

    const dry = ctx.createGain()
    dry.gain.value = 1
    const wet = ctx.createGain()
    wet.gain.value = 0.16

    // 響板ぶんの短い共鳴。外部アセットを使わず、その場で合成した IR。
    const reverb = ctx.createConvolver()
    reverb.buffer = makeSoundboardIR(ctx)

    dry.connect(master)
    wet.connect(reverb)
    reverb.connect(master)
    master.connect(tone)
    tone.connect(limiter)
    limiter.connect(out)
    out.connect(ctx.destination)

    this.master = master
    this.dry = dry
    this.wet = wet
    this.noise = makeNoise(ctx, 0.4)
  }

  /**
   * 歯が解放された瞬間の楽音。
   * @param tooth 歯番号 (音程はここだけで決まる)
   * @param loudness 0..1 たわみ量から出した強さ
   * @param delay この呼び出しからの遅れ (秒)。フレーム内の発生位置。
   */
  release(tooth: number, loudness: number, delay: number): void {
    const ctx = this.ctx
    const dry = this.dry
    const wet = this.wet
    if (!ctx || !dry || !wet || this.muted) return
    if (this.voices >= MAX_VOICES) return
    const f0 = TOOTH_HZ[tooth]
    if (f0 === undefined) return

    const t = Math.max(ctx.currentTime, ctx.currentTime + LOOKAHEAD + delay)
    const amp = Math.min(1, Math.max(0, loudness))
    if (amp <= 0.001) return
    const baseDecay = clamp(2.35 * Math.sqrt(440 / f0), 0.5, 2.6)

    const bus = ctx.createGain()
    bus.gain.value = 0.2 * (0.35 + 0.65 * amp)
    bus.connect(dry)
    bus.connect(wet)

    this.voices++
    let longest = 0
    for (const p of PARTIALS) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = f0 * p.ratio
      // わずかな個体差。全部の歯が同じ倍音比では機械的すぎる。
      osc.detune.value = ((tooth * 37) % 13) - 6
      const g = ctx.createGain()
      const decay = baseDecay * p.decay
      longest = Math.max(longest, decay)
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, p.gain), t + 0.0035)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.0035 + decay)
      osc.connect(g)
      g.connect(bus)
      osc.start(t)
      osc.stop(t + 0.05 + decay)
      osc.onended = () => {
        g.disconnect()
        osc.disconnect()
      }
    }

    // 歯がピンから離れる瞬間のごく短い立ち上がり音。
    this.burst(bus, t, 0.012, f0 * 2.1, 2.2, 0.09)

    window.setTimeout(
      () => {
        bus.disconnect()
        this.voices = Math.max(0, this.voices - 1)
      },
      (longest + 0.4) * 1000,
    )
  }

  /** ピンが歯に触れた瞬間の小さな機械音。楽音とは別物。 */
  contact(loudness: number, delay: number): void {
    const ctx = this.ctx
    const dry = this.dry
    if (!ctx || !dry || this.muted) return
    const t = Math.max(ctx.currentTime, ctx.currentTime + LOOKAHEAD + delay)
    this.burst(dry, t, 0.02, 1500, 1.4, 0.05 * clamp(loudness, 0.2, 1))
  }

  /** 逆回しを止めるラチェットの音。 */
  ratchet(): void {
    const ctx = this.ctx
    const dry = this.dry
    if (!ctx || !dry || this.muted) return
    this.burst(dry, ctx.currentTime + LOOKAHEAD, 0.016, 900, 2.6, 0.035)
  }

  /** 工具でねじが動いたときの、ざらついた小さな音。 */
  screw(progress: number): void {
    const ctx = this.ctx
    const dry = this.dry
    if (!ctx || !dry || this.muted) return
    this.burst(dry, ctx.currentTime + LOOKAHEAD, 0.05, 420 + progress * 520, 1.1, 0.03)
  }

  private burst(
    dest: AudioNode,
    t: number,
    dur: number,
    freq: number,
    q: number,
    gain: number,
  ): void {
    const ctx = this.ctx
    if (!ctx || !this.noise) return
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    src.loop = true
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = Math.min(freq, 7000)
    bp.Q.value = q
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.002)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(bp)
    bp.connect(g)
    g.connect(dest)
    src.start(t)
    src.stop(t + dur + 0.02)
    src.onended = () => {
      g.disconnect()
      bp.disconnect()
      src.disconnect()
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function makeNoise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(1, n, ctx.sampleRate)
  const d = buf.getChannelData(0)
  let s = 0x2f6e2b1
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0
    d[i] = (s / 0xffffffff) * 2 - 1
  }
  return buf
}

/** 木の響板ぶんの短いインパルス応答。合成なので配信アセットが要らない。 */
function makeSoundboardIR(ctx: BaseAudioContext): AudioBuffer {
  const seconds = 0.38
  const n = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(2, n, ctx.sampleRate)
  let s = 0x9e3779b9
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    let lp = 0
    for (let i = 0; i < n; i++) {
      s = (s * 1664525 + 1013904223) >>> 0
      const white = (s / 0xffffffff) * 2 - 1
      lp += (white - lp) * 0.28 // 木らしく高域を落とす
      const env = Math.pow(1 - i / n, 3.4)
      d[i] = lp * env * (ch === 0 ? 1 : 0.86)
    }
  }
  return buf
}
