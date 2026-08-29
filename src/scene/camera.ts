import * as THREE from 'three';
import { easeInOut } from '../util/tween';

export interface Pose {
  target: THREE.Vector3;
  /** Direction from target to camera (need not be normalised). */
  dir: THREE.Vector3;
  /** Radius that must fit on screen, in centimetres. */
  fit: number;
  /** Extra push toward the viewer in portrait, where depth reads best. */
  portraitBias?: number;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * Fixed shot list. There is no free camera: every phase is framed where the
 * cause and its effect are both readable.
 */
export const POSES = {
  whole: { target: V(0, 8.4, 0), dir: V(-0.34, 0.6, 1), fit: 8.6 },
  cutA: { target: V(0, 8.9, 0), dir: V(0.24, 0.4, 1), fit: 10.6 },
  turn: { target: V(0, 7.6, 0), dir: V(-0.08, 0.46, 1), fit: 11.4 },
  cutB: { target: V(0, 8.9, 0), dir: V(-0.5, 0.38, 0.95), fit: 10.6 },
  serve: { target: V(3.6, 7.6, 1.0), dir: V(0.08, 0.3, 1), fit: 11.8 },
  study: { target: V(5.4, 7.2, 2.2), dir: V(0.42, 0.4, 1), fit: 9.6, portraitBias: 0.7 },

  buildTop: { target: V(34, 4.6, 4.5), dir: V(0.02, 0.95, 0.42), fit: 12.0 },
  place: { target: V(34, 3.6, 6.5), dir: V(-0.1, 0.78, 1), fit: 12.6 },
  fill: { target: V(34, 5.6, 0.8), dir: V(0.14, 0.66, 1), fit: 10.6 },
  lid: { target: V(34, 6.6, 2.4), dir: V(-0.08, 0.6, 1), fit: 12.8 },
  coat: { target: V(34, 7.8, 0), dir: V(-0.3, 0.44, 1), fit: 11.0 },
  aim: { target: V(34, 9.4, 0), dir: V(0.0, 0.95, 0.62), fit: 10.4 },
  cutNew: { target: V(34, 8.9, 0), dir: V(0.24, 0.4, 1), fit: 10.6 },
  serveNew: { target: V(37.6, 7.6, 1.0), dir: V(0.08, 0.3, 1), fit: 11.8 },
  revealNew: { target: V(39.4, 7.2, 2.2), dir: V(0.42, 0.4, 1), fit: 9.6, portraitBias: 0.7 },
} satisfies Record<string, Pose>;

export type PoseName = keyof typeof POSES;

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private from = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };
  private to = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };
  private t = 1;
  private dur = 1;
  private cur: Pose = POSES.whole;
  private pos = new THREE.Vector3();
  private tgt = new THREE.Vector3();
  private shake = 0;
  private portrait = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(38, aspect, 0.5, 500);
    this.apply(POSES.whole, true);
  }

  setAspect(aspect: number) {
    this.camera.aspect = aspect;
    this.portrait = aspect < 1;
    this.camera.updateProjectionMatrix();
    // Re-solve the current framing so a rotation never crops the action.
    this.solve(this.cur, this.to.pos, this.to.tgt);
    if (this.t >= 1) {
      this.pos.copy(this.to.pos);
      this.tgt.copy(this.to.tgt);
    }
  }

  private solve(p: Pose, outPos: THREE.Vector3, outTgt: THREE.Vector3) {
    const vFov = (this.camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const fov = Math.min(vFov, hFov);
    let dist = p.fit / Math.tan(fov / 2);
    if (this.portrait && p.portraitBias) dist *= 1 - p.portraitBias * 0.12;
    const dir = p.dir.clone().normalize();
    outTgt.copy(p.target);
    outPos.copy(p.target).addScaledVector(dir, dist);
  }

  apply(p: Pose, instant = false, dur = 1.5) {
    this.cur = p;
    this.from.pos.copy(this.pos);
    this.from.tgt.copy(this.tgt);
    this.solve(p, this.to.pos, this.to.tgt);
    if (instant) {
      this.pos.copy(this.to.pos);
      this.tgt.copy(this.to.tgt);
      this.t = 1;
    } else {
      this.t = 0;
      this.dur = dur;
    }
  }

  goto(name: PoseName, dur = 1.5) {
    this.apply(POSES[name], false, dur);
  }

  nudge(amount: number) {
    this.shake = Math.max(this.shake, amount);
  }

  get moving() {
    return this.t < 1;
  }

  update(dt: number) {
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt / this.dur);
      const k = easeInOut(this.t);
      this.pos.lerpVectors(this.from.pos, this.to.pos, k);
      this.tgt.lerpVectors(this.from.tgt, this.to.tgt, k);
    }
    this.shake *= Math.exp(-dt * 7);
    const s = this.shake;
    this.camera.position.set(
      this.pos.x + Math.sin(performance.now() * 0.031) * s,
      this.pos.y + Math.sin(performance.now() * 0.043) * s,
      this.pos.z
    );
    this.camera.lookAt(this.tgt);
  }
}
