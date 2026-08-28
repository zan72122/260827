// Five conditions, each captured as a short sequence so the change over
// time is visible. No captions, no overlays -- exactly what a player sees.
import { page, browser, shot, logs } from './drive.mjs'

const setup = (o) => page.evaluate((opt) => {
  const g = window.__app.game
  g.snow.clear(); g.field.reset(); g.school.reset(-3.85)
  g.rig.setLoad(opt.load)
  g.setPhase('snow')
  g.rigTopY = opt.rigY
  g.baited = opt.load > 0
  g.flowTarget = opt.flow
  g.setShot('snowSide', 9)
  return true
}, o)

const stats = () => page.evaluate(() => {
  const g = window.__app.game
  return { live: g.snow.liveCount, i: g.school.interested, h: g.school.atHook, ft: +g.school.firstTurnAge.toFixed(1) }
})

// step the simulation at a fixed 20 Hz so every condition sees exactly
// the same elapsed time regardless of how fast the machine renders
const step = (seconds) => page.evaluate((sec) => {
  const g = window.__app.game
  const ar = window.innerWidth / window.innerHeight
  for (let i = 0; i < Math.round(sec / 0.05); i++) g.update(0.05, ar)
}, seconds)

const run = async (tag, o, marks) => {
  await setup(o)
  let t = 0
  const line = []
  for (const m of marks) {
    await step(m - t)
    t = m
    await page.evaluate(() => window.__app.game.snapCamera())
    await page.waitForTimeout(300)
    await shot(`${tag}-t${String(m).padStart(2, '0')}`)
    const s = await stats()
    line.push(`t=${m}s grains=${s.live} interested=${s.i} atHook=${s.h}`)
  }
  console.log(tag.padEnd(16), line.join(' | '))
}

await page.click('#start')
await page.waitForTimeout(2500)
const M = [1, 8, 18, 30]
await run('A-no-bait',    { load: 0,   rigY: -3.9, flow: 0.03 }, M)
await run('B-one-pass',   { load: 0.9, rigY: -3.9, flow: 0.03 }, M)
await run('C-two-pass',   { load: 1.8, rigY: -3.9, flow: 0.03 }, M)
await run('D-shallow',    { load: 0.9, rigY: -2.0, flow: 0.03 }, M)
await run('E-same-depth', { load: 0.9, rigY: -3.9, flow: 0.03 }, M)
console.log('console:', logs.length ? logs.join('\n') : '(clean)')
await browser.close()
