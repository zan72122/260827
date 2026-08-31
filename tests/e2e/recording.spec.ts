import { expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { boot } from './helpers'

const DIR = 'artifacts/evidence'
mkdirSync(DIR, { recursive: true })

// 静止画だけでなく、追従の様子を短い動画と数値の記録で残す。
test.use({ video: { mode: 'on', size: { width: 390, height: 844 } } })

test('ゆっくり引く・止める・戻す の操作記録', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone-portrait', '記録は 1 構成で足りる')
  test.setTimeout(300_000)
  await boot(page, { lite: false })
  const w = page.viewportSize()!.width
  const y = await page.evaluate(() => window.__game.frontBandY())
  await page.evaluate(() => window.__game.startTrace())
  await page.mouse.move(w * 0.1, y)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(w * 0.1 + i * (w * 0.062), y)
  }
  await page.waitForTimeout(900)
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(w * 0.1 + (12 - i) * (w * 0.062), y)
  }
  await page.mouse.up()
  await page.waitForTimeout(600)
  const trace = await page.evaluate(() => window.__game.trace())
  writeFileSync(`${DIR}/${info.project.name}-trace.json`, JSON.stringify(trace))
  expect(trace.length).toBeGreaterThan(10)
  const moving = trace.filter((p) => p.drag === 1 && p.x >= 0)
  expect(moving.length).toBeGreaterThan(5)
})
