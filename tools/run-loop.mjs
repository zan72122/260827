// Event driven walk of the whole loop, twice, with one variable changed.
import { page, browser, shot, state, swipe, press, logs, W, H } from './drive.mjs'
const log = async (t) => console.log(t.padEnd(10), JSON.stringify(await state()))
const phase = () => page.evaluate(() => window.__app.game.phase)
const waitPhase = async (ph, ms = 40000) => {
  const t0 = Date.now(), want = Array.isArray(ph) ? ph : [ph]
  while (Date.now() - t0 < ms) {
    if (want.includes(await phase())) return true
    await page.waitForTimeout(200)
  }
  console.log('!! timeout waiting for', ph, 'now', await phase())
  return false
}
const snap = async (n) => {
  await page.evaluate(() => window.__app.game.snapCamera())
  await page.waitForTimeout(300)
  await shot(n)
}

await page.click('#start')
await page.waitForTimeout(1500)

// --- the first drop is the bare test rig: no bait, no reaction ---
await swipe(W * 0.5, H * 0.20, W * 0.5, H * 0.74, 22)
await waitPhase('watch')
await page.waitForTimeout(5000)
await snap('20-bare-under')
await log('bare')
await page.waitForTimeout(6000)
await log('bare-late')
await press(W * 0.5, H * 0.62, 5000)
await waitPhase('bait')

async function trial({ passes, depthPx, tag }) {
  // bait: n passes through the krill
  await waitPhase('bait')
  await page.waitForTimeout(1800)
  if (tag === 'a') await snap('30-tub')
  for (let i = 0; i < passes; i++) {
    const l = W * 0.15, r = W * 0.9
    if (i % 2 === 0) await swipe(l, H * 0.62, r, H * 0.64, 24)
    else await swipe(r, H * 0.64, l, H * 0.62, 24)
    await page.waitForTimeout(1400)
    if (tag === 'a' && i === 0) await snap('31-pass')
  }
  await log(`${tag}-baited`)
  if (tag === 'a') await snap('32-baited')
  // drop
  await swipe(W * 0.5, H * 0.18, W * 0.5, H * 0.18 + depthPx, 22)
  await page.waitForTimeout(1500)
  if (tag === 'a') await snap('33-cutaway')
  await waitPhase('snow')
  await log(`${tag}-snow`)
  // watch the first fish turn
  const t0 = Date.now()
  let firstTurn = -1
  while (Date.now() - t0 < 30000) {
    const st = await page.evaluate(() => ({ f: window.__app.game.school.firstTurnAge, i: window.__app.game.school.interested, h: window.__app.game.school.atHook }))
    if (st.f >= 0 && firstTurn < 0) { firstTurn = (Date.now() - t0) / 1000; await snap(`34-${tag}-firstturn`); console.log(`${tag} first turn after ${firstTurn}s, interested ${st.i}`) }
    if (firstTurn > 0 && (Date.now() - t0) / 1000 > firstTurn + 4) { await snap(`35-${tag}-cascade`); await log(`${tag}-cascade`); break }
    await page.waitForTimeout(300)
  }
  while (Date.now() - t0 < 40000) {
    const st = await page.evaluate(() => window.__app.game.school.atHook)
    if (st > 0) break
    await page.waitForTimeout(300)
  }
  await snap(`36-${tag}-athook`); await log(`${tag}-athook`)
  // jig once, let go
  await swipe(W * 0.5, H * 0.58, W * 0.5, H * 0.50, 6, 150)
  await page.waitForTimeout(400)
  const gotBite = await waitPhase('bite', 30000)
  console.log(`${tag} bite:`, gotBite)
  if (tag === 'a') await snap('37-bite')
  // short flick up
  await swipe(W * 0.5, H * 0.58, W * 0.5, H * 0.44, 3)
  await page.waitForTimeout(500)
  if (!(await waitPhase(['hooked', 'reelup'], 12000))) {
    await swipe(W * 0.5, H * 0.58, W * 0.5, H * 0.44, 3)
    await waitPhase(['hooked', 'reelup'], 15000)
  }
  await log(`${tag}-hooked`)
  await press(W * 0.5, H * 0.66, 6000)
  await waitPhase(['deliver', 'settle'], 25000)
  if (tag === 'a') await snap('38-deliver')
  await waitPhase('settle', 20000)
  await page.waitForTimeout(1500)
  await snap(`39-${tag}-tank`); await log(`${tag}-tank`)
}

await trial({ passes: 1, depthPx: H * 0.55, tag: 'a' })
await trial({ passes: 2, depthPx: H * 0.55, tag: 'b' })
console.log('--- console ---')
console.log(logs.slice(0, 30).join('\n'))
await browser.close()
