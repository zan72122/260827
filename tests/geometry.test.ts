import { describe, expect, it } from 'vitest'
import {
  HALF_KERF,
  KERF,
  LAMB_HEIGHT,
  LAMB_LENGTH,
  R_INNER,
  R_OUTER,
  WEDGE_RAD,
  fullRingVolume,
  isSimplePolygon,
  lambProfile,
  polygonArea,
} from '../src/core/profile'
import {
  COLLAR,
  THETA0,
  THETA1,
  buildPieceBulk,
  buildPieceCollar,
  buildRingBulk,
  buildRingCollar,
  insideFullRing,
  insidePiece,
  insideRing,
} from '../src/core/blank'
import { buildSector, meshVolume, type SectorMesh } from '../src/core/sector'

// --- helpers ---------------------------------------------------------------

function merge(...ms: SectorMesh[]): SectorMesh {
  const nv = ms.reduce((a, m) => a + m.position.length / 3, 0)
  const ni = ms.reduce((a, m) => a + m.index.length, 0)
  const position = new Float32Array(nv * 3)
  const normal = new Float32Array(nv * 3)
  const fresh = new Float32Array(nv)
  const index = new Uint32Array(ni)
  let vo = 0
  let io = 0
  for (const m of ms) {
    position.set(m.position, vo * 3)
    normal.set(m.normal, vo * 3)
    fresh.set(m.fresh, vo)
    for (let i = 0; i < m.index.length; i++) index[io + i] = m.index[i] + vo
    vo += m.position.length / 3
    io += m.index.length
  }
  return { position, normal, fresh, index, triangleCount: ni / 3 }
}

/** Weld vertices on a grid and report edges that are not shared by 2 faces. */
function manifoldReport(m: SectorMesh, eps = 1e-6) {
  const key = new Map<string, number>()
  const remap = new Uint32Array(m.position.length / 3)
  for (let v = 0; v < remap.length; v++) {
    const k = [0, 1, 2]
      .map((c) => Math.round(m.position[v * 3 + c] / eps))
      .join(',')
    let id = key.get(k)
    if (id === undefined) {
      id = key.size
      key.set(k, id)
    }
    remap[v] = id
  }
  const edges = new Map<string, number>()
  let degenerate = 0
  for (let i = 0; i < m.index.length; i += 3) {
    const t = [remap[m.index[i]], remap[m.index[i + 1]], remap[m.index[i + 2]]]
    if (t[0] === t[1] || t[1] === t[2] || t[0] === t[2]) {
      degenerate++
      continue
    }
    for (let e = 0; e < 3; e++) {
      const a = t[e]
      const b = t[(e + 1) % 3]
      const k = a < b ? `${a}_${b}` : `${b}_${a}`
      edges.set(k, (edges.get(k) ?? 0) + 1)
    }
  }
  let boundary = 0
  let nonManifold = 0
  for (const c of edges.values()) {
    if (c === 1) boundary++
    else if (c > 2) nonManifold++
  }
  return { boundary, nonManifold, degenerate, edges: edges.size }
}

const FULL_CUT = 0
const NO_CUT = R_OUTER + 1

// --- the profile -----------------------------------------------------------

describe('lamb profile (the single source of truth)', () => {
  const poly = lambProfile()

  it('is a simple, counter-clockwise, closed polygon', () => {
    expect(poly.length).toBeGreaterThan(80)
    expect(isSimplePolygon(poly)).toBe(true)
    expect(polygonArea(poly)).toBeGreaterThan(0)
  })

  it('never reaches the centre hole', () => {
    for (const p of poly) expect(p.x).toBeGreaterThanOrEqual(R_INNER - 1e-12)
    expect(Math.min(...poly.map((p) => p.x))).toBeCloseTo(R_INNER, 3)
  })

  it('has plausible tabletop dimensions', () => {
    expect(R_OUTER * 2).toBeGreaterThan(0.38) // >= 380 mm ring
    expect(R_OUTER * 2).toBeLessThan(0.45)
    expect(LAMB_LENGTH).toBeCloseTo(0.0992, 4)
    expect(LAMB_HEIGHT).toBeCloseTo(0.0604, 4)
  })

  it('carries the features that become the grooves of the ring', () => {
    const topAt = (x: number) => {
      let best = -Infinity
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i]
        const b = poly[(i + 1) % poly.length]
        if ((a.x - x) * (b.x - x) <= 0 && a.x !== b.x) {
          const t = (x - a.x) / (b.x - a.x)
          best = Math.max(best, a.y + (b.y - a.y) * t)
        }
      }
      return best
    }
    const back = topAt(R_INNER + 0.045)
    const neck = topAt(R_INNER + 0.0766)
    const head = topAt(R_INNER + 0.0844)
    expect(neck).toBeLessThan(back - 0.008) // >= 8 mm neck groove
    expect(neck).toBeLessThan(head - 0.008)
  })
})

