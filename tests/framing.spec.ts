import { expect, test } from '@playwright/test';
import { anchor, boot, snapshot } from './drive';

/**
 * Runs on every representative phone and tablet frame, portrait and landscape:
 * the opening has to read, and nothing may ask the child to read words.
 */
test('the opening frame reads on its own', async ({ page }) => {
  await boot(page, 'q=low');
  const size = page.viewportSize()!;
  const s = await snapshot(page);
  expect(s.phase).toBe('intro');

  // the tree is more than twice the width of the slot it has to go through
  expect(s.half).toBeGreaterThan(s.gateHalf * 2);

  // and both of them are actually on screen, clear of the edges
  for (const name of ['tree', 'gate']) {
    const p = await anchor(page, name);
    expect(p.x, `${name} x`).toBeGreaterThan(size.width * 0.02);
    expect(p.x, `${name} x`).toBeLessThan(size.width * 0.98);
    expect(p.y, `${name} y`).toBeGreaterThan(size.height * 0.02);
    expect(p.y, `${name} y`).toBeLessThan(size.height * 0.98);
  }

  // the first hint appears as a hand, never as a sentence
  await page.waitForTimeout(2500);
  await expect(page.locator('.hint')).toHaveClass(/on/);
  expect((await page.locator('#overlay').innerText()).trim()).toBe('');
});

test('rotating the device keeps the game running', async ({ page }) => {
  await boot(page, 'q=low');
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: size.height, height: size.width });
  await page.waitForTimeout(1200);
  const rotated = await snapshot(page);
  expect(rotated.phase).toBe('intro');
  const p = await anchor(page, 'tree');
  expect(p.x).toBeGreaterThan(0);
  expect(p.x).toBeLessThan(size.height);
});
