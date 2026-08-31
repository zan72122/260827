/**
 * verify.mjs — the shape-and-motion evidence set, shot in the bare
 * environment so nothing can be hidden by the workshop.
 */
import { launch, openGame, settle } from './shots.mjs'
import fs from 'node:fs'
fs.mkdirSync('shots', { recursive: true })

const b = await launch()
const p = await openGame(b, { viewport: { width: 1000, height: 720 }, query: '?plain=1&orbit=1' })
await settle(p, 12)
const C = await p.evaluate(() => window.__reifen.constants)
const call = (fn, v) => p.evaluate(([fn, v]) => window.__reifen[fn](v), [fn, v])

async function look(az, el, d, tx = 0, ty = 0.06, tz = 0) {
  await p.evaluate(([az, el, d, tx, ty, tz]) => {
    const { camera } = window.__reifen
    const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180
    camera.position.set(tx + d * Math.cos(e) * Math.cos(a), ty + d * Math.sin(e), tz + d * Math.cos(e) * Math.sin(a))
    camera.lookAt(tx, ty, tz)
  }, [az, el, d, tx, ty, tz])
  await settle(p, 2)
}
const shot = (n) => p.screenshot({ path: `shots/v-${n}.png` })

// ---- 1. the prepared blank, from four sides ------------------------------
await look(40, 32, 0.60); await shot('01-blank-oblique')
await look(0, 87, 0.58);  await shot('02-blank-top')
await look(8, 3, 0.56);   await shot('03-blank-side')
await look(184, 26, 0.58);await shot('04-blank-back')
await look(3, 20, 0.16, 0.20, 0.055); await shot('05-prepared-kerf-closeup')

// ---- 2. the cut following the blade --------------------------------------
for (const [n, bladeR] of [['06-cut-25', 0.181], ['07-cut-60', 0.145], ['08-cut-98', 0.106]]) {
  await call('setCarriage', bladeR + C.SAW_LEAD)
  await settle(p, 2)
  await look(24, 40, 0.30, 0.15, 0.055); await shot(n)
}
// blade drawn back out: the kerf must stay exactly as deep
await call('setCarriage', C.SAW_CARRIAGE_START)
await settle(p, 2)
await look(24, 40, 0.30, 0.15, 0.055); await shot('09-saw-back-kerf-unchanged')

// wedge must not move while it is still joined
await call('setSlide', 0.09)
const stuck = await p.evaluate(() => window.__reifen.state.slide)
console.log('slide while still joined (must be 0):', stuck)

// ---- 3. parted, pulled, turned -------------------------------------------
await call('setCarriage', C.SAW_CARRIAGE_END)
await settle(p, 3)
for (const [n, s] of [['10-pull-30', 0.040], ['11-pull-70', 0.092], ['12-pull-full', C.SLIDE_MAX]]) {
  await call('setSlide', s); await settle(p, 2)
  await look(16, 34, 0.56, 0.13, 0.055); await shot(n)
}
const yt = await p.evaluate(() => window.__reifen.state.yawTarget)
await call('setYaw', yt); await settle(p, 2)
await look(90 - (yt * 180) / Math.PI, 16, 0.42, 0.20, 0.055); await shot('13-turned-face-on')

// ---- 4. the extracted blank from every side ------------------------------
const px = C.PIVOT_R + C.SLIDE_MAX
const yawDeg = (yt * 180) / Math.PI
for (const [n, off, el] of [
  ['14-lamb-face', 0, 3],
  ['15-lamb-edge', 90, 3],
  ['16-lamb-back', 180, 4],
  ['17-lamb-top', 0, 66],
  ['18-lamb-low3q', 34, 9],
]) {
  await look(90 - yawDeg + off, el, 0.26, px, 0.058); await shot(n)
}

// ---- 5. put it back: the blank must reconstruct --------------------------
await call('setYaw', 0)
await call('setSlide', 0)
await settle(p, 3)
await look(40, 32, 0.60, 0, 0.06); await shot('19-returned-oblique')
await look(0, 87, 0.58, 0, 0.06);  await shot('20-returned-top')
await look(3, 20, 0.16, 0.20, 0.055); await shot('21-returned-kerf-closeup')

console.log('errors', p.__errors.filter((e) => !e.includes('404')))
await b.close()
