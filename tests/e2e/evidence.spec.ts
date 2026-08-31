import { expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { attachClip, boot, openFully, state, stats, stroke } from './helpers'

const DIR = 'artifacts/evidence'
mkdirSync(DIR, { recursive: true })

const shot = (page: import('@playwright/test').Page, name: string) =>
  page.screenshot({ path: `${DIR}/${name}.png`, timeout: 180_000, animations: 'disabled' })

test('閉／途中／完成 の画面証拠', async ({ page }, info) => {
  // 画面証拠は品質を落とさずに撮るので、ソフトウェアGLでは 1 コマに数秒かかる
  test.setTimeout(900_000)
  const p = info.project.name
  await boot(page, { lite: false })

  await shot(page, `${p}-1-closed`)
  const closed = await stats(page)

  await stroke(page, page.viewportSize()!.width * 0.55, 6)
  const mid = await state(page)
  expect(mid.open).toBeGreaterThan(0.1)
  expect(mid.open).toBeLessThan(0.95)
  await shot(page, `${p}-2-partial`)

  await openFully(page)
  await shot(page, `${p}-3-open`)
  await attachClip(page)
  const done = await state(page)
  expect(done.phase).toBe('clipped')
  await page.waitForTimeout(1200)
  await shot(page, `${p}-4-clipped`)

  const open = await stats(page)
  writeFileSync(
    `${DIR}/${p}-stats.json`,
    JSON.stringify({ viewport: page.viewportSize(), closed, open, finalState: done }, null, 2),
  )
})
