import { chromium } from '@playwright/test'
const args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']
const [w,h,patchJson,out,setup] = process.argv.slice(2)
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args })
const p = await b.newPage({ viewport:{width:+w,height:+h} })
await p.goto('http://127.0.0.1:4173/')
await p.waitForFunction(()=>window.__orgel)
const which = (+w >= +h) ? 'landscape' : 'portrait'
if (patchJson && patchJson !== '-') await p.evaluate(([wh,q])=>window.__orgel.tune(wh,q), [which, JSON.parse(patchJson)])
if (setup) await p.evaluate((code)=>{ new Function('o', code)(window.__orgel) }, setup)
await p.waitForTimeout(700)
console.log(JSON.stringify(await p.evaluate(()=>window.__orgel.probe())))
await p.screenshot({ path: out ?? 'docs/evidence/tune.png' })
await b.close()
