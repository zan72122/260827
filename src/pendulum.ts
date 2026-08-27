import * as THREE from 'three';
import { clamp, rotateByAngularVelocity } from './math';

const G = 9.81;

/**
 * Spherical pendulum: the ball is always on a sphere of radius `length`
 * around `pivot`. State is a unit direction (pivot -> ball) plus an angular
 * velocity vector perpendicular to it. While the player drags, the ball is
 * pulled toward a target direction on the same sphere by a damped spring, so
 * the finger never detaches the ball from its rope arc and small jitter is
 * absorbed by the mass of the ball.
 */
export class Pendulum {
  readonly pivot = new THREE.Vector3();
  length: number;
  /** unit vector pivot -> ball */
  readonly dir = new THREE.Vector3(0, -1, 0);
  /** angular velocity (rad/s), perpendicular to dir */
  readonly omega = new THREE.Vector3();

  /** true while the finger holds the ball */
  dragging = false;
  private readonly dragTarget = new THREE.Vector3(0, -1, 0);

  private readonly tmpV = new THREE.Vector3();
  private readonly tmpV2 = new THREE.Vector3();
  private readonly tmpV3 = new THREE.Vector3();

  constructor(pivot: THREE.Vector3, length: number) {
    this.pivot.copy(pivot);
    this.length = length;
  }

  ballPosition(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.dir).multiplyScalar(this.length).add(this.pivot);
  }

  /** Linear velocity of the ball (m/s). */
  ballVelocity(out: THREE.Vector3): THREE.Vector3 {
    // v = omega x (dir * L)
    out.copy(this.omega).cross(this.tmpV.copy(this.dir).multiplyScalar(this.length));
    return out;
  }

  speed(): number {
    return this.omega.length() * this.length;
  }

  startDrag(): void {
    this.dragging = true;
    this.dragTarget.copy(this.dir);
  }

  /** Set the constrained target direction (unit, pivot->ball). */
  setDragTarget(dirUnit: THREE.Vector3): void {
    this.dragTarget.copy(dirUnit).normalize();
  }

  endDrag(): void {
    this.dragging = false;
    // clamp release speed so a wild fling stays a heavy, plausible swing
    const maxOmega = 1.65; // rad/s -> tip speed ~ 12 m/s at L=7.4
    if (this.omega.length() > maxOmega) this.omega.setLength(maxOmega);
  }

  /** Set linear velocity directly (used for impact response). */
  setBallVelocity(v: THREE.Vector3): void {
    // omega = (dir x v) / L
    this.omega.copy(this.dir).cross(v).multiplyScalar(1 / this.length);
  }

  step(dt: number): void {
    if (this.dragging) {
      // damped spring toward target on the sphere; the lag is the ball's mass
      const axis = this.tmpV.copy(this.dir).cross(this.dragTarget);
      const s = clamp(axis.length(), -1, 1);
      const angle = Math.asin(s) + (this.dir.dot(this.dragTarget) < 0 ? Math.PI / 2 : 0);
      if (s > 1e-6) {
        axis.multiplyScalar(1 / s);
        const kp = 34; // spring strength: heavy but responsive
        const kd = 9.5; // damping: near-critical, kills finger jitter
        this.tmpV2.copy(axis).multiplyScalar(kp * angle);
        this.tmpV3.copy(this.omega).multiplyScalar(kd);
        this.omega.addScaledVector(this.tmpV2.sub(this.tmpV3), dt);
      } else {
        this.omega.multiplyScalar(Math.max(0, 1 - 9.5 * dt));
      }
      // gravity still tugs a little during the hold (rope feel)
      this.tmpV.copy(this.dir).cross(this.tmpV2.set(0, -G * 0.25, 0)).multiplyScalar(1 / this.length);
      this.omega.addScaledVector(this.tmpV, dt);
    } else {
      // alpha = (dir x g) / L, restoring toward the vertical
      this.tmpV.copy(this.dir).cross(this.tmpV2.set(0, -G, 0)).multiplyScalar(1 / this.length);
      this.omega.addScaledVector(this.tmpV, dt);
      // light air/bearing damping
      this.omega.multiplyScalar(Math.max(0, 1 - 0.055 * dt));
    }
    rotateByAngularVelocity(this.dir, this.omega, dt);
    this.dir.normalize();
    // keep omega tangent to the sphere
    const radial = this.tmpV.copy(this.dir).multiplyScalar(this.omega.dot(this.dir));
    this.omega.sub(radial);
  }
}
