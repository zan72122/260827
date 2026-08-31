import * as THREE from 'three';

/**
 * One finger, handled properly.
 *
 * The first pointer down owns the gesture; extra fingers are ignored until it
 * ends, so a palm resting on the glass cannot hijack the stroke. The pointer is
 * captured, so dragging off the edge of the screen keeps delivering moves, and
 * pointercancel — which iOS fires for a system gesture or an incoming call —
 * ends the stroke cleanly rather than leaving cream flowing forever.
 */

export interface PointerFrame {
  /** CSS pixels, relative to the canvas. */
  x: number;
  y: number;
  /** Movement since the previous frame, CSS pixels. */
  dx: number;
  dy: number;
  /** Seconds since this stroke began. */
  age: number;
  /** Total distance travelled this stroke, CSS pixels. */
  travelled: number;
}

export interface PointerHandlers {
  onDown?(f: PointerFrame): void;
  onMove?(f: PointerFrame): void;
  onUp?(f: PointerFrame, cancelled: boolean): void;
}

export class PointerInput {
  private readonly el: HTMLElement;
  private handlers: PointerHandlers = {};
  private id: number | null = null;
  private last = new THREE.Vector2();
  private startTime = 0;
  private travelled = 0;
  private pending: { x: number; y: number } | null = null;

  readonly current: PointerFrame = { x: 0, y: 0, dx: 0, dy: 0, age: 0, travelled: 0 };
  down = false;
  /** True on the frame the stroke ended, for stages that need the edge. */
  private queuedUp: { cancelled: boolean } | null = null;

  constructor(el: HTMLElement) {
    this.el = el;
    el.addEventListener('pointerdown', this.onDown, { passive: false });
    el.addEventListener('pointermove', this.onMove, { passive: false });
    el.addEventListener('pointerup', this.onUp, { passive: false });
    el.addEventListener('pointercancel', this.onCancel, { passive: false });
    el.addEventListener('lostpointercapture', this.onCancel, { passive: false });
    el.addEventListener('contextmenu', this.prevent);
  }

  setHandlers(h: PointerHandlers): void {
    this.handlers = h;
  }

  /** Abandon any stroke in progress — used when the stage changes underfoot. */
  release(): void {
    if (this.down) {
      this.down = false;
      this.id = null;
      this.queuedUp = { cancelled: true };
    }
  }

  private prevent = (e: Event) => e.preventDefault();

  private local(e: PointerEvent): { x: number; y: number } {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onDown = (e: PointerEvent) => {
    if (this.id !== null) return; // an extra finger; the first one owns the stroke
    e.preventDefault();
    this.id = e.pointerId;
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety, not a requirement */
    }
    const p = this.local(e);
    this.last.set(p.x, p.y);
    this.startTime = performance.now();
    this.travelled = 0;
    this.down = true;
    Object.assign(this.current, { x: p.x, y: p.y, dx: 0, dy: 0, age: 0, travelled: 0 });
    this.handlers.onDown?.(this.current);
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerId !== this.id) return;
    e.preventDefault();
    const p = this.local(e);
    this.pending = p;
  };

  private end(e: PointerEvent, cancelled: boolean): void {
    if (e.pointerId !== this.id) return;
    e.preventDefault();
    try {
      this.el.releasePointerCapture(e.pointerId);
    } catch {
      /* already gone */
    }
    this.id = null;
    this.down = false;
    this.queuedUp = { cancelled };
  }

  private onUp = (e: PointerEvent) => this.end(e, false);
  private onCancel = (e: PointerEvent) => this.end(e, true);

  /**
   * Fold whatever arrived since the last frame into a single move, then deliver
   * any queued end. Called once per animation frame so the game never sees a
   * burst of coalesced events as a burst of separate strokes.
   */
  pump(): void {
    if (this.pending && this.id !== null) {
      const p = this.pending;
      this.pending = null;
      const dx = p.x - this.last.x;
      const dy = p.y - this.last.y;
      this.last.set(p.x, p.y);
      this.travelled += Math.hypot(dx, dy);
      Object.assign(this.current, {
        x: p.x,
        y: p.y,
        dx,
        dy,
        age: (performance.now() - this.startTime) / 1000,
        travelled: this.travelled,
      });
      this.handlers.onMove?.(this.current);
    } else if (this.down) {
      this.current.dx = 0;
      this.current.dy = 0;
      this.current.age = (performance.now() - this.startTime) / 1000;
      this.handlers.onMove?.(this.current);
    }

    if (this.queuedUp) {
      const { cancelled } = this.queuedUp;
      this.queuedUp = null;
      this.pending = null;
      this.current.dx = 0;
      this.current.dy = 0;
      this.handlers.onUp?.(this.current, cancelled);
    }
  }

  dispose(): void {
    this.el.removeEventListener('pointerdown', this.onDown);
    this.el.removeEventListener('pointermove', this.onMove);
    this.el.removeEventListener('pointerup', this.onUp);
    this.el.removeEventListener('pointercancel', this.onCancel);
    this.el.removeEventListener('lostpointercapture', this.onCancel);
    this.el.removeEventListener('contextmenu', this.prevent);
  }
}
