/**
 * Camera chain. A shot is described by what must stay in frame, not by a fixed
 * lens, so portrait and landscape both keep the whole subject — the camera
 * moves instead of the field of view stretching.
 */
import * as THREE from 'three';
import { damp } from '../core/rand';

export interface ShotSpec {
  /** what the camera looks at (the exact look-at when `eye` is given) */
  target: THREE.Vector3;
  /** unit vector from the target toward the camera; ignored when `eye` is set */
  dir?: THREE.Vector3;
  /** half width that must stay in frame, metres */
  fitW?: number;
  /** half height that must stay in frame, metres */
  fitH?: number;
  /** how fast the camera converges (higher = snappier) */
  lambda?: number;
  /** push the subject up the screen so a thumb never covers it */
  lift?: number;
  /** explicit camera placement; when given, `target` is the exact look-at */
  eye?: THREE.Vector3;
}

/** Portrait gets a wider lens: it is the only way a phone frame holds a scene. */
const FOV_LANDSCAPE = 45;
const FOV_PORTRAIT = 58;

const UP_AXIS = new THREE.Vector3(0, 0, 1);

export class Director {
  private eye = new THREE.Vector3(0, 2, 8);
  private look = new THREE.Vector3();
  private wantEye = new THREE.Vector3(0, 2, 8);
  private wantLook = new THREE.Vector3();
  private lambda = 2.2;
  /** distance the current move started from, for reporting progress */
  private refDist = 1e-6;

  constructor(private camera: THREE.PerspectiveCamera) {
    camera.fov = FOV_LANDSCAPE;
  }

  /** 0..1 — how far the camera has travelled into the shot it was last given. */
  get transitionProgress(): number {
    const d = this.eye.distanceTo(this.wantEye);
    return Math.max(0, Math.min(1, 1 - d / this.refDist));
  }

  set(spec: ShotSpec, aspect: number, portrait: boolean, snap = false): void {
    const fov = portrait ? FOV_PORTRAIT : FOV_LANDSCAPE;
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    const prev = this.wantEye.clone();
    if (spec.eye) {
      this.wantEye.copy(spec.eye);
      this.wantLook.copy(spec.target);
    } else {
      const halfV = THREE.MathUtils.degToRad(fov / 2);
      const halfH = Math.atan(Math.tan(halfV) * aspect);
      const lift = spec.lift ?? (portrait ? 0.3 : 0.12);
      const fitH = spec.fitH ?? 1;
      const fitW = spec.fitW ?? 1;
      // the lift pushes the subject up the screen, so the framing has to make
      // room for it or the top of the tree walks out of shot
      const dV = (fitH * (1 + Math.abs(lift))) / Math.tan(halfV);
      const dH = fitW / Math.tan(halfH);
      const dist = Math.max(dV, dH) + 0.35;
      this.wantLook.copy(spec.target);
      this.wantLook.y -= fitH * lift;
      this.wantEye
        .copy(spec.dir ?? UP_AXIS)
        .normalize()
        .multiplyScalar(dist)
        .add(spec.target);
    }
    this.lambda = spec.lambda ?? 2.2;
    if (snap) {
      this.eye.copy(this.wantEye);
      this.look.copy(this.wantLook);
      this.refDist = 1e-6;
    } else if (prev.distanceTo(this.wantEye) > 0.75) {
      // a genuinely new shot, not the same one re-issued this frame
      this.refDist = Math.max(1e-6, this.eye.distanceTo(this.wantEye));
    }
  }

  update(dt: number): void {
    this.eye.x = damp(this.eye.x, this.wantEye.x, this.lambda, dt);
    this.eye.y = damp(this.eye.y, this.wantEye.y, this.lambda, dt);
    this.eye.z = damp(this.eye.z, this.wantEye.z, this.lambda, dt);
    this.look.x = damp(this.look.x, this.wantLook.x, this.lambda * 1.15, dt);
    this.look.y = damp(this.look.y, this.wantLook.y, this.lambda * 1.15, dt);
    this.look.z = damp(this.look.z, this.wantLook.z, this.lambda * 1.15, dt);
    this.camera.position.copy(this.eye);
    this.camera.lookAt(this.look);
  }
}

export const dirFrom = (az: number, el: number): THREE.Vector3 =>
  new THREE.Vector3(
    Math.cos(el) * Math.cos(az),
    Math.sin(el),
    Math.cos(el) * Math.sin(az),
  ).normalize();
