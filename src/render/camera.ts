/**
 * The camera is written, not flown.
 *
 * The child never controls it. Each stage names a direction to look from and
 * the things that must be on screen; the framing is then solved from those
 * objects' real positions, so a grab target cannot end up off the edge on a
 * screen shape nobody tried. Moving between stages is a continuous ease, never
 * a cut, and the three moments that have to read as cause and effect -- the
 * balance changing, the thread lifting the head, the first nod -- happen while
 * the camera is holding still.
 *
 * Portrait and landscape differ in where the composition sits and how much air
 * it is given, not in what is included.
 */
import { PerspectiveCamera, Vector3 } from 'three';
import type { Stage } from '../sim/stages';

export interface ShotSpec {
  /** direction from the subject towards the camera */
  dir: [number, number, number];
  /** breathing room around the subject, 1 = tight */
  pad: number;
  /** shift of the subject within the frame, in fractions of the half-extent */
  bias: [number, number];
}

const SHOTS: Record<Stage, { portrait: ShotSpec; landscape: ShotSpec }> = {
  // The oblique side: face, support notch, inner arm and grip all at once.
  balance: {
    portrait: { dir: [0.52, 0.17, 0.84], pad: 1.35, bias: [0, 0.12] },
    landscape: { dir: [0.46, 0.15, 0.87], pad: 1.22, bias: [0, 0.05] },
  },
  insert: {
    portrait: { dir: [0.42, 0.3, 0.85], pad: 1.2, bias: [0, 0] },
    landscape: { dir: [0.4, 0.26, 0.88], pad: 1.14, bias: [0, 0] },
  },
  // Upright, the thread's free end sits below the head; sideways, the neck and
  // the inside of the belly spread across the width.
  thread: {
    portrait: { dir: [0.48, 0.2, 0.85], pad: 1.16, bias: [0, 0] },
    landscape: { dir: [0.34, 0.18, 0.92], pad: 1.12, bias: [0, 0] },
  },
  tie: {
    portrait: { dir: [0.48, 0.2, 0.85], pad: 1.16, bias: [0, 0] },
    landscape: { dir: [0.34, 0.18, 0.92], pad: 1.12, bias: [0, 0] },
  },
  // Deliberately the same as the tie: the camera must not move while the head
  // nods for the first time.
  firstNod: {
    portrait: { dir: [0.48, 0.2, 0.85], pad: 1.16, bias: [0, 0] },
    landscape: { dir: [0.34, 0.18, 0.92], pad: 1.12, bias: [0, 0] },
  },
  play: {
    portrait: { dir: [0.62, 0.2, 0.76], pad: 1.24, bias: [0, 0.04] },
    landscape: { dir: [0.56, 0.17, 0.81], pad: 1.16, bias: [0, 0.02] },
  },
};

const UP = new Vector3(0, 1, 0);

export class CameraRig {
  readonly camera: PerspectiveCamera;
  private pos = new Vector3();
  private look = new Vector3();
  private wantPos = new Vector3();
  private wantLook = new Vector3();
  private started = false;

  constructor() {
    this.camera = new PerspectiveCamera(42, 1, 0.01, 20);
  }

  /**
   * Frame `points` (world metres) from the stage's direction.
   *
   * The extents are measured in the camera's own right/up basis, and the depth
   * spread of the subject is added to the distance so the nearest part is
   * inside the frustum too -- which is what was letting the grip, closest to
   * the lens, fall off the side of a narrow screen.
   */
  set(stage: Stage, aspect: number, points: Vector3[]): void {
    if (points.length === 0) return;
    const spec = aspect >= 1 ? SHOTS[stage].landscape : SHOTS[stage].portrait;
    const d = new Vector3(spec.dir[0], spec.dir[1], spec.dir[2]).normalize();
    const right = new Vector3().crossVectors(d, UP).normalize();
    const up = new Vector3().crossVectors(right, d).normalize();

    let rMin = Infinity;
    let rMax = -Infinity;
    let uMin = Infinity;
    let uMax = -Infinity;
    let dMin = Infinity;
    let dMax = -Infinity;
    for (const p of points) {
      const r = p.dot(right);
      const u = p.dot(up);
      const z = p.dot(d);
      rMin = Math.min(rMin, r);
      rMax = Math.max(rMax, r);
      uMin = Math.min(uMin, u);
      uMax = Math.max(uMax, u);
      dMin = Math.min(dMin, z);
      dMax = Math.max(dMax, z);
    }
    const halfW = ((rMax - rMin) / 2) * spec.pad;
    const halfH = ((uMax - uMin) / 2) * spec.pad;
    const cr = (rMin + rMax) / 2 - halfW * spec.bias[0];
    const cu = (uMin + uMax) / 2 - halfH * spec.bias[1];
    const cd = (dMin + dMax) / 2;

    this.wantLook
      .copy(right)
      .multiplyScalar(cr)
      .addScaledVector(up, cu)
      .addScaledVector(d, cd);

    const halfV = (this.camera.fov * Math.PI) / 360;
    const tv = Math.tan(halfV);
    const th = tv * aspect;
    const dist = Math.max(halfH / tv, halfW / th) + (dMax - dMin) / 2 + 0.01;
    this.wantPos.copy(this.wantLook).addScaledVector(d, dist);

    if (!this.started) {
      this.pos.copy(this.wantPos);
      this.look.copy(this.wantLook);
      this.started = true;
    }
  }

  /** Reframe immediately, keeping the state: used when the screen rotates. */
  snap(): void {
    this.pos.copy(this.wantPos);
    this.look.copy(this.wantLook);
    this.apply();
  }

  /**
   * Ease towards the current shot. `hold` freezes the camera outright, which is
   * what keeps a cut out of the moments that have to be read continuously.
   */
  update(dt: number, hold = false): void {
    if (!hold) {
      const k = 1 - Math.exp(-Math.max(0, dt) / 0.55);
      this.pos.lerp(this.wantPos, k);
      this.look.lerp(this.wantLook, k);
    }
    this.apply();
  }

  private apply(): void {
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
    this.camera.updateMatrixWorld();
  }

  get settled(): boolean {
    return this.pos.distanceTo(this.wantPos) < 0.004;
  }
}
