import { chromium } from 'playwright'
import fs from 'node:fs'
const [a, b_, out] = process.argv.slice(2)
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const p = await br.newPage()
const png = await p.evaluate(async ([fa, fb]) => {
  const load = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = src })
  const [ia, ib] = await Promise.all([load(fa), load(fb)])
  const c = document.createElement('canvas'); c.width = ia.width; c.height = ia.height
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(ia, 0, 0); const da = ctx.getImageData(0, 0, c.width, c.height)
  ctx.clearRect(0,0,c.width,c.height); ctx.drawImage(ib, 0, 0); const db = ctx.getImageData(0, 0, c.width, c.height)
  const o = ctx.createImageData(c.width, c.height)
  let n = 0
  for (let k = 0; k < da.data.length; k += 4) {
    const d = Math.abs(da.data[k]-db.data[k]) + Math.abs(da.data[k+1]-db.data[k+1]) + Math.abs(da.data[k+2]-db.data[k+2])
    const v = Math.min(255, d * 3)
    if (d > 12) n++
    o.data[k] = v; o.data[k+1] = v * 0.3; o.data[k+2] = 255 - v; o.data[k+3] = 255
  }
  ctx.putImageData(o, 0, 0)
  return { url: c.toDataURL('image/png'), n, total: c.width * c.height }
}, [a, b_].map((f) => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64')))
fs.writeFileSync(out, Buffer.from(png.url.split(',')[1], 'base64'))
console.log(`${a} vs ${b_}: ${png.n} px differ (${(100*png.n/png.total).toFixed(3)}%) -> ${out}`)
await br.close()
