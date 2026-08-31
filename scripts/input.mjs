/**
 * input.mjs — drives the game with real pointer events only (no state hooks),
 * the way a finger would, and checks the rules hold.
 */
import { launch, openGame, settle } from './shots.mjs'

const b = await launch()
const p = await openGame(b, { viewport: { width: 430, height: 932 }, query: '?auto=1' })
await settle(p, 20)

const st = () =>
  p.evaluate(() => {
    const s = window.__reifen.state
    return {
      phase: s.phase,
      cut: s.cut === Infinity ? null : +s.cut.toFixed(4),
      carriage: +s.carriage.toFixed(4),
      slide: +s.slide.toFixed(4),
      yaw: +((s.yaw * 180) / Math.PI).toFixed(1),
      yawTarget: +((s.yawTarget * 180) / Math.PI).toFixed(1),
      parted: s.parted,
    }
  })

/** Screen position of a world point. */
const project = (x, y, z) =>
  p.evaluate(
    ([x, y, z]) => {
      const { camera, renderer } = window.__reifen
      const v = new (window.__reifen.scene.constructor.prototype.constructor === Object
        ? Object
        : Object)()
      void v
      const THREEVec = camera.position.constructor
      const pt = new THREEVec(x, y, z).project(camera)
      const r = renderer.domElement.getBoundingClientRect()
      return { x: r.left + ((pt.x + 1) / 2) * r.width, y: r.top + ((1 - pt.y) / 2) * r.height }
    },
    [x, y, z],
  )

const handlePos = async () => {
  const w = await p.evaluate(() => {
    const v = window.__reifen.saw.handleWorld(new window.__reifen.camera.position.constructor())
    return [v.x, v.y, v.z]
  })
  return project(...w)
}
const piecePos = async () => {
  const w = await p.evaluate(() => {
    const bb = window.__reifen.blank.pieceBox()
    return [(bb.min.x + bb.max.x) / 2, bb.min.y + 0.012, (bb.min.z + bb.max.z) / 2]
  })
  return project(...w)
}

async function dragTo(from, steps) {
  await p.mouse.move(from.x, from.y)
  await p.mouse.down()
  for (const s of steps) {
    await p.mouse.move(s.x, s.y)
    await settle(p, 1)
  }
  await p.mouse.up()
  await settle(p, 2)
}

const fail = []
const check = (name, ok, extra = '') => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '   ' + extra : ''))
  if (!ok) fail.push(name)
}

// ---- 1. feed the saw a little, with the finger on the handle -------------
let h = await handlePos()
await dragTo(h, [
  { x: h.x - 6, y: h.y - 30 },
  { x: h.x - 12, y: h.y - 60 },
  { x: h.x - 18, y: h.y - 90 },
])
let s1 = await st()
check('a drag on the handle starts the cut', s1.cut !== null && s1.cut < 0.2042, JSON.stringify(s1))
check('the kerf never leads the blade', s1.cut === null || s1.cut >= s1.carriage - 0.135 - 1e-9)
check('the wedge is still joined', !s1.parted)

// ---- 2. stopping holds the state ----------------------------------------
await settle(p, 60)
const s2 = await st()
check('stopping the finger stops the cut', s2.cut === s1.cut, `${s1.cut} -> ${s2.cut}`)

// ---- 3. the wedge will not move while it is joined -----------------------
let pp = await piecePos()
await dragTo(pp, [{ x: pp.x + 20, y: pp.y + 40 }, { x: pp.x + 40, y: pp.y + 80 }])
const s3 = await st()
check('a joined wedge cannot be pulled out', s3.slide === 0, JSON.stringify(s3))

// ---- 4. a pointercancel mid-drag ends cleanly ----------------------------
h = await handlePos()
await p.mouse.move(h.x, h.y)
await p.mouse.down()
await p.mouse.move(h.x - 8, h.y - 40)
await settle(p, 1)
const midCut = (await st()).cut
await p.evaluate(() => {
  const c = window.__reifen.renderer.domElement
  c.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }))
})
await settle(p, 5)
await p.mouse.move(h.x - 200, h.y - 400) // moving after cancel must do nothing
await settle(p, 3)
await p.mouse.up()
const s4 = await st()
check('pointercancel ends the gesture and keeps the state', s4.cut === midCut, `${midCut} -> ${s4.cut}`)

// ---- 5. a screen rotation mid-drag -------------------------------------
h = await handlePos()
await p.mouse.move(h.x, h.y)
await p.mouse.down()
await p.mouse.move(h.x - 10, h.y - 40)
await settle(p, 1)
const beforeRotate = await st()
await p.setViewportSize({ width: 932, height: 430 })
await settle(p, 8)
const afterRotate = await st()
check(
  'rotating the screen mid-drag keeps the cut',
  afterRotate.cut === beforeRotate.cut && afterRotate.carriage === beforeRotate.carriage,
  `${JSON.stringify(beforeRotate)} -> ${JSON.stringify(afterRotate)}`,
)
check('the turn target follows the new orientation', afterRotate.yawTarget !== beforeRotate.yawTarget,
  `${beforeRotate.yawTarget} -> ${afterRotate.yawTarget}`)
await p.mouse.up()
await p.setViewportSize({ width: 430, height: 932 })
await settle(p, 8)

// ---- 6. finish the cut with the finger ----------------------------------
for (let i = 0; i < 14; i++) {
  h = await handlePos()
  await dragTo(h, [{ x: h.x - 4, y: h.y - 45 }])
  if ((await st()).parted) break
}
const s6 = await st()
check('the finger can part the wedge right through', s6.parted, JSON.stringify(s6))
check('parting moves the game on to pulling', s6.phase === 'pull' || s6.phase === 'turn')

// ---- 7. pull it out ------------------------------------------------------
await settle(p, 60) // let the saw draw itself back
for (let i = 0; i < 12; i++) {
  pp = await piecePos()
  await dragTo(pp, [{ x: pp.x + 8, y: pp.y + 34 }])
  if ((await st()).phase === 'turn') break
}
const s7 = await st()
check('the finger can pull the wedge out', s7.slide > 0.10, JSON.stringify(s7))

// ---- 8. turn it ----------------------------------------------------------
await settle(p, 30)
for (let i = 0; i < 14; i++) {
  pp = await piecePos()
  await dragTo(pp, [{ x: pp.x + 26, y: pp.y + 3 }])
  if ((await st()).phase === 'done') break
}
await settle(p, 60)
const s8 = await st()
check('the finger can turn it square to the camera', s8.phase === 'done', JSON.stringify(s8))
check('the turn lands exactly on the target', Math.abs(s8.yaw - s8.yawTarget) < 0.2)
await p.screenshot({ path: 'shots/i-finger-driven-result.png' })

console.log('errors', p.__errors.filter((e) => !e.includes('404')))
console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(', ')}` : '\nall input checks passed')
await b.close()
process.exit(fail.length ? 1 : 0)
