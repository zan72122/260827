export type EaseFn = (t: number) => number

export const Ease = {
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t: number) => {
    const c1 = 1.4
    const c3 = c1 + 1
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
  },
}

interface Entry {
  t: number
  dur: number
  delay: number
  ease: EaseFn
  fn: (k: number) => void
  done?: () => void
}

/** Minimal tween list; every scripted beat in the game runs through it. */
export class Tweens {
  private list: Entry[] = []

  add(
    dur: number,
    fn: (k: number) => void,
    opts: { done?: () => void; delay?: number; ease?: EaseFn } = {},
  ) {
    this.list.push({
      t: 0,
      dur: Math.max(0.0001, dur),
      delay: opts.delay ?? 0,
      ease: opts.ease ?? Ease.inOut,
      fn,
      done: opts.done,
    })
  }

  update(dt: number) {
    if (this.list.length === 0) return
    const finished: Entry[] = []
    for (const e of this.list) {
      if (e.delay > 0) {
        e.delay -= dt
        continue
      }
      e.t += dt
      const k = Math.min(1, e.t / e.dur)
      e.fn(e.ease(k))
      if (k >= 1) finished.push(e)
    }
    if (finished.length) {
      this.list = this.list.filter((e) => !finished.includes(e))
      for (const e of finished) e.done?.()
    }
  }

  clear() {
    this.list.length = 0
  }
}
