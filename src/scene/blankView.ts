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

function toGeometry(m: SectorMesh) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(m.position, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3))
  g.setAttribute('aFresh', new THREE.BufferAttribute(m.fresh, 1))
  g.setIndex(new THREE.BufferAttribute(m.index, 1))
  g.computeBoundingSphere()
  g.computeBoundingBox()
  return g
}

/**
 * A collar geometry with room to spare.  The vertex count changes every time
 * the cut front crosses another edge of the profile, so a freshly allocated
 * buffer per frame would churn hundreds of kilobytes a second while the child
 * is sawing.  Instead the buffers are sized once for the worst case and the
 * draw range is moved.
 */
class CollarGeometry {
  readonly geometry = new THREE.BufferGeometry()
  private capacityV = 0
  private capacityI = 0
  reallocations = 0

  constructor(first: SectorMesh) {
    this.allocate(Math.ceil((first.position.length / 3) * 1.6) + 512, first.index.length * 2 + 1536)
    this.set(first)
  }

  private allocate(verts: number, indices: number) {
    this.capacityV = verts
    this.capacityI = indices
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3))
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(verts * 3), 3))
    this.geometry.setAttribute('aFresh', new THREE.BufferAttribute(new Float32Array(verts), 1))
    this.geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1))
    this.reallocations++
  }

  set(m: SectorMesh) {
    const nv = m.position.length / 3
    if (nv > this.capacityV || m.index.length > this.capacityI) {
      this.geometry.dispose()
      this.allocate(Math.ceil(nv * 1.6), Math.ceil(m.index.length * 1.6))
    }
    const g = this.geometry
    ;(g.getAttribute('position').array as Float32Array).set(m.position)
    ;(g.getAttribute('normal').array as Float32Array).set(m.normal)
    ;(g.getAttribute('aFresh').array as Float32Array).set(m.fresh)
    ;(g.getIndex()!.array as Uint32Array).set(m.index)
    g.getAttribute('position').needsUpdate = true
    g.getAttribute('normal').needsUpdate = true
    g.getAttribute('aFresh').needsUpdate = true
    g.getIndex()!.needsUpdate = true
    g.setDrawRange(0, m.index.length)

    // Bounds over the live vertices only: the tail of the buffer is stale.
    const p = m.position
    const box = (g.boundingBox ??= new THREE.Box3())
    box.makeEmpty()
    for (let i = 0; i < p.length; i += 3) box.expandByPoint(_v.set(p[i], p[i + 1], p[i + 2]))
    g.boundingSphere ??= new THREE.Sphere()
    box.getBoundingSphere(g.boundingSphere)
  }
}

const _v = new THREE.Vector3()

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
  private pieceCollarGeo: CollarGeometry
  private ringCollarGeo: CollarGeometry
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
    this.pieceBulk = mk(buildPieceBulk(quality))
    // The collars are sized for a full-depth cut, which is the worst case.
    this.pieceCollarGeo = new CollarGeometry(buildPieceCollar(0))
    this.ringCollarGeo = new CollarGeometry(buildRingCollar(0))
    this.pieceCollarGeo.set(buildPieceCollar(Number.POSITIVE_INFINITY))
    this.ringCollarGeo.set(buildRingCollar(Number.POSITIVE_INFINITY))
    this.ringCollar = new THREE.Mesh(this.ringCollarGeo.geometry, this.material)
    this.pieceCollar = new THREE.Mesh(this.pieceCollarGeo.geometry, this.material)
    for (const m of [this.ringCollar, this.pieceCollar]) {
      m.castShadow = true
      m.receiveShadow = true
    }

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
    this.pieceCollarGeo.set(buildPieceCollar(q))
    this.ringCollarGeo.set(buildRingCollar(q))
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

  /** Diagnostics: how often the collar buffers had to be resized. */
  get collarReallocations() {
    return this.pieceCollarGeo.reallocations + this.ringCollarGeo.reallocations
  }

  triangleCount() {
    let n = 0
    for (const m of [this.ringBulk, this.ringCollar, this.pieceBulk, this.pieceCollar]) {
      const r = m.geometry.drawRange
      const i = m.geometry.getIndex()
      if (i) n += Math.min(r.count === Infinity ? i.count : r.count, i.count) / 3
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
