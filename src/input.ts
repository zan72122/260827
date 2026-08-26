// One-finger upward swipe, forgiving of wandering. Pointer Events only.
// Finger speed is never evaluated: progress follows accumulated vertical travel.
export interface InputCallbacks {
  onDown(): void;
  onDelta(dyPixels: number): void; // positive = finger moved up
  onUp(cancelled: boolean): void;
}

export class SwipeInput {
  private pointerId: number | null = null;
  private lastY = 0;
  constructor(el: HTMLElement, cb: InputCallbacks) {
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => {
      if (this.pointerId !== null || !e.isPrimary) return;
      this.pointerId = e.pointerId;
      this.lastY = e.clientY;
      try { el.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
      cb.onDown();
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pointerId) return;
      // wide tolerance: only the vertical component matters, wandering is fine
      const dy = this.lastY - e.clientY;
      this.lastY = e.clientY;
      cb.onDelta(dy);
      e.preventDefault();
    });
    const end = (cancelled: boolean) => (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = null;
      cb.onUp(cancelled);
    };
    el.addEventListener('pointerup', end(false));
    el.addEventListener('pointercancel', end(true));
    el.addEventListener('lostpointercapture', (e) => {
      if (e.pointerId === this.pointerId) {
        this.pointerId = null;
        cb.onUp(true);
      }
    });
  }
  get active(): boolean {
    return this.pointerId !== null;
  }
}
