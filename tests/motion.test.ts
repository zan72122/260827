import { describe, expect, it } from 'vitest'
import { R_INNER, R_OUTER, HALF_KERF, lambProfile, pointInProfile } from '../src/core/profile'
import { buildPieceBulk, buildPieceCollar, insideRing, THETA0, THETA1 } from '../src/core/blank'
import {
  PIVOT_R,
  SAW_CARRIAGE_END,
  SAW_CARRIAGE_START,
  SAW_LEAD,
  SLIDE_MAX,
  SLIDE_TURN_UNLOCK,
} from '../src/core/layout'
import { GameState, NO_CUT } from '../src/game/state'

/** Every vertex of the wedge, in ring space. */
function pieceVertices() {
  const out: Array<[number, number, number]> = []
  for (const m of [buildPieceBulk(), buildPieceCollar(0)]) {
    for (let v = 0; v < m.position.length / 3; v++) {
      out.push([m.position[v * 3], m.position[v * 3 + 1], m.position[v * 3 + 2]])
    }
  }
  return out
}

/** The pose the game applies: turn about the wedge's own vertical centroid
 *  axis, then translate radially outward. Mirrors BlankView.setPiecePose. */
function pose(p: [number, number, number], slide: number, yaw: number) {
  const lx = p[0] - PIVOT_R
  const lz = p[2]
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return [PIVOT_R + slide + lx * c + lz * s, p[1], -lx * s + lz * c] as const
}

describe('the wedge never passes through the ring', () => {
  const verts = pieceVertices()

  it('stays clear while sliding straight out', () => {
    let worst = 0
    for (let i = 0; i <= 60; i++) {
      const slide = (SLIDE_MAX * i) / 60
      for (const v of verts) {
        const [x, y, z] = pose(v, slide, 0)
        if (insideRing(x, y, z)) worst++
      }
    }
    expect(worst).toBe(0)
  })

  it('stays clear through every turn the game allows', () => {
    const yawMax = Math.PI / 2 // the largest target any orientation uses
    let hits = 0
    let minGap = Infinity
    for (let i = 0; i <= 12; i++) {
      const slide = SLIDE_TURN_UNLOCK + ((SLIDE_MAX - SLIDE_TURN_UNLOCK) * i) / 12
      for (let j = 0; j <= 24; j++) {
        const yaw = (yawMax * j) / 24
        for (const v of verts) {
          const [x, y, z] = pose(v, slide, yaw)
          if (insideRing(x, y, z)) hits++
          const r = Math.hypot(x, z)
          // clearance from the ring's outer surface at this height
          if (pointInProfile(lambProfile(), R_OUTER - 1e-4, y)) minGap = Math.min(minGap, r - R_OUTER)
        }
      }
    }
    expect(hits).toBe(0)
    expect(minGap).toBeGreaterThan(0.004) // >= 4 mm of daylight at all times
  })

  it('keeps every vertex on or above the table', () => {
    for (const v of verts) expect(v[1]).toBeGreaterThanOrEqual(-1e-9)
  })

  it('keeps the wedge inside its own angular slot at home', () => {
    for (const v of verts) {
      const t = Math.atan2(v[2], v[0])
      const r = Math.max(Math.hypot(v[0], v[2]), 1e-6)
      const d = Math.asin(Math.min(1, HALF_KERF / r))
      expect(t).toBeGreaterThan(THETA0 + d - 1e-6)
      expect(t).toBeLessThan(THETA1 - d + 1e-6)
    }
  })
})

