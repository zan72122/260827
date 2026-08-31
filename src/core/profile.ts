/**
 * profile.ts — THE single geometric source of truth for this prototype.
 *
 * Everything in the game (the ring blank, the wedge the child cuts out, the
 * notch left behind in the ring) is derived from ONE closed 2D polygon: the
 * side silhouette of a lamb roughing-out blank ("Rohling").
 *
 * Coordinate system of the profile (the meridian / half-plane of the lathe):
 *
 *     x  = radial distance from the ring axis   [m]
 *     y  = height above the jig plate           [m]   (0 = the hoof plane)
 *
 * Revolving this polygon around the Y axis (never crossing it — the polygon
 * lives entirely at x >= R_INNER) produces the ring blank ("Reifen").  The
 * lamb's nose points OUTWARD (large x), its rump inward, its hooves down.
 *
 * Because the profile is revolved, every feature of the animal becomes a
 * circumferential groove or ridge of the ring:
 *
 *     the notch between fore and hind legs  ->  a deep groove on the underside
 *     the dip of the neck                   ->  a groove on the top face
 *     the crown of the head                 ->  the raised outer rim
 *     the rump                              ->  the sloped inner edge
 *
 * That is precisely why the ring "only looks like a grooved wheel": you are
 * looking at the revolved surface, never at the meridian section.
 *
 * DIMENSIONS ARE DESIGN VALUES FOR THIS PROTOTYPE.  They are chosen to be a
 * plausible tabletop size for a workshop ring; they are NOT measurements taken
 * from any museum piece or historic drawing.
 */

export type Pt = { x: number; y: number }

/** Inner radius of the ring: the hole the profile must not reach into. */
export const R_INNER = 0.105 // m  -> 210 mm hole
/** Radial length of the lamb blank (rump to muzzle) — derived from CONTROL. */
export let LAMB_LENGTH = 0
/** Outer radius of the ring — derived from CONTROL. */
export let R_OUTER = 0
/** Overall height of the blank — derived from CONTROL. */
export let LAMB_HEIGHT = 0

/** Angular width of one animal wedge. 360/7.5 = 48 animals per ring. */
export const WEDGE_DEG = 7.5
export const WEDGE_RAD = (WEDGE_DEG * Math.PI) / 180

/** Saw kerf. The blade removes this much material; it is also the tolerance
 *  within which the ring can be reconstructed by putting the piece back. */
export const KERF = 0.0016 // m (1.6 mm)
export const HALF_KERF = KERF / 2

/**
 * Control points of the lamb silhouette, in centimetres, measured from the
 * rump end (x' = 0 at R_INNER) and from the hoof plane (y' = 0).
 *
 * `s` marks a hard crease (a corner that must stay sharp, e.g. the edge of a
 * hoof).  Everything else is rounded by a Catmull-Rom pass, the way a turned
 * profile actually comes off the lathe tool.
 *
 * Winding is counter-clockwise in (x, y): along the hooves in +x, up the
 * chest, over the head, back along the spine in -x, down the rump.
 */
const CONTROL: Array<[number, number, ('s' | 'r')?]> = [
  // ---- underside: hind hoof, leg notch, fore hoof -------------------------
  [1.10, 0.00, 's'], // hind hoof, rear edge
  [2.85, 0.00, 's'], // hind hoof, front edge
  [3.10, 0.80],
  [3.48, 2.05],
  [4.00, 2.82],
  [4.45, 2.98], // belly = roof of the leg notch (deep groove of the ring)
  [5.05, 2.96],
  [5.44, 2.16],
  [5.66, 0.86],
  [5.80, 0.00, 's'], // fore hoof, rear edge
  [7.45, 0.00, 's'], // fore hoof, front edge
  // ---- brisket, throat, muzzle -------------------------------------------
  [7.62, 1.15],
  [7.72, 2.10],
  [7.78, 2.78], // brisket
  [7.98, 3.30],
  [8.55, 4.10], // throat
  [9.10, 4.00],
  [9.50, 4.06], // jaw line
  [9.82, 4.24],
  [9.92, 4.64], // blunt muzzle: outermost point of the ring
  [9.76, 5.04],
  // ---- head, neck dip, spine ---------------------------------------------
  [9.34, 5.44],
  [8.90, 5.72], // forehead
  [8.44, 5.84], // poll: crown of the head, highest point
  [8.08, 5.30],
  [7.66, 4.70], // neck dip -> the groove on the top face of the ring
  [7.08, 5.32],
  [6.44, 5.66], // withers
  [5.30, 5.92],
  [4.00, 6.04],
  [2.80, 6.02],
  [1.85, 5.86],
  [1.15, 5.62],
  // ---- rump, inner edge ---------------------------------------------------
  [0.62, 5.20],
  [0.24, 4.48],
  [0.06, 3.56],
  [0.05, 2.52], // innermost point of the ring
  [0.28, 1.42],
  [0.66, 0.44],
]

