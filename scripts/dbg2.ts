import { polygonArea, lambProfile, polygonCentroid, HALF_KERF, WEDGE_RAD } from '../src/core/profile'
import { buildSector, meshVolume } from '../src/core/sector'
const A = Math.abs(polygonArea(lambProfile())), c = polygonCentroid(lambProfile()).x
const step=(0.2*Math.PI)/180
const plain = buildSector({a:{theta:0,offset:0,cutR:Infinity}, b:{theta:WEDGE_RAD,offset:0,cutR:Infinity}, step, capA:true, capB:true})
console.log('plain  ', meshVolume(plain), 'analytic', WEDGE_RAD*c*A)
const one = buildSector({a:{theta:0,offset:HALF_KERF,cutR:0}, b:{theta:WEDGE_RAD,offset:0,cutR:Infinity}, step, capA:true, capB:true})
console.log('one kerf', meshVolume(one), 'analytic', WEDGE_RAD*c*A - HALF_KERF*A, 'delta', WEDGE_RAD*c*A-meshVolume(one), 'hk*A', HALF_KERF*A)
const two = buildSector({a:{theta:0,offset:HALF_KERF,cutR:0}, b:{theta:WEDGE_RAD,offset:-HALF_KERF,cutR:0}, step, capA:true, capB:true})
console.log('two kerf', meshVolume(two), 'analytic', WEDGE_RAD*c*A - 2*HALF_KERF*A)
