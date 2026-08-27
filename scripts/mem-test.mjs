// Repeated enter/exit memory measurement: geometries/textures must plateau.
import { chromium } from 'playwright-core';

const W = 390, H = 844;
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
await page.goto('http://localhost:4173/');
await page.waitForFunction(() => window.__game !== undefined);
await page.waitForTimeout(1200);

const cdp = await ctx.newCDPSession(page);
async function touchDrag(points, stepMs = 50) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: points[0][0], y: points[0][1], id: 1 }] });
  for (let i = 1; i < points.length; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: points[i][0], y: points[i][1], id: 1 }] });
    await page.waitForTimeout(stepMs);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const line = (x0, y0, x1, y1, n) =>
  Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]);
const waitState = (s) => page.waitForFunction((w) => window.__game.state() === w, s, { timeout: 60000 });
const info = () => page.evaluate(() => window.__game.info());

console.log('start:', JSON.stringify(await info()));
for (let cycle = 0; cycle < 4; cycle++) {
  const p = await page.evaluate(() => window.__game.presentXY());
  const m = await page.evaluate(() => window.__game.mouthXY());
  await touchDrag(line(p.x, p.y, m.x, m.y + 30, 14), 50);
  await waitState('inside');
  await page.waitForTimeout(300);
  const p2 = await page.evaluate(() => window.__game.presentXY());
  const b = await page.evaluate((i) => window.__game.bayXY(i), cycle % 3);
  await touchDrag(line(p2.x, p2.y, b.x, b.y + 50, 12), 70);
  try { await waitState('storedWait'); } catch {
    const p3 = await page.evaluate(() => window.__game.presentPos());
    console.log('  retry, present at', p3);
    const p4 = await page.evaluate(() => window.__game.presentXY());
    await touchDrag(line(p4.x, p4.y, b.x, b.y + 40, 12), 70);
    await waitState('storedWait');
  }
  await page.locator('.picbtn').first().click();
  await page.waitForFunction(() => ['outside', 'lift', 'menu'].includes(window.__game.state()), null, { timeout: 60000 });
  // after 3rd present: lift then menu -> choose another
  const st = await page.evaluate(() => window.__game.state());
  if (st !== 'outside') {
    await waitState('menu');
    await page.waitForTimeout(700);
    await page.locator('.picbtn').first().click(); // "another"
    await waitState('outside');
  }
  await page.waitForTimeout(500);
  console.log(`cycle ${cycle + 1}:`, JSON.stringify(await info()));
}
await browser.close();
console.log('DONE mem test');
