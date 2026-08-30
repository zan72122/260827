import * as THREE from 'three';

/**
 * Automatic camera chain. The child never controls the camera: every shot is
 * declared as "stand here, look at this, and make THIS MUCH of the world fill
 * the width of the screen", which keeps the framing identical on a narrow
 * phone and on a wide tablet.
 */
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.aspect = 1;
    this.cur = { pos: new THREE.Vector3(), look: new THREE.Vector3(), frame: 1, bias: 0.2, shake: 1, vfit: 0.45 };
    this.from = { pos: new THREE.Vector3(), look: new THREE.Vector3(), frame: 1, bias: 0.2, shake: 1, vfit: 0.45 };
    this.shot = null;
    this.t = 1; this.dur = 1;
    this._p = new THREE.Vector3();
    this._l = new THREE.Vector3();
    this.kickAmt = 0;
    this.kickT = 0;
  }

  _eval(shot, out) {
    const p = typeof shot.pos === 'function' ? shot.pos() : shot.pos;
    const l = typeof shot.look === 'function' ? shot.look() : shot.look;
    out.pos.copy(p); out.look.copy(l);
    out.frame = typeof shot.frame === 'function' ? shot.frame() : shot.frame;
    out.bias = shot.bias ?? 0.2;
    out.shake = shot.shake ?? 1;
    out.vfit = shot.vfit ?? 0.45;      // half of the vertical extent, as a fraction of frame
    return out;
  }

  cut(shot) {
    this.shot = shot;
    this._eval(shot, this.cur);
    this.from.pos.copy(this.cur.pos); this.from.look.copy(this.cur.look);
    this.from.frame = this.cur.frame; this.from.bias = this.cur.bias;
    this.from.shake = this.cur.shake; this.from.vfit = this.cur.vfit;
    this.t = 1; this.dur = 1;
  }

  move(shot, dur) {
    this.from.pos.copy(this.cur.pos);
    this.from.look.copy(this.cur.look);
    this.from.frame = this.cur.frame;
    this.from.bias = this.cur.bias;
    this.from.shake = this.cur.shake;
    this.from.vfit = this.cur.vfit;
    this.shot = shot;
    this.t = 0;
    this.dur = Math.max(0.0001, dur);
  }

  get settled() { return this.t >= 1; }

  /** A small, decaying shove — used on each puff so the bubble has impact. */
  kick(amount) { this.kickAmt = Math.min(1, this.kickAmt + amount); this.kickT = 0; }

  update(dt, time) {
    if (!this.shot) return;
    this.t = Math.min(1, this.t + dt / this.dur);
    const e = easeInOut(this.t);

    const dst = this._eval(this.shot, { pos: this._p, look: this._l, frame: 0, bias: 0, shake: 1, vfit: 0.45 });
    this.cur.pos.lerpVectors(this.from.pos, dst.pos, e);
    this.cur.look.lerpVectors(this.from.look, dst.look, e);
    this.cur.frame = this.from.frame + (dst.frame - this.from.frame) * e;
    this.cur.bias = this.from.bias + (dst.bias - this.from.bias) * e;
    this.cur.shake = this.from.shake + (dst.shake - this.from.shake) * e;
    this.cur.vfit = this.from.vfit + (dst.vfit - this.from.vfit) * e;

    const dist = Math.max(0.02, this.cur.pos.distanceTo(this.cur.look));

    // Fit the requested world width across the screen, but never let a narrow
    // phone turn that into a fisheye: the vertical extent is capped too, so a
    // portrait screen crops the sides instead of swallowing floor and ceiling.
    const halfW = this.cur.frame * 0.5;
    const fovW = 2 * Math.atan(halfW / (this.aspect * dist));
    const fovH = 2 * Math.atan((this.cur.frame * this.cur.vfit) / dist);
    let fov = Math.min(fovW, fovH) * 180 / Math.PI;
    fov = Math.min(70, Math.max(16, fov));
    if (Math.abs(fov - this.cam.fov) > 0.01) { this.cam.fov = fov; this.cam.updateProjectionMatrix(); }

    // a little life, scaled with the shot so macro shots never get seasick
    this.kickT += dt;
    const kick = this.kickAmt * Math.exp(-9 * this.kickT) * Math.cos(this.kickT * 34);
    this.kickAmt *= Math.exp(-2.4 * dt);
    const amp = 0.0022 * dist * this.cur.shake;
    const bx = Math.sin(time * 0.62) * 0.6 + Math.sin(time * 1.31 + 1.7) * 0.4;
    const by = Math.sin(time * 0.47 + 2.1) * 0.6 + Math.sin(time * 1.13) * 0.4;
    this.cam.position.set(
      this.cur.pos.x + bx * amp,
      this.cur.pos.y + by * amp + kick * dist * 0.016,
      this.cur.pos.z + bx * by * amp * 0.6 - kick * dist * 0.010
    );

    // put the subject above the middle so the child's finger never covers it
    const half = Math.tan(fov * Math.PI / 360) * dist;
    this._l.copy(this.cur.look);
    this._l.y -= this.cur.bias * half;
    this.cam.lookAt(this._l);
  }
}
