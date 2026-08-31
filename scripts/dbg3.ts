import { polygonArea, lambProfile, polygonCentroid, WEDGE_RAD } from '../src/core/profile'
import { buildSector, meshVolume } from '../src/core/sector'
const A = Math.abs(polygonArea(lambProfile())), c = polygonCentroid(lambProfile()).x
const step=(0.2*Math.PI)/180
const plainV = WEDGE_RAD*c*A
for (const off of [0.0008, 0.004, 0.01]) {
  const m = buildSector({a:{theta:0,offset:off,cutR:0}, b:{theta:WEDGE_RAD,offset:0,cutR:Infinity}, step, capA:true, capB:true})
  const removed = plainV - meshVolume(m)
  console.log('off', off, 'removed', removed.toExponential(4), 'off*A', (off*A).toExponential(4), 'ratio', (removed/(off*A)).toFixed(4))
}
// inspect boundary angles
const m = buildSector({a:{theta:0,offset:0.0008,cutR:0}, b:{theta:WEDGE_RAD,offset:0,cutR:Infinity}, step, capA:false, capB:false})
let minT=1e9,maxT=-1e9
const np = 0
void np
for (let v=0; v<m.position.length/3; v++){
  const x=m.position[v*3], z=m.position[v*3+2]
  const t=Math.atan2(z,x); if(t<minT)minT=t; if(t>maxT)maxT=t
}
console.log('theta range', minT, maxT, 'expected min ~', Math.atan2(0.0008,0.205), '..', Math.atan2(0.0008,0.105))