describe('the three moves cannot be short-circuited', () => {
  const g = () => {
    const s = new GameState()
    s.phase = 'cut'
    s.yawTarget = Math.PI / 2 - (7 * Math.PI) / 180
    return s
  }

  it('will not let the wedge move before it is parted', () => {
    const s = g()
    s.setCarriage(0.16 + SAW_LEAD, 1 / 60) // half way in
    expect(s.parted).toBe(false)
    s.setSlide(0.09)
    expect(s.slide).toBe(0)
    s.setYaw(1)
    expect(s.yaw).toBe(0)
  })

  it('the kerf follows the blade and never leads it', () => {
    const s = g()
    for (let r = SAW_CARRIAGE_START; r > SAW_CARRIAGE_END; r -= 0.004) {
      s.setCarriage(r, 1 / 60)
      if (s.cut !== NO_CUT) expect(s.cut).toBeGreaterThanOrEqual(s.bladeR - 1e-12)
    }
  })

  it('pulling the saw back out does not re-join the wood', () => {
    const s = g()
    s.setCarriage(0.14 + SAW_LEAD, 1 / 60)
    const deep = s.cut
    s.setCarriage(SAW_CARRIAGE_START, 1 / 60) // all the way back
    expect(s.cut).toBe(deep)
    expect(s.parted).toBe(false)
  })

  it('stopping half way holds the state', () => {
    const s = g()
    s.setCarriage(0.15 + SAW_LEAD, 1 / 60)
    const snapshot = s.cut
    for (let i = 0; i < 60; i++) s.tick(1 / 60)
    expect(s.cut).toBe(snapshot)
    expect(s.parted).toBe(false)
    expect(s.slide).toBe(0)
  })

  it('will not let the wedge turn until it is clear of the ring', () => {
    const s = g()
    s.setCarriage(SAW_CARRIAGE_END, 1 / 60)
    expect(s.parted).toBe(true)
    s.setSlide(SLIDE_TURN_UNLOCK - 0.01)
    s.setYaw(0.5)
    expect(s.yaw).toBe(0)
    s.setSlide(SLIDE_TURN_UNLOCK)
    s.setYaw(0.5)
    expect(s.yaw).toBeCloseTo(0.5, 6)
  })

  it('will not let a turned wedge slide back into the ring', () => {
    const s = g()
    s.setCarriage(SAW_CARRIAGE_END, 1 / 60)
    s.setSlide(SLIDE_MAX)
    s.setYaw(0.4)
    s.setSlide(0)
    expect(s.slide).toBe(SLIDE_MAX)
  })

  it('clamps the turn to the angle that squares the face to the camera', () => {
    const s = g()
    s.setCarriage(SAW_CARRIAGE_END, 1 / 60)
    s.setSlide(SLIDE_MAX)
    s.setYaw(9)
    expect(s.yaw).toBeCloseTo(s.yawTarget, 9)
  })

  it('reset arms a fresh prepared blank, it does not rewind the cut', () => {
    const s = g()
    s.setCarriage(SAW_CARRIAGE_END, 1 / 60)
    s.setSlide(SLIDE_MAX)
    s.setYaw(s.yawTarget)
    s.reset()
    expect(s.cut).toBe(NO_CUT)
    expect(s.slide).toBe(0)
    expect(s.yaw).toBe(0)
    expect(s.carriage).toBe(SAW_CARRIAGE_START)
    expect(s.parted).toBe(false)
  })

  it('the saw can reach right through the blank', () => {
    expect(SAW_CARRIAGE_END - SAW_LEAD).toBeLessThan(R_INNER)
    expect(SAW_CARRIAGE_START - SAW_LEAD).toBeGreaterThan(R_OUTER)
  })
})

// ---------------------------------------------------------------------------

describe('bench geometry', () => {
  it('the jig and the receiving table are not inside out', async () => {
    // An inside-out plate renders its back faces into the shadow map and
    // stripes everything standing on it, which is how this was found.
    const { annularSector } = await import('../src/scene/geom')
    const g = annularSector(0.089, 0.218, 0.1, 0.1 + Math.PI * 2 - 0.08, 0, 0.0293, 128)
    const pos = g.getAttribute('position').array as Float32Array
    const nor = g.getAttribute('normal').array as Float32Array
    const idx = g.getIndex()!.array as ArrayLike<number>
    let volume = 0
    let disagreeing = 0
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3
      const b = idx[i + 1] * 3
      const c = idx[i + 2] * 3
      volume +=
        (pos[a] * (pos[b + 1] * pos[c + 2] - pos[c + 1] * pos[b + 2]) -
          pos[a + 1] * (pos[b] * pos[c + 2] - pos[c] * pos[b + 2]) +
          pos[a + 2] * (pos[b] * pos[c + 1] - pos[c] * pos[b + 1])) /
        6
      const e1 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]]
      const e2 = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]]
      const n = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ]
      if (n[0] * nor[a] + n[1] * nor[a + 1] + n[2] * nor[a + 2] < 0) disagreeing++
    }
    expect(disagreeing).toBe(0)
    expect(volume).toBeGreaterThan(0)
    expect(volume / (Math.PI * (0.218 ** 2 - 0.089 ** 2) * 0.0293)).toBeGreaterThan(0.97)
  })
})
