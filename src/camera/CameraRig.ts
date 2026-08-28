import * as THREE from 'three';
import { clamp, damp } from '../core/rng';

export interface Shot {
  /** Direction the camera sits in, relative to the target. Length is ignored. */
  from: THREE.Vector3;
  target: THREE.Vector3;
  /** World-space size that must stay inside the frame. */
  fitWidth: number;
  fitHeight: number;
  fov?: number;
  /** 0 centres the subject; positive lifts it up-screen, away from the finger. */
  lift?: number;
  /** Approach speed; higher is snappier. */
  speed?: number;
  /** Never come closer than this. */
  minDistance?: number;
}

const dir = new THREE.Vector3();
const desiredPos = new THREE.Vector3();
const desiredTarget = new THREE.Vector3();

/**
 * One continuous camera. Every beat is a move, never a cut, and every framing is
 * solved for the actual viewport so a phone in portrait still sees the whole tree.
 */
export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(46, 1, 0.1, 260);
  private readonly pos = new THREE.Vector3(0, 2, 10);
  private readonly look = new THREE.Vector3(0, 1.5, 0);
  private shot: Shot | null = null;
  private aspect = 1;
  private portrait = true;
  private shakeAmount = 0;
  private t = 0;

  setViewport(w: number, h: number): void {
    this.aspect = w / h;
    this.portrait = h >= w;
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
    if (this.shot) this.solve(this.shot, desiredPos, desiredTarget);
  }

  get isPortrait(): boolean {
    return this.portrait;
  }

  to(shot: Shot): void {
    this.shot = shot;
  }

  cut(shot: Shot): void {
    this.shot = shot;
    this.solve(shot, desiredPos, desiredTarget);
    this.pos.copy(desiredPos);
    this.look.copy(desiredTarget);
    this.apply();
  }

  /** Handheld response to the shaker, 0..1. */
  setShake(v: number): void {
    this.shakeAmount = v;
  }

  private solve(shot: Shot, outPos: THREE.Vector3, outTarget: THREE.Vector3): void {
    const fov = shot.fov ?? 46;
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    const vTan = Math.tan((fov * Math.PI) / 360);
    // portrait frames get extra headroom so nothing important sits under a thumb
    const pad = this.portrait ? 1.12 : 1.06;
    const dh = (shot.fitHeight * pad * 0.5) / vTan;
    const dw = (shot.fitWidth * pad * 0.5) / (vTan * this.aspect);
    const distance = Math.max(dh, dw, shot.minDistance ?? 1.4);
    dir.copy(shot.from).normalize();
    outTarget.copy(shot.target);
    const lift = (shot.lift ?? 0.16) * shot.fitHeight * (this.portrait ? 1.25 : 0.8);
    outTarget.y -= lift;
    outPos.copy(shot.target).addScaledVector(dir, distance);
    outPos.y -= lift * 0.35;
  }

  update(dt: number): void {
    this.t += dt;
    if (this.shot) {
      this.solve(this.shot, desiredPos, desiredTarget);
      const k = this.shot.speed ?? 2.2;
      this.pos.x = damp(this.pos.x, desiredPos.x, k, dt);
      this.pos.y = damp(this.pos.y, desiredPos.y, k, dt);
      this.pos.z = damp(this.pos.z, desiredPos.z, k, dt);
      this.look.x = damp(this.look.x, desiredTarget.x, k, dt);
      this.look.y = damp(this.look.y, desiredTarget.y, k, dt);
      this.look.z = damp(this.look.z, desiredTarget.z, k, dt);
    }
    this.apply();
  }

  private apply(): void {
    const breathe = 0.012;
    const sx = Math.sin(this.t * 0.63) * breathe + Math.sin(this.t * 71) * this.shakeAmount * 0.012;
    const sy = Math.cos(this.t * 0.47) * breathe + Math.cos(this.t * 67) * this.shakeAmount * 0.009;
    this.camera.position.set(this.pos.x + sx, this.pos.y + sy, this.pos.z);
    this.camera.lookAt(this.look.x, this.look.y + sy * 0.4, this.look.z);
  }

  /** Distance from the camera to a world point - used for net level of detail. */
  distanceTo(p: THREE.Vector3): number {
    return this.camera.position.distanceTo(p);
  }

  get shakeLevel(): number {
    return clamp(this.shakeAmount, 0, 1);
  }
}
