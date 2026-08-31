import fs from 'node:fs'
import { lambProfile, polygonArea, isSimplePolygon, R_INNER, R_OUTER, LAMB_HEIGHT } from '../src/core/profile'

const poly = lambProfile()
const S = 2400 / (R_OUTER - R_INNER + 0.02)
const pad = 0.01
const W = (R_OUTER - R_INNER + 2 * pad) * S
const H = (LAMB_HEIGHT + 2 * pad) * S
const px = (p: { x: number; y: number }) =>
  `${((p.x - R_INNER + pad) * S).toFixed(1)},${(H - (p.y + pad) * S).toFixed(1)}`
const d = poly.map(px).join(' ')
fs.writeFileSync(
  'shots/profile.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(0)}" height="${H.toFixed(0)}" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}">
<rect width="100%" height="100%" fill="#f4efe6"/>
<polygon points="${d}" fill="#c9a97a" stroke="#6b4f2e" stroke-width="3"/>
${poly.map((p) => `<circle cx="${px(p).split(',')[0]}" cy="${px(p).split(',')[1]}" r="3" fill="#b3402a"/>`).join('')}
</svg>`,
)
console.log('points', poly.length, 'area(cm2)', (Math.abs(polygonArea(poly)) * 1e4).toFixed(2), 'simple', isSimplePolygon(poly))
console.log('height(cm)', (LAMB_HEIGHT * 100).toFixed(1))
