/**
 * blankView.ts — the ring and the wedge as three.js objects.
 *
 * Geometry is authored in RING SPACE and never re-baked; the wedge is moved by
 * its parent transforms only.  That is what keeps the grain from swimming and
 * keeps "put it back and the ring is whole" literally true.
 */

import * as THREE from 'three'
import {
  buildPieceBulk,
  buildPieceCollar,
  buildRingBulk,
  buildRingCollar,
  type Quality,
} from '../core/blank'
import type { SectorMesh } from '../core/sector'
import { JIG_TOP, PIVOT_R } from '../core/layout'
import { createWoodMaterial } from '../materials/wood'

function toGeometry(m: SectorMesh, target?: THREE.BufferGeometry) {
  const g = target ?? new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(m.position, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3))
  g.setAttribute('aFresh', new THREE.BufferAttribute(m.fresh, 1))
  g.setIndex(new THREE.BufferAttribute(m.index, 1))
  g.computeBoundingSphere()
  g.computeBoundingBox()
  return g
}

/** Copy a rebuilt sector into an existing geometry when the layout matches. */
function update(mesh: THREE.Mesh, m: SectorMesh) {
  const g = mesh.geometry
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const idx = g.getIndex()
  if (pos && idx && pos.array.length === m.position.length && idx.array.length === m.index.length) {
    ;(pos.array as Float32Array).set(m.position)
    ;(g.getAttribute('normal').array as Float32Array).set(m.normal)
    ;(g.getAttribute('aFresh').array as Float32Array).set(m.fresh)
    ;(idx.array as Uint32Array).set(m.index)
    pos.needsUpdate = true
    g.getAttribute('normal').needsUpdate = true
    g.getAttribute('aFresh').needsUpdate = true
    idx.needsUpdate = true
    g.computeBoundingSphere()
    g.computeBoundingBox()
    return
  }
  g.dispose()
  mesh.geometry = toGeometry(m)
}

export class BlankView {
  readonly root = new THREE.Group()
  readonly ringGroup = new THREE.Group()
  readonly pieceRoot = new THREE.Group()
  readonly pieceInner = new THREE.Group()
  readonly material = createWoodMaterial()

  private ringBulk: THREE.Mesh
  private ringCollar: THREE.Mesh
  private pieceBulk: THREE.Mesh
  private pieceCollar: THREE.Mesh
  private lastCut = Number.POSITIVE_INFINITY
  private quality: Quality

  constructor(quality: Quality = 'high') {
    this.quality = quality
    const mk = (m: SectorMesh) => {
      const mesh = new THREE.Mesh(toGeometry(m), this.material)
      mesh.castShadow = true
      mesh.receiveShadow = true
      return mesh
    }
    this.ringBulk = mk(buildRingBulk(quality))
    this.ringCollar = mk(buildRingCollar(Number.POSITIVE_INFINITY))
    this.pieceBulk = mk(buildPieceBulk(quality))
    this.pieceCollar = mk(buildPieceCollar(Number.POSITIVE_INFINITY))

    this.ringGroup.add(this.ringBulk, this.ringCollar)
    this.ringGroup.position.set(0, JIG_TOP, 0)

    this.pieceInner.position.set(-PIVOT_R, 0, 0)
    this.pieceInner.add(this.pieceBulk, this.pieceCollar)
    this.pieceRoot.add(this.pieceInner)
    this.pieceRoot.position.set(PIVOT_R, JIG_TOP, 0)

    this.root.add(this.ringGroup, this.pieceRoot)
  }

  /** Re-cut the two collars. ~950 vertices each, and the buffers are reused
   *  whenever the vertex count has not changed, so sawing does not churn the
   *  GPU or the collector. */
  setCut(cutR: number) {
    // The kerf is 1.6 mm wide; resolving its end to a third of a millimetre is
    // already below what any pixel shows.
    const q = Number.isFinite(cutR) ? Math.round(cutR / 0.0003) * 0.0003 : cutR
    if (q === this.lastCut) return
    this.lastCut = q
    update(this.pieceCollar, buildPieceCollar(q))
    update(this.ringCollar, buildRingCollar(q))
  }

  /** slide: metres radially outward along +X. yaw: radians about the wedge's
   *  own vertical centroid axis. */
  setPiecePose(slide: number, yaw: number) {
    this.pieceRoot.position.set(PIVOT_R + slide, JIG_TOP, 0)
    this.pieceRoot.rotation.y = yaw
  }

  /** World-space bounding box of the wedge as it stands. */
  pieceBox(target = new THREE.Box3()) {
    target.makeEmpty()
    target.expandByObject(this.pieceBulk)
    target.expandByObject(this.pieceCollar)
    return target
  }

  ringBox(target = new THREE.Box3()) {
    target.makeEmpty()
    target.expandByObject(this.ringBulk)
    target.expandByObject(this.ringCollar)
    return target
  }

  get pieceMeshes() {
    return [this.pieceBulk, this.pieceCollar]
  }

  triangleCount() {
    let n = 0
    for (const m of [this.ringBulk, this.ringCollar, this.pieceBulk, this.pieceCollar]) {
      const i = m.geometry.getIndex()
      if (i) n += i.count / 3
    }
    return n
  }

  setQuality(q: Quality) {
    if (q === this.quality) return
    this.quality = q
    this.ringBulk.geometry.dispose()
    this.pieceBulk.geometry.dispose()
    this.ringBulk.geometry = toGeometry(buildRingBulk(q))
    this.pieceBulk.geometry = toGeometry(buildPieceBulk(q))
  }

  dispose() {
    for (const m of [this.ringBulk, this.ringCollar, this.pieceBulk, this.pieceCollar]) {
      m.geometry.dispose()
    }
    this.material.dispose()
  }
}
