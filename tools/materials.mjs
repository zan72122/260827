// One frame per camera in the chain, for a materials and framing review.
import { page, browser, shot, logs } from './drive.mjs'
const set = async (shotName, prep) => {
  if (prep) await page.evaluate(prep)
  await page.evaluate((s) => { const g = window.__app.game; g.setShot(s, 9); g.snapCamera() }, shotName)
  await page.waitForTimeout(450)
  await shot(shotName)
}
await page.click('#start')
await page.waitForTimeout(2500)
await set('wide')
await set('seat')
await set('tub', () => { window.__app.game.setPhase('bait') })
await set('macro')
await set('baitedRig', () => { const g = window.__app.game; g.rig.addLoad(1); g.showBaitT = 1.2 })
await set('reelShot', () => { const g = window.__app.game; g.setPhase('bait') })
await set('tip')
await set('cutaway', () => { const g = window.__app.game; g.rig.setLoad(0.9); g.rigTopY = -1.9; g.setPhase('descend'); g.cutAmount = 1
  window.__app.game.snow.clear(); for (let i = 0; i < 200; i++) g.update(0.05, window.innerWidth / window.innerHeight) })
await set('snowSide')
await set('tank', () => { const g = window.__app.game; g.setPhase('bite'); g.setHook(); g.setPhase('deliver')
  for (let i = 0; i < 90; i++) g.update(0.05, window.innerWidth / window.innerHeight) })
console.log('console:', logs.length ? logs.join('\n') : '(clean)')
await browser.close()
