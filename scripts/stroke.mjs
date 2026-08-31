/** How much finger travel the whole cut takes, with the camera settled. */
import { launch, openGame, settle } from './shots.mjs'
const b = await launch()
for (const [tag, viewport] of [
  ['portrait 430x932', { width: 430, height: 932 }],
  ['landscape 932x430', { width: 932, height: 430 }],
]) {
  const p = await openGame(b, { viewport, query: '?auto=1' })
  await settle(p, 25)
  const handle = async () => {
    const w = await p.evaluate(() => {
      const v = window.__reifen.saw.handleWorld(new window.__reifen.camera.position.constructor())
      return [v.x, v.y, v.z]
    })
    return p.evaluate(([x, y, z]) => {
      const { camera, renderer } = window.__reifen
      const V = camera.position.constructor
      const pt = new V(x, y, z).project(camera)
      const r = renderer.domElement.getBoundingClientRect()
      return { x: r.left + ((pt.x + 1) / 2) * r.width, y: r.top + ((1 - pt.y) / 2) * r.height }
    }, w)
  }
  const parted = () => p.evaluate(() => window.__reifen.state.parted)
  let travel = 0
  const STEP = 14
  for (let i = 0; i < 200 && !(await parted()); i++) {
    const h = await handle()
    await p.mouse.move(h.x, h.y)
    await p.mouse.down()
    await p.mouse.move(h.x - 2, h.y - STEP)
    travel += Math.hypot(2, STEP)
    await settle(p, 2)
    await p.mouse.up()
    await settle(p, 2) // let the camera keep up
  }
  console.log(
    `${tag}: whole cut took ${travel.toFixed(0)} css px of finger travel ` +
      `(${((100 * travel) / Math.min(viewport.width, viewport.height)).toFixed(0)}% of the short side)`,
  )
  await p.close()
}
await b.close()