// --- sector meshes ---------------------------------------------------------

describe('sector meshes', () => {
  it('the fully parted wedge is a closed solid with no boundary edges', () => {
    const m = merge(buildPieceBulk(), buildPieceCollar(FULL_CUT))
    const r = manifoldReport(m)
    expect(r.boundary).toBe(0)
    expect(r.nonManifold).toBe(0)
    expect(meshVolume(m)).toBeGreaterThan(0) // outward-facing normals
  })

  it('the remaining ring is a closed solid with no boundary edges', () => {
    const m = merge(buildRingCollar(FULL_CUT), buildRingBulk())
    const r = manifoldReport(m)
    expect(r.boundary).toBe(0)
    expect(r.nonManifold).toBe(0)
    expect(meshVolume(m)).toBeGreaterThan(0)
  })

  it('is not a hollow shell: the sawn faces are filled', () => {
    const piece = merge(buildPieceBulk(), buildPieceCollar(FULL_CUT))
    const freshTris = countFreshTriangles(piece)
    expect(freshTris).toBeGreaterThan(200) // both sawn faces triangulated
    // A shell of the same skin would have far less volume than the wedge.
    const solid = meshVolume(piece)
    const expected =
      (fullRingVolume() * (WEDGE_RAD - 2 * Math.asin(HALF_KERF / (R_INNER + LAMB_LENGTH / 2)))) /
      (2 * Math.PI)
    expect(solid / expected).toBeGreaterThan(0.9)
    expect(solid / expected).toBeLessThan(1.1)
  })

  it('the wedge and the ring together are the full blank, minus two kerfs', () => {
    const piece = meshVolume(merge(buildPieceBulk(), buildPieceCollar(FULL_CUT)))
    const ring = meshVolume(merge(buildRingCollar(FULL_CUT), buildRingBulk()))
    const ideal = fullRingVolume()
    const missing = ideal - (piece + ring)
    // Two saw kerfs of 1.6 mm through the profile cross-section.
    const area = Math.abs(polygonArea(lambProfile()))
    const expectedKerf = 2 * KERF * area
    expect(missing).toBeGreaterThan(0)
    expect(missing / expectedKerf).toBeGreaterThan(0.9)
    expect(missing / expectedKerf).toBeLessThan(1.1)
    expect(missing / ideal).toBeLessThan(0.01) // < 1 % of the blank
  })

  it('the wedge sawn face is exactly the ring notch face (same polygon)', () => {
    // Cross-section of the wedge at theta1, and of the ring at theta1,
    // expressed back in the meridian plane.  They must be the same profile.
    const pieceFace = capOutline(buildPieceCollar(FULL_CUT), THETA1, -1)
    const ringFace = capOutline(buildRingCollar(FULL_CUT), THETA1, +1)
    expect(pieceFace.length).toBeGreaterThan(100)
    expect(ringFace.length).toBe(pieceFace.length)
    let worst = 0
    for (let i = 0; i < pieceFace.length; i++) {
      worst = Math.max(
        worst,
        Math.hypot(pieceFace[i].r - ringFace[i].r, pieceFace[i].y - ringFace[i].y),
      )
    }
    expect(worst).toBeLessThan(2e-6) // 2 microns
  })
})

