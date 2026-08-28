import { Vector2 } from 'three';

/**
 * One pointer state machine shared by mouse, pen and touch.
 *
 * Two products come out of it:
 *  - a drag stream (used to carry bells and to pull the buckle), and
 *  - a forward-swipe "drive" value snapped to three coarse steps, so a
 *    four-year-old never has to hit a number.
 */

export type DriveStep = 0 | 1 | 2 | 3; // idle / single step / walk / trot

export interface PointerFrame {
  /** normalised device coords, -1..1 */
  ndc: Vector2;
  /** css pixels */
  screen: Vector2;
  /** where the press began, in css pixels */
  pressScreen: Vector2;
  /** css pixels since last frame */
  delta: Vector2;
  down: boolean;
  /** true only on the frame the pointer went down */
  pressed: boolean;
  /** true only on the frame the pointer went up */
  released: boolean;
  /** seconds the current (or last) press lasted */
  heldFor: number;
}

interface Sample {
  t: number;
  y: number;
  x: number;
}

export class Input {
  readonly frame: PointerFrame = {
    ndc: new Vector2(),
    screen: new Vector2(),
    pressScreen: new Vector2(),
    delta: new Vector2(),
    down: false,
    pressed: false,
    released: false,
    heldFor: 0,
  };

  /** 0..1 continuous drive request, already smoothed and step-snapped */
  drive = 0;
  driveStep: DriveStep = 0;
  /** set for exactly one frame when a short forward flick is recognised */
  singleStep = false;
  /** set for exactly one frame on a tap that was not a drag */
  tapped = false;

  private el: HTMLElement;
  private activeId: number | null = null;
  private prev = new Vector2();
  private startScreen = new Vector2();
  private startTime = 0;
  private history: Sample[] = [];
  private pendingPressed = false;
  private pendingReleased = false;
  private pendingTap = false;
  private pendingStep = false;
  private travel = 0;
  private rawDrive = 0;
  private holdDrive = 0;
  private releaseAt = -1;
  private enabled = true;

  constructor(el: HTMLElement) {
    this.el = el;
    el.addEventListener('pointerdown', this.onDown, { passive: false });
    el.addEventListener('pointermove', this.onMove, { passive: false });
    el.addEventListener('pointerup', this.onUp, { passive: false });
    el.addEventListener('pointercancel', this.onUp, { passive: false });
    el.addEventListener('lostpointercapture', this.onUp, { passive: false });
    // Keep iOS from turning a vertical drag into a page scroll / pull-to-refresh.
    el.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (!v) this.cancel();
  }

  private cancel(): void {
    if (this.activeId !== null) {
      this.pendingReleased = true;
      this.releaseAt = performance.now() / 1000;
    }
    this.activeId = null;
    this.frame.down = false;
  }

  private local(e: PointerEvent): Vector2 {
    const r = this.el.getBoundingClientRect();
    return new Vector2(e.clientX - r.left, e.clientY - r.top);
  }

