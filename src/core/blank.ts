/**
 * blank.ts — the prepared ring blank and the one wedge the child takes out.
 *
 * Starting state (what the craftsman has already done, and what the child can
 * see from the first frame): the ring is turned, and ONE boundary — theta0 —
 * has already been parted, so a 1.6 mm kerf is visible there.
 *
 * What the child does: part the NEXT boundary, theta1, then pull the wedge
 * between theta0 and theta1 out of the ring, then turn it to read it.
 *
 * The four meshes:
 *   pieceBulk   theta0 (sawn)      .. theta1 - COLLAR (internal seam)
 *   pieceCollar theta1 - COLLAR    .. theta1 (the face being sawn now)
 *   ringCollar  theta1 (the face being sawn now) .. theta1 + COLLAR
 *   ringBulk    theta1 + COLLAR    .. theta0 + 2pi (sawn)
 *
 * The two "collars" are the only things that change while the saw is moving,
 * and they are ~450 vertices each, so a partial cut costs nothing per frame.
 * The two "bulks" are built once.
 */

import {
  HALF_KERF,
  R_INNER,
  R_OUTER,
  WEDGE_RAD,
  lambProfile,
  pointInProfile,
} from './profile'
import { buildSector, type Boundary, type SectorMesh } from './sector'

/** Angular position of the wedge the child extracts: centred on +X. */
export const PIECE_CENTER = 0
export const THETA0 = PIECE_CENTER - WEDGE_RAD / 2 // already parted by the craftsman
export const THETA1 = PIECE_CENTER + WEDGE_RAD / 2 // the child's cut

/** Angular width of the re-buildable collar either side of theta1. */
export const COLLAR = (0.9 * Math.PI) / 180

/** Angular sampling of the swept surface. */
export const STEP_HIGH = (2.0 * Math.PI) / 180
export const STEP_LOW = (3.6 * Math.PI) / 180

export type Quality = 'high' | 'low'

const sawn = (theta: number, sign: 1 | -1): Boundary => ({
  theta,
  offset: sign * HALF_KERF,
  cutR: 0,
})
const seam = (theta: number): Boundary => ({ theta, offset: 0, cutR: Infinity })
/** The face being sawn right now: kerf only outboard of `cutR`. */
const sawing = (theta: number, sign: 1 | -1, cutR: number): Boundary => ({
  theta,
  offset: sign * HALF_KERF,
  cutR,
})

export function buildPieceBulk(q: Quality = 'high'): SectorMesh {
  return buildSector({
    a: sawn(THETA0, +1),
    b: seam(THETA1 - COLLAR),
    step: q === 'high' ? STEP_HIGH : STEP_LOW,
    capA: true,
    capB: false,
  })
}

export function buildRingBulk(q: Quality = 'high'): SectorMesh {
  return buildSector({
    a: seam(THETA1 + COLLAR),
    b: sawn(THETA0 + Math.PI * 2, -1),
    step: q === 'high' ? STEP_HIGH : STEP_LOW,
    capA: false,
    capB: true,
  })
}

/** cutR === R_OUTER+ : nothing cut yet.  cutR <= R_INNER : fully parted. */
export function buildPieceCollar(cutR: number): SectorMesh {
  const cut = clampCut(cutR)
  return buildSector({
    a: seam(THETA1 - COLLAR),
    b: sawing(THETA1, -1, cut),
    step: COLLAR / 2,
    capA: false,
    capB: cut < R_OUTER,
    capCutR: cut,
  })
}

export function buildRingCollar(cutR: number): SectorMesh {
  const cut = clampCut(cutR)
  return buildSector({
    a: sawing(THETA1, +1, cut),
    b: seam(THETA1 + COLLAR),
    step: COLLAR / 2,
    capA: cut < R_OUTER,
    capB: false,
    capCutR: cut,
  })
}

function clampCut(cutR: number): number {
  if (cutR >= R_OUTER) return R_OUTER + 1 // no kerf at all
  if (cutR <= R_INNER) return 0 // fully parted
  return cutR
}

export const isFullyParted = (cutR: number) => cutR <= R_INNER

// ---------------------------------------------------------------------------
// Reconstruction check — "put the wedge back and you have the ring again"
// ---------------------------------------------------------------------------

/** Is (x, y, z) inside the ideal, uncut ring blank? */
export function insideFullRing(x: number, y: number, z: number): boolean {
  return pointInProfile(lambProfile(), Math.hypot(x, z), y)
}

/** Is (x, y, z) inside the wedge, at its home position, after a full part-off? */
export function insidePiece(x: number, y: number, z: number): boolean {
  const r = Math.hypot(x, z)
  if (!pointInProfile(lambProfile(), r, y)) return false
  const t = wrap(Math.atan2(z, x))
  const d0 = Math.asin(Math.min(1, HALF_KERF / Math.max(r, 1e-6)))
  return t >= THETA0 + d0 && t <= THETA1 - d0
}

/** Is (x, y, z) inside the remaining ring after a full part-off? */
export function insideRing(x: number, y: number, z: number): boolean {
  const r = Math.hypot(x, z)
  if (!pointInProfile(lambProfile(), r, y)) return false
  const t = wrap(Math.atan2(z, x))
  const d0 = Math.asin(Math.min(1, HALF_KERF / Math.max(r, 1e-6)))
  return t >= THETA1 + d0 || t <= THETA0 - d0
}

function wrap(t: number): number {
  while (t > Math.PI) t -= Math.PI * 2
  while (t < -Math.PI) t += Math.PI * 2
  return t
}
