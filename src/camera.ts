import * as THREE from 'three';

// ---------------------------------------------------------------------------
// 演出カメラ。ショットは「毎フレーム望ましい位置・注視点を計算する関数」で、
// 現在値はそこへ臨界減衰風に追従する。縦画面では一頭を大きく・そり方向を
// 画面上部へ、横画面では編成全体を横長に収める。
// ---------------------------------------------------------------------------

export type ShotFn = (portrait: boolean, out: { pos: THREE.Vector3; look: THREE.Vector3; fov: number }) => void;

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  /** true の間は望ましい位置の再計算を止める（ドラッグ中の凍結） */
  frozen = false;
  private shot: ShotFn | null = null;
  private pos = new THREE.Vector3(4, 2, 6);
  private look = new THREE.Vector3(0, 1, 0);
  private fov = 50;
  private speed = 2.2;
  portrait = false;
  private desired = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 50 };

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 400);
    this.camera.position.copy(this.pos);
    this.portrait = aspect < 1;
  }

  setShot(fn: ShotFn, snap = false, speed = 2.2): void {
    this.shot = fn;
    this.speed = speed;
    if (snap) {
      this.shot(this.portrait, this.desired);
      this.pos.copy(this.desired.pos);
      this.look.copy(this.desired.look);
      this.fov = this.desired.fov;
    }
  }

  update(dt: number): void {
    if (this.shot) {
      if (!this.frozen) this.shot(this.portrait, this.desired);
      const k = 1 - Math.exp(-dt * this.speed);
      this.pos.lerp(this.desired.pos, k);
      this.look.lerp(this.desired.look, k);
      this.fov += (this.desired.fov - this.fov) * k;
    }
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
    if (Math.abs(this.camera.fov - this.fov) > 0.05) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.portrait = aspect < 1;
    this.camera.updateProjectionMatrix();
  }
}
