// Full flow: three presents stored -> Santa lifts the sack -> picture menu
// -> free-fly mode -> return -> in/out mode.
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const W = 390, H = 844;
const OUT = 'shots/menu-flow';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const ctx = await browser.newContext({
  viewport: { width: W, height: H }, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGE EXCEPTION:', e.message));
await page.goto('http://localhost:4173/');
await page.waitForFunction(() => window.__game !== undefined);
await page.waitForTimeout(1500);

const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
const state = () => page.evaluate(() => window.__game.state());
const waitState = (s, t = 60000) =>
  page.waitForFunction((w) => window.__game.state() === w, s, { timeout: t });
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

async function storeOne(bayIdx) {
  const p = await page.evaluate(() => window.__game.presentXY());
  const m = await page.evaluate(() => window.__game.mouthXY());
  await touchDrag(line(p.x, p.y, m.x, m.y + 30, 16), 50);
  await waitState('inside');
  await page.waitForTimeout(400);
  const p2 = await page.evaluate(() => window.__game.presentXY());
  const b = await page.evaluate((i) => window.__game.bayXY(i), bayIdx);
  await touchDrag(line(p2.x, p2.y, b.x, b.y + 50, 14), 70);
  try { await waitState('storedWait'); } catch {
    const p3 = await page.evaluate(() => window.__game.presentXY());
    await touchDrag(line(p3.x, p3.y, b.x, b.y + 40, 12), 70);
    await waitState('storedWait');
  }
  await page.waitForTimeout(500);
  await page.locator('.picbtn').first().click();
  await waitState('outside').catch(() => waitState('lift'));
}

await storeOne(0);
console.log('stored 1');
await storeOne(1);
console.log('stored 2');
// third: lift comes after return
const p = await page.evaluate(() => window.__game.presentXY());
const m = await page.evaluate(() => window.__game.mouthXY());
await touchDrag(line(p.x, p.y, m.x, m.y + 30, 16), 50);
await waitState('inside');
await page.waitForTimeout(400);
const p2 = await page.evaluate(() => window.__game.presentXY());
const b = await page.evaluate((i) => window.__game.bayXY(i), 2);
await touchDrag(line(p2.x, p2.y, b.x, b.y + 50, 14), 70);
try { await waitState('storedWait'); } catch {
  const p3 = await page.evaluate(() => window.__game.presentXY());
  await touchDrag(line(p3.x, p3.y, b.x, b.y + 40, 12), 70);
  await waitState('storedWait');
}
await shot('01-three-stored');
await page.locator('.picbtn').first().click();
console.log('waiting for lift...');
await waitState('lift');
await page.waitForTimeout(1600);
await shot('02-santa-lift');
await waitState('menu');
await page.waitForTimeout(900);
await shot('03-picture-menu');
console.log('menu shown, buttons:', await page.locator('.picbtn').count());

// choose FLY (2nd button)
await page.locator('.picbtn').nth(1).click();
await waitState('fly');
await page.waitForTimeout(600);
await shot('04-fly-mode');
// steer around
await touchDrag(line(W * 0.5, H * 0.5, W * 0.8, H * 0.4, 10), 60);
await page.waitForTimeout(800);
await shot('05-fly-steered');
// return
await page.locator('.picbtn').first().click();
await waitState('menu', 30000).catch(async () => console.log('after fly:', await state()));
await shot('06-back-to-menu');

// choose IN/OUT (3rd button) then tap the sack
const btns = await page.locator('.picbtn').count();
console.log('menu buttons now:', btns);
if (btns >= 3) {
  await page.locator('.picbtn').nth(2).click();
  await waitState('outside');
  await page.waitForTimeout(500);
  const mm = await page.evaluate(() => window.__game.mouthXY());
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: mm.x, y: mm.y + 60, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await waitState('fly', 40000).catch(async () => console.log('inout state:', await state()));
  await shot('07-inout-dived-in');
  await page.locator('.picbtn').first().click().catch(() => {});
  await page.waitForTimeout(4000);
  await shot('08-inout-back-outside');
  console.log('final state:', await state());
}
await browser.close();
console.log('DONE menu flow');
