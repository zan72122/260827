import * as THREE from 'three';
import { DIM } from '../core/units';
import { TAU, lerp, smoothstep } from '../util/math';
import { loft, orientOutward } from './geometry';
import type { Materials } from '../render/materials';

/**
 * A petal tip.
 *
 * The important part is the mouth: a teardrop slot, wide at one end and nearly
 * closed at the other, cut in sheet steel about a third of a millimetre thick.
 * That asymmetry is what makes a ribbon of cream thick at its root and thin at
 * its free edge, which is in turn what makes a petal look like a petal. So the
 * slot is modelled as a real opening in a real wall, with the rim of the sheet
 * visible all the way round, rather than being painted on.
 *
 * Local frame: the mouth sits at the origin, the body runs along +Y, cream
 * leaves along -Y. The slot's long axis is Z, wide end at -Z.
 */

const SIDE_STEPS = 22;
const CAP_STEPS = 10;
const RING = SIDE_STEPS * 2 + CAP_STEPS * 2;

/** The outline of the mouth, shrunk inwards by `shrink` metres. */
function slotOutline(shrink: number): THREE.Vector2[] {
  const halfL = Math.max(DIM.tipSlotLength / 2 - shrink, 0.0004);
  const wWide = Math.max(DIM.tipSlotWideOpening / 2 - shrink, 0.00015);
  const wNarrow = Math.max(DIM.tipSlotNarrowOpening / 2 - shrink, 0.00008);
  const widthAt = (z: number) => {
    const t = (z + halfL) / (2 * halfL);
    return lerp(wWide, wNarrow, Math.pow(t, 0.85));
  };

  const pts: THREE.Vector2[] = [];
  // quarter of the wide cap: from the very bottom round to the +X side
  for (let i = 0; i < CAP_STEPS / 2; i++) {
    const a = -Math.PI / 2 + (i / (CAP_STEPS / 2)) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.cos(a) * wWide, -halfL + Math.sin(a) * wWide));
  }
  // +X flank, wide end to narrow end
  for (let i = 0; i < SIDE_STEPS; i++) {
    const z = lerp(-halfL, halfL, i / SIDE_STEPS);
    pts.push(new THREE.Vector2(widthAt(z), z));
  }
  // narrow cap, all the way over
  for (let i = 0; i < CAP_STEPS; i++) {
    const a = (i / CAP_STEPS) * Math.PI;
    pts.push(new THREE.Vector2(Math.cos(a) * wNarrow, halfL + Math.sin(a) * wNarrow));
  }
  // -X flank, narrow end back to wide end
  for (let i = 0; i < SIDE_STEPS; i++) {
    const z = lerp(halfL, -halfL, i / SIDE_STEPS);
    pts.push(new THREE.Vector2(-widthAt(z), z));
  }
  // remaining quarter of the wide cap
  for (let i = 0; i < CAP_STEPS / 2; i++) {
    const a = Math.PI + (i / (CAP_STEPS / 2)) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.cos(a) * wWide, -halfL + Math.sin(a) * wWide));
  }
  return pts;
}

/** A circle sampled so vertex k lines up with vertex k of the slot outline. */
function circleOutline(radius: number): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < RING; i++) {
    const a = -Math.PI / 2 + (i / RING) * TAU;
    pts.push(new THREE.Vector2(Math.cos(a) * radius, Math.sin(a) * radius));
  }
  return pts;
}

function station(t: number, shrink: number): THREE.Vector3[] {
  // Round at the back where it meets the coupler, squeezed to the slot at the
  // mouth. The squeeze happens over the last third, the way a pressed tip does.
  const blend = smoothstep((t - 0.28) / 0.72);
  const radius = lerp(DIM.tipBackRadius, DIM.tipSlotLength * 0.42, smoothstep(t)) - shrink;
  const circle = circleOutline(Math.max(radius, 0.0006));
  const slot = slotOutline(shrink);
  const y = (1 - t) * DIM.tipLength;
  const ring: THREE.Vector3[] = [];
  for (let i = 0; i < RING; i++) {
    const x = lerp(circle[i].x, slot[i].x, blend);
    const z = lerp(circle[i].y, slot[i].y, blend);
    ring.push(new THREE.Vector3(x, y, z));
  }
  return ring;
}

export function buildPipingTip(materials: Materials): THREE.Group {
  const group = new THREE.Group();
  group.name = 'pipingTip';

  const steps = 16;
  const wall = DIM.tipWallThickness;

  const rings: THREE.Vector3[][] = [];
  // down the outside, back to front
  for (let i = 0; i <= steps; i++) rings.push(station(i / steps, 0));
  // across the rim of the sheet, then back up the inside
  for (let i = steps; i >= 0; i--) rings.push(station(i / steps, wall));
  // close the loop with a flat annulus at the back
  rings.push(rings[0].map((p) => p.clone()));

  const geo = orientOutward(loft(rings, { closedRings: true }));
  const mesh = new THREE.Mesh(geo, materials.steel);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  return group;
}

/**
 * Where the cream actually leaves the tip, in the tip's local frame, together
 * with the direction of the slot's long axis. The petal model is anchored to
 * these so the ribbon always starts at the metal.
 */
export const TIP_MOUTH = new THREE.Vector3(0, 0, 0);
export const TIP_SLOT_AXIS = new THREE.Vector3(0, 0, 1);
