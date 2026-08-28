// Produces the five comparison states with no text, for a fresh reviewer.
import { page, browser, shot, logs } from './drive.mjs'

const setup = async (opts) => page.evaluate((o) => {
  const g = window.__app.game
  g.snow.clear(); g.field.reset(); g.school.reset(-3.85)
  g.school.center.set(-0.4, -3.85, -2.6)
  g.rig.setLoad(o.load)
  g.setPhase('snow')
  g.rigTopY = o.rigY
  g.baited = o.load > 0
  g.flowTarget = o.flow
  window.__app.scene.updateMatrixWorld(true)
  return true
}, opts)

const run = async (name, opts, seconds) => {
  await setup(opts)
  const t0 = Date.now()
  const marks = []
  while ((Date.now() - t0) / 1000 < seconds) {
    await page.waitForTimeout(500)
    marks.push(await page.evaluate(() => {
      const g = window.__app.game
      return { t: 0, live: g.snow.liveCount, i: g.school.interested, h: g.school.atHook, ft: +g.school.firstTurnAge.toFixed(1) }
    }))
  }
  await page.evaluate(() => window.__app.game.setShot('snowSide', 9))
  await page.evaluate(() => window.__app.game.snapCamera())
  await page.waitForTimeout(400)
  await shot(name)
  const last = marks[marks.length - 1]
  const turnedAt = marks.findIndex((m) => m.ft >= 0)
  console.log(name.padEnd(22), 'grains', String(last.live).padStart(3),
    ' firstTurn', turnedAt < 0 ? 'never' : (turnedAt * 0.5).toFixed(1) + 's',
    ' interested', String(last.i).padStart(3), ' atHook', last.h)
}

await page.click('#start')
await page.waitForTimeout(2000)
await run('90-A-no-bait',       { load: 0,   rigY: -4.0, flow: 0.03 }, 30)
await run('91-B-one-pass',      { load: 0.9, rigY: -4.0, flow: 0.03 }, 30)
await run('92-C-two-pass',      { load: 1.8, rigY: -4.0, flow: 0.03 }, 30)
await run('93-D-shallow',       { load: 0.9, rigY: -2.1, flow: 0.03 }, 30)
await run('94-E-same-depth',    { load: 0.9, rigY: -3.9, flow: 0.03 }, 30)
await run('95-F-cross-flow',    { load: 0.9, rigY: -3.9, flow: 0.30 }, 30)
console.log('--- console ---'); console.log(logs.slice(0, 20).join('\n'))
await browser.close()
