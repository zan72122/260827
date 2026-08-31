/**
 * sector.ts — turns the ONE lamb profile into every solid in the game.
 *
 * A "sector" is the solid swept by the profile polygon between two boundary
 * surfaces.  A boundary surface is a plane that contains the ring axis,
 * optionally pushed sideways by half a saw kerf, and optionally only pushed
 * beyond a given radius (that is how a half-finished saw cut is represented:
 * beyond `cutR` the blade has passed and there is a slot; inside `cutR` the
 * wood is still joined).
 *
 * ring blank      = sector(theta1 .. theta0 + 2pi)      <- what stays clamped
 * lamb wedge      = sector(theta0 .. theta1)            <- what the child takes
 *
 * Both are generated from the same profile array by the same code, so the
 * wedge's sawn face and the notch left in the ring are the same polygon by
 * construction — they cannot drift apart.
 */

import { lambProfile, type Pt } from './profile'

// ---------------------------------------------------------------------------
// Boundary description
// ---------------------------------------------------------------------------

export type Boundary = {
  /** Angle of the radial plane (radians). */
  theta: number
  /** Perpendicular offset of the plane, in metres. +/- HALF_KERF, or 0. */
  offset: number
  /** Offset only applies at radii >= cutR. Use 0 for "applies everywhere",
   *  Infinity for "never" (a plain radial plane). */
  cutR: number
}

export const plainBoundary = (theta: number): Boundary => ({ theta, offset: 0, cutR: 0 })

/** Where boundary `b` puts the profile point (r, y), as cylindrical (R, Theta). */
function place(b: Boundary, r: number, y: number, useOffset: boolean) {
  const off = useOffset ? b.offset : 0
  // Exact perpendicular offset of the radial plane: a point at radius r on the
  // offset plane sits at cylindrical radius hypot(r, off) and angle
  // theta + atan2(off, r).  For off = 0.8 mm this is a 2 um correction on R.
  return { R: Math.hypot(r, off), T: b.theta + Math.atan2(off, r), y }
}

// ---------------------------------------------------------------------------
// Crease-aware expansion of the profile into surface vertices
// ---------------------------------------------------------------------------

export type PV = { r: number; y: number; nr: number; ny: number }

const CREASE_COS = Math.cos((38 * Math.PI) / 180)

let expandedCache: PV[] | null = null

/**
 * The profile as a closed loop of shading vertices: smooth where the turned
 * surface is smooth, doubled (with two different normals) at hard corners such
 * as the edge of a hoof.
 */
export function expandedProfile(): PV[] {
  if (expandedCache) return expandedCache
  const poly = lambProfile()
  const n = poly.length
  const en: Array<{ x: number; y: number }> = []
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const l = Math.hypot(dx, dy) || 1
    en.push({ x: dy / l, y: -dx / l }) // outward normal for CCW winding
  }
  const out: PV[] = []
  for (let i = 0; i < n; i++) {
    const p = poly[i]
    const e0 = en[(i - 1 + n) % n]
    const e1 = en[i]
    if (e0.x * e1.x + e0.y * e1.y >= CREASE_COS) {
      const nx = e0.x + e1.x
      const ny = e0.y + e1.y
      const l = Math.hypot(nx, ny) || 1
      out.push({ r: p.x, y: p.y, nr: nx / l, ny: ny / l })
    } else {
      out.push({ r: p.x, y: p.y, nr: e0.x, ny: e0.y })
      out.push({ r: p.x, y: p.y, nr: e1.x, ny: e1.y })
    }
  }
  expandedCache = out
  return out
}

/** Insert doubled vertices where the loop crosses r = cutR, so the mesh can
 *  carry the step between "sawn" and "still joined". */
