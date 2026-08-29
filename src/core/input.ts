/**
 * One finger, four gestures: a big swipe, a press-and-hold, an up/down swipe on
 * the rollers and a long downward pull. Nothing needs precision, pinch or two
 * fingers.
 */
export interface Swipe {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  dx: number;
  dy: number;
  length: number;
}

export class Input {
  /** finger is on the glass right now */
  down = false;
  /** current position, CSS pixels */
  x = 0;
  y = 0;
  startX = 0;
  startY = 0;
  /** movement since the previous frame */
  frameDx = 0;
  frameDy = 0;
  /** how long the current press has lasted, seconds */
  holdTime = 0;
  /** total downward travel of the current press, CSS pixels */
  pulledDown = 0;
  /** signed vertical travel accumulated for roller feeding */
  strokeDistance = 0;

  private pending: Swipe[] = [];
  private swipeFired = false;
  private lastX = 0;
  private lastY = 0;
  private el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onUp);
    el.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private onDown = (e: PointerEvent): void => {
    if (this.down) return; // strictly single finger
    this.down = true;
    this.swipeFired = false;
    this.x = this.startX = this.lastX = e.clientX;
    this.y = this.startY = this.lastY = e.clientY;
    this.holdTime = 0;
    this.pulledDown = 0;
    this.strokeDistance = 0;
    this.el.setPointerCapture?.(e.pointerId);
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.down) return;
    this.x = e.clientX;
    this.y = e.clientY;
    const dy = this.y - this.lastY;
    if (dy > 0) this.pulledDown += dy;
    this.strokeDistance += Math.abs(dy);
    this.frameDx += this.x - this.lastX;
    this.frameDy += dy;
    this.lastX = this.x;
    this.lastY = this.y;

    if (!this.swipeFired) {
      const dx = this.x - this.startX;
      const dyTotal = this.y - this.startY;
      const len = Math.hypot(dx, dyTotal);
      const threshold = Math.min(window.innerWidth, window.innerHeight) * 0.16;
      if (len > threshold) {
        this.swipeFired = true;
        this.pending.push({
          x0: this.startX,
          y0: this.startY,
          x1: this.x,
          y1: this.y,
          dx,
          dy: dyTotal,
          length: len,
        });
      }
    }
  };

  private onUp = (): void => {
    this.down = false;
    this.holdTime = 0;
  };

  /** true once the current press has travelled far enough to be a swipe */
  get travelling(): boolean {
    return this.swipeFired;
  }

  /** Advance timers; call once per frame before reading gestures. */
  tick(dt: number): void {
    if (this.down) this.holdTime += dt;
  }

  /** Clear per-frame deltas; call at the end of the frame. */
  endFrame(): void {
    this.frameDx = 0;
    this.frameDy = 0;
  }

  /** Take the oldest swipe that matches, if any. */
  takeSwipe(match?: (s: Swipe) => boolean): Swipe | null {
    for (let i = 0; i < this.pending.length; i++) {
      if (!match || match(this.pending[i])) return this.pending.splice(i, 1)[0];
    }
    return null;
  }

  clearSwipes(): void {
    this.pending.length = 0;
  }

  /** Test-support: synthesise a gesture without a real pointer device. */
  injectSwipe(x0: number, y0: number, x1: number, y1: number): void {
    this.pending.push({
      x0,
      y0,
      x1,
      y1,
      dx: x1 - x0,
      dy: y1 - y0,
      length: Math.hypot(x1 - x0, y1 - y0),
    });
  }
}
