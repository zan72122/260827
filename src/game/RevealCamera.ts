import * as THREE from 'three';
import { smoothstep } from '../core/rng';

export interface Pose {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

export const pose = (
  position: [number, number, number],
  target: [number, number, number],
  fov: number,
): Pose => ({
  position: new THREE.Vector3(...position),
  target: new THREE.Vector3(...target),
  fov,
});

export interface FrameSpec {
  target: THREE.Vector3;
  /** Compass angle of the camera around the target, radians. */
  azimuth: number;
  /** Height of the camera above the horizon, radians. */
  elevation: number;
  /** Half width and half height, in metres, that must stay in frame. */
  fitH: number;
  fitV: number;
  fov: number;
}

/**
 * Distance is solved from the aspect rather than hard coded, so a tall phone
 * pulls back to keep the whole cake across the narrow axis and a landscape
 * tablet holds the cake and the tray of slices in one shot.
 */
export function framePose(spec: FrameSpec, aspect: number): Pose {
  const vf = (spec.fov * Math.PI) / 180;
  const hf = 2 * Math.atan(Math.tan(vf / 2) * Math.max(0.1, aspect));
  const d = Math.max(spec.fitH / Math.sin(hf / 2), spec.fitV / Math.sin(vf / 2));
  const ce = Math.cos(spec.elevation);
  const position = spec.target
    .clone()
    .add(
      new THREE.Vector3(
        Math.cos(spec.azimuth) * ce * d,
        Math.sin(spec.elevation) * d,
        Math.sin(spec.azimuth) * ce * d,
      ),
    );
  return { position, target: spec.target.clone(), fov: spec.fov };
}

/**
 * RevealCamera — moves between the working view and the view of the cut face
 * without ever cutting to black. The reveal pose is derived from the plane the
 * knife actually took, so the child watches the same slice they built come out
 * and turn toward them.
 */
export class RevealCamera {
  readonly camera: THREE.PerspectiveCamera;
  private from: Pose;
  private to: Pose;
  private t = 1;
  private duration = 1;
  private readonly current: Pose;

  constructor(start: Pose) {
    this.camera = new THREE.PerspectiveCamera(start.fov, 1, 0.02, 40);
    this.from = clone(start);
    this.to = clone(start);
    this.current = clone(start);
    this.apply();
  }

  moveTo(next: Pose, duration: number): void {
    this.from = clone(this.current);
    this.to = clone(next);
    this.duration = Math.max(0.0001, duration);
    this.t = 0;
  }

  snapTo(next: Pose): void {
    this.from = clone(next);
    this.to = clone(next);
    this.current.position.copy(next.position);
    this.current.target.copy(next.target);
    this.current.fov = next.fov;
    this.t = 1;
    this.apply();
  }

  get settled(): boolean {
    return this.t >= 1;
  }

  get targetPose(): Pose {
    return this.to;
  }

  setViewport(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt / this.duration);
      const k = smoothstep(0, 1, this.t);
      this.current.position.lerpVectors(this.from.position, this.to.position, k);
      this.current.target.lerpVectors(this.from.target, this.to.target, k);
      this.current.fov = this.from.fov + (this.to.fov - this.from.fov) * k;
      this.apply();
    }
  }

  private apply(): void {
    this.camera.position.copy(this.current.position);
    this.camera.lookAt(this.current.target);
    if (Math.abs(this.camera.fov - this.current.fov) > 1e-4) {
      this.camera.fov = this.current.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}

const clone = (p: Pose): Pose => ({
  position: p.position.clone(),
  target: p.target.clone(),
  fov: p.fov,
});
