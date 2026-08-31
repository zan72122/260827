/**
 * One finger at a time.
 *
 * Everything the child does is a press, a drag or a release, so the router
 * keeps exactly one pointer: the first one down wins, a second finger is
 * ignored outright rather than fighting it, and the pointer is captured so a
 * drag that wanders off the canvas -- or off the screen -- keeps working.
 * `pointercancel` (a system gesture, a call coming in) ends the gesture the
 * same way a release does, so nothing is ever left stuck to the finger.
 */
export interface Touch {
  /** CSS pixels within the canvas */
  x: number;
  y: number;
  /** normalised device coordinates, -1..1 */
  nx: number;
  ny: number;
  /** movement since the previous event, CSS pixels */
  dx: number;
  dy: number;
  /** CSS pixels travelled since the press */
  travel: number;
  /** seconds since the press */
  age: number;
}

export type TouchHandler = (t: Touch) => void;

export class PointerRouter {
  onDown: TouchHandler = () => {};
  onMove: TouchHandler = () => {};
  onUp: TouchHandler = () => {};
  /** Called for a cancelled gesture: release whatever was grabbed, quietly. */
  onCancel: () => void = () => {};

  private el: HTMLElement | null = null;
  private id: number | null = null;
  private last = { x: 0, y: 0 };
  private start = { x: 0, y: 0, t: 0 };
  private travel = 0;
  private now: () => number;

  constructor(now: () => number = () => performance.now() / 1000) {
    this.now = now;
  }

  get active(): boolean {
    return this.id !== null;
  }

  attach(el: HTMLElement): void {
    this.el = el;
    el.addEventListener('pointerdown', this.down, { passive: false });
    el.addEventListener('pointermove', this.move, { passive: false });
    el.addEventListener('pointerup', this.up, { passive: false });
    el.addEventListener('pointercancel', this.cancel, { passive: false });
    el.addEventListener('lostpointercapture', this.cancel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  detach(): void {
    const el = this.el;
    if (!el) return;
    el.removeEventListener('pointerdown', this.down);
    el.removeEventListener('pointermove', this.move);
    el.removeEventListener('pointerup', this.up);
    el.removeEventListener('pointercancel', this.cancel);
    el.removeEventListener('lostpointercapture', this.cancel);
    this.el = null;
  }

  /** Drop the current gesture without a release, e.g. when the tab is hidden. */
  abort(): void {
    if (this.id === null) return;
    this.id = null;
    this.onCancel();
  }

  private sample(e: PointerEvent): Touch {
    const el = this.el!;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const dx = x - this.last.x;
    const dy = y - this.last.y;
    this.last = { x, y };
    this.travel += Math.hypot(dx, dy);
    return {
      x,
      y,
      nx: (x / Math.max(1, r.width)) * 2 - 1,
      ny: -((y / Math.max(1, r.height)) * 2 - 1),
      dx,
      dy,
      travel: this.travel,
      age: this.now() - this.start.t,
    };
  }

  private down = (e: PointerEvent): void => {
    if (this.id !== null) return; // a second finger never takes over
    e.preventDefault();
    this.id = e.pointerId;
    const r = this.el!.getBoundingClientRect();
    this.last = { x: e.clientX - r.left, y: e.clientY - r.top };
    this.start = { ...this.last, t: this.now() };
    this.travel = 0;
    try {
      this.el!.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety; the gesture still works without it */
    }
    this.onDown(this.sample(e));
  };

  private move = (e: PointerEvent): void => {
    if (e.pointerId !== this.id) return;
    e.preventDefault();
    this.onMove(this.sample(e));
  };

  private up = (e: PointerEvent): void => {
    if (e.pointerId !== this.id) return;
    e.preventDefault();
    const t = this.sample(e);
    this.id = null;
    try {
      this.el!.releasePointerCapture(e.pointerId);
    } catch {
      /* already gone */
    }
    this.onUp(t);
  };

  private cancel = (e: PointerEvent): void => {
    if (e.pointerId !== this.id) return;
    this.id = null;
    this.onCancel();
  };
}
