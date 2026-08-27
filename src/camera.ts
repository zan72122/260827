import * as THREE from 'three';
import { clamp, damp } from './math';

export type ShotPhase = 'aim' | 'swing' | 'aftermath';

/**
 * Camera director. One three-quarter side view frames pivot, rope, ball,
 * wall and ground together. The camera is frozen while the finger is down,
 * drifts subtly during the swing (never a cut before impact), shakes at the
 * hit, then eases to a slightly lower view while debris falls and returns.
 */
export class CameraDirector {
  readonly camera: THREE.PerspectiveCamera;
  phase: ShotPhase = 'aim';
  private aimPos = new THREE.Vector3();
  private aimLook = new THREE.Vector3();
  private curPos = new THREE.Vector3();
  private curLook = new THREE.Vector3();
  private targetPos = new THREE.Vector3();
  private targetLook = new THREE.Vector3();
  private shake = 0;
  private aftermathT = 0;
  private aftermathFocus = new THREE.Vector3(0, 2, 0);
  private portrait = false;
  private frozen = false;
  private tmp = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(55, aspect, 0.1, 200);
    this.setAspect(aspect);
    this.curPos.copy(this.aimPos);
    this.curLook.copy(this.aimLook);
    this.apply();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.portrait = aspect < 1;
    if (this.portrait) {
      // portrait: emphasize the vertical run from sheave to ball
      this.camera.fov = 64;
      this.aimPos.set(-3.2, 4.6, -15.4);
      this.aimLook.set(0.2, 4.1, -1.0);
    } else {
      // landscape: emphasize left/center/right aiming across the wall width
      this.camera.fov = 54;
      this.aimPos.set(-4.6, 4.5, -13.4);
      this.aimLook.set(0.4, 3.7, -1.2);
    }
    this.camera.updateProjectionMatrix();
  }

  /** Freeze all camera motion (used while the finger is down). */
  setFrozen(f: boolean): void {
    this.frozen = f;
  }

  toAim(): void {
    this.phase = 'aim';
  }

  /** Ball released: subtle drift only, keeps the aim frame. */
  toSwing(): void {
    this.phase = 'swing';
  }

  /** Impact happened at p with energy e (0..1). */
  onImpact(p: THREE.Vector3, e: number): void {
    this.shake = Math.min(0.5, 0.1 + e * 0.4);
    this.aftermathFocus.set(p.x * 0.7, Math.max(1.6, p.y * 0.6), 0);
    this.phase = 'aftermath';
    this.aftermathT = 0;
  }

  update(dt: number, ballPos: THREE.Vector3): void {
    if (this.phase === 'aim') {
      this.targetPos.copy(this.aimPos);
      this.targetLook.copy(this.aimLook);
    } else if (this.phase === 'swing') {
      // follow the ball laterally a little; no rotation flips, no cuts
      const fx = clamp(ballPos.x * 0.28, -0.9, 0.9);
      this.targetPos.copy(this.aimPos).add(this.tmp.set(fx, 0, 0));
      this.targetLook.copy(this.aimLook).add(this.tmp.set(fx * 0.7, 0, 0));
    } else {
      // aftermath: ease lower and closer to read the debris, then home
      this.aftermathT += dt;
      const t = this.aftermathT;
      if (t < 2.6) {
        const lowPos = this.portrait
          ? this.tmp.set(this.aftermathFocus.x - 3.6, 2.3, -10.6).clone()
          : this.tmp.set(this.aftermathFocus.x - 5.2, 2.5, -9.2).clone();
        this.targetPos.copy(lowPos);
        this.targetLook.set(this.aftermathFocus.x, this.aftermathFocus.y, -0.4);
      } else if (t < 4.2) {
        this.targetPos.copy(this.aimPos);
        this.targetLook.copy(this.aimLook);
      } else {
        this.phase = 'aim';
      }
    }

    if (!this.frozen) {
      const k = damp(this.phase === 'aftermath' ? 1.7 : 2.6, dt);
      this.curPos.lerp(this.targetPos, k);
      this.curLook.lerp(this.targetLook, k);
    }
    this.shake = Math.max(0, this.shake - dt * 1.1);
    this.apply();
  }

  private apply(): void {
    this.camera.position.copy(this.curPos);
    if (this.shake > 0.001) {
      const s = this.shake * this.shake;
      this.camera.position.x += (Math.random() - 0.5) * s * 0.5;
      this.camera.position.y += (Math.random() - 0.5) * s * 0.4;
    }
    this.camera.lookAt(this.curLook);
  }
}
