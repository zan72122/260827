import * as THREE from 'three';
import { mm } from '../core/units';
import { clamp } from '../util/math';
import { mergeAll, roundedBox, taperedCapsule } from './geometry';
import type { Materials } from '../render/materials';

/**
 * Adult hands, entering from the edge of the frame.
 *
 * There is no face and no body: what matters is that the tool is genuinely
 * inside the fingers. So rather than posing the fingers by eye, each finger's
 * curl is solved so the fingertip lands on the surface of the thing being held.
 * A tool can then never float.
 *
 * Canonical frame: the axis of whatever is being gripped runs along local Z
 * through the origin; the palm sits above it, the fingers wrap down around it,
 * and the forearm runs off towards -X.
 */

interface FingerSpec {
  z: number;
  lengths: [number, number, number];
  radius: number;
  base: number;
}

/**
 * Index, middle, ring, little. `radius` is the radius of one segment, so an
 * adult finger comes out about 18 mm across.
 */
const FINGERS: FingerSpec[] = [
  { z: mm(28.5), lengths: [mm(40), mm(25), mm(19)], radius: mm(9.1), base: 0.30 },
  { z: mm(9.6), lengths: [mm(44), mm(27), mm(20)], radius: mm(9.5), base: 0.26 },
  { z: mm(-9.6), lengths: [mm(41), mm(25), mm(19)], radius: mm(9.0), base: 0.29 },
  { z: mm(-28), lengths: [mm(33), mm(20), mm(16)], radius: mm(7.9), base: 0.38 },
];

/**
 * How far behind the tool each finger settles.
 *
 * A hand wrapped round a piping bag closes almost evenly. A hand holding a
 * flower nail does something quite different: thumb and forefinger pinch the
 * shaft and the remaining fingers stay loosely curled underneath, which is what
 * lets the nail be spun. Same geometry, two poses.
 */
const POSE_SLACK: Record<'grip' | 'pinch', number[]> = {
  grip: [mm(0), mm(1.6), mm(3.2), mm(5.0)],
  pinch: [mm(0), mm(11), mm(18), mm(24)],
};

const PALM_CENTRE = new THREE.Vector3(mm(-14), mm(30), 0);
const PALM = { length: mm(92), thickness: mm(23), width: mm(80) };

function fingerTipRadius(spec: FingerSpec, scale: number): { tip: THREE.Vector2; joints: THREE.Vector2[] } {
  const start = new THREE.Vector2(PALM_CENTRE.x + PALM.length * 0.5 - mm(6), PALM_CENTRE.y);
  const curls = [1.02 * scale, 1.14 * scale, 0.86 * scale];
  let angle = -spec.base;
  let p = start.clone();
  const joints = [p.clone()];
  for (let i = 0; i < 3; i++) {
    angle -= curls[i];
    p = p.clone().add(new THREE.Vector2(Math.cos(angle) * spec.lengths[i], Math.sin(angle) * spec.lengths[i]));
    joints.push(p.clone());
  }
  return { tip: p, joints };
}

/** Close the fingers until the tips sit on a cylinder of the given radius. */
function solveCurl(spec: FingerSpec, gripRadius: number): THREE.Vector2[] {
  let lo = 0.45;
  let hi = 1.85;
  let best = fingerTipRadius(spec, 1).joints;
  for (let iter = 0; iter < 24; iter++) {
    const mid = (lo + hi) / 2;
    const r = fingerTipRadius(spec, mid);
    best = r.joints;
    if (r.tip.length() > gripRadius) lo = mid;
    else hi = mid;
  }
  return best;
}

export interface HandOptions {
  side: 'left' | 'right';
  /** Radius of the thing being held, metres. */
  gripRadius: number;
  /** How the hand closes on it. */
  pose?: 'grip' | 'pinch';
}

