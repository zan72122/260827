import * as THREE from 'three';
import type { Stage } from './stage';

export interface PointerState {
  down: boolean;
  /** CSS pixels */
  x: number; y: number;
  startX: number; startY: number;
  prevX: number; prevY: number;
  /** movement since last frame, CSS px */
  dx: number; dy: number;
  /** velocity in CSS px / s, smoothed */
  vx: number; vy: number;
  downAt: number;
  travel: number;
  id: number;
}

/**
 * Single-finger input. Extra fingers are ignored on purpose: this game never
 * needs pinch or two-handed gestures, and swallowing them avoids accidental
 * double-execution of a step.
 */
export class Input {
  readonly p: PointerState = {
    down: false, x: 0, y: 0, startX: 0, startY: 0, prevX: 0, prevY: 0,
    dx: 0, dy: 0, vx: 0, vy: 0, downAt: 0, travel: 0, id: -1,
  };
  onDown: ((p: PointerState) => void) | null = null;
  onUp: ((p: PointerState) => void) | null = null;
  /** first user gesture of the session (used to unlock audio) */
  onFirstGesture: (() => void) | null = null;
  private firstGestureDone = false;
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();

  constructor(private stage: Stage) {
    const el = stage.canvas;
    el.addEventListener('pointerdown', this.handleDown, { passive: false });
    window.addEventListener('pointermove', this.handleMove, { passive: false });
    window.addEventListener('pointerup', this.handleUp, { passive: false });
    window.addEventListener('pointercancel', this.handleUp, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('gesturestart', (e) => e.preventDefault());
  }

  private handleDown = (e: PointerEvent) => {
    if (this.p.down) return;
    e.preventDefault();
    if (!this.firstGestureDone) {
      this.firstGestureDone = true;
      this.onFirstGesture?.();
    }
    const p = this.p;
    p.down = true; p.id = e.pointerId;
    p.x = p.startX = p.prevX = e.clientX;
    p.y = p.startY = p.prevY = e.clientY;
    p.dx = p.dy = p.vx = p.vy = 0;
    p.travel = 0;
    p.downAt = performance.now();
    this.stage.canvas.setPointerCapture?.(e.pointerId);
    this.onDown?.(p);
  };

  private handleMove = (e: PointerEvent) => {
    const p = this.p;
    if (!p.down || e.pointerId !== p.id) return;
    e.preventDefault();
    p.x = e.clientX; p.y = e.clientY;
  };

  private handleUp = (e: PointerEvent) => {
    const p = this.p;
    if (!p.down || e.pointerId !== p.id) return;
    e.preventDefault();
    this.onUp?.(p);
    p.down = false; p.id = -1;
    p.dx = p.dy = 0;
  };

  /** call once per frame, before game logic */
  update(dt: number) {
    const p = this.p;
    p.dx = p.x - p.prevX;
    p.dy = p.y - p.prevY;
    p.travel += Math.hypot(p.dx, p.dy);
    const k = dt > 0 ? Math.min(1, dt * 14) : 1;
    p.vx += ((p.dx / Math.max(dt, 1 / 240)) - p.vx) * k;
    p.vy += ((p.dy / Math.max(dt, 1 / 240)) - p.vy) * k;
    p.prevX = p.x; p.prevY = p.y;
  }

  /** World position -> CSS pixel position. */
  toScreen(world: THREE.Vector3, out = new THREE.Vector2()): THREE.Vector2 {
    const v = world.clone().project(this.stage.camera);
    out.set((v.x * 0.5 + 0.5) * this.stage.width, (-v.y * 0.5 + 0.5) * this.stage.height);
    return out;
  }

  /** Distance in CSS px from the pointer to a world point. */
  screenDistance(world: THREE.Vector3): number {
    const s = this.toScreen(world, _tmpV2);
    return Math.hypot(s.x - this.p.x, s.y - this.p.y);
  }

  /** Ray from a CSS-pixel screen position. */
  rayAt(x: number, y: number): THREE.Raycaster {
    this.ndc.set((x / this.stage.width) * 2 - 1, -(y / this.stage.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.stage.camera);
    return this.raycaster;
  }

  /**
   * Where the finger points on a world plane. `liftPx` raises the result above
   * the finger so the finger never covers the tool tip or the deforming metal.
   */
  onPlane(plane: THREE.Plane, liftPx = 0, out = new THREE.Vector3()): THREE.Vector3 | null {
    const r = this.rayAt(this.p.x, this.p.y - liftPx);
    return r.ray.intersectPlane(plane, out);
  }
}

const _tmpV2 = new THREE.Vector2();
