import { chromium } from 'playwright'
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox','--disable-background-networking','--no-first-run','--disable-component-update'] })
for (const [w,h] of [[390,844],[844,390],[820,1180],[1180,820]]) {
  const ctx = await browser.newContext({ viewport:{width:w,height:h}, deviceScaleFactor:1 })
  await ctx.route('**', r => r.request().url().startsWith('http://127.0.0.1') ? r.continue() : r.abort())
  const page = await ctx.newPage()
  await page.goto('http://127.0.0.1:4173/?open=1&lite=1&fixq=1', { waitUntil:'load' })
  await page.waitForFunction(()=>!!window.__game, null, {timeout:60000})
  await page.waitForTimeout(500)
  const r = await page.evaluate(()=>({a:window.__game.clipScreenAt(0), b:window.__game.clipScreenAt(1), tab:window.__game.tabScreen(), band:window.__game.frontBandY()}))
  console.log(`${w}x${h}`, 'clip0', Math.round(r.a.x), Math.round(r.a.y), '| clip1', Math.round(r.b.x), Math.round(r.b.y), '| tab', Math.round(r.tab.x), Math.round(r.tab.y), '| bandY', Math.round(r.band))
  await page.evaluate(()=>{ window.__game.setClip(1); window.__game.releaseClip() })
  await page.waitForTimeout(2500)
  const sw = await page.evaluate(()=>[0,1,2].map(i=>window.__game.swatchScreen(i)))
  console.log('   clipped swatches', sw.map(s=>`${Math.round(s.x)},${Math.round(s.y)}`).join(' | '))
  await ctx.close()
}
await browser.close()
