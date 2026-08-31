import { describe, expect, it } from 'vitest'
import { BlankView } from '../src/scene/blankView'
import { NO_CUT } from '../src/game/state'
import { R_INNER, R_OUTER } from '../src/core/profile'
import { SLIDE_MAX } from '../src/core/layout'

/** three.js geometry works fine outside a browser; no WebGL context needed. */
describe('the wedge is never swapped for another model', () => {
  it('keeps the same geometry, vertex for vertex, through pulling and turning', () => {
    const v = new BlankView('high')
    v.setCut(NO_CUT)
    v.setCut(R_INNER - 0.01) // parted
    const [bulk, collar] = v.pieceMeshes
    const gBulk = bulk.geometry
    const gCollar = collar.geometry
    const pBulk = Float32Array.from(gBulk.getAttribute('position').array)
    const pCollar = Float32Array.from(gCollar.getAttribute('position').array)

    for (let i = 0; i <= 20; i++) {
      v.setPiecePose((SLIDE_MAX * i) / 20, 0)
      v.setCut(R_INNER - 0.01)
    }
    for (let i = 0; i <= 20; i++) {
      v.setPiecePose(SLIDE_MAX, (Math.PI / 2) * (i / 20))
      v.setCut(R_INNER - 0.01)
    }

    // same objects...
    expect(v.pieceMeshes[0].geometry).toBe(gBulk)
    expect(v.pieceMeshes[1].geometry).toBe(gCollar)
    // ...and the same object-space vertices, which is what the wood shader
    // reads, so the grain cannot swim or change scale as the piece moves.
    expect(Array.from(gBulk.getAttribute('position').array)).toEqual(Array.from(pBulk))
    expect(Array.from(gCollar.getAttribute('position').array)).toEqual(Array.from(pCollar))
    v.dispose()
  })

  it('sawing does not reallocate the collar buffers on every step', () => {
    const v = new BlankView('high')
    v.setCut(NO_CUT)
    v.setCut(0.18)
    const before = v.collarReallocations
    const g = v.pieceMeshes[1].geometry
    const buf = g.getAttribute('position').array
    for (let r = 0.18; r > R_INNER; r -= 0.0006) v.setCut(r)
    // The buffers are sized once for a full-depth cut, so sawing must not
    // allocate at all: otherwise the child's finger churns 6 MB a second.
    expect(v.collarReallocations).toBe(before)
    expect(v.pieceMeshes[1].geometry.getAttribute('position').array).toBe(buf)
    v.dispose()
  })

  it('the wedge is always inside the ring blank envelope', () => {
    const v = new BlankView('high')
    v.setCut(NO_CUT)
    const box = v.pieceBox()
    expect(box.min.x).toBeGreaterThan(R_INNER - 0.002)
    expect(box.max.x).toBeLessThan(R_OUTER + 0.002)
    v.dispose()
  })
})
