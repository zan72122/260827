import * as THREE from 'three';

export type OpenSource = 'idle' | 'drag' | 'settle';

/**
 * One finger, one meaning: how far you move sideways is how far the paper is
 * open. The mapping is relative and re-anchored on every touch, so letting go
 * and grabbing somewhere else never makes the tree jump, and the moving end
 * can travel all the way round the back without the drag being lost.
 *
 * Nothing here runs on a timer. Left alone, the tree stays exactly where the
 * finger left it.
 */
export class OpenControl {
  open = 0;
  velocity = 0;
  source: OpenSource = 'idle';
  onFirstInput: (() => void) | null = null;

  private el: HTMLElement;
  private hitTest: (x: number, y: number) => boolean;
  private activeId: number | null = null;
  private anchorX = 0;
  private anchorOpen = 0;
  private gainPx = 320;
  private settleTo: number | null = null;
  private settleFrom = 0;
  private settleT = 0;
  private firstDone = false;
  private prevOpen = 0;
  private bound: Array<[string, EventListener]> = [];

  constructor(el: HTMLElement, hitTest: (x: number, y: number) => boolean) {
    this.el = el;
    this.hitTest = hitTest;
    this.on('pointerdown', this.down as EventListener);
    this.on('pointermove', this.move as EventListener);
    this.on('pointerup', this.up as EventListener);
    this.on('pointercancel', this.up as EventListener);
    this.on('lostpointercapture', this.up as EventListener);
    this.on('contextmenu', ((e: Event) => e.preventDefault()) as EventListener);
    // A rotation or a tab switch mid-drag must end the drag cleanly, keeping
    // whatever opening the finger had reached.
    const abort = () => this.release(false);
    window.addEventListener('orientationchange', abort);
    window.addEventListener('blur', abort);
    document.addEventListener('visibilitychange', abort);
    this.extra = [
      () => window.removeEventListener('orientationchange', abort),
      () => window.removeEventListener('blur', abort),
      () => document.removeEventListener('visibilitychange', abort),
    ];
    this.resize();
  }

  private extra: Array<() => void> = [];

  private on(type: string, fn: EventListener) {
    this.el.addEventListener(type, fn, { passive: false });
    this.bound.push([type, fn]);
  }

  get listenerCount() {
    return this.bound.length + this.extra.length;
  }

  get dragging() {
    return this.activeId !== null;
  }

  resize() {
    const vw = this.el.clientWidth || window.innerWidth;
    this.gainPx = THREE.MathUtils.clamp(vw * 0.72, 230, 560);
  }

  private down = (e: PointerEvent) => {
    if (this.activeId !== null) return; // a second finger is simply ignored
    if (!this.hitTest(e.clientX, e.clientY)) return;
    e.preventDefault();
    this.activeId = e.pointerId;
    this.anchorX = e.clientX;
    this.anchorOpen = this.open;
    this.settleTo = null;
    this.source = 'drag';
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* capture is an optimisation, not a requirement */
    }
    if (!this.firstDone) {
      this.firstDone = true;
      this.onFirstInput?.();
    }
  };

  private move = (e: PointerEvent) => {
    if (e.pointerId !== this.activeId) return;
    e.preventDefault();
    // The paper's free edge sweeps across the front of the tree as it opens,
    // so the finger and the edge travel the same way: leftwards opens.
    const next = this.anchorOpen - (e.clientX - this.anchorX) / this.gainPx;
    // Re-anchor at the stops so pushing past them and coming back is symmetric.
    if (next < 0) {
      this.anchorX = e.clientX;
      this.anchorOpen = 0;
      this.open = 0;
    } else if (next > 1) {
      this.anchorX = e.clientX;
      this.anchorOpen = 1;
      this.open = 1;
    } else {
      this.open = next;
    }
  };

  private up = (e: PointerEvent) => {
    if (e.pointerId !== this.activeId) return;
    this.release(true);
  };

  private release(allowSettle: boolean) {
    if (this.activeId === null) return;
    try {
      if (this.el.hasPointerCapture(this.activeId)) this.el.releasePointerCapture(this.activeId);
    } catch {
      /* ignore */
    }
    this.activeId = null;
    this.source = 'idle';
    // Close to the stops the two ends want to line up; anywhere else the
    // paper simply stays where it was put.
    if (allowSettle && this.open > 0.94 && this.open < 1) this.beginSettle(1);
    else if (allowSettle && this.open < 0.055 && this.open > 0) this.beginSettle(0);
  }

  private beginSettle(to: number) {
    this.settleFrom = this.open;
    this.settleTo = to;
    this.settleT = 0;
    this.source = 'settle';
  }

  update(dt: number) {
    if (this.settleTo !== null) {
      this.settleT = Math.min(1, this.settleT + dt / 0.19);
      const e = 1 - Math.pow(1 - this.settleT, 3);
      this.open = this.settleFrom + (this.settleTo - this.settleFrom) * e;
      if (this.settleT >= 1) {
        this.settleTo = null;
        this.source = 'idle';
      }
    }
    const inst = dt > 0 ? (this.open - this.prevOpen) / dt : 0;
    this.velocity += (inst - this.velocity) * Math.min(1, dt * 22);
    this.prevOpen = this.open;
  }

  dispose() {
    for (const [type, fn] of this.bound) this.el.removeEventListener(type, fn);
    this.bound.length = 0;
    for (const off of this.extra) off();
    this.extra.length = 0;
  }
}
