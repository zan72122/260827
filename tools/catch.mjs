import { page, browser, shot, state, swipe, press, logs, W, H } from './drive.mjs'
const phase = () => page.evaluate(() => window.__app.game.phase)
const wait = async (p, ms=45000) => { const t=Date.now(), w=[].concat(p)
  while (Date.now()-t<ms) { if (w.includes(await phase())) return true; await page.waitForTimeout(150) } 
  console.log('!!timeout',p,await phase()); return false }
const snap = async (n) => { await page.evaluate(()=>window.__app.game.snapCamera()); await page.waitForTimeout(280); await shot(n) }
await page.click('#start'); await page.waitForTimeout(1500)
// straight to a baited drop
await page.evaluate(() => { const g = window.__app.game; g.setPhase('bait') })
await page.waitForTimeout(1500)
await swipe(W*0.12, H*0.6, W*0.92, H*0.62, 24); await page.waitForTimeout(2400)
await swipe(W*0.5, H*0.15, W*0.5, H*0.78, 22)
await wait('snow'); await page.waitForTimeout(1000)
// wait until fish are at the hooks
const t0 = Date.now()
while (Date.now()-t0 < 60000) { const h = await page.evaluate(()=>window.__app.game.school.atHook); if (h>0) break; await page.waitForTimeout(400) }
await swipe(W*0.5, H*0.6, W*0.5, H*0.5, 6, 150); await page.waitForTimeout(300)
console.log('bite', await wait('bite', 40000))
await swipe(W*0.5, H*0.6, W*0.5, H*0.42, 3); await page.waitForTimeout(400)
if (!(await wait(['hooked','reelup'], 8000))) { await swipe(W*0.5,H*0.6,W*0.5,H*0.42,3); await wait(['hooked','reelup'],15000) }
await snap('a1-hooked'); await log_()
await press(W*0.5, H*0.66, 1200)
await page.waitForTimeout(1200); await snap('a2-reelup')
await press(W*0.5, H*0.66, 5000)
await wait('deliver', 25000); await page.waitForTimeout(300); await snap('a3-outofwater')
await page.waitForTimeout(1200); await snap('a4-releaser')
await wait('settle', 20000); await page.waitForTimeout(1400); await snap('a5-tank')
async function log_(){ console.log(JSON.stringify(await state())) }
await log_()
console.log('--- console ---'); console.log(logs.slice(0,15).join('\n'))
await browser.close()