function augment(base: PV[], cutR: number): { pv: PV[]; use: boolean[] } {
  if (!(cutR > 0) || cutR <= 0) return { pv: base, use: base.map(() => true) }
  const pv: PV[] = []
  const use: boolean[] = []
  const n = base.length
  for (let i = 0; i < n; i++) {
    const a = base[i]
    const b = base[(i + 1) % n]
    pv.push(a)
    use.push(a.r >= cutR)
    const da = a.r - cutR
    const db = b.r - cutR
    if (da === 0 || db === 0 || da * db > 0) continue
    const t = da / (da - db)
    const c: PV = {
      r: cutR,
      y: a.y + (b.y - a.y) * t,
      nr: a.nr + (b.nr - a.nr) * t,
      ny: a.ny + (b.ny - a.ny) * t,
    }
    const l = Math.hypot(c.nr, c.ny) || 1
    c.nr /= l
    c.ny /= l
    pv.push({ ...c })
    use.push(da >= 0) // this copy belongs to the side we came from
    pv.push({ ...c })
    use.push(db >= 0) // this copy belongs to the side we are going to
  }
  return { pv, use }
}

// ---------------------------------------------------------------------------
// Cap triangulation (ear clipping on the fixed profile, then half-plane clip)
// ---------------------------------------------------------------------------

let triCache: number[] | null = null

/** Ear-clipping triangulation of the profile. Indices into lambProfile(). */
export function profileTriangles(): number[] {
  if (triCache) return triCache
  const poly = lambProfile()
  const n = poly.length
  const idx: number[] = []
  for (let i = 0; i < n; i++) idx.push(i)
  const area2 = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  const inTri = (a: Pt, b: Pt, c: Pt, p: Pt) => {
    const d1 = area2(a, b, p)
    const d2 = area2(b, c, p)
    const d3 = area2(c, a, p)
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
  }
  const out: number[] = []
  let guard = n * n + 64
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k - 1 + idx.length) % idx.length]
      const i1 = idx[k]
      const i2 = idx[(k + 1) % idx.length]
      const a = poly[i0]
      const b = poly[i1]
      const c = poly[i2]
      if (area2(a, b, c) <= 1e-12) continue // reflex or degenerate
      let ok = true
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue
        if (inTri(a, b, c, poly[j])) {
          ok = false
          break
        }
      }
      if (!ok) continue
      out.push(i0, i1, i2)
      idx.splice(k, 1)
      clipped = true
      break
    }
    if (!clipped) break
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2])
  triCache = out
  return out
}

/** Profile triangles clipped to r >= cutR, as flat (r, y) triples. */
export function capTriangles(cutR: number): number[] {
  const poly = lambProfile()
  const tris = profileTriangles()
  const out: number[] = []
  const push = (p: Pt[]) => {
    for (let i = 1; i + 1 < p.length; i++) {
      out.push(p[0].x, p[0].y, p[i].x, p[i].y, p[i + 1].x, p[i + 1].y)
    }
  }
  for (let t = 0; t < tris.length; t += 3) {
    const v = [poly[tris[t]], poly[tris[t + 1]], poly[tris[t + 2]]]
    if (!(cutR > 0)) {
      push(v)
      continue
    }
    // Sutherland-Hodgman against the single half-plane x >= cutR (convex clip
    // of a triangle: always a convex polygon, so this is exact).
    const res: Pt[] = []
    for (let i = 0; i < 3; i++) {
      const a = v[i]
      const b = v[(i + 1) % 3]
      const da = a.x - cutR
      const db = b.x - cutR
      if (da >= 0) res.push(a)
      if (da * db < 0) {
        const s = da / (da - db)
        res.push({ x: cutR, y: a.y + (b.y - a.y) * s })
      }
    }
    if (res.length >= 3) push(res)
  }
  return out
}

// ---------------------------------------------------------------------------
// The sector builder
// ---------------------------------------------------------------------------

export type SectorSpec = {
  a: Boundary
  b: Boundary
  /** Angular sampling step in radians for the swept surface. */
  step: number
  /** Cap the `a` end (its outward normal points away from the sector). */
  capA: boolean
  capB: boolean
  /** Radius above which the caps exist. 0 = the whole profile is capped. */
  capCutR?: number
}

export type SectorMesh = {
  position: Float32Array
  normal: Float32Array
  /** 1 on freshly sawn faces, 0 on turned surfaces. */
  fresh: Float32Array
  index: Uint32Array
  triangleCount: number
}

