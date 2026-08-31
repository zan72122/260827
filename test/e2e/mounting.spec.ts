import { expect, test } from '@playwright/test';
import { gotoStation, read } from './helpers';

/**
 * 封入操作と振り返りの流れを短時間で確認する。
 * 実践モードでは誤った順序も選べるため、染色を省いて封入台へ進める（工程の完遂は playthrough.spec.ts）。
 */
test('封入操作（量・接触位置・下ろす速度）と振り返りの流れが最後まで通る', async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.click('[data-v="exam"]');
  await page.click('#start');
  await page.waitForTimeout(2200);

  await gotoStation(page, 'mount');
  await page.waitForTimeout(600);
  expect(await read(page, 'mountPhase')).toBe('take');

  await page.click('#mount-tools button');
  await page.waitForTimeout(400);
  expect(await read(page, 'mountPhase')).toBe('dispense');

  // 押し出す（押している時間で量が変わる）
  await page.mouse.move(195, 430);
  await page.mouse.down();
  await page.waitForTimeout(2200);
  await page.mouse.up();
  const vol = await read(page, 'volumeUl');
  expect(vol).toBeGreaterThan(12);
  expect(vol).toBeLessThan(60);
  await page.screenshot({ path: 'evidence/shots/60-dispense.png' });

  await page.click('#mount-tools button.primary');
  await page.waitForTimeout(300);
  expect(await read(page, 'mountPhase')).toBe('place');

  // 接触辺の位置を上下ドラッグで変える
  const slipBefore = await page.evaluate(() => window.__he.coverAngle());
  expect(slipBefore).toBeCloseTo(30, 0);
  await page.mouse.move(195, 400);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(195, 400 - i * 8);
  await page.mouse.up();
  await page.screenshot({ path: 'evidence/shots/61-place.png' });

  await page.click('#mount-tools button.primary');
  await page.waitForTimeout(300);
  expect(await read(page, 'mountPhase')).toBe('lower');

  // ゆっくり倒す
  await page.mouse.move(195, 360);
  await page.mouse.down();
  for (let i = 1; i <= 40; i++) {
    await page.mouse.move(195, 360 + i * 6);
    await page.waitForTimeout(50);
  }
  await page.mouse.up();
  await page.waitForTimeout(800);
  expect(await read(page, 'mountPhase')).toBe('done');

  // 振り返りが自動的に開く。いったん閉じて、封入後の作業台を記録する。
  await expect(page.locator('#sheet')).toBeVisible({ timeout: 30000 });
  await page.click('#sheet-close');
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'evidence/shots/62-mounted.png' });
  await page.click('#mount-tools button.primary');

  // 振り返り: 完成画像 → 所見 → 原因候補 → 解説 → 次の1条件
  await expect(page.locator('#sheet')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(1500);
  await expect(page.locator('#sheet-body canvas')).toBeVisible();
  await expect(page.locator('#sheet-body')).toContainText('教育用シミュレーション');
  await page.screenshot({ path: 'evidence/shots/63-debrief-image.png' });

  await page.getByRole('button', { name: '所見を選ぶ' }).click();
  await page.waitForTimeout(500);
  await page.locator('.opt').first().click();
  await page.screenshot({ path: 'evidence/shots/64-debrief-findings.png' });
  await page.getByRole('button', { name: '原因候補へ' }).click();
  await page.waitForTimeout(400);
  await page.locator('.opt').first().click();
  await page.getByRole('button', { name: '解説を見る' }).click();
  await page.waitForTimeout(800);
  await expect(page.locator('#sheet-body')).toContainText('画像だけから考えられる原因候補');
  await expect(page.locator('#sheet-body')).toContainText('操作履歴');
  await page.screenshot({ path: 'evidence/shots/65-debrief-explain.png' });

  await page.getByRole('button', { name: '次に変える1条件へ' }).click();
  await page.waitForTimeout(500);
  await page.locator('.opt').first().click();
  await expect(page.locator('.compare canvas')).toHaveCount(2, { timeout: 60000 });
  await page.locator('.compare').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'evidence/shots/66-debrief-compare.png' });

  await page.getByRole('button', { name: 'はじめからもう一度' }).click();
  await page.waitForTimeout(2500);
  expect(await read(page, 'phase')).toBe('play');
  expect((await read(page, 'fieldMeans')).paraffin).toBeCloseTo(1, 3);

  expect(errors).toEqual([]);
});
