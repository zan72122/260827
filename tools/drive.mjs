// Headless driver: loads the game, drives real pointer gestures, captures
// screenshots and every console message.
import { chromium } from 'playwright'
import fs from 'node:fs'

const URL = process.env.URL || 'http://localhost:4173/'
const OUT = process.env.OUT || 'shots'
const VIEW = process.env.VIEW || '390x844'
const [W, H] = VIEW.split('x').map(Number)
const TAG = process.env.TAG || 'p'

fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-lcd-text'],
})
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true, isMobile: true })
const logs = []
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))
page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`))

await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

const shot = async (name) => { await page.screenshot({ path: `${OUT}/${TAG}-${name}.png` }) }
const state = () => page.evaluate(() => {
  const g = window.__app.game
  return {
    phase: g.phase, trial: g.trial, shot: g.shot ?? null,
    load: +g.rig.totalLoad.toFixed(2),
    passes: g.passes ?? null,
    live: g.snow.liveCount,
    interested: g.school.interested,
    atHook: g.school.atHook,
    firstTurnAge: +g.school.firstTurnAge.toFixed(1),
    rigY: +g.rigRoot.position.y.toFixed(2),
    peak: +g.field.peak.v.toFixed(2),
    tank: g.tankFish?.length ?? 0,
    fps: Math.round(window.__app.fps),
  }
})

// gestures
const swipe = async (x0, y0, x1, y1, steps = 18, hold = 0) => {
  await page.mouse.move(x0, y0)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps)
    await page.waitForTimeout(12)
  }
  if (hold) await page.waitForTimeout(hold)
  await page.mouse.up()
}
const press = async (x, y, ms) => {
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.waitForTimeout(ms)
  await page.mouse.up()
}

export { page, browser, shot, state, swipe, press, logs, W, H }
