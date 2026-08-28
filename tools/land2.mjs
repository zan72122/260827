import { page, browser, shot, state, swipe, press, logs, W, H } from './drive.mjs'
const log = async (t) => console.log(t.padEnd(10), JSON.stringify(await state()))
const phase = () => page.evaluate(() => window.__app.game.phase)
const wait = async (p, ms = 45000) => { const t = Date.now(), w = [].concat(p)
  while (Date.now() - t < ms) { if (w.includes(await phase())) return true; await page.waitForTimeout(200) }
  console.log('!! timeout', p, await phase()); return false }
const snap = async (n) => { await page.evaluate(() => window.__app.game.snapCamera()); await page.waitForTimeout(300); await shot(n) }
await page.click('#start'); await page.waitForTimeout(1500)
await swipe(W*0.5, H*0.2, W*0.5, H*0.8, 22)
await wait('watch'); await page.waitForTimeout(3500); await snap('80-bare')
await press(W*0.5, H*0.6, 5000); await wait('bait'); await page.waitForTimeout(2200); await snap('81-tub')
await swipe(W*0.28, H*0.6, W*0.74, H*0.62, 24); await page.waitForTimeout(2600); await snap('82-baited')
await swipe(W*0.5, H*0.16, W*0.5, H*0.76, 22); await page.waitForTimeout(2400); await snap('83-cut')
await wait('snow'); await page.waitForTimeout(4000); await snap('84-snow'); await log('snow')
await page.waitForTimeout(7000); await snap('85-turn'); await log('turn')
// jig, release
await swipe(W*0.5, H*0.6, W*0.5, H*0.48, 6, 150); await page.waitForTimeout(400)
console.log('bite', await wait('bite', 30000)); await snap('86-bite')
await swipe(W*0.5, H*0.6, W*0.5, H*0.42, 3); await page.waitForTimeout(600)
if (!(await wait(['hooked','reelup'], 10000))) { await swipe(W*0.5, H*0.6, W*0.5, H*0.42, 3); await wait(['hooked','reelup'], 15000) }
await log('hooked')
await press(W*0.5, H*0.62, 7000)
await wait(['deliver','settle'], 25000); await snap('87-deliver')
await wait('settle', 20000); await page.waitForTimeout(1200); await snap('88-tank'); await log('tank')
await wait('bait', 20000); await log('trial2')
console.log('--- console ---'); console.log(logs.slice(0,20).join('\n'))
await browser.close()
