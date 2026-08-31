import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
mkdirSync('artifacts/dev-views', { recursive: true })
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox','--disable-background-networking','--no-first-run','--disable-component-update'] })
const ctx = await browser.newContext({ viewport:{width:520,height:700}, deviceScaleFactor:1 })
await ctx.route('**', r => r.request().url().startsWith('http://127.0.0.1') ? r.continue() : r.abort())
const page = await ctx.newPage()
page.on('pageerror', e=>console.log('PAGEERR', e.message))
for (const open of ['0','0.5','1']) {
  await page.goto(`http://127.0.0.1:4173/?dev=1&fixq=1&open=${open}`, { waitUntil:'load' })
  await page.waitForFunction(()=>!!window.__dev, null, {timeout:60000})
  for (const v of ['front','side','back','top']) {
    await page.evaluate((vv)=>window.__dev.view(vv), v)
    await page.waitForTimeout(500)
    await page.screenshot({ path:`artifacts/dev-views/t${open}-${v}.png`, timeout:180000, animations:'disabled' })
  }
  console.log('done', open)
}
await browser.close()
