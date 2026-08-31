import * as THREE from 'three';
import { wrapPi } from '../core/units';
import type { Mechanism } from '../mech/mechanism';
import type { TreeModel } from '../render/tree';
import type { PointerSample, PointerSink } from '../input/pointerRouter';
import { distToSegment, metresPerPixel, toScreen, type Viewport } from './screen';

/** The winding grip is always at least this wide on screen, in CSS pixels. */
export const GRIP_MIN_PX = 64;
/** Inside this radius of the axis the angle is meaningless, so it is frozen. */
export const DEAD_RADIUS_PX = 26;
/** The grip is around the foot of the trunk, not out at the branch tips. */
export const GRIP_LOW_MM = 4;
export const GRIP_HIGH_MM = 150;
const GRIP_RADIUS_M = 0.082;

export interface WindCallbacks {
  onGrab(): void;
  onRelease(): void;
  onRatchet(count: number, slipping: boolean): void;
}

/**
 * 巻き上げ — take hold low down and turn.
 *
 * The angle is measured around the tree's own axis where it appears on screen.
 * Short tangential strokes add up, because the wind that is already stored is
 * never reset: letting go and taking hold again keeps every turn.  Crossing the
 * middle cannot flip the angle, because inside a small radius the reading is
 * simply held.
 */
export class Winder implements PointerSink {
  private centre = new THREE.Vector2();
  private prevAngle = 0;
  private hasAngle = false;
  holding = false;
  private enabled = false;
  /** last measured grip radius on screen, for the tests */
  lastGripPx = 0;

  constructor(
    private mech: Mechanism,
    private tree: TreeModel,
    private camera: THREE.PerspectiveCamera,
    private vp: Viewport,
    private cb: WindCallbacks,
  ) {}

  setEnabled(v: boolean) {
    this.enabled = v;
  }

  private gripSegment(): [THREE.Vector2, THREE.Vector2] {
    const a = toScreen(this.camera, this.tree.axisPoint(GRIP_LOW_MM), this.vp);
    const b = toScreen(this.camera, this.tree.axisPoint(GRIP_HIGH_MM), this.vp);
    return [a, b];
  }

  gripRadiusPx(): number {
    const p = this.tree.axisPoint((GRIP_LOW_MM + GRIP_HIGH_MM) / 2);
    const px = GRIP_RADIUS_M / metresPerPixel(this.camera, p, this.vp);
    this.lastGripPx = Math.max(GRIP_MIN_PX, px);
    return this.lastGripPx;
  }

  /** Is this CSS pixel on the part of the tree you wind by? */
  hits(x: number, y: number): boolean {
    const [a, b] = this.gripSegment();
    return distToSegment(new THREE.Vector2(x, y), a, b) <= this.gripRadiusPx();
  }

  onDown(p: PointerSample): boolean {
    if (!this.enabled) return false;
    if (!this.hits(p.x, p.y)) return false;
    this.centre.copy(toScreen(this.camera, this.tree.axisPoint(60), this.vp));
    this.prevAngle = Math.atan2(p.y - this.centre.y, p.x - this.centre.x);
    this.hasAngle =
      Math.hypot(p.x - this.centre.x, p.y - this.centre.y) > DEAD_RADIUS_PX;
    this.holding = true;
    this.mech.grab();
    this.cb.onGrab();
    return true;
  }

  onMove(p: PointerSample) {
    if (!this.holding) return;
    // the centre follows the tree, so the reading stays honest if the view moves
    this.centre.copy(toScreen(this.camera, this.tree.axisPoint(60), this.vp));
    const r = Math.hypot(p.x - this.centre.x, p.y - this.centre.y);
    const angle = Math.atan2(p.y - this.centre.y, p.x - this.centre.x);
    if (r <= DEAD_RADIUS_PX) {
      // over the middle: hold the reading rather than let it jump
      this.hasAngle = false;
      return;
    }
    if (!this.hasAngle) {
      this.prevAngle = angle;
      this.hasAngle = true;
      return;
    }
    const dScreen = wrapPi(angle - this.prevAngle);
    this.prevAngle = angle;
    // clockwise on screen is clockwise seen from above, which is the wind
    const ev = this.mech.applyHandTurn(-dScreen);
    if (ev.ratchetClicks > 0 || ev.slipping) this.cb.onRatchet(ev.ratchetClicks, ev.slipping);
  }

  onUp(_p: PointerSample) {
    this.finish();
  }

  onCancel(_p: PointerSample) {
    // A cancelled touch is the same as letting go: the tree starts to turn.
    this.finish();
  }

  private finish() {
    if (!this.holding) return;
    this.holding = false;
    this.hasAngle = false;
    this.mech.release();
    this.cb.onRelease();
  }
}
