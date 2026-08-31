import { expect, test } from '@playwright/test';
import {
  doDips,
  drain,
  gotoStation,
  lift,
  moveToJar,
  read,
  refreshWater,
  soak,
  tapWashThreeChanges,
} from './helpers';

/**
 * 受け入れ条件 1:
 * 正規の工程をタッチ（ポインタ）操作で進め、1枚・1切片のまま
 * 封入 → 顕微鏡画像 → 原因推定 → 再挑戦まで完遂できること。
 *
 * 内部状態への書き込みは一切行わない。すべて実際のポインタ経路とボタン操作で進める。
 */
test('S1 の工程を最後まで通して封入・観察・振り返りまで到達できる', async ({ page }) => {
  test.setTimeout(14 * 60 * 1000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`${e.message}`));

  await page.goto('/');
  await page.click('[data-v="exam"]');
  await page.click('#start');
  await page.waitForTimeout(2500);

  // --- 1. 脱パラフィン（キシレン3槽、各3分）
  for (const jar of ['X1', 'X2', 'X3']) {
    await moveToJar(page, jar);
    await soak(page, 178);
    await drain(page, 1200);
  }
  expect((await read(page, 'fieldMeans')).paraffin).toBeLessThan(0.01);
  await page.screenshot({ path: 'evidence/shots/20-deparaffin-done.png' });

  // --- 2. 親水化（100% x2、95% x2、各10 dips）
  await gotoStation(page, 'hydration');
  for (const jar of ['A100a', 'A100b', 'A95a', 'A95b']) {
    await moveToJar(page, jar);
    await doDips(page, 10);
    await drain(page, 900);
  }

  // --- 3. 蒸留水で十分に洗う
  await gotoStation(page, 'wash');
  await moveToJar(page, 'DI');
  await refreshWater(page);
  await doDips(page, 5);
  await soak(page, 8);

  // --- 4. ヘマトキシリン（教材の基準 3 分）
  await gotoStation(page, 'nuclear');
  await moveToJar(page, 'HEM');
  await soak(page, 178);
  await drain(page, 1200);
  await page.screenshot({ path: 'evidence/shots/21-hematoxylin.png' });

  // --- 5. 水道水3回交換
  await tapWashThreeChanges(page);

  // --- 6. 分別（酸アルコール。加速しない）
  await gotoStation(page, 'nuclear');
  await moveToJar(page, 'ACID');
  expect(await read(page, 'accel')).toBe(1);
  await doDips(page, 5);
  await lift(page, true);

  // --- 7. 水道水3回交換
  await tapWashThreeChanges(page);

  // --- 8. 色出し（Scott 液 10 dips）
  await gotoStation(page, 'nuclear');
  await moveToJar(page, 'SCOTT');
  await doDips(page, 10);
  await lift(page, true);

  // --- 9. 水道水3回交換 → 蒸留水ですすぐ
  await tapWashThreeChanges(page);
  await moveToJar(page, 'DI');
  await refreshWater(page);
  await doDips(page, 5);
  await drain(page, 2500); // 余分な水を切る

  // --- 10-11. 70% エタノール → エオジン
  await gotoStation(page, 'counter');
  await moveToJar(page, 'A70');
  await doDips(page, 10);
  await drain(page, 800);
  await moveToJar(page, 'EOS');
  await soak(page, 58);
  await drain(page, 900);
  await page.screenshot({ path: 'evidence/shots/22-eosin.png' });

  // --- 12-13. 脱水
  await gotoStation(page, 'dehydrate');
  for (const jar of ['A95c', 'A95d']) {
    await moveToJar(page, jar);
    await soak(page, 58);
    await drain(page, 700);
  }
  for (const jar of ['A100c', 'A100d']) {
    await moveToJar(page, jar);
    await doDips(page, 10);
    await drain(page, 700);
  }

  // --- 14. 透徹
  await gotoStation(page, 'clearing');
  for (const jar of ['X4', 'X5', 'X6']) {
    await moveToJar(page, jar);
    await doDips(page, 10);
    await drain(page, 600);
  }
  const before = await read(page, 'fieldMeans');
  expect(before.hemaN).toBeGreaterThan(0.5);
  expect(before.eosin).toBeGreaterThan(0.4);
  expect(before.cleared).toBeGreaterThan(0.6);
  await lift(page, true);

  // --- 15. 封入
  await gotoStation(page, 'mount');
  await page.waitForTimeout(600);
  expect(await read(page, 'mountPhase')).toBe('take');
  await page.click('#mount-tools button');
  await page.waitForTimeout(400);
  expect(await read(page, 'mountPhase')).toBe('dispense');
  await page.screenshot({ path: 'evidence/shots/23-mount-dispense.png' });

  // 封入剤を押し出す（長押しの時間で量が変わる）
  await page.mouse.move(195, 430);
  await page.mouse.down();
  await page.waitForTimeout(2100);
  await page.mouse.up();
  const vol = await read(page, 'volumeUl');
  expect(vol).toBeGreaterThan(12);
  expect(vol).toBeLessThan(60);

  await page.click('#mount-tools button.primary');
  await page.waitForTimeout(300);
  expect(await read(page, 'mountPhase')).toBe('place');
  await page.click('#mount-tools button.primary');
  await page.waitForTimeout(300);
  expect(await read(page, 'mountPhase')).toBe('lower');

  // カバーガラスをゆっくり倒す
  await page.mouse.move(195, 380);
  await page.mouse.down();
  for (let i = 1; i <= 40; i++) {
    await page.mouse.move(195, 380 + i * 6);
    await page.waitForTimeout(55);
  }
  await page.mouse.up();
  await page.waitForTimeout(600);
  expect(await read(page, 'mountPhase')).toBe('done');
  await page.screenshot({ path: 'evidence/shots/24-mounted.png' });

  // --- 16. 顕微鏡画像 → 所見 → 原因候補 → 解説 → 次の1条件
  await expect(page.locator('#sheet')).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'evidence/shots/25-debrief-image.png' });
  await expect(page.locator('#sheet-body canvas')).toBeVisible();

  await page.getByRole('button', { name: '所見を選ぶ' }).click();
  await page.waitForTimeout(400);
  await page.locator('.opt').first().click();
  await page.screenshot({ path: 'evidence/shots/26-debrief-findings.png' });
  await page.getByRole('button', { name: '原因候補へ' }).click();
  await page.waitForTimeout(300);
  await page.locator('.opt').first().click();
  await page.getByRole('button', { name: '解説を見る' }).click();
  await page.waitForTimeout(600);
  await expect(page.locator('#sheet-body')).toContainText('操作履歴');
  await expect(page.locator('#sheet-body')).toContainText('画像だけから考えられる原因候補');
  await page.screenshot({ path: 'evidence/shots/27-debrief-explain.png' });
  await page.getByRole('button', { name: '次に変える1条件へ' }).click();
  await page.waitForTimeout(400);
  await page.locator('.opt').first().click();
  await page.waitForTimeout(4000);
  await expect(page.locator('.compare canvas')).toHaveCount(2);
  await page.screenshot({ path: 'evidence/shots/28-debrief-compare.png' });

  // --- 17. 再挑戦
  await page.getByRole('button', { name: 'はじめからもう一度' }).click();
  await page.waitForTimeout(2500);
  expect(await read(page, 'station')).toBe('deparaffin');
  expect((await read(page, 'fieldMeans')).paraffin).toBeGreaterThan(0.9);
  expect(await read(page, 'phase')).toBe('play');
  await page.screenshot({ path: 'evidence/shots/29-retry.png' });

  expect(errors).toEqual([]);
});
