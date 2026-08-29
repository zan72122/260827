import * as THREE from 'three';
import { Rng, TAU } from '../core/rng';
import { CAKE, slotAngle } from './CakeSpec';
import { orientationQuaternion, type OrientationId } from './OrientationState';

export interface Slot {
  id: number;
  angle: number;
  radius: number;
  x: number;
  z: number;
  center: boolean;
}

export interface Placement {
  slotId: number;
  variantId: string;
  orientation: OrientationId;
  /** Small per-berry lean; the cream steadies it as the gap is filled. */
  wobble: number;
  /** How far the berry has settled into the cream, in metres. */
  sink: number;
  /** Placed by the child rather than by the patissier. */
  byPlayer: boolean;
  /** Remaining drop height while the slice is still settling, in metres. */
  lift: number;
  /**
   * World height of the slice's origin, fixed the moment it is set down. The
   * cream then rises around it; a berry that floated up with the filling would
   * make the reveal disagree with what the child built.
   */
  seatY: number;
}

/**
 * PlacementRing — twelve wells around the ring plus one in the middle. There
 * are no numbered targets and no coloured discs: a well is a shallow dip in the
 * cream with its own soft shadow, and the berry is pulled into it when it comes
 * close.
 */
export class PlacementRing {
  readonly slots: Slot[] = [];
  /** Deterministic per-slot offsets so the finished ring is never mechanical. */
  private readonly offsets: { radial: number; angular: number }[] = [];

  constructor() {
    const rng = new Rng(0x21f4b);
    for (let i = 0; i < CAKE.ringSlots; i++) {
      const a = slotAngle(i);
      this.offsets.push({ radial: rng.jitter(0.0012), angular: rng.jitter(0.014) });
      const r = CAKE.ringRadius + this.offsets[i].radial;
      const aa = a + this.offsets[i].angular;
      this.slots.push({
        id: i,
        angle: a,
        radius: r,
        x: Math.cos(aa) * r,
        z: Math.sin(aa) * r,
        center: false,
      });
    }
    this.offsets.push({ radial: 0, angular: 0 });
    this.slots.push({
      id: CAKE.ringSlots,
      angle: 0,
      radius: 0,
      x: 0,
      z: 0,
      center: true,
    });
  }

  get centerSlotId(): number {
    return CAKE.ringSlots;
  }

  slot(id: number): Slot {
    return this.slots[id];
  }

  /** Nearest free well within `maxDist`; this is the whole snap behaviour. */
  nearest(x: number, z: number, maxDist: number, taken: ReadonlySet<number>): Slot | null {
    let best: Slot | null = null;
    let bestD = maxDist;
    for (const s of this.slots) {
      if (taken.has(s.id)) continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  /** Angular gap to the nearest occupied neighbour, used to space the ring. */
  neighbourGap(id: number, taken: ReadonlySet<number>): number {
    if (id === this.centerSlotId) return Math.PI;
    let gap = Math.PI;
    for (const other of taken) {
      if (other === id || other === this.centerSlotId) continue;
      const d = Math.abs(((this.slots[other].angle - this.slots[id].angle + TAU * 1.5) % TAU) - Math.PI);
      gap = Math.min(gap, Math.PI - d);
    }
    return gap;
  }
}

/** Lowest point of a rotated local box; used to seat a berry on the cream. */
export function seatOffset(box: THREE.Box3, q: THREE.Quaternion): number {
  let min = Infinity;
  const p = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    p.set(
      i & 1 ? box.max.x : box.min.x,
      i & 2 ? box.max.y : box.min.y,
      i & 4 ? box.max.z : box.min.z,
    ).applyQuaternion(q);
    if (p.y < min) min = p.y;
  }
  return min;
}

/** Highest point of a rotated local box; used to bury a slice in cream. */
export function topOffset(box: THREE.Box3, q: THREE.Quaternion): number {
  let max = -Infinity;
  const p = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    p.set(
      i & 1 ? box.max.x : box.min.x,
      i & 2 ? box.max.y : box.min.y,
      i & 4 ? box.max.z : box.min.z,
    ).applyQuaternion(q);
    if (p.y > max) max = p.y;
  }
  return max;
}

export interface Seated {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

/** Height at which a slice rests on the cream as it is now, for this facing. */
export function computeSeatY(
  slot: Slot,
  orientation: OrientationId,
  sink: number,
  localBox: THREE.Box3,
  creamTopAt: (x: number, z: number) => number,
): number {
  const q = orientationQuaternion(orientation, slot.angle, 0);
  return creamTopAt(slot.x, slot.z) - sink - seatOffset(localBox, q);
}

/**
 * Where a placement actually lives in the cake. This is the single source of
 * truth: the assembled cake, the clipped wedge and the section caps are all
 * derived from it, so the reveal cannot disagree with the placement.
 */
export function seatPlacement(slot: Slot, placement: Placement): Seated {
  const q = orientationQuaternion(placement.orientation, slot.angle, placement.wobble);
  return {
    position: new THREE.Vector3(slot.x, placement.seatY + placement.lift, slot.z),
    quaternion: q,
  };
}
