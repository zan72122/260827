import { chromium } from '@playwright/test'
const args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args })
const out = []
for (const [w,h] of [[390,844],[844,390],[820,1180],[1180,820]]) {
  const p = await b.newPage({ viewport:{width:w,height:h}, deviceScaleFactor: +(process.env.DSF ?? 1) })
  await p.goto('http://127.0.0.1:4173/'); await p.waitForFunction(()=>window.__orgel); await p.waitForTimeout(1200)
  const measure = async (label) => p.evaluate(async (lb)=>{
    const f0 = window.__orgel.frames(); const t0 = performance.now()
    await new Promise(res => setTimeout(res, 4000))
    const n = window.__orgel.frames() - f0
    const info = window.__orgel.stage.renderer.info.render
    return { [lb]: +(n / ((performance.now()-t0)/1000)).toFixed(1), calls: info.calls, tris: info.triangles,
             dpr: window.__orgel.stage.renderer.getPixelRatio() }
  }, label)
  const idle = await measure('fpsIdle')
  await p.evaluate(()=>{ window.__orgel.setTravel(0.45); window.__orgel.advance(Math.PI*20) })
  const busy = await measure('fpsPlaying')
  const r = { ...idle, ...busy }
  out.push({ size:`${w}x${h}`, ...r })
  await p.close()
}
console.log(JSON.stringify(out, null, 1))
await b.close()
