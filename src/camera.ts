// Camera rig: the camera is a narrative device, never free. The game feeds a
// per-frame Shot (possibly following Santa); the rig smooths toward it so
// transitions between shots are continuous camera moves, never cuts.
import * as THREE from 'three';
import { damp } from './util';

export interface Shot {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
}

export class CameraRig {
  camera: THREE.PerspectiveCamera;
  private curPos = new THREE.Vector3();
  private curLook = new THREE.Vector3();
  private curFov = 45;
  // responsiveness of the move (higher = tighter follow)
  lambda = 2.2;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.08, 90);
  }

  snapTo(shot: Shot): void {
    this.curPos.copy(shot.pos);
    this.curLook.copy(shot.look);
    this.curFov = shot.fov;
    this.apply();
  }

  update(shot: Shot, dt: number): void {
    const k = 1 - Math.exp(-this.lambda * dt);
    this.curPos.lerp(shot.pos, k);
    this.curLook.lerp(shot.look, k);
    this.curFov = damp(this.curFov, shot.fov, this.lambda, dt);
    this.apply();
  }

  private apply(): void {
    this.camera.position.copy(this.curPos);
    this.camera.lookAt(this.curLook);
    if (Math.abs(this.camera.fov - this.curFov) > 0.01) {
      this.camera.fov = this.curFov;
      this.camera.updateProjectionMatrix();
    }
  }

  get y(): number {
    return this.curPos.y;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
