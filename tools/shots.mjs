import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
mkdirSync('artifacts/shots', { recursive: true })
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox','--disable-background-networking','--no-first-run','--disable-component-update'] })
// [name, w, h, open, clipped]
const jobs = JSON.parse(process.argv[2])
for (const [name, w, h, open, clipped] of jobs) {
  const ctx = await browser.newContext({ viewport:{width:w,height:h}, deviceScaleFactor:1 })
  await ctx.route('**', r => r.request().url().startsWith('http://127.0.0.1') ? r.continue() : r.abort())
  const page = await ctx.newPage()
  page.on('pageerror', e=>console.log('PAGEERR', e.stack||e.message))
  page.on('console', m=>{ if(m.type()==='error') console.log('CONSOLE', m.text()) })
  await page.goto(`http://127.0.0.1:4173/?fixq=1&open=${open}`, { waitUntil:'load' })
  await page.waitForFunction(()=>!!window.__game, null, {timeout:60000})
  if (clipped) { await page.evaluate(()=>{ window.__game.setClip(1); window.__game.releaseClip() }); await page.waitForTimeout(2500) }
  await page.waitForTimeout(700)
  await page.screenshot({ path:`artifacts/shots/${name}.png`, timeout:180000, animations:'disabled' })
  console.log(name, JSON.stringify(await page.evaluate(()=>window.__game.stats())))
  await ctx.close()
}
await browser.close()
