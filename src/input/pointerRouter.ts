export interface PointerSample {
  id: number;
  /** CSS pixels, relative to the canvas */
  x: number;
  y: number;
}

export interface PointerSink {
  onDown(p: PointerSample): boolean;
  onMove(p: PointerSample): void;
  onUp(p: PointerSample): void;
  onCancel(p: PointerSample): void;
}

/**
 * One pointer at a time, always.  The first pointer that a sink accepts owns the
 * gesture until it goes up or is cancelled; every other pointer is ignored
 * outright, so a second finger cannot disturb a board or a wind in progress.
 * Pointer capture keeps the gesture alive if the finger leaves the canvas.
 */
export class PointerRouter {
  private activeId: number | null = null;
  private owner: PointerSink | null = null;

  constructor(
    private el: HTMLElement,
    private sinks: PointerSink[],
  ) {
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', this.down, { passive: false });
    el.addEventListener('pointermove', this.move, { passive: false });
    el.addEventListener('pointerup', this.up, { passive: false });
    el.addEventListener('pointercancel', this.cancel, { passive: false });
    el.addEventListener('lostpointercapture', this.lost);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get busy() {
    return this.activeId !== null;
  }

  private sample(e: PointerEvent): PointerSample {
    const r = this.el.getBoundingClientRect();
    return { id: e.pointerId, x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private down = (e: PointerEvent) => {
    e.preventDefault();
    if (this.activeId !== null) return; // second finger: harmless, ignored
    const p = this.sample(e);
    for (const sink of this.sinks) {
      if (sink.onDown(p)) {
        this.activeId = e.pointerId;
        this.owner = sink;
        try {
          this.el.setPointerCapture(e.pointerId);
        } catch {
          /* capture is a nicety, not a requirement */
        }
        return;
      }
    }
  };

  private move = (e: PointerEvent) => {
    if (e.pointerId !== this.activeId || !this.owner) return;
    e.preventDefault();
    this.owner.onMove(this.sample(e));
  };

  private finish(e: PointerEvent, cancelled: boolean) {
    if (e.pointerId !== this.activeId || !this.owner) return;
    const p = this.sample(e);
    const owner = this.owner;
    this.activeId = null;
    this.owner = null;
    try {
      this.el.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (cancelled) owner.onCancel(p);
    else owner.onUp(p);
  }

  private up = (e: PointerEvent) => {
    e.preventDefault();
    this.finish(e, false);
  };

  private cancel = (e: PointerEvent) => {
    this.finish(e, true);
  };

  private lost = (e: PointerEvent) => {
    // The browser took the capture away (scroll, orientation change, system
    // gesture).  Treat it exactly like a cancel so nothing can get stuck down.
    if (e.pointerId === this.activeId) this.finish(e, true);
  };

  /** Drop any gesture in progress, e.g. when the tab goes away. */
  abort() {
    if (this.owner) {
      this.owner.onCancel({ id: this.activeId ?? -1, x: 0, y: 0 });
    }
    this.activeId = null;
    this.owner = null;
  }
}
