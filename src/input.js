/**
 * One finger, whole screen. There is no small hit target anywhere in this
 * game: every gesture is read from the entire canvas, so a four-year-old
 * cannot miss. Extra fingers are ignored rather than fighting the first one.
 */
export class Input {
  constructor(el) {
    this.el = el;
    this.id = null;
    this.down = false;
    this.downTime = 0;
    this.x = 0; this.y = 0;
    this.startX = 0; this.startY = 0;
    this.moved = 0;
    this.dxFrame = 0;      // px moved horizontally since the last frame
    this.upFrame = 0;      // px moved upward since the last frame
    this.speed = 0;        // smoothed |dx| per second, for the rolling sound
    this.anyInputAt = -1e9;
    this.tapped = false;
    this.onFirstTouch = null;

    const opt = { passive: false };
    el.addEventListener('pointerdown', (e) => this._down(e), opt);
    el.addEventListener('pointermove', (e) => this._move(e), opt);
    el.addEventListener('pointerup', (e) => this._up(e), opt);
    el.addEventListener('pointercancel', (e) => this._up(e), opt);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('touchstart', (e) => e.preventDefault(), opt);
    el.addEventListener('touchmove', (e) => e.preventDefault(), opt);
  }

  _down(e) {
    if (this.id !== null) return;               // one finger only
    e.preventDefault();
    this.id = e.pointerId;
    try { this.el.setPointerCapture(e.pointerId); } catch (_) {}
    this.down = true;
    this.downTime = performance.now() / 1000;
    this.x = this.startX = e.clientX;
    this.y = this.startY = e.clientY;
    this.moved = 0;
    this.anyInputAt = this.downTime;
    if (this.onFirstTouch) { this.onFirstTouch(); this.onFirstTouch = null; }
  }

  _move(e) {
    if (e.pointerId !== this.id) return;
    e.preventDefault();
    const dx = e.clientX - this.x;
    const dy = e.clientY - this.y;
    this.x = e.clientX; this.y = e.clientY;
    this.dxFrame += dx;
    if (dy < 0) this.upFrame += -dy;            // only upward counts as breath
    this.moved += Math.abs(dx) + Math.abs(dy);
    this.anyInputAt = performance.now() / 1000;
  }

  _up(e) {
    if (e.pointerId !== this.id) return;
    e.preventDefault();
    const dur = performance.now() / 1000 - this.downTime;
    if (this.moved < 18 && dur < 0.45) this.tapped = true;
    this.id = null;
    this.down = false;
    this.anyInputAt = performance.now() / 1000;
  }

  // Gestures are measured as a fraction of the screen and then expressed in
  // the pixels of a reference phone, so "half a screen wide" asks for the same
  // work on a small handset and on a tablet.
  static REF_W = 390;
  static REF_H = 844;

  /** Horizontal travel since the previous frame, in reference px. */
  takeDX() {
    const v = this.dxFrame * (Input.REF_W / Math.max(240, window.innerWidth));
    this.dxFrame = 0;
    return v;
  }

  /** Upward travel since the previous frame, in reference px. */
  takeUp() {
    const v = this.upFrame * (Input.REF_H / Math.max(360, window.innerHeight));
    this.upFrame = 0;
    return v;
  }
  takeTap() { const v = this.tapped; this.tapped = false; return v; }

  holdTime() { return this.down ? performance.now() / 1000 - this.downTime : 0; }
  idleFor() { return performance.now() / 1000 - this.anyInputAt; }

  updateSpeed(dt, dxPixels) {
    const inst = Math.abs(dxPixels) / Math.max(dt, 1 / 120);
    this.speed += (inst - this.speed) * Math.min(1, dt * 8);
  }
}
