/**
 * Everything is synthesised: there are no audio files. Sounds are tied
 * to physical events -- krill and plastic under the guide, line through
 * the rings, the rig breaking the surface, the reel motor under load.
 */
export class GameAudio {
  private ctx: AudioContext | null = null
  private master!: GainNode
  private noiseBuf!: AudioBuffer
  private ambientGain!: GainNode
  private scrapeGain!: GainNode
  private scrapeFilter!: BiquadFilterNode
  private motorGain!: GainNode
  private motorOsc!: OscillatorNode
  private motorNoiseGain!: GainNode
  private underwater!: BiquadFilterNode
  ready = false

  init() {
    if (this.ctx) return
    const Ctx = window.AudioContext || (window as any).webkitAudioContext
    if (!Ctx) return
    this.ctx = new Ctx()
    const ctx = this.ctx
    this.master = ctx.createGain()
    this.master.gain.value = 0.8
    this.underwater = ctx.createBiquadFilter()
    this.underwater.type = 'lowpass'
    this.underwater.frequency.value = 20000
    this.master.connect(this.underwater)
    this.underwater.connect(ctx.destination)

    const len = ctx.sampleRate * 2
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = this.noiseBuf.getChannelData(0)
    let last = 0
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1
      last = (last + 0.02 * w) / 1.02
      d[i] = last * 3.2
    }

    // harbour bed: water against the wall, wind, distant plant
    const amb = ctx.createBufferSource()
    amb.buffer = this.noiseBuf
    amb.loop = true
    const ampFilter = ctx.createBiquadFilter()
    ampFilter.type = 'lowpass'
    ampFilter.frequency.value = 520
    this.ambientGain = ctx.createGain()
    this.ambientGain.gain.value = 0.10
    amb.connect(ampFilter).connect(this.ambientGain).connect(this.master)
    amb.start()
    // slow swell on the ambient level
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.13
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = 0.045
    lfo.connect(lfoGain).connect(this.ambientGain.gain)
    lfo.start()

    // guide/krill scrape: gated noise, driven by drag speed
    const scr = ctx.createBufferSource()
    scr.buffer = this.noiseBuf
    scr.loop = true
    this.scrapeFilter = ctx.createBiquadFilter()
    this.scrapeFilter.type = 'bandpass'
    this.scrapeFilter.frequency.value = 900
    this.scrapeFilter.Q.value = 0.9
    this.scrapeGain = ctx.createGain()
    this.scrapeGain.gain.value = 0
    scr.connect(this.scrapeFilter).connect(this.scrapeGain).connect(this.master)
    scr.start()

    // electric reel: motor whine plus gear noise, gated while winding
    this.motorOsc = ctx.createOscillator()
    this.motorOsc.type = 'sawtooth'
    this.motorOsc.frequency.value = 92
    const motorFilter = ctx.createBiquadFilter()
    motorFilter.type = 'lowpass'
    motorFilter.frequency.value = 1300
    this.motorGain = ctx.createGain()
    this.motorGain.gain.value = 0
    this.motorOsc.connect(motorFilter).connect(this.motorGain).connect(this.master)
    this.motorOsc.start()
    const mn = ctx.createBufferSource()
    mn.buffer = this.noiseBuf
    mn.loop = true
    const mnf = ctx.createBiquadFilter()
    mnf.type = 'bandpass'
    mnf.frequency.value = 2400
    this.motorNoiseGain = ctx.createGain()
    this.motorNoiseGain.gain.value = 0
    mn.connect(mnf).connect(this.motorNoiseGain).connect(this.master)
    mn.start()

    this.ready = true
  }

  resume() { this.ctx?.resume() }

  /** Muffle everything while the camera is under the surface. */
  setSubmerged(v: boolean) {
    if (!this.ready) return
    const t = this.ctx!.currentTime
    this.underwater.frequency.setTargetAtTime(v ? 620 : 20000, t, 0.25)
  }

  setScrape(intensity: number, roughness: number) {
    if (!this.ready) return
    const t = this.ctx!.currentTime
    this.scrapeGain.gain.setTargetAtTime(Math.min(0.24, intensity * 0.24), t, 0.05)
    this.scrapeFilter.frequency.setTargetAtTime(520 + roughness * 1500, t, 0.08)
  }

  setMotor(on: boolean, load: number) {
    if (!this.ready) return
    const t = this.ctx!.currentTime
    this.motorGain.gain.setTargetAtTime(on ? 0.055 : 0, t, 0.07)
    this.motorNoiseGain.gain.setTargetAtTime(on ? 0.02 : 0, t, 0.07)
    this.motorOsc.frequency.setTargetAtTime(88 + load * 26, t, 0.2)
  }

  private burst(freq: number, q: number, gain: number, dur: number, sweepTo?: number) {
    if (!this.ready) return
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuf
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.value = freq
    f.Q.value = q
    const g = ctx.createGain()
    const t = ctx.currentTime
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(gain, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur)
    src.connect(f).connect(g).connect(this.master)
    src.start(t, Math.random() * 1.5, dur + 0.05)
  }

  splashIn() { this.burst(1400, 0.7, 0.30, 0.5, 320) }
  splashOut() { this.burst(900, 0.6, 0.34, 0.6, 2100) }
  tankSplash() { this.burst(1100, 0.8, 0.22, 0.35, 420) }
  lineTick() { this.burst(3200, 6, 0.09, 0.05) }
  /** the shoal turning: a soft, wide flutter, not a whoosh */
  schoolTurn() { this.burst(240, 0.8, 0.10, 0.55, 90) }
  bite() { this.burst(2400, 4, 0.12, 0.09) }
  rodTwitch() { this.burst(600, 2, 0.07, 0.12) }
  bucketKnock() { this.burst(320, 3, 0.11, 0.18, 160) }
}
