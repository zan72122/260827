import * as THREE from 'three';

export interface PointerSnapshot {
  x: number;
  y: number;
  nx: number;
  ny: number;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  downTime: number;
  moved: boolean;
}

type Handler = (p: PointerSnapshot) => void;

/**
 * One-finger pointer abstraction. Large, forgiving gestures only:
 * drag / long press / directional swipe. No pinch, no orbit.
 */
export class PointerInput {
  active = false;
  id = -1;
  x = 0;
  y = 0;
  startX = 0;
  startY = 0;
  downTime = 0;
  moved = false;
  lastActivity = 0;

  onDown: Handler | null = null;
  onMove: Handler | null = null;
  onUp: Handler | null = null;

  private el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
    el.addEventListener('pointerdown', this.handleDown, { passive: false });
    el.addEventListener('pointermove', this.handleMove, { passive: false });
    window.addEventListener('pointerup', this.handleUp, { passive: false });
    window.addEventListener('pointercancel', this.handleUp, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private snap(): PointerSnapshot {
    const r = this.el.getBoundingClientRect();
    return {
      x: this.x,
      y: this.y,
      nx: ((this.x - r.left) / r.width) * 2 - 1,
      ny: -((this.y - r.top) / r.height) * 2 + 1,
      startX: this.startX,
      startY: this.startY,
      dx: this.x - this.startX,
      dy: this.y - this.startY,
      downTime: this.downTime,
      moved: this.moved,
    };
  }

  private handleDown = (e: PointerEvent) => {
    if (this.active) return;
    e.preventDefault();
    this.active = true;
    this.id = e.pointerId;
    this.x = this.startX = e.clientX;
    this.y = this.startY = e.clientY;
    this.downTime = performance.now();
    this.moved = false;
    this.lastActivity = this.downTime;
    this.el.setPointerCapture?.(e.pointerId);
    this.onDown?.(this.snap());
  };

  private handleMove = (e: PointerEvent) => {
    if (!this.active || e.pointerId !== this.id) return;
    e.preventDefault();
    this.x = e.clientX;
    this.y = e.clientY;
    if (Math.abs(this.x - this.startX) > 5 || Math.abs(this.y - this.startY) > 5) this.moved = true;
    this.lastActivity = performance.now();
    this.onMove?.(this.snap());
  };

  private handleUp = (e: PointerEvent) => {
    if (!this.active || e.pointerId !== this.id) return;
    this.active = false;
    this.id = -1;
    this.lastActivity = performance.now();
    this.onUp?.(this.snap());
  };

  /** seconds the player has been idle */
  idleFor(): number {
    return (performance.now() - this.lastActivity) / 1000;
  }

  poke() {
    this.lastActivity = performance.now();
  }
}

const _ray = new THREE.Raycaster();
const _v2 = new THREE.Vector2();

export function raycast(camera: THREE.Camera, nx: number, ny: number, targets: THREE.Object3D[]) {
  _v2.set(nx, ny);
  _ray.setFromCamera(_v2, camera);
  return _ray.intersectObjects(targets, true);
}

export function rayOnPlane(camera: THREE.Camera, nx: number, ny: number, plane: THREE.Plane, out: THREE.Vector3) {
  _v2.set(nx, ny);
  _ray.setFromCamera(_v2, camera);
  const hit = _ray.ray.intersectPlane(plane, out);
  return hit ? out : null;
}

/**
 * World-space offset that moves a dragged object N pixels *up the screen*
 * from the finger, so a small hand never covers the moment of change.
 */
export function screenLift(
  camera: THREE.PerspectiveCamera,
  worldPoint: THREE.Vector3,
  pixels: number,
  viewportHeight: number,
  out: THREE.Vector3
) {
  const dist = camera.position.distanceTo(worldPoint);
  const worldPerPixel = (2 * Math.tan((camera.fov * Math.PI) / 360) * dist) / Math.max(1, viewportHeight);
  out.set(0, 1, 0).applyQuaternion(camera.quaternion).multiplyScalar(pixels * worldPerPixel);
  return out;
}
