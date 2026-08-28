/**
 * One finger, four verbs: big swipe, press and hold, up/down swipe on the rollers,
 * long pull. No pinch, no rotate, no precision dragging.
 */
export interface SwipeEvent {
  /** Unit direction in screen space, y positive downward. */
  dx: number;
  dy: number;
  /** Travel as a fraction of the shorter viewport edge. */
  distance: number;
  /** Fraction of the shorter edge per second. */
  speed: number;
}

export class Gestures {
  private el: HTMLElement;
  private pointerId: number | null = null;
  private startX = 0;
  private startY = 0;
  private lastX = 0;
  private lastY = 0;
  private lastT = 0;
  private swipeSent = false;

  /** True while a finger is on the screen. */
  down = false;
  /** Seconds the current press has lasted. */
  holdTime = 0;
  /** Travel since press start, as a fraction of the shorter viewport edge. */
  dx = 0;
  dy = 0;
  /** Movement during the last frame, same units. */
  frameDx = 0;
  frameDy = 0;
  /** Normalised press position, 0..1 from the top-left. */
  x = 0.5;
  y = 0.5;
  /** Set when the current gesture ended this frame. */
  released = false;

  onSwipe: ((e: SwipeEvent) => void) | null = null;
  onTap: ((x: number, y: number) => void) | null = null;

  constructor(el: HTMLElement) {
    this.el = el;
    el.addEventListener('pointerdown', this.handleDown, { passive: false });
    el.addEventListener('pointermove', this.handleMove, { passive: false });
    window.addEventListener('pointerup', this.handleUp, { passive: false });
    window.addEventListener('pointercancel', this.handleUp, { passive: false });
    el.addEventListener('contextmenu', this.preventDefault);
    el.addEventListener('touchstart', this.preventDefault, { passive: false });
    el.addEventListener('touchmove', this.preventDefault, { passive: false });
  }

  private preventDefault = (e: Event) => e.preventDefault();

  private get unit(): number {
    return Math.min(window.innerWidth, window.innerHeight) || 1;
  }

  private handleDown = (e: PointerEvent) => {
    if (this.pointerId !== null) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    this.down = true;
    this.holdTime = 0;
    this.swipeSent = false;
    this.startX = this.lastX = e.clientX;
    this.startY = this.lastY = e.clientY;
    this.lastT = performance.now();
    this.dx = this.dy = this.frameDx = this.frameDy = 0;
    this.x = e.clientX / window.innerWidth;
    this.y = e.clientY / window.innerHeight;
  };

  private handleMove = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    e.preventDefault();
    const u = this.unit;
    this.frameDx += (e.clientX - this.lastX) / u;
    this.frameDy += (e.clientY - this.lastY) / u;
    this.dx = (e.clientX - this.startX) / u;
    this.dy = (e.clientY - this.startY) / u;
    this.x = e.clientX / window.innerWidth;
    this.y = e.clientY / window.innerHeight;
    const now = performance.now();
    const dt = Math.max(0.008, (now - this.lastT) / 1000);
    if (!this.swipeSent) {
      const dist = Math.hypot(this.dx, this.dy);
      if (dist > 0.11) {
        this.swipeSent = true;
        const len = Math.max(1e-4, dist);
        const stepDist = Math.hypot(e.clientX - this.lastX, e.clientY - this.lastY) / u;
        this.onSwipe?.({
          dx: this.dx / len,
          dy: this.dy / len,
          distance: dist,
          speed: stepDist / dt,
        });
      }
    }
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.lastT = now;
  };

  private handleUp = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.down = false;
    this.released = true;
    if (!this.swipeSent && this.holdTime < 0.45 && Math.hypot(this.dx, this.dy) < 0.04) {
      this.onTap?.(this.x, this.y);
    }
  };

  /** Called once per frame; clears per-frame accumulators. */
  beginFrame(dt: number): void {
    if (this.down) this.holdTime += dt;
  }

  endFrame(): void {
    this.frameDx = 0;
    this.frameDy = 0;
    this.released = false;
  }

  dispose(): void {
    this.el.removeEventListener('pointerdown', this.handleDown);
    this.el.removeEventListener('pointermove', this.handleMove);
    window.removeEventListener('pointerup', this.handleUp);
    window.removeEventListener('pointercancel', this.handleUp);
    this.el.removeEventListener('contextmenu', this.preventDefault);
    this.el.removeEventListener('touchstart', this.preventDefault);
    this.el.removeEventListener('touchmove', this.preventDefault);
  }
}
