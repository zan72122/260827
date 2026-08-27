/**
 * input.ts — one finger, one continuous swipe.
 *
 * Magnification follows DISPLACEMENT, never velocity, so the dive can be crawled to
 * a halt on a boundary, reversed, and re-crossed as many times as a child wants. The
 * whole viewport is the control surface, which is far larger than any 44 pt target,
 * and lifting the finger keeps the progress it earned rather than resetting.
 */

export interface InputOptions {
  /** Called with the new target progress, 0..1. */
  onProgress: (p: number) => void;
  /** Called when the finger has been off the glass for a while. */
  onIdle: () => void;
  /** Called on first real interaction, to unlock audio. */
  onFirstTouch: () => void;
  onDragState?: (dragging: boolean) => void;
}

const IDLE_FIRST_MS = 3000;
const IDLE_REPEAT_MS = 4800;

export class InputController {
  private target = 0;
  private display = 0;
  private activePointer: number | null = null;
  private lastY = 0;
  private lastX = 0;
  /** Exponentially smoothed stroke direction, used to correct diagonal swipes. */
  private axisX = 0;
  private axisY = -1;
  private idleTimer = 0;
  private idleFired = false;
  private touched = false;
  private element: HTMLElement | null = null;

  constructor(private readonly opts: InputOptions) {}

  attach(element: HTMLElement): void {
    this.element = element;
    element.addEventListener('pointerdown', this.onDown);
    element.addEventListener('pointermove', this.onMove);
    element.addEventListener('pointerup', this.onUp);
    element.addEventListener('pointercancel', this.onUp);
    element.addEventListener('lostpointercapture', this.onLostCapture);
    element.addEventListener('wheel', this.onWheel, { passive: false });
    element.addEventListener('keydown', this.onKey);
    // Belt and braces alongside touch-action: none, for older iOS gesture handling.
    element.addEventListener('touchmove', preventDefault, { passive: false });
    element.addEventListener('gesturestart', preventDefault as EventListener);
  }

  detach(): void {
    const element = this.element;
    if (!element) return;
    element.removeEventListener('pointerdown', this.onDown);
    element.removeEventListener('pointermove', this.onMove);
    element.removeEventListener('pointerup', this.onUp);
    element.removeEventListener('pointercancel', this.onUp);
    element.removeEventListener('lostpointercapture', this.onLostCapture);
    element.removeEventListener('wheel', this.onWheel);
    element.removeEventListener('keydown', this.onKey);
    element.removeEventListener('touchmove', preventDefault);
    element.removeEventListener('gesturestart', preventDefault as EventListener);
    this.element = null;
  }

  /** Finger travel, in CSS pixels, that spans the whole dive. */
  private travelPx(): number {
    const h = window.innerHeight;
    // One comfortable stroke on a phone; still reachable in landscape.
    return Math.max(320, Math.min(h * 0.92, 760));
  }

  get isDragging(): boolean {
    return this.activePointer !== null;
  }

  get targetProgress(): number {
    return this.target;
  }

  setProgress(p: number, snap = false): void {
    this.target = clamp01(p);
    if (snap) this.display = this.target;
    this.resetIdle();
    this.opts.onProgress(this.target);
  }

  /** Critically damped follow so the picture is smooth without lagging the finger. */
  step(dt: number): number {
    const tau = 0.055;
    const k = 1 - Math.exp(-dt / tau);
    this.display += (this.target - this.display) * k;
    if (Math.abs(this.target - this.display) < 1e-5) this.display = this.target;

    if (this.activePointer === null) {
      this.idleTimer += dt * 1000;
      const threshold = this.idleFired ? IDLE_REPEAT_MS : IDLE_FIRST_MS;
      if (this.idleTimer >= threshold) {
        this.idleTimer = 0;
        this.idleFired = true;
        this.opts.onIdle();
      }
    }
    return this.display;
  }

  get displayProgress(): number {
    return this.display;
  }

  private resetIdle(): void {
    this.idleTimer = 0;
    this.idleFired = false;
  }

  private onDown = (e: PointerEvent): void => {
    if (this.activePointer !== null) return;
    this.activePointer = e.pointerId;
    this.lastY = e.clientY;
    this.lastX = e.clientX;
    this.axisX = 0;
    this.axisY = -1;
    this.resetIdle();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* capture is best-effort; the move handler still works without it */
    }
    if (!this.touched) {
      this.touched = true;
      this.opts.onFirstTouch();
    }
    this.opts.onDragState?.(true);
    e.preventDefault();
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointer) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    if (dx === 0 && dy === 0) return;

    const len = Math.hypot(dx, dy);
    if (len > 0.5) {
      // Follow the stroke's own direction, smoothed, so the correction below is
      // stable rather than twitching on every jittery sample.
      const k = 0.25;
      this.axisX += (dx / len - this.axisX) * k;
      this.axisY += (dy / len - this.axisY) * k;
      const n = Math.hypot(this.axisX, this.axisY) || 1;
      this.axisX /= n;
      this.axisY /= n;
    }

    // Diagonal correction: a stroke held at an angle should cover the same ground as
    // a vertical one of the same length, but a nearly horizontal wipe must not.
    const cosTheta = Math.abs(this.axisY);
    const correction = Math.min(1 / Math.max(cosTheta, 0.62), 1.62);

    const dp = ((-dy * correction) / this.travelPx()) as number;
    this.target = clamp01(this.target + dp);
    this.resetIdle();
    this.opts.onProgress(this.target);
    e.preventDefault();
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointer) return;
    this.endDrag(e.currentTarget as HTMLElement, e.pointerId);
  };

  private onLostCapture = (e: PointerEvent): void => {
    if (e.pointerId === this.activePointer) this.activePointer = null;
    this.opts.onDragState?.(false);
  };

  private endDrag(el: HTMLElement | null, id: number): void {
    this.activePointer = null;
    this.resetIdle();
    this.opts.onDragState?.(false);
    try {
      el?.releasePointerCapture(id);
    } catch {
      /* already released */
    }
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (!this.touched) {
      this.touched = true;
      this.opts.onFirstTouch();
    }
    this.target = clamp01(this.target + -e.deltaY / (this.travelPx() * 2.2));
    this.resetIdle();
    this.opts.onProgress(this.target);
  };

  private onKey = (e: KeyboardEvent): void => {
    const step = e.shiftKey ? 0.02 : 0.006;
    let dp = 0;
    if (e.key === 'ArrowUp' || e.key === 'PageUp') dp = step;
    else if (e.key === 'ArrowDown' || e.key === 'PageDown') dp = -step;
    else if (e.key === 'Home') this.setProgress(0);
    else if (e.key === 'End') this.setProgress(1);
    else return;
    e.preventDefault();
    if (!this.touched) {
      this.touched = true;
      this.opts.onFirstTouch();
    }
    if (dp !== 0) {
      this.target = clamp01(this.target + dp);
      this.resetIdle();
      this.opts.onProgress(this.target);
    }
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function preventDefault(e: Event): void {
  e.preventDefault();
}
