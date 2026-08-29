/**
 * Placement -> section correspondence check.
 *
 * Runs the exact geometry, seating and intersection code the game uses, with no
 * renderer, and prints what the knife would actually find. Used to prove that
 * the red shape in the reveal is produced by the placement rather than chosen
 * from a set of finished pictures.
 */
import * as THREE from 'three';
import {
  berryContour,
  buildSliceGeometry,
  buildSliceCollider,
  BERRY_VARIANTS,
} from '../src/content/StrawberryCatalog';
import {
  PlacementRing,
  seatPlacement,
  computeSeatY,
  type Placement,
} from '../src/game/PlacementRing';
import { ORIENTATIONS, type OrientationId } from '../src/game/OrientationState';
import { sectionOf, localPlane } from '../src/game/SectionGenerator';
import { CAKE, cutAngle } from '../src/game/CakeSpec';

const ring = new PlacementRing();
const creamTop = () => CAKE.creamBase + CAKE.creamInitial;

function boxOf(contour: THREE.Vector2[]): THREE.Box2 {
  const b = new THREE.Box2();
  for (const p of contour) b.expandByPoint(p);
  return b;
}

function planeAt(angle: number): THREE.Plane {
  return new THREE.Plane(new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle)), 0);
}

interface Probe {
  area: number;
  width: number;
  height: number;
  centreRadius: number;
  centreY: number;
  /** Lean of the cut face's long axis within the cut plane, in degrees. */
  lean: number;
}

/**
 * Principal axis of the cut face as the child sees it: measured in the cut
 * plane's own world frame, outward along the knife and up, so a slice that
 * leans out of the cake and one that leans into it read as opposites.
 */
function principalAngle(loop: THREE.Vector2[]): number {
  let cx = 0;
  let cy = 0;
  for (const p of loop) {
    cx += p.x;
    cy += p.y;
  }
  cx /= loop.length;
  cy /= loop.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of loop) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  return (0.5 * Math.atan2(2 * sxy, sxx - syy) * 180) / Math.PI;
}

function worldLean(
  geom: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
  angle: number,
): number {
  const outward = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
  const pos = geom.getAttribute('position') as THREE.BufferAttribute;
  const pts: THREE.Vector2[] = [];
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(matrix);
    pts.push(new THREE.Vector2(p.dot(outward), p.y));
  }
  return principalAngle(pts);
}

function probe(
  variantId: string,
  slotId: number,
  orientation: OrientationId,
  cutIndex: number,
): Probe | null {
  const v = BERRY_VARIANTS.find((b) => b.id === variantId)!;
  const box = boxOf(berryContour(v, 192));
  const geom = buildSliceGeometry(v, 96, box);
  const hull = buildSliceCollider(v, 128);
  const placement: Placement = {
    slotId,
    variantId,
    orientation,
    wobble: 0,
    sink: 0.0022,
    byPlayer: true,
    lift: 0,
    seatY: 0,
  };
  const slot = ring.slot(slotId);
  placement.seatY = computeSeatY(slot, orientation, placement.sink, geom.boundingBox!, creamTop);
  const seated = seatPlacement(slot, placement);
  const obj = new THREE.Object3D();
  obj.position.copy(seated.position);
  obj.quaternion.copy(seated.quaternion);
  obj.updateMatrixWorld(true);

  const world = planeAt(cutAngle(cutIndex));
  const res = sectionOf(hull, localPlane(world, obj), {
    uvBox: box,
    thickness: v.thickness,
  });
  if (!res) return null;
  const c = res.centroid.clone().applyMatrix4(obj.matrixWorld);
  // A cut runs from the rim to the middle, so only the half plane the knife
  // actually travelled counts: a well on the far side is never reached.
  const radial = new THREE.Vector3(
    Math.cos(cutAngle(cutIndex)),
    0,
    Math.sin(cutAngle(cutIndex)),
  );
  const cap = res.geometry.getAttribute('position') as THREE.BufferAttribute;
  let reach = -Infinity;
  const wp = new THREE.Vector3();
  for (let i = 0; i < cap.count; i++) {
    wp.fromBufferAttribute(cap, i).applyMatrix4(obj.matrixWorld);
    reach = Math.max(reach, wp.dot(radial));
  }
  if (reach < 0.001) return null;
  return {
    area: res.area,
    width: res.extent.x,
    height: res.extent.y,
    centreRadius: Math.hypot(c.x, c.z),
    centreY: c.y,
    lean: worldLean(res.geometry, obj.matrixWorld, cutAngle(cutIndex)),
  };
}

