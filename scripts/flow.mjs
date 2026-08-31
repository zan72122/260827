/** Drives the real game (its own cameras) through the whole flow, in both
 *  screen orientations, and saves the frames a reviewer needs to see. */
import { launch, openGame, settle } from './shots.mjs'
import fs from 'node:fs'
fs.mkdirSync('shots', { recursive: true })

const b = await launch()

for (const [tag, viewport] of [
  ['p', { width: 430, height: 932 }],
  ['l', { width: 932, height: 430 }],
]) {
  const p = await openGame(b, { viewport, query: '?auto=1' })
  await settle(p, 10)
  const C = await p.evaluate(() => window.__reifen.constants)
  const LEAD = C.SAW_LEAD
  const set = (fn, v) => p.evaluate(([fn, v]) => window.__reifen[fn](v), [fn, v])
  const shot = async (n) => {
    await p.evaluate(() => window.__reifen.snap()) // jump the camera to its target
    await settle(p, 2)
    await p.screenshot({ path: `shots/f-${tag}-${n}.png` })
  }

  await shot('1-start')
  await set('setCarriage', 0.170 + LEAD); await settle(p, 4); await shot('2-cut-half')
  await set('setCarriage', C.R_INNER - 0.012 + LEAD); await settle(p, 45); await shot('3-parted')
  await set('setSlide', 0.055); await settle(p, 4); await shot('4-pull-gap')
  await set('setSlide', C.SLIDE_TURN_UNLOCK); await settle(p, 20); await shot('5-out')
  const yt = await p.evaluate(() => window.__reifen.state.yawTarget)
  await set('setYaw', yt * 0.55); await settle(p, 4); await shot('6-turning')
  await set('setYaw', yt); await settle(p, 45); await shot('7-revealed')
  console.log(tag, 'phase', await p.evaluate(() => window.__reifen.phase()),
              'errors', p.__errors.filter((e) => !e.includes('404')))
  await p.close()
}
await b.close()
