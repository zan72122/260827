import * as THREE from 'three';

// Camera direction: a handful of framings that are computed from the actual
// sheet extents and screen aspect, tweened smoothly. During the crack run the
// camera never cuts away.

export class CameraDirector {
  constructor(camera) {
    this.camera = camera;
    this.pos = camera.position.clone();
    this.target = new THREE.Vector3(0, 0.92, 0);
    this.fromPos = this.pos.clone();
    this.fromTarget = this.target.clone();
    this.toPos = this.pos.clone();
    this.toTarget = this.target.clone();
    this.t = 1;
    this.dur = 1;
    this.locked = false; // true while the crack is running: no new moves
  }

  isPortrait() {
    return this.camera.aspect < 1;
  }

  moveTo(pos, target, dur = 1.1) {
    if (this.locked) return;
    this.fromPos.copy(this.pos);
    this.fromTarget.copy(this.target);
    this.toPos.copy(pos);
    this.toTarget.copy(target);
    this.dur = Math.max(0.001, dur);
    this.t = 0;
  }

  jumpTo(pos, target) {
    this.fromPos.copy(pos); this.toPos.copy(pos);
    this.fromTarget.copy(target); this.toTarget.copy(target);
    this.t = 1;
    this._apply(pos, target);
  }

  lock() { this.locked = true; }
  unlock() { this.locked = false; }

  update(dt) {
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt / this.dur);
      const e = this.t < 0.5 ? 2 * this.t * this.t : 1 - Math.pow(-2 * this.t + 2, 2) / 2;
      this.pos.lerpVectors(this.fromPos, this.toPos, e);
      this.target.lerpVectors(this.fromTarget, this.toTarget, e);
    } else {
      this.pos.copy(this.toPos);
      this.target.copy(this.toTarget);
    }
    this._apply(this.pos, this.target);
  }

  _apply(pos, target) {
    this.camera.position.copy(pos);
    this.camera.lookAt(target);
  }

  // Find the camera distance along `dir` (unit, from target) so that all
  // `points` fit inside the frustum with margin (fraction of NDC).
  fitDistance(target, dir, points, margin = 0.82) {
    const cam = this.camera;
    let d = 1.0;
    const test = new THREE.PerspectiveCamera(cam.fov, cam.aspect, 0.01, 50);
    for (let iter = 0; iter < 6; iter++) {
      test.position.copy(target).addScaledVector(dir, d);
      test.lookAt(target);
      test.updateMatrixWorld();
      test.updateProjectionMatrix();
      let maxR = 0;
      const v = new THREE.Vector3();
      for (const p of points) {
        v.copy(p).project(test);
        maxR = Math.max(maxR, Math.abs(v.x), Math.abs(v.y));
      }
      if (maxR < 1e-6) break;
      const scale = maxR / margin;
      if (Math.abs(scale - 1) < 0.02) break;
      d *= scale;
    }
    return d;
  }
}
