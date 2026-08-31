import { expect, test } from '@playwright/test';
import { doDips, dragRack, lift, read, submerge } from './helpers';

test('タッチ操作でラックを沈め、ディップを数え、槽を移せる', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.click('#start');
  await page.waitForTimeout(2000);
  await page.click('#hint button').catch(() => undefined);

  expect(await read(page, 'station')).toBe('deparaffin');
  expect(await read(page, 'jar')).toBe('X1');

  // 沈める
  await submerge(page);
  expect(await read(page, 'level')).toBeGreaterThan(1);
  await page.screenshot({ path: 'evidence/shots/10-submerged.png' });

  // 沈めたまま待つと、長い浸漬の時計だけが加速する
  await page.waitForTimeout(3000);
  expect(await read(page, 'accel')).toBeGreaterThan(1);
  const modelA = await read(page, 'modelSec');
  const opA = await read(page, 'opSec');
  await page.waitForTimeout(2000);
  const modelB = await read(page, 'modelSec');
  const opB = await read(page, 'opSec');
  expect(modelB - modelA).toBeGreaterThan((opB - opA) * 3);

  // 引き上げると加速が止まる
  await lift(page);
  expect(await read(page, 'level')).toBeLessThan(0);
  await page.waitForTimeout(400);
  expect(await read(page, 'accel')).toBe(1);
  await page.screenshot({ path: 'evidence/shots/11-drain.png' });

  // ディップは往復の回数で数える（pointermove の数ではない）
  const before = await read(page, 'dips');
  for (let i = 0; i < 30; i++) await dragRack(page, 6, 2); // 細かい揺れ
  expect(await read(page, 'dips')).toBe(before);
  await doDips(page, 3);
  expect(await read(page, 'dips')).toBe(before + 3);

  expect(errors).toEqual([]);
});
