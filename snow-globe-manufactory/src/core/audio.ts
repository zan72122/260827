/**
 * Procedural WebAudio. No files to download and nothing starts until the first
 * real touch, which is what iOS requires. Each material gets its own voice so a
 * pour, a gasket squeeze and a collar turn never smear into one noise.
 */

type Bus = 'water' | 'rubber' | 'metal' | 'snow'

export class Audio {
  private ctx: AudioContext | null = null
  private buses: Partial<Record<Bus, GainNode>> = {}
  private noise: AudioBuffer | null = null
  private started = false

  enabled = true

  /** Safe to call on every touch; only the first one does anything. */
  start() {
    if (this.started) {
      void this.ctx?.resume()
      return
    }
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    this.started = true
    const ctx = new Ctor()
    this.ctx = ctx
    const master = ctx.createGain()
    master.gain.value = 0.9
    master.connect(ctx.destination)

    const levels: Record<Bus, number> = { water: 0.5, rubber: 0.6, metal: 0.42, snow: 0.5 }
    for (const key of Object.keys(levels) as Bus[]) {
      const g = ctx.createGain()
      g.gain.value = levels[key]
      g.connect(master)
      this.buses[key] = g
    }

    const len = Math.floor(ctx.sampleRate * 2)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    let b0 = 0, b1 = 0, b2 = 0
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1
      // Light pinking keeps the noise beds from sounding like hiss.
      b0 = 0.99765 * b0 + w * 0.099
      b1 = 0.963 * b1 + w * 0.2965
      b2 = 0.57 * b2 + w * 1.0526
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22
    }
    this.noise = buf
    void ctx.resume()
  }

  private get ok(): boolean {
    return this.enabled && !!this.ctx && this.ctx.state === 'running'
  }

  private now(): number {
    return this.ctx!.currentTime
  }

  private noiseSource(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource()
    src.buffer = this.noise
    src.loop = true
    return src
  }

  /** One-shot filtered noise burst — the workhorse for physical textures. */
  private burst(
    bus: Bus,
    o: { dur: number; f0: number; f1: number; q: number; gain: number; type?: BiquadFilterType },
  ) {
    if (!this.ok) return
    const ctx = this.ctx!
    const t = this.now()
    const src = this.noiseSource()
    const f = ctx.createBiquadFilter()
    f.type = o.type ?? 'bandpass'
    f.Q.value = o.q
    f.frequency.setValueAtTime(o.f0, t)
    f.frequency.exponentialRampToValueAtTime(Math.max(40, o.f1), t + o.dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(o.gain, t + Math.min(0.03, o.dur * 0.3))
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur)
    src.connect(f).connect(g).connect(this.buses[bus]!)
    src.start(t)
    src.stop(t + o.dur + 0.05)
  }

  private tone(
    bus: Bus,
    o: { f0: number; f1?: number; dur: number; gain: number; type?: OscillatorType },
  ) {
    if (!this.ok) return
    const ctx = this.ctx!
    const t = this.now()
    const osc = ctx.createOscillator()
    osc.type = o.type ?? 'sine'
    osc.frequency.setValueAtTime(o.f0, t)
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + o.dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(o.gain, t + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur)
    osc.connect(g).connect(this.buses[bus]!)
    osc.start(t)
    osc.stop(t + o.dur + 0.05)
  }

  // ---- sustained beds -------------------------------------------------

  private beds = new Map<
    string,
    { src: AudioBufferSourceNode; gain: GainNode; filt: BiquadFilterNode }
  >()

  private bed(key: string, bus: Bus, freq: number, q: number) {
    if (!this.ok) return null
    let b = this.beds.get(key)
    if (!b) {
      const ctx = this.ctx!
      const src = this.noiseSource()
      const filt = ctx.createBiquadFilter()
      filt.type = 'bandpass'
      filt.frequency.value = freq
      filt.Q.value = q
      const gain = ctx.createGain()
      gain.gain.value = 0
      src.connect(filt).connect(gain).connect(this.buses[bus]!)
      src.start()
      b = { src, gain, filt }
      this.beds.set(key, b)
    }
    return b
  }

  /** amount 0..1 — level of a continuously running texture. */
  setBed(key: string, bus: Bus, freq: number, q: number, amount: number, gainScale = 1) {
    const b = this.bed(key, bus, freq, q)
    if (!b) return
    const t = this.now()
    b.filt.frequency.setTargetAtTime(freq, t, 0.08)
    b.gain.gain.setTargetAtTime(Math.max(0, Math.min(1, amount)) * gainScale, t, 0.07)
  }

  stopBeds() {
    if (!this.ctx) return
    const t = this.now()
    for (const b of this.beds.values()) b.gain.gain.setTargetAtTime(0, t, 0.1)
  }

  // ---- named cues -----------------------------------------------------

  /** Snow granules landing in the funnel. */
  scoop() {
    this.burst('snow', { dur: 0.34, f0: 5200, f1: 2600, q: 0.7, gain: 0.3 })
  }

  /** A miniature seating onto the base. */
  placePiece() {
    this.burst('snow', { dur: 0.13, f0: 900, f1: 380, q: 1.4, gain: 0.34 })
    this.tone('metal', { f0: 300, f1: 190, dur: 0.13, gain: 0.06, type: 'triangle' })
  }

  bubble() {
    if (!this.ok) return
    const f = 480 + Math.random() * 700
    this.tone('water', { f0: f, f1: f * 2.1, dur: 0.09, gain: 0.05 })
  }

  /** Rubber compressing against the glass rim. */
  gasketSqueeze(amount: number) {
    this.burst('rubber', { dur: 0.2, f0: 340 + amount * 260, f1: 150, q: 3.2, gain: 0.1 + amount * 0.18 })
  }

  gasketSeat() {
    this.burst('rubber', { dur: 0.3, f0: 220, f1: 80, q: 2.2, gain: 0.4 })
    this.tone('rubber', { f0: 150, f1: 66, dur: 0.26, gain: 0.16, type: 'sine' })
  }

  /** One notch of the locking collar. */
  collarTick() {
    this.burst('metal', { dur: 0.06, f0: 3000, f1: 1500, q: 5, gain: 0.2 })
  }

  collarLocked() {
    this.tone('metal', { f0: 640, f1: 420, dur: 0.34, gain: 0.13, type: 'triangle' })
    this.burst('metal', { dur: 0.16, f0: 1800, f1: 700, q: 3, gain: 0.16 })
  }

  /** Water and snow sloshing while the globe is being moved. */
  slosh(power: number) {
    this.setBed('slosh', 'water', 420 + power * 700, 0.9, Math.min(1, power), 0.5)
  }

  thud() {
    this.tone('metal', { f0: 120, f1: 58, dur: 0.34, gain: 0.2, type: 'sine' })
    this.burst('rubber', { dur: 0.2, f0: 420, f1: 140, q: 1.4, gain: 0.18 })
  }

  chime() {
    if (!this.ok) return
    const notes = [784, 988, 1175, 1568]
    notes.forEach((f, i) => {
      window.setTimeout(() => this.tone('metal', { f0: f, dur: 1.0, gain: 0.07 }), i * 115)
    })
  }

  lampOn() {
    this.tone('metal', { f0: 1320, f1: 1980, dur: 0.4, gain: 0.05, type: 'sine' })
  }

  snowFall(amount: number) {
    this.setBed('fall', 'snow', 6200, 0.5, amount, 0.22)
  }

  suspend() {
    void this.ctx?.suspend()
  }

  resume() {
    if (this.started) void this.ctx?.resume()
  }
}