export function buildHand(materials: Materials, opts: HandOptions): THREE.Group {
  const group = new THREE.Group();
  group.name = `hand:${opts.side}`;
  const mirror = opts.side === 'left' ? -1 : 1;
  const grip = clamp(opts.gripRadius, mm(1), mm(34));
  const slack = POSE_SLACK[opts.pose ?? 'grip'];

  const parts: THREE.BufferGeometry[] = [];
  const nails: THREE.BufferGeometry[] = [];

  // Palm: a slightly wedge-shaped block, thicker at the thumb side.
  const palm = roundedBox(PALM.length, PALM.thickness, PALM.width, mm(11), 4);
  palm.translate(PALM_CENTRE.x, PALM_CENTRE.y, PALM_CENTRE.z);
  const pp = palm.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pp.count; i++) {
    const x = pp.getX(i);
    const z = pp.getZ(i);
    const along = clamp((x - (PALM_CENTRE.x - PALM.length / 2)) / PALM.length, 0, 1);
    // narrower and thinner towards the wrist, and the heel of the hand is full
    const k = 0.82 + 0.18 * along;
    pp.setZ(i, z * k);
    pp.setY(i, PALM_CENTRE.y + (pp.getY(i) - PALM_CENTRE.y) * (0.85 + 0.2 * (1 - along)));
  }
  palm.computeVertexNormals();
  parts.push(palm);

  // Fingers.
  FINGERS.forEach((spec, fingerIndex) => {
    // The tip settles on the surface of what is held, not on its axis.
    const joints = solveCurl(spec, grip + spec.radius + slack[fingerIndex]);
    const z = spec.z * mirror;
    for (let i = 0; i < 3; i++) {
      const a = new THREE.Vector3(joints[i].x, joints[i].y, z);
      const b = new THREE.Vector3(joints[i + 1].x, joints[i + 1].y, z);
      // Fingers taper towards the tip, and each joint is a little thicker
      // than the segment either side of it.
      const r0 = spec.radius * (1 - i * 0.10);
      const r1 = spec.radius * (1 - (i + 1) * 0.12);
      parts.push(taperedCapsule(a, b, r0, r1, 14, 4));
    }
    // nail plate on the back of the last segment
    const tipDir = new THREE.Vector3(
      joints[3].x - joints[2].x,
      joints[3].y - joints[2].y,
      0,
    ).normalize();
    const nail = new THREE.SphereGeometry(spec.radius * 0.36, 10, 8);
    nail.scale(1.15, 0.35, 0.9);
    const nx = joints[3].x - tipDir.x * spec.radius * 0.30;
    const ny = joints[3].y - tipDir.y * spec.radius * 0.30;
    const back = new THREE.Vector3(-tipDir.y, tipDir.x, 0).multiplyScalar(spec.radius * 0.74);
    const m = new THREE.Matrix4().makeRotationZ(Math.atan2(tipDir.y, tipDir.x));
    nail.applyMatrix4(m);
    nail.translate(nx - back.x, ny - back.y, z);
    nails.push(nail);
  });

  // Thumb: comes across from the radial side to meet the fingers.
  {
    const zSign = mirror;
    const start = new THREE.Vector3(PALM_CENTRE.x + mm(2), PALM_CENTRE.y - mm(2), mm(34) * zSign);
    const mid = new THREE.Vector3(PALM_CENTRE.x + mm(32), PALM_CENTRE.y - mm(18), mm(28) * zSign);
    const reach = Math.max(grip + mm(9), mm(11));
    const tip = new THREE.Vector3(reach * 0.9, -reach * 0.5, mm(16) * zSign);
    parts.push(taperedCapsule(start, mid, mm(12.5), mm(10.5), 14, 4));
    parts.push(taperedCapsule(mid, tip, mm(10.5), mm(8.6), 14, 4));
    const nail = new THREE.SphereGeometry(mm(5.4), 10, 8);
    nail.scale(1.15, 0.3, 0.9);
    nail.translate(tip.x - mm(2), tip.y + mm(6), tip.z);
    nails.push(nail);
  }

  // Wrist and forearm, running out of frame.
  {
    const wristX = PALM_CENTRE.x - PALM.length * 0.5 + mm(4);
    const wrist = new THREE.Vector3(wristX, PALM_CENTRE.y + mm(1), 0);
    const forearm = new THREE.Vector3(wristX - mm(90), PALM_CENTRE.y + mm(10), mm(4) * mirror);
    const elbow = new THREE.Vector3(wristX - mm(250), PALM_CENTRE.y + mm(28), mm(12) * mirror);
    parts.push(taperedCapsule(wrist, forearm, mm(27), mm(38), 18, 5));
    parts.push(taperedCapsule(forearm, elbow, mm(38), mm(46), 18, 5));
  }

  const body = new THREE.Mesh(mergeAll(parts), materials.skin);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  for (const p of parts) p.dispose();

  const nailMat = materials.skin.clone();
  nailMat.color = new THREE.Color(0xf2d8cf);
  nailMat.clearcoat = 0.55;
  nailMat.clearcoatRoughness = 0.22;
  nailMat.roughness = 0.35;
  const nailMesh = new THREE.Mesh(mergeAll(nails), nailMat);
  nailMesh.castShadow = false;
  group.add(nailMesh);
  for (const n of nails) n.dispose();

  group.userData.disposableMaterials = [nailMat];
  return group;
}

export function disposeHand(hand: THREE.Group): void {
  hand.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
  });
  const mats = hand.userData.disposableMaterials as THREE.Material[] | undefined;
  if (mats) for (const m of mats) m.dispose();
  hand.parent?.remove(hand);
}
