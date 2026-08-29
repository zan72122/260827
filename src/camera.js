import { ease } from './rng.js';

// 工程ごとに構図が決まっているカメラ。自由カメラは持たない。
// 「いま何をしているか」と「何が変わったか」が同時に見える位置を各段階で指定する。
export class Camera {
  constructor() {
    this.x = 0; this.y = 0; this.zoom = 1;
    this.fromX = 0; this.fromY = 0; this.fromZoom = 1;
    this.toX = 0; this.toY = 0; this.toZoom = 1;
    this.t = 1; this.dur = 1;
    this.onSettle = null;
    this._settled = true;
  }
  snap(x, y, zoom) {
    this.x = this.fromX = this.toX = x;
    this.y = this.fromY = this.toY = y;
    this.zoom = this.fromZoom = this.toZoom = zoom;
    this.t = 1; this._settled = false;
  }
  moveTo(x, y, zoom, dur = 0.85) {
    if (Math.abs(x - this.toX) < 0.5 && Math.abs(y - this.toY) < 0.5 && Math.abs(zoom - this.toZoom) < 0.005) return;
    this.fromX = this.x; this.fromY = this.y; this.fromZoom = this.zoom;
    this.toX = x; this.toY = y; this.toZoom = zoom;
    this.t = 0; this.dur = dur; this._settled = false;
  }
  update(dt) {
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt / this.dur);
      const e = ease(this.t);
      this.x = this.fromX + (this.toX - this.fromX) * e;
      this.y = this.fromY + (this.toY - this.fromY) * e;
      this.zoom = this.fromZoom + (this.toZoom - this.fromZoom) * e;
      if (this.t >= 1) this._settled = false;
    }
    if (!this._settled && this.t >= 1) {
      this._settled = true;
      if (this.onSettle) this.onSettle();
      return true;
    }
    return false;
  }
  get moving() { return this.t < 1; }
  apply(ctx, W, H, dpr) {
    ctx.setTransform(dpr * this.zoom, 0, 0, dpr * this.zoom,
      dpr * (W / 2 - this.x * this.zoom), dpr * (H / 2 - this.y * this.zoom));
  }
  toScreen(x, y, W, H) {
    return { x: W / 2 + (x - this.x) * this.zoom, y: H / 2 + (y - this.y) * this.zoom };
  }
  toWorld(sx, sy, W, H) {
    return { x: (sx - W / 2) / this.zoom + this.x, y: (sy - H / 2) / this.zoom + this.y };
  }
  visibleRect(W, H) {
    const hw = W / 2 / this.zoom, hh = H / 2 / this.zoom;
    return { x0: this.x - hw, y0: this.y - hh, x1: this.x + hw, y1: this.y + hh };
  }
}
