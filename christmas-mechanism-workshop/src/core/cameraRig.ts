import * as THREE from 'three';
import { clamp, easeInOut, lerp } from '../util/math';
import type { Engine, Orientation } from './engine';

/* ------------------------------------------------------------------ *
 * The child never drives the camera.  Each step of the build names a pose
 * and the rig glides there.  Poses carry their own portrait variant, so
 * turning the iPad re-frames the same shot instead of cutting to a new one.
 * ------------------------------------------------------------------ */

export interface Pose {
  name: string;
  target: THREE.Vector3;
  dist: number;
  yaw: number;      // radians around Y, 0 = looking from +Z
  pitch: number;    // radians above the horizon
  fov?: number;
  /** portrait overrides */
  pDist?: number;
  pFov?: number;
  pTargetY?: number;
  pPitch?: number;
}

function resolve(p: Pose, o: Orientation, outPos: THREE.Vector3, outTgt: THREE.Vector3) {
  const portrait = o === 'portrait';
  const dist = portrait ? (p.pDist ?? p.dist * 1.28) : p.dist;
  const pitch = portrait ? (p.pPitch ?? p.pitch) : p.pitch;
  outTgt.copy(p.target);
  if (portrait) outTgt.y += p.pTargetY ?? 0.012;
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  outPos.set(
    outTgt.x + Math.sin(p.yaw) * cp * dist,
    outTgt.y + sp * dist,
    outTgt.z + Math.cos(p.yaw) * cp * dist,
  );
  return portrait ? (p.pFov ?? (p.fov ?? 38) * 1.06) : (p.fov ?? 38);
}

export class CameraRig {
  private engine: Engine;
  private from: Pose;
  private to: Pose;
  private t = 1;
  private dur = 1;
  private posA = new THREE.Vector3();
  private tgtA = new THREE.Vector3();
  private posB = new THREE.Vector3();
  private tgtB = new THREE.Vector3();
  private curPos = new THREE.Vector3();
  private curTgt = new THREE.Vector3();
  private shake = 0;

  constructor(engine: Engine, start: Pose) {
    this.engine = engine;
    this.from = start;
    this.to = start;
    resolve(start, engine.orientation, this.curPos, this.curTgt);
  }

  /** Glide to a new pose. Always continuous: there are never any cuts. */
  go(pose: Pose, duration = 1.6) {
    if (this.to.name === pose.name && this.t >= 1) return;
    // start the new move from wherever we actually are
    this.from = {
      ...this.to, name: this.to.name + '@cur',
      target: this.curTgt.clone(),
    };
    this.fromOverride = { pos: this.curPos.clone(), tgt: this.curTgt.clone() };
    this.to = pose;
    this.t = 0;
    this.dur = Math.max(0.001, duration);
  }

  private fromOverride: { pos: THREE.Vector3; tgt: THREE.Vector3 } | null = null;

  get poseName() { return this.to.name; }
  get settled() { return this.t >= 0.985; }
  nudge(amount = 0.4) { this.shake = amount; }

  update(dt: number, time: number) {
    this.t = clamp(this.t + dt / this.dur, 0, 1);
    const e = easeInOut(this.t);
    const o = this.engine.orientation;

    const fovB = resolve(this.to, o, this.posB, this.tgtB);
    let fovA = fovB;
    if (this.fromOverride && this.t < 1) {
      this.posA.copy(this.fromOverride.pos);
      this.tgtA.copy(this.fromOverride.tgt);
      fovA = this.engine.camera.fov;
    } else {
      fovA = resolve(this.from, o, this.posA, this.tgtA);
    }

    this.curPos.copy(this.posA).lerp(this.posB, e);
    this.curTgt.copy(this.tgtA).lerp(this.tgtB, e);
    const fov = lerp(fovA, fovB, e);

    // a breath of hand-held life, tiny enough to stay invisible
    const bx = Math.sin(time * 0.37) * 0.0016 + Math.sin(time * 0.83) * 0.0009;
    const by = Math.cos(time * 0.29) * 0.0014;
    this.shake = Math.max(0, this.shake - dt * 1.6);
    const sh = this.shake * 0.004;

    const cam = this.engine.camera;
    cam.position.set(
      this.curPos.x + bx + Math.sin(time * 31) * sh,
      this.curPos.y + by + Math.cos(time * 27) * sh,
      this.curPos.z,
    );
    cam.lookAt(this.curTgt);
    if (Math.abs(cam.fov - fov) > 0.001) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }
}
