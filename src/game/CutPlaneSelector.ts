import * as THREE from 'three';
import { TAU } from '../core/rng';
import { CAKE, cutAngle } from './CakeSpec';

export interface CutPlanes {
  a0: number;
  a1: number;
  /** Oriented so the normal points into the wedge that gets lifted out. */
  planeA: THREE.Plane;
  planeB: THREE.Plane;
  /** Outward directions the two cuts travelled from the middle. */
  reachA: THREE.Vector3;
  reachB: THREE.Vector3;
}

/**
 * CutPlaneSelector — the child runs one finger along the top edge and the knife
 * settles onto one of twelve directions. Twelve is a readability decision, not a
 * shortcut: the planes are real, and which strawberries they meet is decided by
 * where those strawberries were actually put, never announced in advance.
 */
export class CutPlaneSelector {
  private idx = 0;

  get index(): number {
    return this.idx;
  }

  get angle(): number {
    return cutAngle(this.idx);
  }

  set index(value: number) {
    this.idx = ((value % CAKE.cutDirections) + CAKE.cutDirections) % CAKE.cutDirections;
  }

  /** Snap to the direction nearest a point on the cake's top surface. */
  aimAt(x: number, z: number): boolean {
    const a = Math.atan2(z, x);
    const step = TAU / CAKE.cutDirections;
    const next = Math.round(a / step);
    const before = this.idx;
    this.index = next;
    return this.idx !== before;
  }

  planes(): CutPlanes {
    const a0 = this.angle;
    const a1 = a0 + CAKE.wedgeSpan;
    // A plane through the axis at angle a has a tangential normal.
    const nA = new THREE.Vector3(-Math.sin(a0), 0, Math.cos(a0));
    const nB = new THREE.Vector3(Math.sin(a1), 0, -Math.cos(a1));
    return {
      a0,
      a1,
      planeA: new THREE.Plane(nA, 0),
      planeB: new THREE.Plane(nB, 0),
      reachA: new THREE.Vector3(Math.cos(a0), 0, Math.sin(a0)),
      reachB: new THREE.Vector3(Math.cos(a1), 0, Math.sin(a1)),
    };
  }
}
