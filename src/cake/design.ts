import * as THREE from 'three';
import { Berry, makeBerryParams, type BerryParams } from './berry';
import { Rng } from '../util/rng';

/** All dimensions in centimetres. A 15 cm round cake, 5.7 cm tall. */
export const CAKE = {
  radius: 7.5,
  coreRadius: 7.2,
  wedgeAngle: Math.PI / 4,
  /** The cut can be aimed at any of these 24 detents. */
  cutSteps: 24,
  sponge1: { y0: 0, y1: 1.55 },
  filling: { y0: 1.55, y1: 3.75 },
  sponge2: { y0: 3.75, y1: 5.3 },
  topCoat: { y0: 5.3, y1: 5.7 },
  /** Thin cream skim the berries are set into. */
  skim: 0.26,
  boardRadius: 8.7,
  boardThickness: 0.5,
} as const;

export type Pose = 'flatTipOut' | 'flatTipIn' | 'faceOut' | 'tilt';
export const POSES: Pose[] = ['flatTipOut', 'faceOut', 'tilt', 'flatTipIn'];

export interface Slot {
  index: number;
  angle: number;
  radius: number;
}

export const SLOTS: Slot[] = (() => {
  const list: Slot[] = [];
  for (let i = 0; i < 8; i++) list.push({ index: i, angle: (i / 8) * Math.PI * 2, radius: 4.4 });
  list.push({ index: 8, angle: 0, radius: 0 });
  return list;
})();

export interface Placement {
  slot: number;
  pose: Pose;
  params: BerryParams;
  /** Half thickness of the lengthwise slice. */
  slab: number;
  /** Small natural yaw jitter, radians. */
  jitter: number;
  berry: Berry;
}

export interface Design {
  placements: Placement[];
  /** 0 = bare gaps, 1 = fully piped. */
  fill: number;
}

/** Basis for a slot: radial, tangential, up. */
function slotFrame(slot: Slot) {
  const R = new THREE.Vector3(Math.cos(slot.angle), 0, Math.sin(slot.angle));
  const T = new THREE.Vector3(-Math.sin(slot.angle), 0, Math.cos(slot.angle));
  const U = new THREE.Vector3(0, 1, 0);
  return { R, T, U };
}

/** Rotation that realises a pose. Local +Y is the berry axis, +Z the slice face. */
export function poseQuaternion(slot: Slot, pose: Pose, jitter: number): THREE.Quaternion {
  const { R, T, U } = slotFrame(slot);
  const m = new THREE.Matrix4();
  const x = new THREE.Vector3();
  const y = new THREE.Vector3();
  const z = new THREE.Vector3();
  switch (pose) {
    case 'flatTipOut':
      x.copy(T).negate(); y.copy(R).negate(); z.copy(U);
      break;
    case 'flatTipIn':
      x.copy(T); y.copy(R); z.copy(U);
      break;
    case 'faceOut':
      x.copy(U); y.copy(T); z.copy(R);
      break;
    case 'tilt':
      x.copy(T).negate(); y.copy(R).negate(); z.copy(U);
      break;
  }
  m.makeBasis(x, y, z);
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  if (pose === 'tilt') {
    // Lift the tip so the slice leans against its neighbour.
    q.premultiply(new THREE.Quaternion().setFromAxisAngle(T, -0.62));
  }
  q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), jitter));
  return q;
}

/** Vertical extent of a placed slice, used to seat it on the skim of cream. */
export function placedHeight(p: Placement): { min: number; max: number } {
  const q = poseQuaternion(SLOTS[p.slot], p.pose, p.jitter);
  const hl = p.berry.halfLength;
  const r = p.berry.p.radius * 1.05;
  const t = p.slab;
  const v = new THREE.Vector3();
  let min = Infinity;
  let max = -Infinity;
  for (const sx of [-r, r]) {
    for (const sy of [-hl, hl]) {
      for (const sz of [-t, t]) {
        v.set(sx, sy, sz).applyQuaternion(q);
        min = Math.min(min, v.y);
        max = Math.max(max, v.y);
      }
    }
  }
  return { min, max };
}

export function placementMatrix(p: Placement, sink = 0): THREE.Matrix4 {
  const slot = SLOTS[p.slot];
  const q = poseQuaternion(slot, p.pose, p.jitter);
  const { min } = placedHeight(p);
  const restY = CAKE.filling.y0 + CAKE.skim * 0.55 - min - sink;
  const pos = new THREE.Vector3(
    Math.cos(slot.angle) * slot.radius,
    restY,
    Math.sin(slot.angle) * slot.radius
  );
  return new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1));
}

export function makePlacement(slot: number, pose: Pose, rng: Rng, sizeBias = 1): Placement {
  const params = makeBerryParams(rng, 1);
  params.length = rng.range(3.0, 3.9) * sizeBias;
  params.radius = rng.range(0.80, 1.0) * sizeBias;
  return {
    slot,
    pose,
    params,
    slab: rng.range(0.42, 0.55),
    jitter: rng.range(-0.13, 0.13),
    berry: new Berry(params),
  };
}

/** The pâtissier's own arrangement, used for the cake the player first cuts. */
export function chefDesign(seed = 20260829): Design {
  const rng = new Rng(seed);
  const poses: Pose[] = ['flatTipOut', 'faceOut', 'flatTipOut', 'tilt', 'flatTipOut', 'faceOut', 'flatTipOut', 'tilt'];
  const placements: Placement[] = [];
  for (let i = 0; i < 8; i++) {
    placements.push(makePlacement(i, poses[i], rng, i % 2 === 0 ? 1.06 : 0.92));
  }
  placements.push(makePlacement(8, 'faceOut', rng, 1.0));
  return { placements, fill: 1 };
}
