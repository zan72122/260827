export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}
/** Frame-rate independent exponential approach. */
export const approach = (cur: number, target: number, rate: number, dt: number) =>
  cur + (target - cur) * (1 - Math.exp(-rate * dt))

/** Deterministic value noise in 1D — used instead of Math.random for readable behaviour. */
export function noise1(x: number): number {
  const i = Math.floor(x)
  const f = x - i
  const h = (n: number) => {
    const s = Math.sin(n * 127.1) * 43758.5453
    return s - Math.floor(s)
  }
  const a = h(i)
  const b = h(i + 1)
  const u = f * f * (3 - 2 * f)
  return a + (b - a) * u
}

/** Second order damped oscillator, integrated semi-implicitly. */
export class Spring {
  x = 0
  v = 0
  constructor(public freq: number, public damping: number) {}
  step(dt: number, target = 0) {
    const w = 2 * Math.PI * this.freq
    // sub-step so the integrator stays stable even on a slow frame
    const n = Math.max(1, Math.ceil((w * dt) / 0.35))
    const h = dt / n
    for (let i = 0; i < n; i++) {
      const a = -w * w * (this.x - target) - 2 * this.damping * w * this.v
      this.v += a * h
      this.x += this.v * h
    }
  }
  kick(amount: number) {
    this.v += amount
  }
}
