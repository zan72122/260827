// Capture evaluation frames: the first 10 idle seconds, then the first
// full operation (drag -> swallow -> tunnel -> draw -> store).
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const W = 390, H = 844;
const OUT = 'shots/eval';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
await page.goto('http://localhost:4173/');
await page.waitForFunction(() => window.__game !== undefined);

// first 10 seconds, one frame every 2s
for (let i = 0; i < 5; i++) {
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/first10s-${i + 1}.png` });
}

const cdp = await ctx.newCDPSession(page);
async function touchDrag(points, stepMs = 60) {
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

// operation: drag to sack
const p = await page.evaluate(() => window.__game.presentXY());
const m = await page.evaluate(() => window.__game.mouthXY());
const dragP = touchDrag(line(p.x, p.y, m.x, m.y + 30, 16), 50);
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/op-1-dragging.png` });
await dragP;
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/op-2-at-mouth.png` });
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/op-3-swallow.png` });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/op-4-tunnel.png` });
await waitState('inside');
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/op-5-warehouse.png` });
// draw
const p2 = await page.evaluate(() => window.__game.presentXY());
const b = await page.evaluate(() => window.__game.bayXY(0));
const drawP = touchDrag(line(p2.x, p2.y, b.x, b.y + 50, 14), 80);
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/op-6-drawing.png` });
await drawP;
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/op-7-following.png` });
await waitState('storedWait').catch(() => {});
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/op-8-stored.png` });
await browser.close();
console.log('DONE eval capture');