const mm2 = (a: number) => (a * 1e6).toFixed(1);
const mm = (a: number) => (a * 1000).toFixed(1);

let failures = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

console.log('\n--- orientation changes the red shape (large berry, well 0, cut 0) ---');
const byOrientation = new Map<OrientationId, Probe>();
for (const o of ORIENTATIONS) {
  const p = probe('large', 0, o, 0);
  if (!p) {
    console.log(`${o.padEnd(9)} no intersection`);
    continue;
  }
  byOrientation.set(o, p);
  console.log(
    `${o.padEnd(9)} area ${mm2(p.area).padStart(7)} mm2   ` +
      `size ${mm(p.width)} x ${mm(p.height)} mm   ` +
      `centre r=${mm(p.centreRadius)} mm  y=${mm(p.centreY)} mm  ` +
      `lean ${p.lean.toFixed(0).padStart(4)} deg`,
  );
}
check('every orientation is reached by the cut through its own well', byOrientation.size === 5);
const fo = byOrientation.get('faceOut')!;
const sl = byOrientation.get('slanted')!;
const cw = byOrientation.get('tipCW')!;
const ccw = byOrientation.get('tipCCW')!;
const fi = byOrientation.get('faceIn')!;
check('cut face outward gives a narrow stripe', fo.width < 0.009);
check('slanted is wider than face-out', sl.area > fo.area * 1.2);
check('tip-along-the-ring shows most of the berry', cw.area > fo.area * 2.5);
// The two leaning orientations show the same berry mirrored, so what separates
// them is which way the shape leans on the cut face, not how large it is.
// Principal axes are undirected, so compare them modulo 180 degrees.
const leanGap = (a: number, b: number): number => {
  const d = Math.abs(((a - b) % 180) + 180) % 180;
  return Math.min(d, 180 - d);
};
check(
  `clockwise and counterclockwise lean opposite ways (${leanGap(cw.lean, ccw.lean).toFixed(0)} deg apart)`,
  leanGap(cw.lean, ccw.lean) > 25,
);
check('face-in sits differently in height than face-out', Math.abs(fi.centreY - fo.centreY) > 0.0002);

console.log('\n--- the same placement, twelve different knife directions ---');
const layout: { slot: number; variant: string; orientation: OrientationId }[] = [
  { slot: 0, variant: 'large', orientation: 'faceOut' },
  { slot: 2, variant: 'small', orientation: 'tipCW' },
  { slot: 5, variant: 'pointed', orientation: 'faceIn' },
  { slot: 8, variant: 'round', orientation: 'slanted' },
  { slot: 12, variant: 'broadface', orientation: 'tipCCW' },
];
const seen = new Set<string>();
for (let c = 0; c < CAKE.cutDirections; c++) {
  const hits: string[] = [];
  for (const item of layout) {
    const p = probe(item.variant, item.slot, item.orientation, c);
    if (p) hits.push(`${item.variant}@${item.slot} ${mm2(p.area)}mm2`);
  }
  seen.add(hits.join('|'));
  console.log(`cut ${String(c).padStart(2)} (${((c * 30) % 360).toString().padStart(3)} deg): ${hits.length ? hits.join('   ') : '(only sponge and cream)'}`);
}
check('different knife directions give different sections', seen.size >= 6);

console.log('\n--- a berry only appears where it was actually put ---');
const atOwn = probe('large', 3, 'faceOut', 3);
const atOther = probe('large', 3, 'faceOut', 6);
check('cut through its own well finds it', atOwn !== null);
check('cut elsewhere does not find it', atOther === null);

console.log('\n--- the middle well is met by every cut ---');
let centreHits = 0;
for (let c = 0; c < CAKE.cutDirections; c++) {
  if (probe('round', 12, 'tipCW', c)) centreHits++;
}
check(`middle berry found by all twelve directions (${centreHits}/12)`, centreHits === 12);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
