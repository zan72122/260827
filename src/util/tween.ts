export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const damp = (current: number, target: number, lambda: number, dt: number) =>
  current + (target - current) * (1 - Math.exp(-lambda * dt));

/** Minimal time-based tween queue driven from the main loop. */
export class Timeline {
  private items: { t: number; dur: number; delay: number; fn: (k: number) => void; done?: () => void }[] = [];

  add(dur: number, fn: (k: number) => void, delay = 0, done?: () => void) {
    this.items.push({ t: 0, dur, delay, fn, done });
    return this;
  }
  wait(dur: number, done?: () => void) {
    return this.add(dur, () => {}, 0, done);
  }
  get busy() {
    return this.items.length > 0;
  }
  clear() {
    this.items.length = 0;
  }
  update(dt: number) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      const local = it.t - it.delay;
      if (local < 0) continue;
      const k = it.dur <= 0 ? 1 : clamp(local / it.dur, 0, 1);
      it.fn(k);
      if (k >= 1) {
        this.items.splice(i, 1);
        it.done?.();
      }
    }
  }
}