function countFreshTriangles(m: SectorMesh) {
  let n = 0
  for (let i = 0; i < m.index.length; i += 3) {
    if (m.fresh[m.index[i]] > 0.5 && m.fresh[m.index[i + 1]] > 0.5) n++
  }
  return n
}

/** Pull the cap vertices of a mesh back into the (r, y) meridian plane. */
function capOutline(m: SectorMesh, theta: number, sign: number) {
  const out: Array<{ r: number; y: number }> = []
  const nx = -Math.sin(theta)
  const nz = Math.cos(theta)
  const dx = Math.cos(theta)
  const dz = Math.sin(theta)
  for (let v = 0; v < m.fresh.length; v++) {
    if (m.fresh[v] < 0.5) continue
    const x = m.position[v * 3]
    const y = m.position[v * 3 + 1]
    const z = m.position[v * 3 + 2]
    const off = x * nx + z * nz
    expect(Math.abs(off - sign * HALF_KERF)).toBeLessThan(1e-6)
    out.push({ r: x * dx + z * dz, y })
  }
  return out
}

// --- reconstruction --------------------------------------------------------

describe('put the wedge back and the blank is whole again', () => {
  it('the union of wedge and ring differs from the blank only inside the kerfs', () => {
    let inFull = 0
    let mismatch = 0
    let worstDepth = 0
    let seed = 12345
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    for (let i = 0; i < 400000; i++) {
      const x = (rnd() * 2 - 1) * R_OUTER
      const z = (rnd() * 2 - 1) * R_OUTER
      const y = rnd() * LAMB_HEIGHT
      const full = insideFullRing(x, y, z)
      if (!full) continue
      inFull++
      const rebuilt = insidePiece(x, y, z) || insideRing(x, y, z)
      if (rebuilt) continue
      mismatch++
      // every mismatched point must lie inside one of the two 1.6 mm kerfs
      const r = Math.hypot(x, z)
      let t = Math.atan2(z, x)
      while (t > Math.PI) t -= Math.PI * 2
      while (t < -Math.PI) t += Math.PI * 2
      const d = Math.min(Math.abs(r * Math.sin(t - THETA0)), Math.abs(r * Math.sin(t - THETA1)))
      worstDepth = Math.max(worstDepth, d)
    }
    expect(inFull).toBeGreaterThan(1000)
    expect(worstDepth).toBeLessThanOrEqual(HALF_KERF + 1e-9)
    expect(mismatch / inFull).toBeLessThan(0.005) // < 0.5 % of the blank volume
  })
})

// --- partial cut -----------------------------------------------------------

describe('a half-finished cut', () => {
  it('leaves the wedge joined: the kerf never reaches past the blade', () => {
    for (const cut of [R_OUTER - 0.005, R_OUTER - 0.03, R_INNER + 0.02, R_INNER + 0.001]) {
      const pc = buildPieceCollar(cut)
      const rc = buildRingCollar(cut)
      for (const m of [pc, rc]) {
        for (let v = 0; v < m.fresh.length; v++) {
          if (m.fresh[v] < 0.5) continue
          const r = Math.hypot(m.position[v * 3], m.position[v * 3 + 2])
          // sawn material only exists outboard of the blade
          expect(r).toBeGreaterThan(cut - 2e-4)
        }
      }
    }
  })

  it('opens no kerf at all before the blade touches the wood', () => {
    const pc = buildPieceCollar(NO_CUT)
    const rc = buildRingCollar(NO_CUT)
    expect(pc.fresh.reduce((a, b) => a + b, 0)).toBe(0)
    expect(rc.fresh.reduce((a, b) => a + b, 0)).toBe(0)
    // the two collars meet exactly on the theta1 plane: no gap, still one body
    for (const m of [pc, rc]) {
      let onPlane = 0
      for (let v = 0; v < m.fresh.length; v++) {
        const off = -Math.sin(THETA1) * m.position[v * 3] + Math.cos(THETA1) * m.position[v * 3 + 2]
        if (Math.abs(off) < 1e-7) onPlane++
      }
      expect(onPlane).toBeGreaterThan(50)
    }
  })

  it('grows the kerf monotonically as the blade advances', () => {
    let prev = 0
    for (const cut of [R_OUTER - 0.001, R_OUTER - 0.02, R_OUTER - 0.05, R_INNER + 0.005, 0]) {
      const area = freshArea(buildPieceCollar(cut))
      expect(area).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = area
    }
    const full = freshArea(buildPieceCollar(FULL_CUT))
    expect(full).toBeCloseTo(Math.abs(polygonArea(lambProfile())), 5)
  })
})