LAMB_LENGTH = Math.max(...CONTROL.map((p) => p[0])) / 100
LAMB_HEIGHT = Math.max(...CONTROL.map((p) => p[1])) / 100
R_OUTER = R_INNER + LAMB_LENGTH

// ---------------------------------------------------------------------------
// Catmull-Rom rounding + curvature-adaptive resampling
// ---------------------------------------------------------------------------

function catmull(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const t2 = t * t
  const t3 = t2 * t
  return {
    x:
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y:
      0.5 *
      (2 * p1.y +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  }
}

let cached: Pt[] | null = null

/**
 * The canonical, densely sampled, closed profile polygon in METRES,
 * counter-clockwise, first point NOT repeated at the end.
 *
 * This array is the only shape definition in the project.  The ring, the
 * wedge and the gap in the ring are all generated from it, which is what
 * makes "put the piece back and the ring is whole again" true by
 * construction rather than by authoring two models that happen to match.
 */
export function lambProfile(): Pt[] {
  if (cached) return cached

  // Duplicate creased control points so the spline develops a corner there.
  const ctrl: Pt[] = []
  for (const [cx, cy, kind] of CONTROL) {
    const p = { x: R_INNER + cx / 100, y: cy / 100 }
    ctrl.push(p)
    if (kind === 's') ctrl.push({ ...p })
  }

  const n = ctrl.length
  const out: Pt[] = []
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n]
    const p1 = ctrl[i]
    const p2 = ctrl[(i + 1) % n]
    const p3 = ctrl[(i + 2) % n]
    const seg = Math.hypot(p2.x - p1.x, p2.y - p1.y)
    if (seg < 1e-9) continue // collapsed crease pair
    // adaptive: more samples where the turn is tighter
    const turn = Math.abs(
      Math.atan2(p2.y - p1.y, p2.x - p1.x) - Math.atan2(p1.y - p0.y, p1.x - p0.x),
    )
    const steps = Math.max(1, Math.min(9, Math.round(seg / 0.0035 + turn * 2)))
    for (let s = 0; s < steps; s++) out.push(catmull(p0, p1, p2, p3, s / steps))
  }

  // Drop near-duplicate neighbours (keeps the mesh builder well conditioned).
  const clean: Pt[] = []
  for (const p of out) {
    const q = clean[clean.length - 1]
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-5) clean.push(p)
  }
  if (Math.hypot(clean[0].x - clean[clean.length - 1].x, clean[0].y - clean[clean.length - 1].y) < 1e-5)
    clean.pop()

  cached = clean
  return clean
}

// ---------------------------------------------------------------------------
// Polygon helpers (used by both the mesh builder and the verification suite)
// ---------------------------------------------------------------------------

/** Signed area; positive for counter-clockwise winding. */
export function polygonArea(poly: Pt[]): number {
  let a = 0
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % n]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

/** Centroid of the polygon area. */
export function polygonCentroid(poly: Pt[]): Pt {
  let cx = 0
  let cy = 0
  const a = polygonArea(poly)
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % n]
    const cr = p.x * q.y - q.x * p.y
    cx += (p.x + q.x) * cr
    cy += (p.y + q.y) * cr
  }
  return { x: cx / (6 * a), y: cy / (6 * a) }
}

/** Even-odd point-in-polygon test in the meridian plane. */
export function pointInProfile(poly: Pt[], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, n = poly.length, j = n - 1; i < n; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > y !== b.y > y) {
      const t = (y - a.y) / (b.y - a.y)
      if (x < a.x + t * (b.x - a.x)) inside = !inside
    }
  }
  return inside
}

/** True if no two non-adjacent edges of the polygon intersect. */
export function isSimplePolygon(poly: Pt[]): boolean {
  const n = poly.length
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const seg = (p1: Pt, p2: Pt, p3: Pt, p4: Pt) => {
    const d1 = cross(p3, p4, p1)
    const d2 = cross(p3, p4, p2)
    const d3 = cross(p1, p2, p3)
    const d4 = cross(p1, p2, p4)
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue
      if (seg(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return false
    }
  }
  return true
}

/** Volume of the full solid of revolution (Pappus's theorem). */
export function fullRingVolume(poly: Pt[] = lambProfile()): number {
  const a = Math.abs(polygonArea(poly))
  const c = polygonCentroid(poly)
  return 2 * Math.PI * c.x * a
}
