// One-finger stroke input. The first touch draws; extra fingers are ignored
// (gesture separation: there is no user camera gesture in this game, so a
// second finger can never hijack the view). Samples are raycast onto the
// ice plane in world space, with timestamps for the speed -> vigour mapping.

import * as THREE from 'three';
import { StrokeSample } from './path';

export interface StrokeResult {
  samples: StrokeSample[];
  /** average screen speed in px/s */
  screenSpeed: number;
}

export class StrokeInput {
  enabled = false;
  private activeId: number | null = null;
  private samples: StrokeSample[] = [];
  private screenPts: { x: number; y: number; t: number }[] = [];
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private ndc = new THREE.Vector2();
  private hit = new THREE.Vector3();

  onProgress: ((samples: StrokeSample[]) => void) | null = null;
  onComplete: ((r: StrokeResult) => void) | null = null;
  onAnyTap: (() => void) | null = null;

  constructor(private el: HTMLElement, private camera: THREE.PerspectiveCamera) {
    el.addEventListener('pointerdown', this.down, { passive: false });
    el.addEventListener('pointermove', this.move, { passive: false });
    el.addEventListener('pointerup', this.up, { passive: false });
    el.addEventListener('pointercancel', this.cancel, { passive: false });
    el.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  }

  private down = (e: PointerEvent): void => {
    e.preventDefault();
    if (this.onAnyTap) this.onAnyTap();
    if (!this.enabled || this.activeId !== null) return;
    this.activeId = e.pointerId;
    this.samples = [];
    this.screenPts = [];
    try { this.el.setPointerCapture(e.pointerId); } catch { /* ok */ }
    this.record(e);
  };

  private move = (e: PointerEvent): void => {
    if (this.activeId !== e.pointerId || !this.enabled) return;
    e.preventDefault();
    const last = this.screenPts[this.screenPts.length - 1];
    if (last && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 4) return;
    this.record(e);
    if (this.onProgress) this.onProgress(this.samples);
  };

  private up = (e: PointerEvent): void => {
    if (this.activeId !== e.pointerId) return;
    e.preventDefault();
    this.activeId = null;
    if (!this.enabled) return;
    this.finish();
  };

  private cancel = (e: PointerEvent): void => {
    if (this.activeId !== e.pointerId) return;
    this.activeId = null;
    this.samples = [];
    this.screenPts = [];
    if (this.onProgress) this.onProgress([]);
  };

  private record(e: PointerEvent): void {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    this.ndc.set((e.clientX / w) * 2 - 1, -(e.clientY / h) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    if (this.raycaster.ray.intersectPlane(this.plane, this.hit)) {
      const t = performance.now() / 1000;
      this.samples.push({ x: this.hit.x, z: this.hit.z, t });
      this.screenPts.push({ x: e.clientX, y: e.clientY, t });
    }
  }

  private finish(): void {
    const pts = this.screenPts;
    let dist = 0;
    for (let i = 1; i < pts.length; i++) {
      dist += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    const dt = pts.length > 1 ? pts[pts.length - 1].t - pts[0].t : 0;
    const screenSpeed = dt > 0.05 ? dist / dt : 600;
    const samples = this.samples;
    this.samples = [];
    this.screenPts = [];
    if (dist < 30 || samples.length < 4) {
      if (this.onProgress) this.onProgress([]);
      return; // just a tap / accidental touch
    }
    if (this.onComplete) this.onComplete({ samples, screenSpeed });
  }

  /** Feed a synthetic stroke (testing hook). Points in world space. */
  injectStroke(samples: StrokeSample[], screenSpeed = 600): void {
    if (this.onComplete) this.onComplete({ samples, screenSpeed });
  }
}
