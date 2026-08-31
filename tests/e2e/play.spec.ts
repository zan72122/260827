import { expect, test } from '@playwright/test'
import { attachClip, boot, closeFully, detachClip, openFully, state, stats, stroke, waitSettled } from './helpers'

test.describe('紙がひらく、クリスマス工房', () => {
  test('起動直後に作業台から始まり、タイトルメニューを挟まない', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await boot(page)
    expect(await page.locator('#fallback.show').count()).toBe(0)
    const s = await state(page)
    expect(s.open).toBe(0)
    expect(s.phase).toBe('unfolding')
    const st = await stats(page)
    expect(st.triangles).toBeLessThan(150000)
    expect(st.calls).toBeLessThan(80)
    expect(errors).toEqual([])
  })

  test('ドラッグの停止・逆転・再開に追従する', async ({ page }) => {
    await boot(page)
    const w = page.viewportSize()!.width
    const y = await page.evaluate(() => window.__game.frontBandY())
    await page.evaluate(() => window.__game.startTrace())

    await page.mouse.move(w * 0.12, y)
    await page.mouse.down()
    for (let i = 1; i <= 8; i++) await page.mouse.move(w * 0.12 + i * (w * 0.08), y)
    const afterRise = (await state(page)).open
    // 指を止めれば止まる（勝手に完成へ進まない）
    await page.waitForTimeout(1200)
    const afterHold = (await state(page)).open
    for (let i = 1; i <= 4; i++) await page.mouse.move(w * 0.12 + (8 - i) * (w * 0.08), y)
    const afterBack = (await state(page)).open
    for (let i = 1; i <= 4; i++) await page.mouse.move(w * 0.12 + (4 + i) * (w * 0.08), y)
    const afterResume = (await state(page)).open
    await page.mouse.up()

    expect(afterRise).toBeGreaterThan(0.2)
    expect(afterHold).toBeCloseTo(afterRise, 6)
    expect(afterBack).toBeLessThan(afterRise - 0.1)
    expect(afterResume).toBeGreaterThan(afterBack + 0.1)

    // 記録から、指の位置と展開量が同じ向きに動いていることを確かめる
    const trace = await page.evaluate(() => window.__game.trace())
    const moving = trace.filter((p) => p.drag === 1 && p.x >= 0)
    expect(moving.length).toBeGreaterThan(5)
    let agree = 0
    let compared = 0
    for (let i = 1; i < moving.length; i++) {
      const dx = moving[i].x - moving[i - 1].x
      const dOpen = moving[i].open - moving[i - 1].open
      if (Math.abs(dx) < 1) continue
      compared++
      if (Math.sign(dx) === Math.sign(dOpen) || dOpen === 0) agree++
    }
    expect(compared).toBeGreaterThan(3)
    expect(agree).toBe(compared)
  })

  test('タップの回数や経過時間だけでは完成しない', async ({ page }) => {
    await boot(page)
    const y = await page.evaluate(() => window.__game.frontBandY())
    const w = page.viewportSize()!.width
    for (let i = 0; i < 12; i++) {
      await page.mouse.click(w * 0.5, y)
    }
    await page.waitForTimeout(1500)
    const s = await state(page)
    expect(s.open).toBeLessThan(0.02)
    expect(s.everCompleted).toBe(false)
  })

  test('つかみ代を直接つまんでも開く（当たり領域は指で届く大きさ）', async ({ page }) => {
    await boot(page)
    const tab = await page.evaluate(() => window.__game.tabScreen())
    await page.mouse.move(tab.x + 20, tab.y + 18) // 中心から離れていても掴める
    await page.mouse.down()
    await page.mouse.move(tab.x + 120, tab.y + 18)
    const s = await state(page)
    await page.mouse.up()
    expect(s.open).toBeGreaterThan(0.05)
  })

  test('全開 → 留める → 外す → 閉じる → 開く が繰り返せる', async ({ page }) => {
    await boot(page)
    test.setTimeout(360_000)
    for (let cycle = 0; cycle < 2; cycle++) {
      await openFully(page)
      expect((await state(page)).phase).toBe('clipReady')
      await attachClip(page)
      expect((await state(page)).phase).toBe('clipped')

      // 留めている間は開閉しない
      await stroke(page, -page.viewportSize()!.width * 0.5, 5)
      expect((await state(page)).open).toBe(1)

      // 外す
      await detachClip(page)
      expect((await state(page)).clipAttached).toBe(false)

      // また閉じられる
      await closeFully(page)
      expect((await state(page)).open).toBeLessThan(0.02)
    }
    expect((await state(page)).everCompleted).toBe(true)
  })

  test('途中で画面を回しても進捗を失わない', async ({ page }) => {
    await boot(page)
    await stroke(page, page.viewportSize()!.width * 0.5, 6)
    await waitSettled(page)
    const before = (await state(page)).open
    expect(before).toBeGreaterThan(0.1)
    const size = page.viewportSize()!
    await page.setViewportSize({ width: size.height, height: size.width })
    await page.waitForTimeout(500)
    const after = (await state(page)).open
    expect(after).toBeCloseTo(before, 6)
    // 回したあとも操作できる
    await stroke(page, page.viewportSize()!.width * 0.4, 6)
    expect((await state(page)).open).toBeGreaterThan(after)
    await page.setViewportSize(size)
    await page.waitForTimeout(400)
    expect((await state(page)).open).toBeGreaterThan(after)
  })

  test('繰り返し操作しても入力が止まらず、資源が単調に増えない', async ({ page }, info) => {
    // 資源の増加は画面サイズに依らないので 1 構成だけで確かめる
    test.skip(info.project.name !== 'phone-portrait', '1 構成で足りる検査')
    test.setTimeout(420_000)
    await boot(page)
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await openFully(page)
    await attachClip(page)
    const base = await stats(page)
    for (let i = 0; i < 3; i++) {
      await detachClip(page)
      await closeFully(page)
      await openFully(page)
      await attachClip(page)
      expect((await state(page)).phase).toBe('clipped')
    }
    const after = await stats(page)
    expect(after.geometries).toBeLessThanOrEqual(base.geometries + 2)
    expect(after.textures).toBeLessThanOrEqual(base.textures + 2)
    expect(after.programs).toBeLessThanOrEqual(base.programs + 2)
    expect(errors).toEqual([])
  })

  test('完成後は紙見本で色を選べ、そのまま開閉できる玩具状態が続く', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-portrait', '1 構成で足りる検査')
    test.setTimeout(360_000)
    await boot(page)
    await openFully(page)
    await attachClip(page)
    expect((await state(page)).everClipped).toBe(true)
    const before = (await state(page)).paperColor
    const s2 = await page.evaluate(() => window.__game.swatchScreen(2))
    await page.mouse.click(s2.x, s2.y)
    await page.waitForTimeout(400)
    expect((await state(page)).paperColor).not.toBe(before)
    // 色を替えても留めたままで、外せばまた開閉できる
    expect((await state(page)).phase).toBe('clipped')
    await detachClip(page)
    await stroke(page, -page.viewportSize()!.width * 0.4, 5)
    expect((await state(page)).open).toBeLessThan(0.995)
  })

  test('二本目の指や pointercancel で操作が壊れない', async ({ page }) => {
    await boot(page)
    const y = await page.evaluate(() => window.__game.frontBandY())
    const w = page.viewportSize()!.width
    // 途中で pointercancel を送る
    await page.mouse.move(w * 0.15, y)
    await page.mouse.down()
    await page.mouse.move(w * 0.5, y)
    const mid = (await state(page)).open
    await page.evaluate(() => {
      const c = document.getElementById('view')!
      c.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }))
    })
    await page.mouse.up()
    await waitSettled(page)
    expect((await state(page)).open).toBeGreaterThan(0)
    // 直後にまた操作できる
    await stroke(page, w * 0.4, 6)
    expect((await state(page)).open).toBeGreaterThan(mid)
  })
})
