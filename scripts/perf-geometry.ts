/** Cost of the per-frame work: rebuilding the two collars while sawing. */
import { buildPieceBulk, buildPieceCollar, buildRingBulk, buildRingCollar } from '../src/core/blank'
import { R_INNER, R_OUTER } from '../src/core/profile'

const t0 = performance.now()
const pb = buildPieceBulk('high')
const rb = buildRingBulk('high')
const tBulk = performance.now() - t0

const N = 600
let cut = R_OUTER
let verts = 0
let tris = 0
const t1 = performance.now()
for (let i = 0; i < N; i++) {
  cut = R_OUTER - ((R_OUTER - R_INNER) * (i % 100)) / 100
  const a = buildPieceCollar(cut)
  const b = buildRingCollar(cut)
  verts = a.position.length / 3 + b.position.length / 3
  tris = a.triangleCount + b.triangleCount
}
const tCollar = (performance.now() - t1) / N

const lowPb = buildPieceBulk('low')
const lowRb = buildRingBulk('low')

console.log('static build (high):', tBulk.toFixed(1), 'ms')
console.log('  ring bulk  tris', rb.triangleCount, ' verts', rb.position.length / 3)
console.log('  piece bulk tris', pb.triangleCount, ' verts', pb.position.length / 3)
console.log('  low quality: ring', lowRb.triangleCount, 'piece', lowPb.triangleCount)
console.log('per-frame collar rebuild:', tCollar.toFixed(3), 'ms  (', verts, 'verts,', tris, 'tris )')
console.log('total scene tris (high):', rb.triangleCount + pb.triangleCount + tris)
