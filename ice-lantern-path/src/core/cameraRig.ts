import * as THREE from 'three';

export interface Shot {
  /** point the camera looks at */
  target: THREE.Vector3;
  /** direction from target towards the camera (does not need to be normalised) */
  dir: THREE.Vector3;
  /** half width of the area that must stay inside the frame (metres) */
  halfW: number;
  /** half height of the area that must stay inside the frame (metres) */
  halfH: number;
  fov?: number;
  /** portrait usually needs a wider lens to keep the subject close */
  fovPortrait?: number;
  /** never dolly closer than this (keeps perspective from going fish-eye) */
  minDist?: number;
  maxDist?: number;
  /** extra vertical framing offset, positive pushes the subject down the screen */
  bias?: number;
  /** portrait-only multiplier on the framing radius */
  portraitPad?: number;
  landscapePad?: number;
  /** portrait re-composition: tall frames want depth, not lateral spread */
  portrait?: Partial<Pick<Shot, 'target' | 'dir' | 'halfW' | 'halfH' | 'bias' | 'minDist' | 'maxDist'>>;
}

const _dir = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _probe = new THREE.PerspectiveCamera();
const _ray = new THREE.Raycaster();
const _v2 = new THREE.Vector2();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/**
 * Fixed, authored shots. The player never controls the camera; the rig only
 * re-frames so the working subject stays fully visible in both orientations.
 */
export class CameraRig {
  camera: THREE.PerspectiveCamera;
  shot: Shot;
  private target = new THREE.Vector3();
  private pos = new THREE.Vector3();
  private aspect = 1;
  private viewH = 1;
  /** 0..1, how quickly the rig eases; 1 = snap */
  private ease = 0.9;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 120);
    this.shot = {
      target: new THREE.Vector3(0, 0.9, 0),
      dir: new THREE.Vector3(0, 0.6, 1),
      halfW: 1,
      halfH: 1,
    };
    this.target.copy(this.shot.target);
    this.pos.copy(this.shot.target).add(new THREE.Vector3(0, 0.6, 2));
    this.camera.position.copy(this.pos);
  }

  setViewport(w: number, h: number) {
    this.aspect = w / h;
    this.viewH = h;
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
  }

  get viewportHeight() {
    return this.viewH;
  }

  get portrait() {
    return this.aspect < 1;
  }

  setShot(shot: Shot, immediate = false) {
    this.shot = shot;
    if (immediate) {
      this.computeDesired(_desired);
      this.pos.copy(_desired);
      this.target.copy(this.frameTarget());
      this.camera.position.copy(this.pos);
      this.camera.lookAt(this.target);
    }
  }

  private get s(): Shot {
    if (this.portrait && this.shot.portrait) return { ...this.shot, ...this.shot.portrait } as Shot;
    return this.shot;
  }

  private frameTarget() {
    const sh = this.s;
    const t = sh.target.clone();
    // In portrait there is more room above/below: nudge the subject down a
    // little so the top instruction chip never sits on top of it.
    const bias = sh.bias ?? 0;
    t.y += this.portrait ? bias * 1.35 : bias;
    return t;
  }

  private computeDesired(out: THREE.Vector3) {
    const sh = this.s;
    const fov = this.portrait ? sh.fovPortrait ?? (sh.fov ?? 42) + 10 : sh.fov ?? 42;
    if (Math.abs(this.camera.fov - fov) > 0.001) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    const pad = this.portrait ? sh.portraitPad ?? 1.1 : sh.landscapePad ?? 1.06;
    const vFov = (fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.aspect);
    const distV = (sh.halfH * pad) / Math.tan(vFov / 2);
    const distH = (sh.halfW * pad) / Math.tan(hFov / 2);
    let dist = Math.max(distV, distH);
    if (sh.minDist) dist = Math.max(dist, sh.minDist);
    if (sh.maxDist) dist = Math.min(dist, sh.maxDist);
    _dir.copy(sh.dir).normalize();
    out.copy(this.frameTarget()).addScaledVector(_dir, dist);
    return out;
  }

  /**
   * Where a given screen position lands on a horizontal plane once this shot
   * has settled. Tools are placed through this, so "bottom left of the frame"
   * means the same thing on a phone in portrait and a tablet in landscape.
   */
  planePointForScreen(ndcX: number, ndcY: number, planeY: number, out = new THREE.Vector3()) {
    const sh = this.s;
    _probe.fov = this.portrait ? sh.fovPortrait ?? (sh.fov ?? 42) + 10 : sh.fov ?? 42;
    _probe.aspect = this.aspect;
    _probe.near = 0.05;
    _probe.far = 120;
    _probe.updateProjectionMatrix();
    this.computeDesired(_desired);
    _probe.position.copy(_desired);
    _probe.lookAt(this.frameTarget());
    _probe.updateMatrixWorld(true);
    _v2.set(ndcX, ndcY);
    _ray.setFromCamera(_v2, _probe);
    _plane.constant = -planeY;
    return _ray.ray.intersectPlane(_plane, out) ? out : out.set(0, planeY, 0);
  }

  update(dt: number) {
    this.computeDesired(_desired);
    const k = 1 - Math.pow(1 - this.ease, dt * 60 * 0.06);
    this.pos.lerp(_desired, k);
    this.target.lerp(this.frameTarget(), k);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.target);
  }
}
