import * as THREE from 'three';
import { clamp, damp } from './math';

export interface InputCallbacks {
  onAnyPointerDown: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}

const MAX_POLAR = THREE.MathUtils.degToRad(72);
const MIN_POLAR = THREE.MathUtils.degToRad(2);
const MAX_AZIMUTH = THREE.MathUtils.degToRad(62);

/**
 * One-stroke pendulum input. The stroke is mapped onto the rope-constrained
 * arc around the pivot: drag length sets the pull-back amplitude (polar
 * angle), lateral drift sets the swing plane (azimuth around the vertical,
 * 0 = straight back from the wall). Both are continuous values — never
 * quantized to left/center/right — and both run through a low-pass filter
 * so hand tremor is absorbed while deliberate curves still steer the plane.
 * The ball itself follows this target through a damped spring on the sphere
 * (see Pendulum), so it trails the finger like the heavy mass it is.
 */
export class DragInput {
  active = false;
  /** filtered target direction (unit, pivot->ball) */
  readonly filteredDir = new THREE.Vector3(0, -1, 0);
  private rawDir = new THREE.Vector3(0, -1, 0);
  private pointerId = -1;
  private startX = 0;
  private startY = 0;
  private startPolar = 0;
  private startAzimuth = 0;
  /** +1/-1 so a leftward finger always moves the ball left ON SCREEN */
  private lateralSign = 1;
  /** how far the ball has been pulled from rest 0..1, for creak sounds */
  pullAmount = 0;

  constructor(
    private el: HTMLElement,
    private camera: THREE.PerspectiveCamera,
    private pivot: THREE.Vector3,
    _ropeLength: number,
    private getBallPos: () => THREE.Vector3,
    private cb: InputCallbacks
  ) {
    el.addEventListener('pointerdown', this.onDown, { passive: false });
    el.addEventListener('pointermove', this.onMove, { passive: false });
    el.addEventListener('pointerup', this.onUp, { passive: false });
    el.addEventListener('pointercancel', this.onUp, { passive: false });
  }

  private onDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.cb.onAnyPointerDown();
    if (this.active) return;
    const r = this.el.getBoundingClientRect();
    // generous grab zone around the ball for small fingers
    const ball = this.getBallPos().clone().project(this.camera);
    const bx = ((ball.x + 1) / 2) * r.width;
    const by = ((1 - ball.y) / 2) * r.height;
    const grabPx = Math.min(r.width, r.height) * 0.32;
    const dx = e.clientX - r.left - bx;
    const dy = e.clientY - r.top - by;
    if (dx * dx + dy * dy > grabPx * grabPx) return;
    this.active = true;
    this.pointerId = e.pointerId;
    this.el.setPointerCapture?.(e.pointerId);
    this.startX = e.clientX;
    this.startY = e.clientY;
    // start from wherever the ball currently hangs — grabbing a swinging
    // ball catches it, it never teleports
    const cur = this.getBallPos().clone().sub(this.pivot).normalize();
    this.startPolar = Math.acos(clamp(-cur.y, -1, 1));
    this.startAzimuth = Math.abs(cur.x) + Math.abs(cur.z) > 1e-4 ? Math.atan2(cur.x, -cur.z) : 0;
    this.startAzimuth = clamp(this.startAzimuth, -MAX_AZIMUTH, MAX_AZIMUTH);
    // screen-right in world space decides which way the azimuth runs, so the
    // ball tracks the finger's left/right no matter where the camera stands
    const rightX = this.camera.matrixWorld.elements[0];
    this.lateralSign = rightX >= 0 ? 1 : -1;
    this.filteredDir.copy(cur);
    this.rawDir.copy(cur);
    this.cb.onDragStart();
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.active || e.pointerId !== this.pointerId) return;
    e.preventDefault();
    const r = this.el.getBoundingClientRect();
    const minDim = Math.min(r.width, r.height);
    const px = e.clientX - this.startX;
    const py = e.clientY - this.startY;
    // downward drag (and to a lesser degree any lateral drag) raises the
    // pull-back amplitude; upward drag lowers it again
    const polar = clamp(
      this.startPolar + ((py + Math.abs(px) * 0.4) / minDim) * THREE.MathUtils.degToRad(98),
      MIN_POLAR,
      MAX_POLAR
    );
    // lateral drift rotates the swing plane around the vertical
    const azimuth = clamp(
      this.startAzimuth + this.lateralSign * (px / minDim) * THREE.MathUtils.degToRad(88),
      -MAX_AZIMUTH,
      MAX_AZIMUTH
    );
    const sp = Math.sin(polar);
    // azimuth 0 = pulled straight back from the wall (-z)
    this.rawDir.set(Math.sin(azimuth) * sp, -Math.cos(polar), -Math.cos(azimuth) * sp);
  };

  private onUp = (e: PointerEvent): void => {
    if (!this.active || e.pointerId !== this.pointerId) return;
    e.preventDefault();
    this.active = false;
    this.pointerId = -1;
    this.cb.onDragEnd();
  };

  /**
   * Advance the tremor filter; returns the filtered direction while active.
   * ~10 Hz low-pass: deliberate strokes pass, shivers are absorbed.
   */
  update(dt: number): THREE.Vector3 | null {
    if (!this.active) return null;
    const k = damp(11, dt);
    this.filteredDir.lerp(this.rawDir, k).normalize();
    this.pullAmount = clamp(this.filteredDir.angleTo(new THREE.Vector3(0, -1, 0)) / MAX_POLAR, 0, 1);
    return this.filteredDir;
  }
}
