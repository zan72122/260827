import { launch, openGame, settle } from './shots.mjs'
import fs from 'node:fs'
fs.mkdirSync('shots', { recursive: true })

const b = await launch()
const p = await openGame(b, { viewport: { width: 1000, height: 760 }, query: '?plain=1&orbit=1' })
await settle(p, 15)

async function look(az, el, d, tx = 0, ty = 0.05, tz = 0) {
  await p.evaluate(([az, el, d, tx, ty, tz]) => {
    const { camera } = window.__reifen
    const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180
    camera.position.set(tx + d * Math.cos(e) * Math.cos(a), ty + d * Math.sin(e), tz + d * Math.cos(e) * Math.sin(a))
    camera.lookAt(tx, ty, tz)
  }, [az, el, d, tx, ty, tz])
  await settle(p, 3)
}
const setC = (r) => p.evaluate((r) => window.__reifen.setCarriage(r), r)
const setS = (s) => p.evaluate((s) => window.__reifen.setSlide(s), s)
const setY = (y) => p.evaluate((y) => window.__reifen.setYaw(y), y)
const shot = (n) => p.screenshot({ path: `shots/${n}.png` })

const C = await p.evaluate(() => window.__reifen.constants)
const START = C.SAW_CARRIAGE_START, LEAD = C.SAW_LEAD

// --- cut in stages ---------------------------------------------------------
for (const [name, bladeR] of [['s1-cut-25', 0.180], ['s2-cut-60', 0.145], ['s3-cut-95', 0.108]]) {
  await setC(bladeR + LEAD)
  await settle(p, 3)
  await look(20, 34, 0.40, 0.16, 0.055, 0)
  await shot(name)
}
// blade pulled back out: the kerf must stay open
await setC(START)
await settle(p, 3)
await look(20, 34, 0.40, 0.16, 0.055, 0)
await shot('s4-saw-retracted-kerf-stays')

// --- full part-off + pull --------------------------------------------------
await setC(C.R_INNER - 0.012 + LEAD)
await settle(p, 3)
for (const [name, s] of [['s5-pull-30', 0.040], ['s6-pull-70', 0.092], ['s7-pull-full', C.SLIDE_MAX]]) {
  await setS(s)
  await settle(p, 3)
  await look(14, 36, 0.62, 0.14, 0.055, 0)
  await shot(name)
}
// --- turn ------------------------------------------------------------------
for (const [name, y] of [['s8-turn-45', 0.62], ['s9-turn-full', Math.PI / 2 - 0.12]]) {
  await setY(y)
  await settle(p, 3)
  await look(7, 17, 0.55, 0.19, 0.055, 0)
  await shot(name)
}
// --- inspection views of the extracted blank -------------------------------
const px = C.PIVOT_R + C.SLIDE_MAX
await look(7, 4, 0.30, px, 0.058, 0);  await shot('s10-lamb-front')
await look(97, 4, 0.30, px, 0.058, 0); await shot('s11-lamb-edge')
await look(187, 6, 0.30, px, 0.058, 0);await shot('s12-lamb-back')
await look(7, 62, 0.30, px, 0.058, 0); await shot('s13-lamb-top')
console.log('errors', p.__errors.filter(e => !e.includes('404')))
await b.close()
