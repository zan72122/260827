/**
 * perf-runtime.mjs — frame timing in the browser.
 *
 * NOTE: this environment has no GPU; Chromium is running SwiftShader, so these
 * numbers are a software-rendering floor, not a phone measurement.
 */
import { launch, openGame, settle } from './shots.mjs'

const b = await launch()
const out = []
for (const [tag, viewport] of [
  ['portrait 430x932', { width: 430, height: 932 }],
  ['landscape 932x430', { width: 932, height: 430 }],
]) {
  const p = await openGame(b, { viewport, query: '?auto=1&debug=1' })
  await settle(p, 40)
  const C = await p.evaluate(() => window.__reifen.constants)

  const measure = (n) =>
    p.evaluate(
      (n) =>
        new Promise((res) => {
          const t = []
          let last = performance.now()
          let i = 0
          const tick = () => {
            const now = performance.now()
            t.push(now - last)
            last = now
            if (++i >= n) {
              t.sort((a, b) => a - b)
              res({
                median: +t[t.length >> 1].toFixed(2),
                p95: +t[Math.floor(t.length * 0.95)].toFixed(2),
                worst: +t[t.length - 1].toFixed(2),
              })
            } else requestAnimationFrame(tick)
          }
          requestAnimationFrame(tick)
        }),
      n,
    )

  const idle = await measure(140)
  // now saw continuously, which rebuilds both collars every frame
  await p.evaluate(
    ([start, end]) => {
      let r = start
      window.__sawTimer = setInterval(() => {
        r -= 0.002
        if (r < end) r = start
        window.__reifen.setCarriage(r)
      }, 8)
    },
    [C.SAW_CARRIAGE_START, C.SAW_CARRIAGE_END],
  )
  const sawing = await measure(140)
  await p.evaluate(() => clearInterval(window.__sawTimer))
  const info = await p.evaluate(() => window.__reifen.info())
  out.push({ view: tag, idle, sawing, drawCalls: info.calls, triangles: info.triangles })
  await p.close()
}
for (const r of out) {
  console.log(
    `${r.view}\n  idle    median ${r.idle.median} ms (${(1000 / r.idle.median).toFixed(0)} fps)  p95 ${r.idle.p95}  worst ${r.idle.worst}`,
  )
  console.log(
    `  sawing  median ${r.sawing.median} ms (${(1000 / r.sawing.median).toFixed(0)} fps)  p95 ${r.sawing.p95}  worst ${r.sawing.worst}`,
  )
  console.log(`  draw calls ${r.drawCalls}   triangles ${r.triangles}`)
}
await b.close()
