// カメラは「見せたいものを画面に収める」宣言で書き、常にゆっくり寄る。
// 画面比が縦でも横でも同じ体験になるよう、必要な幅と奥行きから距離を計算する。
import * as THREE from './three.js';
import { damp } from './anim.js';

const D2R = Math.PI / 180;

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.targetPos = new THREE.Vector3();
    this.targetLook = new THREE.Vector3();
    this.lambda = 2.4;
    this.view = null;
    this.t = 0;
    this._tmp = new THREE.Vector3();
  }

  /** view: { look:Vec3, pitch:deg, yaw:deg, fitW:cm, fitD:cm, margin } */
  set(view, lambda = 2.4) {
    this.view = view;
    this.lambda = lambda;
    this.recompute();
  }

  recompute() {
    const v = this.view;
    if (!v) return;
    const cam = this.camera;
    const t = Math.tan((cam.fov * 0.5) * D2R);
    const aspect = cam.aspect;
    const pitch = v.pitch * D2R;
    const yaw = (v.yaw || 0) * D2R;

    const halfW = v.fitW * 0.5;
    const halfScreenV = (v.fitD !== undefined ? v.fitD : v.fitW) * 0.5 * Math.sin(pitch);
    const dH = halfW / (t * aspect);
    const dV = halfScreenV / t;
    const dist = Math.max(dH, dV) * (v.margin !== undefined ? v.margin : 1.16);

    this.targetLook.copy(v.look);
    this.targetPos.set(
      v.look.x + Math.sin(yaw) * Math.cos(pitch) * dist,
      v.look.y + Math.sin(pitch) * dist,
      v.look.z + Math.cos(yaw) * Math.cos(pitch) * dist
    );
  }

  snap() {
    this.recompute();
    this.pos.copy(this.targetPos);
    this.look.copy(this.targetLook);
    this.apply(0);
  }

  update(dt) {
    this.t += dt;
    const k = 1 - Math.exp(-this.lambda * dt);
    this.pos.lerp(this.targetPos, k);
    this.look.lerp(this.targetLook, k);
    this.apply(this.t);
  }

  apply(time) {
    // ごくわずかな呼吸。止まって見えないだけで、目立たせない。
    const bx = Math.sin(time * 0.31) * 0.22;
    const by = Math.sin(time * 0.24 + 1.1) * 0.16;
    this.camera.position.set(this.pos.x + bx, this.pos.y + by, this.pos.z);
    this._tmp.copy(this.look);
    this.camera.lookAt(this._tmp);
  }
}

export function v3(x, y, z) { return new THREE.Vector3(x, y, z); }