export function buildSector(spec: SectorSpec): SectorMesh {
  const { a, b, capA, capB } = spec
  const cutR = Math.max(a.cutR === Infinity ? 0 : a.cutR, b.cutR === Infinity ? 0 : b.cutR)
  const { pv, use } = augment(expandedProfile(), cutR)
  const useA = a.cutR === Infinity ? pv.map(() => false) : a.cutR <= 0 ? pv.map(() => true) : use
  const useB = b.cutR === Infinity ? pv.map(() => false) : b.cutR <= 0 ? pv.map(() => true) : use

  const span = b.theta - a.theta
  const segs = Math.max(1, Math.ceil(Math.abs(span) / spec.step))
  const np = pv.length

  const pos: number[] = []
  const nor: number[] = []
  const fre: number[] = []
  const ind: number[] = []

  // ---- swept lateral surface ---------------------------------------------
  const ringA = pv.map((p, i) => place(a, p.r, p.y, useA[i]))
  const ringB = pv.map((p, i) => place(b, p.r, p.y, useB[i]))
  for (let s = 0; s <= segs; s++) {
    const t = s / segs
    for (let i = 0; i < np; i++) {
      const A = ringA[i]
      const B = ringB[i]
      const T = A.T + (B.T - A.T) * t
      const R = A.R + (B.R - A.R) * t
      const c = Math.cos(T)
      const si = Math.sin(T)
      pos.push(R * c, pv[i].y, R * si)
      nor.push(pv[i].nr * c, pv[i].ny, pv[i].nr * si)
      fre.push(0)
    }
  }
  const flip = span < 0
  for (let s = 0; s < segs; s++) {
    for (let i = 0; i < np; i++) {
      const j = (i + 1) % np
      const v00 = s * np + i
      const v01 = s * np + j
      const v10 = (s + 1) * np + i
      const v11 = (s + 1) * np + j
      if (flip) ind.push(v00, v10, v01, v01, v10, v11)
      else ind.push(v00, v01, v10, v01, v11, v10)
    }
  }

  // ---- caps ---------------------------------------------------------------
  const capR = spec.capCutR ?? 0
  const addCap = (bd: Boundary, outwardSign: number) => {
    const tri = capTriangles(capR)
    const n = { x: -Math.sin(bd.theta) * outwardSign, y: 0, z: Math.cos(bd.theta) * outwardSign }
    for (let k = 0; k < tri.length; k += 6) {
      const base = pos.length / 3
      // Vertices are always emitted in profile order, so the two faces of a
      // kerf are directly comparable; only the winding differs.
      for (let o = 0; o < 3; o++) {
        const r = tri[k + o * 2]
        const y = tri[k + o * 2 + 1]
        const P = place(bd, r, y, true)
        pos.push(P.R * Math.cos(P.T), y, P.R * Math.sin(P.T))
        nor.push(n.x, n.y, n.z)
        fre.push(1)
      }
      // Cap vertices are laid out with (r, y) mapping to (+d, +y) and the
      // plane normal along +n, so profile-CCW order already faces +n.
      if (outwardSign > 0) ind.push(base, base + 1, base + 2)
      else ind.push(base, base + 2, base + 1)
    }
  }
  // `a` is the low-theta end of the sector -> its outward normal is -theta.
  if (capA) addCap(a, span >= 0 ? -1 : 1)
  if (capB) addCap(b, span >= 0 ? 1 : -1)

  return {
    position: new Float32Array(pos),
    normal: new Float32Array(nor),
    fresh: new Float32Array(fre),
    index: new Uint32Array(ind),
    triangleCount: ind.length / 3,
  }
}

/** Signed volume of a closed triangle mesh (divergence theorem). */
export function meshVolume(m: SectorMesh): number {
  let v = 0
  const p = m.position
  const ix = m.index
  for (let i = 0; i < ix.length; i += 3) {
    const a = ix[i] * 3
    const b = ix[i + 1] * 3
    const c = ix[i + 2] * 3
    v +=
      (p[a] * (p[b + 1] * p[c + 2] - p[c + 1] * p[b + 2]) -
        p[a + 1] * (p[b] * p[c + 2] - p[c] * p[b + 2]) +
        p[a + 2] * (p[b] * p[c + 1] - p[c] * p[b + 1])) /
      6
  }
  return v
}
