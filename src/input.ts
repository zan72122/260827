/**
 * One finger, one continuous swipe. Pointer Events with pointer capture,
 * touch-action:none on the canvas, pointercancel handled. The finger's
 * displacement — projected onto the journey axis (right in landscape,
 * up/diagonal-up in portrait) — maps directly to journeyProgress, so the
 * finger position IS the bag position: scrub forward, pause, scrub back.
 * Meandering perpendicular to the axis is simply ignored; nothing is scored.
 */
export class InputController {
  /** the progress the finger is asking for */
  target = 0;
  dragging = false;
  everDragged = false;
  /** seconds since last pointer activity */
  idleTime = 0;

  private activeId: number | null = null;
  private startX = 0;
  private startY = 0;
  private startTarget = 0;
  private el: HTMLElement;
  private onGesture: () => void;

  constructor(el: HTMLElement, onGesture: () => void) {
    this.el = el;
    this.onGesture = onGesture;
    el.addEventListener('pointerdown', this.down, { passive: false });
    el.addEventListener('pointermove', this.move, { passive: false });
    el.addEventListener('pointerup', this.up, { passive: false });
    el.addEventListener('pointercancel', this.cancel, { passive: false });
    el.addEventListener('lostpointercapture', this.lost);
  }

  /** full-journey swipe distance in px for the current viewport */
  private mapLen(): number {
    const portrait = window.innerHeight > window.innerWidth;
    return (portrait ? window.innerHeight : window.innerWidth) * 0.82;
  }

  private project(dx: number, dy: number): number {
    const portrait = window.innerHeight > window.innerWidth;
    if (portrait) {
      // up or diagonally-up counts forward
      return -dy * 0.975 + dx * 0.22;
    }
    return dx;
  }

  private down = (e: PointerEvent): void => {
    if (this.activeId !== null) return; // one finger only
    e.preventDefault();
    this.activeId = e.pointerId;
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* capture unsupported */
    }
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.startTarget = this.target;
    this.dragging = true;
    this.idleTime = 0;
    this.onGesture();
  };

  private move = (e: PointerEvent): void => {
    if (e.pointerId !== this.activeId) return;
    e.preventDefault();
    const proj = this.project(e.clientX - this.startX, e.clientY - this.startY);
    const next = Math.min(1, Math.max(0, this.startTarget + proj / this.mapLen()));
    if (Math.abs(next - this.startTarget) > 0.01) this.everDragged = true;
    this.target = next;
    this.idleTime = 0;
  };

  private release(id: number): void {
    if (id !== this.activeId) return;
    this.activeId = null;
    this.dragging = false;
    this.idleTime = 0;
  }

  private up = (e: PointerEvent): void => {
    e.preventDefault();
    this.release(e.pointerId);
  };

  private cancel = (e: PointerEvent): void => {
    this.release(e.pointerId);
  };

  private lost = (e: PointerEvent): void => {
    this.release(e.pointerId);
  };

  tick(dt: number): void {
    if (!this.dragging) this.idleTime += dt;
  }
}
