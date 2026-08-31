import { fullRingVolume, polygonArea, lambProfile, KERF, HALF_KERF, WEDGE_RAD, polygonCentroid } from '../src/core/profile'
import { buildPieceBulk, buildPieceCollar, buildRingBulk, buildRingCollar } from '../src/core/blank'
import { meshVolume } from '../src/core/sector'
const A = Math.abs(polygonArea(lambProfile()))
const c = polygonCentroid(lambProfile())
const ideal = fullRingVolume()
const pb = meshVolume(buildPieceBulk()), pc = meshVolume(buildPieceCollar(0))
const rc = meshVolume(buildRingCollar(0)), rb = meshVolume(buildRingBulk())
console.log('A', A, 'rc_centroid', c.x, 'ideal', ideal)
console.log('pieceBulk', pb, 'pieceCollar', pc, 'ringCollar', rc, 'ringBulk', rb)
console.log('piece', pb+pc, 'analytic piece', WEDGE_RAD*c.x*A - KERF*A)
console.log('ring', rc+rb, 'analytic ring', (2*Math.PI-WEDGE_RAD)*c.x*A - KERF*A)
console.log('missing', ideal-(pb+pc+rc+rb), 'expected', 2*KERF*A, 'HALF_KERF', HALF_KERF)
