/**
 * Sound is driven from the same world state as the picture. The only job it
 * has is to let the child hear the force arrive from below and then reach the
 * rod: one dull knock down in the water, one small tick up at the tip.
 */
export class Audio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private motor: { osc: OscillatorNode; gain: GainNode } | null = null
  private noiseBuf: AudioBuffer | null = null

  async start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume()
      return
    }
    const Ctor = window.AudioContext || (window as any).webkitAudioContext
    if (!Ctor) return
    const ctx: AudioContext = new Ctor()
    this.ctx = ctx
    const master = ctx.createGain()
    master.gain.value = 0.55
    master.connect(ctx.destination)
    this.master = master

    const len = ctx.sampleRate * 2
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    this.noiseBuf = buf

    // cabin: heater hum plus water slapping the hull, both very low
    const hum = ctx.createOscillator()
    hum.type = 'sine'
    hum.frequency.value = 63
    const humG = ctx.createGain()
    humG.gain.value = 0.035
    hum.connect(humG).connect(master)
    hum.start()

    const lap = ctx.createBufferSource()
    lap.buffer = buf
    lap.loop = true
    const lapF = ctx.createBiquadFilter()
    lapF.type = 'lowpass'
    lapF.frequency.value = 380
    const lapG = ctx.createGain()
    lapG.gain.value = 0.03
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.17
    const lfoG = ctx.createGain()
    lfoG.gain.value = 0.022
    lfo.connect(lfoG).connect(lapG.gain)
    lfo.start()
    lap.connect(lapF).connect(lapG).connect(master)
    lap.start()

    await ctx.resume()
  }

  private grain(freq: number, q: number, dur: number, gain: number, delay = 0, sweepTo?: number) {
    const ctx = this.ctx
    if (!ctx || !this.master || !this.noiseBuf) return
    const t = ctx.currentTime + delay
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuf
    src.loop = true
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.Q.value = q
    f.frequency.setValueAtTime(freq, t)
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(f).connect(g).connect(this.master)
    src.start(t)
    src.stop(t + dur + 0.05)
  }

  /** a fish taps the bait: dull knock below, then a fine tick at the rod tip */
  contact(strength: number, travel: number) {
    this.grain(150, 3.5, 0.1, 0.16 * strength, 0, 240)
    this.grain(1750, 7, 0.045, 0.1 * strength, travel, 2600)
  }

  /** the child lifts the rod */
  strike(loaded: boolean) {
    this.grain(520, 2.2, 0.09, 0.05, 0, 900)
    if (loaded) this.grain(95, 2.0, 0.32, 0.13, 0.05, 60)
  }

  splash() {
    this.grain(900, 0.8, 0.24, 0.16, 0, 260)
    this.grain(2600, 1.2, 0.13, 0.07, 0.01, 1200)
  }

  reel(on: boolean) {
    const ctx = this.ctx
    if (!ctx || !this.master) return
    if (on && !this.motor) {
      const osc = ctx.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.value = 118
      const f = ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = 620
      const gain = ctx.createGain()
      gain.gain.value = 0.0001
      gain.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.08)
      osc.connect(f).connect(gain).connect(this.master)
      osc.start()
      this.motor = { osc, gain }
    } else if (!on && this.motor) {
      const m = this.motor
      this.motor = null
      m.gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12)
      m.osc.stop(ctx.currentTime + 0.2)
    }
  }

  suspend() {
    this.ctx?.suspend()
  }
  resume() {
    this.ctx?.resume()
  }
}
