import * as THREE from 'three';
import type { PathSample } from './journey';

/**
 * Camera rig. Two genuinely different framings:
 *  - landscape: side-tracking camera; travel always maps to screen-RIGHT
 *    (side vector = tangent × up puts the camera so motion reads rightward),
 *    bag held slightly right of center.
 *  - portrait: low chase camera behind the bag; the journey recedes upward
 *    on screen, bag offset from center so the finger never covers it.
 * All rig parameters are keyframed over journeyProgress so the camera can
 * duck into the screening tunnel and follow through the cargo doorway.
 */

interface RigKey {
  p: number;
  side: number; // along (tangent × up)
  back: number; // along -tangent
  up: number;
  lookAhead: number; // along +tangent (negative = look behind bag)
  lookUp: number;
  fov: number;
}

const LANDSCAPE: RigKey[] = [
  { p: 0.0, side: 3.5, back: 0.1, up: 1.35, lookAhead: 0.9, lookUp: 0.3, fov: 56 },
  { p: 0.1, side: 3.5, back: 0.2, up: 1.35, lookAhead: 0.5, lookUp: 0.3, fov: 56 },
  // move in close for the curtain crossing (highlight moment #1)
  { p: 0.135, side: 2.3, back: 0.3, up: 0.95, lookAhead: 0.3, lookUp: 0.35, fov: 55 },
  { p: 0.195, side: 2.5, back: 0.35, up: 1.0, lookAhead: 0.1, lookUp: 0.3, fov: 55 },
  { p: 0.24, side: 3.3, back: 0.35, up: 1.3, lookAhead: -0.5, lookUp: 0.28, fov: 55 },
  { p: 0.38, side: 3.3, back: 0.35, up: 1.3, lookAhead: -0.5, lookUp: 0.28, fov: 55 },
  { p: 0.418, side: 0.3, back: 1.45, up: 0.52, lookAhead: 0.6, lookUp: 0.12, fov: 60 },
  { p: 0.525, side: 0.3, back: 1.45, up: 0.52, lookAhead: 0.6, lookUp: 0.12, fov: 60 },
  { p: 0.56, side: 3.3, back: 0.35, up: 1.3, lookAhead: -0.5, lookUp: 0.28, fov: 55 },
  { p: 0.74, side: 3.4, back: 0.4, up: 1.25, lookAhead: -0.4, lookUp: 0.35, fov: 55 },
  // swing to a trailing camera while still inside the hall, then follow the
  // bag out through the doorway (staying inside the door opening) so the
  // aircraft belly rises ahead of it instead of behind the viewer
  { p: 0.764, side: 0.35, back: 3.0, up: 1.05, lookAhead: 2.6, lookUp: 0.35, fov: 55 },
  { p: 0.87, side: 0.35, back: 3.2, up: 1.05, lookAhead: 3.2, lookUp: 0.75, fov: 55 },
  { p: 0.905, side: 1.4, back: 3.6, up: 1.5, lookAhead: 3.2, lookUp: 0.9, fov: 55 },
  { p: 0.945, side: 1.1, back: 2.9, up: 1.15, lookAhead: 2.2, lookUp: 0.5, fov: 55 },
  { p: 0.975, side: 0.7, back: 2.6, up: 0.85, lookAhead: 0.8, lookUp: 0.15, fov: 58 },
  { p: 1.0, side: 0.75, back: 2.7, up: 0.75, lookAhead: 0.6, lookUp: 0.1, fov: 58 },
];

