// Drives the game in real Chromium: full loop from wrapping room to
// starry warehouse and back, capturing screenshots along the way.
// Usage: node scripts/drive.mjs [deviceKey]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const DEVICES = {
  'iphone-portrait': { w: 390, h: 844, dpr: 3 },
  'iphone-landscape': { w: 844, h: 390, dpr: 3 },
  'ipad-portrait': { w: 820, h: 1180, dpr: 2 },
  'ipad-landscape': { w: 1180, h: 820, dpr: 2 },
};

const which = process.argv[2] || 'iphone-portrait';
const dev = DEVICES[which];
const OUT = `shots/${which}`;
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const ctx = await browser.newContext({
  viewport: { width: dev.w, height: dev.h },
  deviceScaleFactor: dev.dpr,
  hasTouch: true,
  isMobile: true,
});
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('PAGE ERROR:', m.text()); });
page.on('pageerror', (e) => console.log('PAGE EXCEPTION:', e.message));

// software-GL test env: big iPad canvases are too slow at native dpr
const q = dev.w * dev.h > 500000 ? '?q=low' : '';
await page.goto(`http://localhost:4173/${q}`);
await page.waitForFunction(() => window.__game !== undefined, { timeout: 15000 });
await page.waitForTimeout(1800);

const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
const state = () => page.evaluate(() => window.__game.state());
const info = () => page.evaluate(() => window.__game.info());
const waitState = async (s, timeout = 40000) => {
  await page.waitForFunction((want) => window.__game.state() === want, s, { timeout });
};

// touch-drag helper using CDP touch events
const cdp = await ctx.newCDPSession(page);
async function touchDrag(points, stepMs = 40) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: points[0][0], y: points[0][1], id: 1 }],
  });
  for (let i = 1; i < points.length; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: points[i][0], y: points[i][1], id: 1 }],
    });
    await page.waitForTimeout(stepMs);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
function line(x0, y0, x1, y1, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push([x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]);
  return pts;
}

const W = dev.w, H = dev.h;
console.log('device', which, 'state:', await state());

// ---- 1. opening: the impossible size difference, prophecy loop
await shot('01-opening');
await page.waitForTimeout(1400);
await shot('02-opening-pulse');

// ---- 2. drag the present toward the sack mouth using real screen positions
const getXY = async () => {
  const p = await page.evaluate(() => window.__game.presentXY());
  const m = await page.evaluate(() => window.__game.mouthXY());
  return { p, m };
};
let { p: pXY, m: mXY } = await getXY();
console.log('present at', pXY, 'mouth at', mXY);
const dragPromise = touchDrag(line(pXY.x, pXY.y, mXY.x, mXY.y + 30, 18), 50);
await page.waitForTimeout(500);
await shot('03-dragging');
await dragPromise;

// ---- 3. entry sequence frames
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(260);
  const s = await state();
  await shot(`04-entry-${String(i).padStart(2, '0')}-${s}`);
  if (s === 'inside') break;
}
await waitState('inside', 20000);
await page.waitForTimeout(600);
await shot('05-inside-arrived');
console.log('inside. info:', JSON.stringify(await info()));

// ---- 4. draw a path toward the left bay (real screen anchors)
const drawToBay = async (bayIdx, curveSign = 1) => {
  const pNow = await page.evaluate(() => window.__game.presentXY());
  const bay = await page.evaluate((i) => window.__game.bayXY(i), bayIdx);
  console.log('draw from', pNow, 'to bay', bayIdx, bay);
  const midX = (pNow.x + bay.x) / 2 + curveSign * W * 0.1;
  const midY = (pNow.y + bay.y) / 2 + 40;
  await touchDrag([
    ...line(pNow.x, pNow.y, midX, midY, 8),
    ...line(midX, midY, bay.x, bay.y + 50, 8),
  ], 80);
};
const drawPromise = drawToBay(0, -1);
await page.waitForTimeout(600);
await shot('06-drawing');
await drawPromise;
await shot('07-drawn-following');

// wait for capture/settle
try {
  await waitState('settling', 12000);
  await shot('08-settling');
  await waitState('storedWait', 12000);
} catch {
  console.log('no settle yet, state:', await state(), 'present at', await page.evaluate(() => window.__game.presentPos()));
  await drawToBay(0, 1);
  await waitState('storedWait', 20000).catch(async () => console.log('still not stored:', await state(), await page.evaluate(() => window.__game.presentPos())));
}
await page.waitForTimeout(800);
await shot('09-stored');
console.log('stored. info:', JSON.stringify(await info()));

// ---- 5. return outside (tap the return picture button)
await page.locator('.picbtn').first().click();
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(350);
  const s = await state();
  await shot(`10-return-${String(i).padStart(2, '0')}-${s}`);
  if (s === 'outside') break;
}
await waitState('outside', 15000);
await page.waitForTimeout(900);
await shot('11-back-outside-second-present');
console.log('back outside. info:', JSON.stringify(await info()));

// ---- 6. second present (plush) in
({ p: pXY, m: mXY } = await getXY());
await touchDrag(line(pXY.x, pXY.y, mXY.x, mXY.y + 30, 18), 50);
await waitState('inside', 25000);
await page.waitForTimeout(500);
await shot('12-second-inside');
// different path: to the right bay
await drawToBay(2, 1);
try {
  await waitState('storedWait', 15000);
} catch {
  console.log('2nd not stored, state:', await state());
  await drawToBay(2, -1);
  await waitState('storedWait', 20000).catch(async () => console.log('still not stored:', await state()));
}
await page.waitForTimeout(700);
await shot('13-second-stored');
console.log('second stored. count:', await page.evaluate(() => window.__game.stored()), 'info:', JSON.stringify(await info()));

// fps sample
await page.waitForTimeout(2000);
console.log('fps approx:', await page.evaluate(() => window.__game.fps()));

await browser.close();
console.log('DONE', which);