  private onDown = (e: PointerEvent): void => {
    if (!this.enabled || this.activeId !== null) return;
    e.preventDefault();
    this.activeId = e.pointerId;
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best effort */
    }
    const p = this.local(e);
    this.startScreen.copy(p);
    this.frame.pressScreen.copy(p);
    this.prev.copy(p);
    this.frame.screen.copy(p);
    this.frame.delta.set(0, 0);
    this.frame.down = true;
    this.pendingPressed = true;
    this.startTime = performance.now() / 1000;
    this.travel = 0;
    this.history.length = 0;
    this.history.push({ t: this.startTime, x: p.x, y: p.y });
  };

  private onMove = (e: PointerEvent): void => {
    if (this.activeId !== e.pointerId) return;
    e.preventDefault();
    const p = this.local(e);
    this.frame.delta.add(new Vector2(p.x - this.prev.x, p.y - this.prev.y));
    this.travel += this.prev.distanceTo(p);
    this.prev.copy(p);
    this.frame.screen.copy(p);
    const t = performance.now() / 1000;
    this.history.push({ t, x: p.x, y: p.y });
    while (this.history.length > 2 && t - this.history[0].t > 0.22) this.history.shift();
  };

  private onUp = (e: PointerEvent): void => {
    if (this.activeId !== e.pointerId) return;
    e.preventDefault();
    const t = performance.now() / 1000;
    const held = t - this.startTime;
    if (this.travel < 16 && held < 0.4) this.pendingTap = true;
    this.activeId = null;
    this.frame.down = false;
    this.pendingReleased = true;
    this.releaseAt = t;
    try {
      this.el.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };

  /**
   * A forward swipe is "up the screen" in portrait and in landscape alike:
   * the world moves away from the player, so the finger travels away too.
   */
  private measureSwipe(now: number): { speed: number; length: number } {
    if (this.history.length < 2) return { speed: 0, length: 0 };
    const last = this.history[this.history.length - 1];
    let first = this.history[0];
    for (const s of this.history) {
      if (now - s.t <= 0.18) {
        first = s;
        break;
      }
    }
    const dt = Math.max(1e-3, last.t - first.t);
    const dy = first.y - last.y; // upward is positive
    const total = this.startScreen.y - last.y;
    return { speed: dy / dt, length: total };
  }

  update(dt: number): void {
    const now = performance.now() / 1000;
    this.frame.pressed = this.pendingPressed;
    this.frame.released = this.pendingReleased;
    this.tapped = this.pendingTap;
    this.singleStep = this.pendingStep;
    this.pendingPressed = false;
    this.pendingReleased = false;
    this.pendingTap = false;
    this.pendingStep = false;
    this.frame.heldFor = this.frame.down ? now - this.startTime : this.frame.heldFor;

    const vh = Math.max(320, this.el.clientHeight);

    if (this.frame.down) {
      const { speed, length } = this.measureSwipe(now);
      const normLen = length / vh; // fraction of the screen travelled
      const normSpeed = speed / vh; // screens per second

      if (normLen > 0.035) {
        // Three coarse bands. A fast flick can never exceed the trot band.
        let target: number;
        if (normSpeed > 1.15 && normLen > 0.16) target = 1.0;
        else if (normLen > 0.1 || normSpeed > 0.45) target = 0.62;
        else target = 0.3;
        this.rawDrive = Math.max(this.rawDrive * 0.86, target);
        this.holdDrive = this.rawDrive;
      } else if (normLen < -0.05) {
        // Pulling back never reverses the horse: it only asks for less.
        this.rawDrive *= 0.9;
        this.holdDrive = this.rawDrive;
      }
    } else {
      // Letting go coasts down; it never snaps to a stop.
      const since = now - this.releaseAt;
      const decay = since < 0.35 ? 0.55 : 0.95;
      this.holdDrive *= Math.pow(1 - decay, dt);
      this.rawDrive = this.holdDrive;
      if (this.holdDrive < 0.02) this.holdDrive = 0;
    }

    // A single short flick that ended quickly asks for exactly one step.
    if (this.frame.released) {
      const { length } = this.measureSwipe(this.releaseAt);
      const normLen = length / vh;
      const held = this.releaseAt - this.startTime;
      if (normLen > 0.03 && normLen < 0.13 && held < 0.45) {
        this.pendingStep = true;
        this.pendingTap = false;
      }
    }

    this.drive += (this.holdDrive - this.drive) * Math.min(1, dt * 6.5);
    if (this.drive < 0.015) this.drive = 0;
    this.driveStep = this.drive < 0.05 ? 0 : this.drive < 0.45 ? 1 : this.drive < 0.8 ? 2 : 3;

    const r = this.el.getBoundingClientRect();
    this.frame.ndc.set(
      (this.frame.screen.x / Math.max(1, r.width)) * 2 - 1,
      -(this.frame.screen.y / Math.max(1, r.height)) * 2 + 1,
    );
  }

  /** Consume the accumulated per-frame delta. */
  takeDelta(out: Vector2): Vector2 {
    out.copy(this.frame.delta);
    this.frame.delta.set(0, 0);
    return out;
  }
}
