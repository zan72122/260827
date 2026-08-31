/** 20 replays back to back: input, meshes, audio and memory must all survive. */
import { launch, openGame, settle } from './shots.mjs'

const b = await launch()
const p = await openGame(b, { viewport: { width: 430, height: 932 }, query: '?auto=1' })
await settle(p, 30)
const C = await p.evaluate(() => window.__reifen.constants)
const call = (fn, v) => p.evaluate(([fn, v]) => window.__reifen[fn](v), [fn, v])

const samples = []
const ROUNDS = 20
for (let i = 0; i < ROUNDS; i++) {
  // saw all the way in, in small steps, like a finger would
  for (let r = C.SAW_CARRIAGE_START; r > C.SAW_CARRIAGE_END; r -= 0.008) await call('setCarriage', r)
  await call('setCarriage', C.SAW_CARRIAGE_END)
  await settle(p, 3)
  for (let s = 0; s <= C.SLIDE_TURN_UNLOCK; s += 0.012) await call('setSlide', s)
  await call('setSlide', C.SLIDE_TURN_UNLOCK)
  await settle(p, 8)
  const yt = await p.evaluate(() => window.__reifen.state.yawTarget)
  for (let y = 0; y <= yt; y += yt / 12) await call('setYaw', y)
  await call('setYaw', yt)
  await settle(p, 20)
  const phase = await p.evaluate(() => window.__reifen.phase())
  const info = await p.evaluate(() => window.__reifen.info())
  const heap = await p.evaluate(() => performance.memory?.usedJSHeapSize ?? 0)
  const realloc = await p.evaluate(() => window.__reifen.blank.collarReallocations)
  const row = { i, phase, geometries: info.geometries, textures: info.textures, programs: info.programs, collarAllocs: realloc, heapMB: +(heap / 1048576).toFixed(1) }
  samples.push(row)
  console.log('round', JSON.stringify(row))
  if (phase !== 'done') { console.error('round', i, 'did not finish:', phase); break }
  await p.evaluate(() => window.__reifen.replay())
  await settle(p, 90)
  const after = await p.evaluate(() => window.__reifen.phase())
  if (after !== 'cut') { console.error('round', i, 'reset left phase', after); break }
}

const first = samples[1], last = samples[samples.length - 1]
console.log('rounds completed:', samples.length)
console.log('geometry delta:', last.geometries - first.geometries)
console.log('texture delta:', last.textures - first.textures)
console.log('program delta:', last.programs - first.programs)
console.log('heap delta MB:', +(last.heapMB - first.heapMB).toFixed(1))
console.log('page errors:', p.__errors.filter((e) => !e.includes('404')))
const state = await p.evaluate(() => {
  const s = window.__reifen.state
  return { plays: s.plays, cut: s.cut, slide: s.slide, yaw: s.yaw, phase: s.phase }
})
console.log('final state:', state)
await b.close()
