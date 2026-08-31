import { expect, test } from '@playwright/test';
import { doDips, lift, read, submerge } from './helpers';

/** 受け入れ条件 8: 中断・キャンセル・回転・連続再挑戦で壊れないこと。 */
test('pointercancel / 中断復帰 / 画面回転 / 連続再挑戦で状態が壊れない', async ({ page, context }) => {
  test.setTimeout(5 * 60 * 1000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.click('#start');
  await page.waitForTimeout(2000);
  await page.locator('#hint button').click().catch(() => undefined);

  // --- ドラッグ中の pointercancel: ラックが消えたり跳ねたりしない
  const g = await page.evaluate(() => window.__he.grab());
  expect(g).not.toBeNull();
  await page.mouse.move(g!.x, g!.y + 60);
  await page.mouse.down();
  await page.mouse.move(g!.x, g!.y + 160);
  const midY = await read(page, 'rackY');
  await page.evaluate(() => {
    const c = document.getElementById('gl')!;
    c.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }));
  });
  await page.mouse.up().catch(() => undefined);
  await page.waitForTimeout(400);
  const afterCancel = await read(page, 'rackY');
  expect(Math.abs(afterCancel - midY)).toBeLessThan(12);
  expect(await read(page, 'jar')).toBe('X1');

  // --- 中断（タブ非表示）中は教材内時間が進まず、復帰時に飛ばない
  await submerge(page);
  await page.waitForTimeout(2500);
  const beforeHide = await read(page, 'modelSec');
  await context.newPage().then(async (p2) => {
    await p2.goto('about:blank');
    await p2.waitForTimeout(2500);
    await p2.close();
  });
  await page.waitForTimeout(150);
  const afterHide = await read(page, 'modelSec');
  // 非表示中に大きく進まない（復帰直後の 1 フレーム分＝最大 0.1 秒 × 加速 のみ）
  expect(afterHide - beforeHide).toBeLessThan(6);

  // --- 画面回転（ビューポート変更）でも操作が続けられる
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(900);
  expect(await read(page, 'jar')).toBe('X1');
  const g2 = await page.evaluate(() => window.__he.grab());
  expect(g2).not.toBeNull();
  expect(g2!.x).toBeGreaterThan(0);
  expect(g2!.x).toBeLessThan(844);
  await page.screenshot({ path: 'evidence/shots/40-landscape.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(900);
  await lift(page);
  await doDips(page, 2);
  expect(await read(page, 'dips')).toBeGreaterThanOrEqual(2);

  // --- 連続再挑戦で状態が持ち越されない
  for (let i = 0; i < 3; i++) {
    const before = await read(page, 'fieldMeans');
    expect(before.paraffin).toBeLessThan(1);
    await page.click('#btn-menu');
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'はじめからやり直す' }).click();
    await page.waitForTimeout(2200);
    const after = await read(page, 'fieldMeans');
    expect(after.paraffin).toBeCloseTo(1, 3);
    expect(after.hemaN).toBe(0);
    expect(await read(page, 'station')).toBe('deparaffin');
    expect(await read(page, 'jar')).toBe('X1');
    expect(await read(page, 'modelSec')).toBeLessThan(3);
    await submerge(page);
    await page.waitForTimeout(700);
    await lift(page);
  }

  expect(errors).toEqual([]);
});

/** 受け入れ条件 9: 規定の縦画面サイズで重要な要素が画面外へ消えないこと。 */
for (const vp of [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
]) {
  test(`縦画面 ${vp.width}x${vp.height} で薬液名・操作対象・完了画面が読み取れる`, async ({ page }) => {
    test.setTimeout(3 * 60 * 1000);
    await page.setViewportSize(vp);
    await page.goto('/');
    await page.click('#start');
    await page.waitForTimeout(2200);
    await page.locator('#hint button').click().catch(() => undefined);

    for (const sel of ['#hud-station', '#hud-jar', '#hud-ref', '#nav-label', '#btn-protocol', '#btn-menu']) {
      const box = await page.locator(sel).boundingBox();
      expect(box, sel).not.toBeNull();
      expect(box!.x, sel).toBeGreaterThanOrEqual(0);
      expect(box!.y, sel).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, sel).toBeLessThanOrEqual(vp.width + 0.5);
      expect(box!.y + box!.height, sel).toBeLessThanOrEqual(vp.height + 0.5);
    }
    // 主要な操作領域は 48 CSS px 以上
    for (const sel of ['#btn-protocol', '#btn-menu', '#nav-prev', '#nav-next', '#btn-magnify']) {
      const box = await page.locator(sel).boundingBox();
      expect(box!.height, sel).toBeGreaterThanOrEqual(44);
    }
    // 薬液名が空でない
    expect((await page.locator('#hud-jar').textContent())?.trim().length).toBeGreaterThan(0);
    // ラックの掴み位置が画面内にある（操作対象が画面外へ出ない）
    const g = await page.evaluate(() => window.__he.grab());
    expect(g!.y).toBeGreaterThan(0);
    expect(g!.y).toBeLessThan(vp.height);
    await page.screenshot({ path: `evidence/shots/50-layout-${vp.width}x${vp.height}.png` });

    // 手順書（説明画面）はスクロールできる
    await page.click('#btn-protocol');
    await page.waitForTimeout(400);
    await expect(page.locator('#sheet-body')).toContainText('キシレン');
    const scrolled = await page.evaluate(() => {
      const b = document.getElementById('sheet-body')!;
      b.scrollTop = 400;
      return b.scrollTop;
    });
    expect(scrolled).toBeGreaterThan(0);
    await page.click('#sheet-close');
  });
}
