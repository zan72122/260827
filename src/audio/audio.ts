/**
 * 材質の音だけ。BGM も成功ファンファーレも鳴らさない。
 * 最初の明示的な操作でだけ音を開始する（自動再生はしない）。
 */
export class Sound {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private rustleGain: GainNode | null = null
  private rustleFilter: BiquadFilterNode | null = null
  private noise: AudioBufferSourceNode | null = null
  private started = false
  private muted = false

  get ready(): boolean {
    return this.started
  }

  /** 明示的な操作から呼ぶ。 */
  start(): void {
    if (this.started) return
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    try {
      const ctx = new Ctor()
      this.ctx = ctx
      const master = ctx.createGain()
      master.gain.value = this.muted ? 0 : 1
      master.connect(ctx.destination)
      this.master = master

      const len = Math.floor(ctx.sampleRate * 2)
      const buf = ctx.createBuffer(1, len, ctx.sampleRate)
      const d = buf.getChannelData(0)
      let last = 0
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1
        last = last * 0.35 + w * 0.65
        d[i] = last
      }
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.loop = true

      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = 2400
      bp.Q.value = 0.7
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = 700

      const g = ctx.createGain()
      g.gain.value = 0
      src.connect(hp).connect(bp).connect(g).connect(master)
      src.start()

      this.noise = src
      this.rustleGain = g
      this.rustleFilter = bp
      this.started = true
      void ctx.resume()
    } catch {
      this.started = false
    }
  }

  setMuted(m: boolean): void {
    this.muted = m
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.03)
    }
  }

  /** 開閉の速さに応じた擦過音。止めれば新しい音は出ない。 */
  setRustle(speed: number): void {
    if (!this.ctx || !this.rustleGain || !this.rustleFilter) return
    const s = Math.min(1, Math.abs(speed) / 1.1)
    const now = this.ctx.currentTime
    this.rustleGain.gain.setTargetAtTime(s * 0.22, now, s > 0.01 ? 0.02 : 0.05)
    this.rustleFilter.frequency.setTargetAtTime(1500 + s * 2600, now, 0.05)
  }

  /** クリップが触れた瞬間だけの小さな音。 */
  click(): void {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return
    const now = ctx.currentTime
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, now)
    g.gain.exponentialRampToValueAtTime(0.26, now + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.14)
    g.connect(master)
    for (const [freqValue, gainValue] of [
      [2100, 0.6],
      [3350, 0.34],
      [5200, 0.18],
    ]) {
      const o = ctx.createOscillator()
      o.type = 'triangle'
      o.frequency.value = freqValue
      const og = ctx.createGain()
      og.gain.value = gainValue
      o.connect(og).connect(g)
      o.start(now)
      o.stop(now + 0.16)
    }
    const nb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.03), ctx.sampleRate)
    const nd = nb.getChannelData(0)
    for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nd.length)
    const ns = ctx.createBufferSource()
    ns.buffer = nb
    const nf = ctx.createBiquadFilter()
    nf.type = 'highpass'
    nf.frequency.value = 2600
    ns.connect(nf).connect(g)
    ns.start(now)
    setTimeout(() => g.disconnect(), 400)
  }

  dispose(): void {
    try {
      this.noise?.stop()
      void this.ctx?.close()
    } catch {
      /* noop */
    }
    this.ctx = null
    this.started = false
  }
}
