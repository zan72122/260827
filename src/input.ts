import * as THREE from 'three';
import { clamp } from './util';

/**
 * Pointer handling. One finger drives the nozzle:
 *  - the aim point sits ABOVE the finger (screen offset) so the finger
 *    never hides the stream or the impact;
 *  - the nozzle is open only while a pointer is down;
 *  - pointer capture keeps the gesture alive if the finger slips off the
 *    canvas edge, and out-of-range positions are clamped into the arena;
 *  - the raw path is resampled/smoothed into a continuously moving
 *    impact target, preserving wide sweeps and circles while removing
 *    jitter. Gameplay consumes the target EVERY frame, so the whole
 *    trace matters — where you lingered, where you swept.
 */

// arena bounds for the impact point
const MIN_X = -7.5, MAX_X = 7.5, MIN_Z = 3.2, MAX_Z = 17;

export class AimInput {
  /** finger currently down */
  active = false;
  /** raw clamped world target under (offset) finger */
  readonly rawTarget = new THREE.Vector3(0, 0, 10);
  /** smoothed target — this is what the water chases */
  readonly smoothTarget = new THREE.Vector3(0, 0, 10);
  /** world-units-per-second speed of the smoothed target */
  targetSpeed = 0;
  /** most recent raw path samples (world), for debugging/inspection */
  readonly path: { x: number; z: number; t: number }[] = [];
  /** called on the very first press (audio unlock etc.) */
  onPress: (() => void) | null = null;

  private pointerId: number | null = null;
  private canvas: HTMLCanvasElement;
  private camera: THREE.PerspectiveCamera;
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private prevSmooth = new THREE.Vector3(0, 0, 10);
  private hasRaw = false;

  constructor(canvas: HTMLCanvasElement, camera: THREE.PerspectiveCamera) {
    this.canvas = canvas;
    this.camera = camera;

    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // guard against page-level gestures on iOS
    document.addEventListener('gesturestart', (e) => e.preventDefault());
  }

  /** vertical screen offset (px) between finger and aim point */
  private aimOffsetPx(): number {
    return this.canvas.clientHeight * 0.13;
  }

  private onDown = (e: PointerEvent): void => {
    e.preventDefault();
    if (this.pointerId !== null) return; // first finger only
    this.pointerId = e.pointerId;
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* not supported */ }
    this.active = true;
    this.path.length = 0;
    this.updateRaw(e.clientX, e.clientY);
    // snap the smoothed target so the stream doesn't sweep from a stale spot
    this.smoothTarget.copy(this.rawTarget);
    this.prevSmooth.copy(this.rawTarget);
    this.onPress?.();
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.updateRaw(e.clientX, e.clientY);
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.active = false;
  };

  /** screen → world ground point, offset above the finger, clamped to the arena */
  private updateRaw(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const x = clamp(clientX - rect.left, 0, rect.width);
    const y = clamp(clientY - rect.top, 0, rect.height) - this.aimOffsetPx();
    this.ndc.set((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const dir = this.ray.ray.direction;
    const org = this.ray.ray.origin;
    let px: number, pz: number;
    if (dir.y < -0.02) {
      const t = -org.y / dir.y;
      px = org.x + dir.x * t;
      pz = org.z + dir.z * t;
    } else {
      // aiming at/above the horizon → push to the far edge along the view
      const t = (MAX_Z - org.z) / Math.max(0.05, dir.z);
      px = org.x + dir.x * t;
      pz = MAX_Z;
    }
    this.rawTarget.set(clamp(px, MIN_X, MAX_X), 0, clamp(pz, MIN_Z, MAX_Z));
    this.hasRaw = true;
    this.path.push({ x: this.rawTarget.x, z: this.rawTarget.z, t: performance.now() / 1000 });
    if (this.path.length > 240) this.path.splice(0, this.path.length - 240);
  }

  /** advance smoothing; call once per frame */
  update(dt: number): void {
    if (!this.hasRaw) return;
    // critically-damped-ish chase: fast enough to track sweeps, slow enough
    // to iron out sensor jitter; speed also capped so the impact point
    // "travels" rather than teleporting.
    const k = 1 - Math.exp(-dt / 0.085);
    this.prevSmooth.copy(this.smoothTarget);
    this.smoothTarget.lerp(this.rawTarget, k);
    const step = this.smoothTarget.distanceTo(this.prevSmooth);
    const maxStep = 20 * dt;
    if (step > maxStep && step > 1e-6) {
      this.smoothTarget.copy(this.prevSmooth).lerp(this.smoothTarget, maxStep / step);
    }
    this.targetSpeed = dt > 0 ? this.smoothTarget.distanceTo(this.prevSmooth) / dt : 0;
  }
}
