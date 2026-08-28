import { expect, test, type Page } from '@playwright/test';

/** Snapshot of the running game, published by the game loop for automation. */
interface GameState {
  phase: string;
  treeIndex: number;
  variant: string;
  feed: number;
  shed: number;
  fold: number;
  netFront: number;
  opened: number;
  portrait: boolean;
  quality: string;
  webgpu: boolean;
  treeWidth: number;
  gateWidth: number;
}

declare global {
  interface Window {
    __treeGame?: GameState;
    __treeGameReady?: boolean;
  }
}

const state = (page: Page) => page.evaluate(() => window.__treeGame as GameState);

const waitPhase = (page: Page, phase: string, timeout = 180_000) =>
  page.waitForFunction((p) => window.__treeGame?.phase === p, phase, { timeout, polling: 150 });

async function swipe(page: Page, x0: number, y0: number, x1: number, y1: number, steps = 10) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(40);
}

/** Presses and holds, with the small wobble a real finger always has. */
async function hold(page: Page, x: number, y: number, ticks: number) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 0; i < ticks; i++) {
    await page.mouse.move(x + (i % 2), y + ((i + 1) % 2));
    await page.waitForTimeout(60);
  }
  await page.mouse.up();
  await page.waitForTimeout(120);
}

test.describe('christmas tree: shake, bale, open', () => {
  test.setTimeout(900_000);

  test('one finger plays the whole loop and starts the next tree', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await page.goto('/?quality=low', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__treeGameReady === true, null, { timeout: 120_000 });

    const vp = page.viewportSize()!;
    const cx = vp.width / 2;
    const cy = vp.height / 2;

    // The opening frame has to carry the whole premise: this tree is far too
    // wide for the loading gate standing next to it.
    const intro = await state(page);
    expect(intro.phase).toBe('intro');
    expect(intro.treeWidth).toBeGreaterThan(intro.gateWidth * 2.5);
    expect(intro.portrait).toBe(vp.height >= vp.width);

    await page.click('#bootBtn');
    await page.waitForTimeout(900);

    // 1. push the tree onto the shaker
    await swipe(page, vp.width * 0.22, cy, vp.width * 0.84, cy);
    await waitPhase(page, 'shaking');

    // 2. hold the safety lever: dry needles come off, nothing else happens
    await hold(page, cx, vp.height * 0.72, 45);
    const shaken = await state(page);
    expect(shaken.shed).toBeGreaterThan(0.2);
    expect(shaken.fold).toBeLessThan(0.05);

    // rotating the device must not cost any progress
    const rotated = { width: vp.height, height: vp.width };
    await page.setViewportSize(rotated);
    await page.waitForTimeout(700);
    const afterRotate = await state(page);
    expect(afterRotate.phase).toBe('shaking');
    expect(afterRotate.shed).toBeGreaterThanOrEqual(shaken.shed);
    expect(afterRotate.portrait).toBe(rotated.height >= rotated.width);
    await page.setViewportSize(vp);
    await page.waitForTimeout(700);
    expect((await state(page)).shed).toBeGreaterThanOrEqual(shaken.shed);

    // 3. send it into the baler
    await swipe(page, vp.width * 0.22, cy, vp.width * 0.86, cy);
    await waitPhase(page, 'feeding');

    // 4. work the feed rollers until the tree is through the cone
    for (let i = 0; i < 60; i++) {
      if ((await state(page)).phase !== 'feeding') break;
      await swipe(page, cx, vp.height * 0.34, cx, vp.height * 0.82, 5);
    }
    const fed = await state(page);
    expect(fed.feed).toBeGreaterThan(1.7);
    expect(fed.fold).toBeGreaterThan(0.85);

    // 5. short haul, then the net comes off in the delivery hall
    await waitPhase(page, 'release');
    for (let i = 0; i < 30; i++) {
      const s = await state(page);
      // stop pulling once the net is off; the tree finishes opening by itself
      if (s.phase !== 'release' || s.netFront > 0.97) break;
      await swipe(page, cx, vp.height * 0.3, cx, vp.height * 0.93, 7);
    }
    await waitPhase(page, 'admire');
    const opened = await state(page);
    expect(opened.netFront).toBeGreaterThan(0.99);
    expect(opened.fold).toBeLessThan(0.1);

    // 6. a tap brings the next, differently shaped tree. The finished tree holds
    // the screen for a beat first, so tap again the way a child would.
    for (let i = 0; i < 20 && (await state(page)).phase === 'admire'; i++) {
      await page.mouse.click(cx, cy);
      await page.waitForTimeout(1500);
    }
    await waitPhase(page, 'intro', 60_000);
    const next = await state(page);
    expect(next.treeIndex).toBe(1);
    expect(next.variant).not.toBe(opened.variant);
    expect(next.feed).toBe(0);
    expect(next.opened).toBe(0);

    expect(errors, 'no runtime errors during a full play-through').toEqual([]);
  });

  test('the plain WebGL 2 path runs the same machines', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/?quality=low&renderer=webgl', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__treeGameReady === true, null, { timeout: 120_000 });
    const vp = page.viewportSize()!;
    expect((await state(page)).webgpu).toBe(false);

    await page.click('#bootBtn');
    await page.waitForTimeout(600);
    await swipe(page, vp.width * 0.22, vp.height / 2, vp.width * 0.84, vp.height / 2);
    await waitPhase(page, 'shaking');
    await hold(page, vp.width / 2, vp.height * 0.72, 30);
    expect((await state(page)).shed).toBeGreaterThan(0.1);
    expect(errors).toEqual([]);
  });
});
