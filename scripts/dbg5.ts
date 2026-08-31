import { WEDGE_RAD } from '../src/core/profile'
import { buildSector } from '../src/core/sector'
import { expandedProfile } from '../src/core/sector'
const step=(0.2*Math.PI)/180
const m = buildSector({a:{theta:0,offset:0.0008,cutR:0}, b:{theta:WEDGE_RAD,offset:0,cutR:Infinity}, step, capA:false, capB:false})
const np = expandedProfile().length
console.log('np',np,'verts',m.position.length/3)
let bad=0, samples:string[]=[]
for (let i=0;i<np;i++){
  const x=m.position[i*3], z=m.position[i*3+2]
  const r=Math.hypot(x,z), t=Math.atan2(z,x)
  const d=r*Math.sin(t)
  if (Math.abs(d-0.0008)>1e-9) bad++
  if (i%20===0) samples.push(`r=${r.toFixed(4)} t=${t.toExponential(3)} dist=${d.toExponential(4)}`)
}
console.log('bad',bad,'of',np); console.log(samples.join('\n'))
