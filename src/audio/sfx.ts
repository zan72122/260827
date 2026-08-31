/**
 * sfx.ts — everything synthesised, nothing sampled.
 *
 * Green wood being sawn is a dry, broadband rasp, not a ring; the release is a
 * short crack with a low body; sliding on a bench is low friction noise.  Every
 * sound is driven by an actual contact in the simulation, and the whole game
 * still reads with the sound off.
 */

export class Sfx {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private sawSrc: AudioBufferSourceNode | null = null
  private sawGain: GainNode | null = null
  private sawFilter: BiquadFilterNode | null = null
  private slideGain: GainNode | null = null
  muted = false

  private noiseBuffer(ctx: AudioContext, seconds = 2) {
    const n = Math.floor(ctx.sampleRate * seconds)
    const buf = ctx.createBuffer(1, n, ctx.sampleRate)
    const d = buf.getChannelData(0)
    let last = 0
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1
      last = 0.86 * last + 0.14 * w // slightly brown: less hiss, more rasp
      d[i] = last * 2.2
    }
    return buf
  }

  /** Must be called from a user gesture. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.gain.value = 0.9
    this.master.connect(ctx.destination)

    const buf = this.noiseBuffer(ctx)

    // continuous saw bed, gated by cut speed
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 1150
    bp.Q.value = 0.85
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 3600
    const g = ctx.createGain()
    g.gain.value = 0
    src.connect(bp).connect(lp).connect(g).connect(this.master)
    src.start()
    this.sawSrc = src
    this.sawGain = g
    this.sawFilter = bp

    // sliding-on-wood bed
    const src2 = ctx.createBufferSource()
    src2.buffer = buf
    src2.loop = true
    const lp2 = ctx.createBiquadFilter()
    lp2.type = 'lowpass'
    lp2.frequency.value = 620
    const g2 = ctx.createGain()
    g2.gain.value = 0
    src2.connect(lp2).connect(g2).connect(this.master)
    src2.start()
    this.slideGain = g2
  }

  private now() {
    return this.ctx?.currentTime ?? 0
  }

  setMuted(m: boolean) {
    this.muted = m
    if (this.master) this.master.gain.value = m ? 0 : 0.9
  }

  /** speed in metres of cut per second */
  saw(speed: number) {
    if (!this.sawGain || !this.sawFilter) return
    const v = Math.min(1, speed / 0.06)
    this.sawGain.gain.setTargetAtTime(0.16 * v, this.now(), 0.03)
    this.sawFilter.frequency.setTargetAtTime(900 + 700 * v, this.now(), 0.05)
  }

  slide(speed: number) {
    if (!this.slideGain) return
    const v = Math.min(1, speed / 0.25)
    this.slideGain.gain.setTargetAtTime(0.10 * v, this.now(), 0.04)
  }

  /** The wedge comes free: a short dry crack plus a low body. */
  release() {
    const ctx = this.ctx
    if (!ctx || !this.master) return
    const t = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuffer(ctx, 0.3)
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 780
    bp.Q.value = 1.1
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.55, t + 0.006)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.19)
    src.connect(bp).connect(g).connect(this.master)
    src.start(t)
    src.stop(t + 0.3)

    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(168, t)
    o.frequency.exponentialRampToValueAtTime(96, t + 0.16)
    const og = ctx.createGain()
    og.gain.setValueAtTime(0.0001, t)
    og.gain.exponentialRampToValueAtTime(0.22, t + 0.008)
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
    o.connect(og).connect(this.master)
    o.start(t)
    o.stop(t + 0.25)
  }

  /** Wood set down on wood. */
  tock(strength = 1) {
    const ctx = this.ctx
    if (!ctx || !this.master) return
    const t = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuffer(ctx, 0.2)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 900
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.30 * strength, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11)
    src.connect(lp).connect(g).connect(this.master)
    src.start(t)
    src.stop(t + 0.2)
  }

  quiet() {
    this.sawGain?.gain.setTargetAtTime(0, this.now(), 0.05)
    this.slideGain?.gain.setTargetAtTime(0, this.now(), 0.05)
  }

  dispose() {
    this.sawSrc?.stop()
    void this.ctx?.close()
    this.ctx = null
  }
}
