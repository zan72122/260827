import { polygonArea, lambProfile, polygonCentroid, WEDGE_RAD } from '../src/core/profile'
import { buildSector, meshVolume } from '../src/core/sector'
const A = Math.abs(polygonArea(lambProfile())), c = polygonCentroid(lambProfile()).x
const step=(0.2*Math.PI)/180
const V=(a:any,b:any)=>meshVolume(buildSector({a,b,step,capA:true,capB:true}))
const plain=(t:number)=>({theta:t,offset:0,cutR:Infinity})
console.log('[0,W]      ', V(plain(0),plain(WEDGE_RAD)).toExponential(6), (WEDGE_RAD*c*A).toExponential(6))
console.log('[0.005,W]  ', V(plain(0.005),plain(WEDGE_RAD)).toExponential(6), ((WEDGE_RAD-0.005)*c*A).toExponential(6))
// pure numeric integral of atan2(off,r)*r over profile, by scanline
import { pointInProfile } from '../src/core/profile'
const poly=lambProfile()
let I=0, Aq=0
const N=1200
const xs=poly.map(p=>p.x), ys=poly.map(p=>p.y)
const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys)
const dx=(x1-x0)/N, dy=(y1-y0)/N
for(let i=0;i<N;i++)for(let j=0;j<N;j++){
  const x=x0+(i+0.5)*dx, y=y0+(j+0.5)*dy
  if(!pointInProfile(poly,x,y))continue
  Aq+=dx*dy; I+=Math.atan2(0.0008,x)*x*dx*dy
}
console.log('quad area',Aq.toExponential(6),'vs',A.toExponential(6),' integral',I.toExponential(6),'off*A',(0.0008*A).toExponential(6))
