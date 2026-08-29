import { expect, test } from '@playwright/test';
import {
  anchor,
  boot,
  feedThrough,
  holdLever,
  pullNet,
  pushRight,
  snapshot,
  waitForPhase,
} from './drive';

test.describe('tree shipping yard', () => {
  test('a whole round: read, shake, bale, deliver, release, replay', async ({ page }) => {
    await boot(page);

    // --- the opening frame has to read on its own ---
    const start = await snapshot(page);
    expect(start.phase).toBe('intro');
    // the tree is plainly wider than the slot it has to go through
    expect(start.half).toBeGreaterThan(start.gateHalf * 2);
    const gate = await anchor(page, 'gate');
    const size = page.viewportSize()!;
    expect(gate.x).toBeGreaterThan(0);
    expect(gate.x).toBeLessThan(size.width);
    expect(gate.y).toBeGreaterThan(0);
    expect(gate.y).toBeLessThan(size.height);

    // --- swipe the tree onto the shaker ---
    await pushRight(page);
    await waitForPhase(page, 'shake');

    // --- hold the safety lever: dry material comes off, the tree stays green ---
    const beforeShake = await snapshot(page);
    await holdLever(page, 5000);
    const afterShake = await snapshot(page);
    expect(afterShake.dry).toBeLessThan(beforeShake.dry - 0.1);
    expect(afterShake.half).toBeGreaterThan(start.gateHalf * 2); // still a wide tree

    // --- swipe on to the baler and crank it through ---
    await pushRight(page);
    await waitForPhase(page, 'bale');

    // half way through, turn the device: nothing may be lost
    await feedThrough(page, 8);
    const midBale = await snapshot(page);
    expect(midBale.fold).toBeGreaterThan(0);
    await page.setViewportSize({ width: size.height, height: size.width });
    await page.waitForTimeout(900);
    const rotated = await snapshot(page);
    expect(rotated.phase).toBe('bale');
    expect(rotated.fold).toBeGreaterThanOrEqual(midBale.fold - 0.02);
    expect(rotated.net).toBeGreaterThanOrEqual(midBale.net - 0.02);
    await page.setViewportSize(size);
    await page.waitForTimeout(600);

    await feedThrough(page);
    const baled = await waitForPhase(page, ['compare', 'transport', 'release']);
    // it now fits through the loading gate, and it got there by being folded
    expect(baled.fold).toBeGreaterThan(0.5);
    expect(baled.half).toBeLessThan(start.gateHalf);
    expect(baled.net).toBeGreaterThan(1);

    // --- the delivery hall: pull the net end down ---
    await waitForPhase(page, 'release');
    const beforePull = await snapshot(page);
    expect(beforePull.released).toBe(0);
    await pullNet(page);
    const settled = await waitForPhase(page, 'settle');
    expect(settled.released).toBeGreaterThan(0.95);
    // the crown is open again, back to roughly the width it started with
    await page.waitForTimeout(2500);
    const open = await snapshot(page);
    expect(open.fold).toBeLessThan(0.12);
    expect(open.half).toBeGreaterThan(start.half * 0.8);

    // --- replay gives a different tree, and the same gestures still work ---
    const replay = page.locator('.replay');
    await expect(replay).toHaveClass(/on/, { timeout: 60_000 });
    await replay.click();
    await page.waitForTimeout(1200);
    const second = await snapshot(page);
    expect(second.run).toBe(1);
    expect(second.variant).not.toBe(start.variant);
    expect(second.phase).toBe('intro');

    await pushRight(page);
    await waitForPhase(page, 'shake');
    await holdLever(page, 2500);
    await pushRight(page);
    await waitForPhase(page, 'bale');
    await feedThrough(page);
    const secondBaled = await waitForPhase(page, ['compare', 'transport', 'release']);
    expect(secondBaled.half).toBeLessThan(second.gateHalf);
  });

  test('nothing on screen asks the player to read anything at the start', async ({ page }) => {
    await boot(page);
    const overlayText = await page.locator('#overlay').innerText();
    expect(overlayText.trim()).toBe('');
    // and there are no empty controls sitting on the glass
    await expect(page.locator('.replay')).not.toHaveClass(/on/);
  });
});
