export type Easing = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  inOut: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  out: (t: number) => 1 - Math.pow(1 - t, 3),
  outQuint: (t: number) => 1 - Math.pow(1 - t, 5),
  in: (t: number) => t * t * t,
  back: (t: number) => {
    const c = 1.70158;
    return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
  },
  bounceSettle: (t: number) => 1 - Math.cos(t * Math.PI * 3.2) * Math.exp(-t * 5.5) * (1 - t),
};

interface Item {
  t: number;
  dur: number;
  delay: number;
  ease: Easing;
  update?: (k: number) => void;
  done?: () => void;
  tag?: string;
}

/** Minimal tween list. Everything scripted in the game runs through this. */
export class Tweener {
  /** global scripted-time multiplier; only the capture harness changes it */
  static speed = 1;
  private items: Item[] = [];

  add(dur: number, update?: (k: number) => void, opts: { ease?: Easing; delay?: number; done?: () => void; tag?: string } = {}) {
    this.items.push({
      t: 0,
      dur: Math.max(0.0001, dur / Tweener.speed),
      delay: (opts.delay ?? 0) / Tweener.speed,
      ease: opts.ease ?? ease.inOut,
      update,
      done: opts.done,
      tag: opts.tag,
    });
  }

  wait(dur: number, done: () => void, tag?: string) {
    this.add(dur, undefined, { done, tag });
  }

  cancel(tag?: string) {
    this.items = tag ? this.items.filter((i) => i.tag !== tag) : [];
  }

  get busy() {
    return this.items.length > 0;
  }

  update(dt: number) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.delay > 0) {
        it.delay -= dt;
        continue;
      }
      it.t += dt;
      const k = Math.min(1, it.t / it.dur);
      it.update?.(it.ease(k));
      if (k >= 1) {
        this.items.splice(i, 1);
        it.done?.();
      }
    }
  }
}
