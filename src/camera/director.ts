import * as THREE from 'three';
import { easeInOutCubic } from '../core/units';

export type Phase = 'overview' | 'assembly' | 'mount' | 'finished';

export interface Framing {
  target: THREE.Vector3;
  /** distance from target, metres */
  dist: number;
  /** yaw around the target, radians; 0 looks from +Z */
  yaw: number;
  /** pitch, radians; negative looks down */
  pitch: number;
  fov: number;
}

/**
 * The camera moves in one order — the whole bench, then in close and oblique for
 * the joinery, then down to the pot and the trunk's foot, then back for the
 * finished tree.  It never cuts, and a move is never allowed to start on the
 * frame a joint closes or a hand lets go: `hold()` pushes the next move back.
 */
/**
 * Distance at which a box of the given half width and half height fits, whichever
 * of the two binds.  This is what re-composes the view on an orientation change:
 * the tree keeps its size, the camera steps back or in.
 */
export function fitDistance(halfW: number, halfH: number, fov: number, aspect: number): number {
  const t = Math.tan((fov * Math.PI) / 360);
  return Math.max(halfH / t, halfW / (t * Math.max(0.2, aspect)));
}

export class CameraDirector {
  phase: Phase = 'overview';
  private from: Framing;
  private to: Framing;
  private t = 1;
  private duration = 1.4;
  private holdUntil = 0;
  private queued: Phase | null = null;
  private clock = 0;
  portrait = true;
  private aspect = 0.5;

  constructor(
    private camera: THREE.PerspectiveCamera,
      private framings: (phase: Phase, aspect: number) => Framing,
  ) {
    this.from = framings('overview', 0.5);
    this.to = this.from;
    this.apply(this.to);
  }

  /** Ask for a phase.  It will not start while the view is held. */
  go(phase: Phase) {
    if (phase === this.phase && this.t >= 1) return;
    if (this.clock < this.holdUntil) {
      this.queued = phase;
      return;
    }
    this.start(phase);
  }

  private start(phase: Phase) {
    this.from = this.current();
    this.phase = phase;
    this.to = this.framings(phase, this.aspect);
    this.t = 0;
    this.queued = null;
  }

  /** Keep the camera still for a moment — used around joints and releases. */
  hold(seconds: number) {
    this.holdUntil = Math.max(this.holdUntil, this.clock + seconds);
  }

  /** Re-derive the framing after an orientation change, without moving the tree. */
  reframe(aspect: number) {
    this.aspect = aspect;
    this.portrait = aspect < 1;
    if (this.t >= 1) {
      this.to = this.framings(this.phase, aspect);
      this.from = this.to;
      this.apply(this.to);
    } else {
      this.to = this.framings(this.phase, aspect);
    }
  }

  private current(): Framing {
    if (this.t >= 1) return this.to;
    const e = easeInOutCubic(this.t);
    return {
      target: new THREE.Vector3().lerpVectors(this.from.target, this.to.target, e),
      dist: THREE.MathUtils.lerp(this.from.dist, this.to.dist, e),
      yaw: THREE.MathUtils.lerp(this.from.yaw, this.to.yaw, e),
      pitch: THREE.MathUtils.lerp(this.from.pitch, this.to.pitch, e),
      fov: THREE.MathUtils.lerp(this.from.fov, this.to.fov, e),
    };
  }

  private apply(f: Framing) {
    const x = Math.sin(f.yaw) * Math.cos(f.pitch);
    const y = Math.sin(-f.pitch);
    const z = Math.cos(f.yaw) * Math.cos(f.pitch);
    this.camera.position.set(
      f.target.x + x * f.dist,
      f.target.y + y * f.dist,
      f.target.z + z * f.dist,
    );
    this.camera.lookAt(f.target);
    if (Math.abs(this.camera.fov - f.fov) > 1e-4) {
      this.camera.fov = f.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  update(dt: number) {
    this.clock += dt;
    if (this.t < 1) this.t = Math.min(1, this.t + dt / this.duration);
    this.apply(this.current());
    if (this.queued && this.clock >= this.holdUntil) this.start(this.queued);
  }

  get moving() {
    return this.t < 1;
  }
}