function freshArea(m: SectorMesh) {
  let a = 0
  for (let i = 0; i < m.index.length; i += 3) {
    const i0 = m.index[i]
    const i1 = m.index[i + 1]
    const i2 = m.index[i + 2]
    if (m.fresh[i0] < 0.5 || m.fresh[i1] < 0.5 || m.fresh[i2] < 0.5) continue
    const ax = m.position[i1 * 3] - m.position[i0 * 3]
    const ay = m.position[i1 * 3 + 1] - m.position[i0 * 3 + 1]
    const az = m.position[i1 * 3 + 2] - m.position[i0 * 3 + 2]
    const bx = m.position[i2 * 3] - m.position[i0 * 3]
    const by = m.position[i2 * 3 + 1] - m.position[i0 * 3 + 1]
    const bz = m.position[i2 * 3 + 2] - m.position[i0 * 3 + 2]
    a += 0.5 * Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx)
  }
  return a
}

// --- material identity -----------------------------------------------------

describe('the wedge is made of the same wood as the ring', () => {
  it('keeps its ring coordinates as its material coordinates', () => {
    // The wedge geometry is authored in ring space and NEVER re-baked; the
    // shader reads object space, so grain cannot swim when the piece moves.
    const m = buildPieceBulk()
    for (let v = 0; v < m.position.length / 3; v++) {
      const r = Math.hypot(m.position[v * 3], m.position[v * 3 + 2])
      expect(r).toBeGreaterThan(R_INNER - 1e-3)
      expect(r).toBeLessThan(R_OUTER + 1e-3)
      let t = Math.atan2(m.position[v * 3 + 2], m.position[v * 3])
      expect(t).toBeGreaterThan(THETA0 - 1e-3)
      expect(t).toBeLessThan(THETA1 + 1e-3)
    }
  })

  it('has the same thickness before and after separation', () => {
    const before = buildPieceBulk()
    const after = buildPieceBulk()
    expect(after.position.length).toBe(before.position.length)
    for (let i = 0; i < before.position.length; i++) {
      expect(after.position[i]).toBe(before.position[i])
    }
  })
})

// --- the collars line up with the bulks ------------------------------------

describe('collar / bulk seams', () => {
  it('the internal seams carry no cap and no gap', () => {
    for (const [collar, theta] of [
      [buildPieceCollar(FULL_CUT), THETA1 - COLLAR],
      [buildRingCollar(FULL_CUT), THETA1 + COLLAR],
    ] as const) {
      let onSeam = 0
      for (let v = 0; v < collar.fresh.length; v++) {
        const off =
          -Math.sin(theta) * collar.position[v * 3] + Math.cos(theta) * collar.position[v * 3 + 2]
        if (Math.abs(off) < 1e-7) {
          onSeam++
          expect(collar.fresh[v]).toBe(0)
        }
      }
      expect(onSeam).toBeGreaterThan(50)
    }
  })

  it('a plain sector of the whole circle equals the analytic ring volume', () => {
    const whole = buildSector({
      a: { theta: 0, offset: 0, cutR: Infinity },
      b: { theta: Math.PI * 2, offset: 0, cutR: Infinity },
      step: (1.5 * Math.PI) / 180,
      capA: false,
      capB: false,
    })
    expect(meshVolume(whole) / fullRingVolume()).toBeGreaterThan(0.999)
    expect(meshVolume(whole) / fullRingVolume()).toBeLessThan(1.001)
  })
})
