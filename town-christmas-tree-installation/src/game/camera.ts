import * as THREE from 'three';
import { damp } from '../core/input';

export interface Shot {
  position: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
  /** Higher = snappier. Reduced-motion halves it. */
  responsiveness?: number;
}

/**
 * A scripted camera. The child never drives it — the director hands it a shot
 * per frame and the rig eases toward it. No shake, no punch-in zooms.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private lookAt = new THREE.Vector3(0, 6, 0);
  private targetPos = new THREE.Vector3(20, 10, 20);
  private targetLook = new THREE.Vector3(0, 6, 0);
  private targetFov = 46;
  private drift = 0;
  private gentle = false;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(46, 1, 0.35, 900);
    this.camera.position.set(24, 12, 26);
    this.camera.lookAt(this.lookAt);
  }

  setGentle(v: boolean): void {
    this.gentle = v;
  }

  set(shot: Shot, snap = false): void {
    this.targetPos.copy(shot.position);
    this.targetLook.copy(shot.look);
    this.targetFov = shot.fov;
    if (snap) {
      this.camera.position.copy(shot.position);
      this.lookAt.copy(shot.look);
      this.camera.fov = shot.fov;
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(this.lookAt);
    }
    this.responsiveness = shot.responsiveness ?? 1.6;
  }

  private responsiveness = 1.6;

  update(dt: number, time: number): void {
    const lambda = this.responsiveness * (this.gentle ? 0.55 : 1);
    this.camera.position.x = damp(this.camera.position.x, this.targetPos.x, lambda, dt);
    this.camera.position.y = damp(this.camera.position.y, this.targetPos.y, lambda, dt);
    this.camera.position.z = damp(this.camera.position.z, this.targetPos.z, lambda, dt);
    this.lookAt.x = damp(this.lookAt.x, this.targetLook.x, lambda * 1.15, dt);
    this.lookAt.y = damp(this.lookAt.y, this.targetLook.y, lambda * 1.15, dt);
    this.lookAt.z = damp(this.lookAt.z, this.targetLook.z, lambda * 1.15, dt);
    const fov = damp(this.camera.fov, this.targetFov, lambda, dt);
    if (Math.abs(fov - this.camera.fov) > 0.002) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    // A barely-there breath so static shots are not dead — off when gentle.
    this.drift = this.gentle ? 0 : Math.sin(time * 0.31) * 0.06;
    this.camera.position.y += this.drift * 0.35;
    this.camera.lookAt(this.lookAt);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }
}

/**
 * Orbit position at a FIXED distance with the field of view widened to fit the
 * subject. Fixing the distance keeps the camera inside the square (never
 * inside a building), and solving the fov instead gives portrait and landscape
 * genuinely different framings rather than a crop of one another.
 */
export function fitShot(
  centre: THREE.Vector3,
  subjectHeight: number,
  subjectWidth: number,
  azimuth: number,
  elevation: number,
  distance: number,
  aspect: number,
  margin = 1.12,
  minFov = 34,
  maxFov = 74,
): { position: THREE.Vector3; fov: number } {
  const needV = 2 * Math.atan((subjectHeight * margin * 0.5) / distance);
  const needH = 2 * Math.atan((subjectWidth * margin * 0.5) / (distance * Math.max(aspect, 0.2)));
  const fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(Math.max(needV, needH)), minFov, maxFov);
  return {
    position: new THREE.Vector3(
      centre.x + Math.cos(azimuth) * Math.cos(elevation) * distance,
      centre.y + Math.sin(elevation) * distance,
      centre.z + Math.sin(azimuth) * Math.cos(elevation) * distance,
    ),
    fov,
  };
}