const PORTRAIT: RigKey[] = [
  { p: 0.0, side: 0.6, back: 2.9, up: 1.4, lookAhead: 2.3, lookUp: 0.2, fov: 62 },
  { p: 0.17, side: 0.6, back: 2.9, up: 1.4, lookAhead: 2.3, lookUp: 0.2, fov: 62 },
  { p: 0.24, side: 0.5, back: 2.6, up: 1.05, lookAhead: 2.2, lookUp: 0.1, fov: 62 },
  { p: 0.4, side: 0.14, back: 1.5, up: 0.5, lookAhead: 1.6, lookUp: 0.05, fov: 64 },
  { p: 0.525, side: 0.14, back: 1.5, up: 0.5, lookAhead: 1.6, lookUp: 0.05, fov: 64 },
  { p: 0.57, side: 0.5, back: 2.7, up: 1.05, lookAhead: 2.2, lookUp: 0.15, fov: 62 },
  { p: 0.77, side: 0.5, back: 2.7, up: 1.05, lookAhead: 2.2, lookUp: 0.15, fov: 62 },
  { p: 0.82, side: 0.4, back: 3.4, up: 1.05, lookAhead: 3.4, lookUp: 0.75, fov: 62 },
  { p: 0.885, side: 0.4, back: 3.4, up: 1.05, lookAhead: 3.4, lookUp: 0.9, fov: 62 },
  { p: 0.915, side: 0.6, back: 3.2, up: 1.6, lookAhead: 3.0, lookUp: 0.9, fov: 62 },
  { p: 0.95, side: 0.5, back: 2.6, up: 1.0, lookAhead: 2.2, lookUp: 0.7, fov: 62 },
  { p: 0.978, side: 0.3, back: 2.1, up: 0.6, lookAhead: 1.2, lookUp: 0.12, fov: 64 },
  { p: 1.0, side: 0.35, back: 2.3, up: 0.65, lookAhead: 1.0, lookUp: 0.1, fov: 64 },
];

const UP = new THREE.Vector3(0, 1, 0);
const _side = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _look = new THREE.Vector3();
const _tanFlat = new THREE.Vector3();

export class CameraRig {
  camera: THREE.PerspectiveCamera;
  private smoothTan = new THREE.Vector3(1, 0, 0);
  private smoothPos = new THREE.Vector3();
  private smoothLook = new THREE.Vector3();
  private initialized = false;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.08, 400);
  }

  private key(p: number, table: RigKey[], out: RigKey): void {
    let i = 0;
    while (i < table.length - 2 && p > table[i + 1].p) i++;
    const a = table[i];
    const b = table[i + 1];
    const t = THREE.MathUtils.clamp((p - a.p) / (b.p - a.p), 0, 1);
    out.side = THREE.MathUtils.lerp(a.side, b.side, t);
    out.back = THREE.MathUtils.lerp(a.back, b.back, t);
    out.up = THREE.MathUtils.lerp(a.up, b.up, t);
    out.lookAhead = THREE.MathUtils.lerp(a.lookAhead, b.lookAhead, t);
    out.lookUp = THREE.MathUtils.lerp(a.lookUp, b.lookUp, t);
    out.fov = THREE.MathUtils.lerp(a.fov, b.fov, t);
  }

  private tmpKey: RigKey = { p: 0, side: 0, back: 0, up: 0, lookAhead: 0, lookUp: 0, fov: 55 };

  update(dt: number, p: number, sample: PathSample, portrait: boolean, snap = false): void {
    // smoothed tangent hides polyline corners from the camera
    const k = snap ? 1 : 1 - Math.exp(-3.2 * dt);
    this.smoothTan.lerp(sample.tangent, k).normalize();
    _tanFlat.set(this.smoothTan.x, 0, this.smoothTan.z).normalize();
    _side.crossVectors(_tanFlat, UP).normalize(); // travel maps to screen-right

    this.key(p, portrait ? PORTRAIT : LANDSCAPE, this.tmpKey);
    const K = this.tmpKey;
    _pos
      .copy(sample.pos)
      .addScaledVector(_side, K.side)
      .addScaledVector(_tanFlat, -K.back)
      .addScaledVector(UP, K.up);
    _look
      .copy(sample.pos)
      .addScaledVector(_tanFlat, K.lookAhead)
      .addScaledVector(UP, K.lookUp + 0.22);

    const kc = snap || !this.initialized ? 1 : 1 - Math.exp(-7.5 * dt);
    this.smoothPos.lerp(_pos, kc);
    this.smoothLook.lerp(_look, kc);
    this.initialized = true;

    this.camera.position.copy(this.smoothPos);
    this.camera.lookAt(this.smoothLook);
    if (Math.abs(this.camera.fov - K.fov) > 0.01) {
      this.camera.fov = K.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
