// One-finger input. The whole screen is the control surface for scrubbing
// (so the finger never has to sit on top of Santa), taps are raycast against
// oversized invisible hit volumes.

export interface InputHandler {
  onDown(x01: number, y01: number): void;
  // dx/dy are normalized to the short screen edge, per event
  onDrag(dx: number, dy: number, x01: number, y01: number): void;
  onUp(wasTap: boolean, x01: number, y01: number): void;
}

export class InputManager {
  private el: HTMLElement;
  handler: InputHandler | null = null;
  private activeId: number | null = null;
  private startX = 0;
  private startY = 0;
  private lastX = 0;
  private lastY = 0;
  private startT = 0;
  private moved = 0;

  constructor(el: HTMLElement) {
    this.el = el;
    el.addEventListener('pointerdown', this.down, { passive: false });
    el.addEventListener('pointermove', this.move, { passive: false });
    el.addEventListener('pointerup', this.up, { passive: false });
    el.addEventListener('pointercancel', this.cancel, { passive: false });
    el.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  }

  private norm(): number {
    return Math.min(window.innerWidth, window.innerHeight);
  }

  private down = (e: PointerEvent): void => {
    if (this.activeId !== null) return; // one finger only
    this.activeId = e.pointerId;
    try { this.el.setPointerCapture(e.pointerId); } catch { /* ok */ }
    this.startX = this.lastX = e.clientX;
    this.startY = this.lastY = e.clientY;
    this.startT = performance.now();
    this.moved = 0;
    this.handler?.onDown(e.clientX / window.innerWidth, e.clientY / window.innerHeight);
    e.preventDefault();
  };

  private move = (e: PointerEvent): void => {
    if (e.pointerId !== this.activeId) return;
    const n = this.norm();
    const dx = (e.clientX - this.lastX) / n;
    const dy = (e.clientY - this.lastY) / n;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.moved += Math.abs(dx) + Math.abs(dy);
    this.handler?.onDrag(dx, dy, e.clientX / window.innerWidth, e.clientY / window.innerHeight);
    e.preventDefault();
  };

  private up = (e: PointerEvent): void => {
    if (e.pointerId !== this.activeId) return;
    this.activeId = null;
    // generous for small fingers: slow, slightly wobbly presses still count
    const dt = performance.now() - this.startT;
    const wasTap = this.moved < 0.05 && dt < 900;
    this.handler?.onUp(wasTap, e.clientX / window.innerWidth, e.clientY / window.innerHeight);
    e.preventDefault();
  };

  private cancel = (e: PointerEvent): void => {
    if (e.pointerId !== this.activeId) return;
    this.activeId = null;
    this.handler?.onUp(false, this.lastX / window.innerWidth, this.lastY / window.innerHeight);
  };

  get touching(): boolean {
    return this.activeId !== null;
  }
}
