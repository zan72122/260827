import * as THREE from 'three';

export interface FrameState {
  /** journeyProgress 0..1 */
  p: number;
  /** arc length along path (m) */
  s: number;
  /** bag speed along path (m/s, signed) */
  speed: number;
  dt: number;
  time: number;
  bagPos: THREE.Vector3;
  /** 0..1 idle-hint strength (finger idle >3s) */
  hint: number;
}

export interface Segment {
  group: THREE.Group;
  /** progress range in which this segment must be visible */
  range: [number, number];
  update?: (st: FrameState) => void;
}
