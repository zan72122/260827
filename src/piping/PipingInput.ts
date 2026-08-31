import * as THREE from 'three';
import { OneEuroVec2 } from '../util/OneEuro';
import { CAKE_RADIUS } from '../scene/CakeSurfaceContact';
import type { CakeSurfaceContact } from '../scene/CakeSurfaceContact';
import { clamp } from '../util/math';

/**
 * iOS gives us no usable continuous pressure, so nothing here depends on force.
 * A touch means "squeeze"; everything else comes from where the finger is and
 * how fast it moves.
 *
 * The finger is deliberately placed BELOW the piping point on screen, so the
 * hand never covers the nozzle or the cream coming out of it.
 */
export class PipingInput {
  readonly point = new THREE.Vector2(); // world x, z (filtered)
  readonly rawPoint = new THREE.Vector2();
  speed = 0;
  active = false;
  pointerId = -1;

  private filter = new OneEuroVec2(1.15, 0.85, 1.0);
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private planeNormal = new THREE.Vector3(0, 1, 0);
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private result = new THREE.Vector2();
  private hit = new THREE.Vector3();
  private prev = new THREE.Vector2();
  private prevTime = 0;
  private out = { x: 0, y: 0 };

  constructor(
    private camera: THREE.PerspectiveCamera,
    private contact: CakeSurfaceContact,
  ) {}

  /** Screen-space distance the piping point sits above the fingertip. */
  fingerOffsetPx(w: number, h: number): number {
    return clamp(Math.min(w, h) * 0.135, 54, 132);
  }

  /**
   * Project a screen position onto the cake top, lifted above the finger.
   * Returns null when the ray misses the cake.
   */
  project(clientX: number, clientY: number, w: number, h: number, rect: DOMRect): THREE.Vector2 | null {
    const sx = clientX - rect.left;
    const sy = clientY - rect.top - this.fingerOffsetPx(w, h);
    this.ndc.set((sx / w) * 2 - 1, -(sy / h) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);

    // two passes: flat top first, then the real (dented, already piped) height
    let y = this.contact.surfaceY(0, 0);
    for (let i = 0; i < 2; i++) {
      this.plane.set(this.planeNormal, -y);
      if (!this.ray.ray.intersectPlane(this.plane, this.hit)) return null;
      y =
        this.contact.surfaceY(this.hit.x, this.hit.z) +
        (this.active
          ? this.contact.creamHeightBase(this.hit.x, this.hit.z)
          : this.contact.creamHeight(this.hit.x, this.hit.z));
    }
    const r = Math.hypot(this.hit.x, this.hit.z);
    const lim = CAKE_RADIUS * 0.955;
    if (r > lim) {
      this.hit.x *= lim / r;
      this.hit.z *= lim / r;
    }
    return this.result.set(this.hit.x, this.hit.z);
  }

  begin(p: THREE.Vector2, time: number): void {
    this.filter.reset();
    this.filter.filter(p.x, p.y, time, this.out);
    this.point.set(this.out.x, this.out.y);
    this.rawPoint.copy(p);
    this.prev.copy(this.point);
    this.prevTime = time;
    this.speed = 0;
    this.active = true;
  }

  move(p: THREE.Vector2, time: number): void {
    this.rawPoint.copy(p);
    this.filter.filter(p.x, p.y, time, this.out);
    const dt = Math.max(1e-3, time - this.prevTime);
    const nx = this.out.x;
    const nz = this.out.y;
    const inst = Math.hypot(nx - this.prev.x, nz - this.prev.y) / dt;
    // a little temporal smoothing so a single jittery event cannot spike the flow
    this.speed = this.speed + (inst - this.speed) * clamp(dt / 0.05, 0, 1);
    this.prev.set(nx, nz);
    this.prevTime = time;
    this.point.set(nx, nz);
  }

  /** Keep decaying the speed estimate on frames with no pointer event. */
  idle(time: number): void {
    const dt = Math.max(0, time - this.prevTime);
    if (dt > 0.03) {
      this.speed *= Math.exp(-dt / 0.06);
      this.prevTime = time;
    }
  }

  end(): void {
    this.active = false;
    this.pointerId = -1;
    this.speed = 0;
  }
}
