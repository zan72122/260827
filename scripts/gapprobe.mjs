// Focused probe: where does the cable continuity gap open during a lay?
import { chromium } from 'playwright-core';

const BASE = process.env.PLAYTEST_URL || 'http://127.0.0.1:4173/';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader']
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.__seacable, null, { timeout: 20000 });
const state = () => page.evaluate(() => window.__seacable.getState());
const w2s = (x, z) => page.evaluate(([a, b]) => window.__seacable.worldToScreen(a, b), [x, z]);

await page.mouse.click(30, 30);
await page.waitForFunction(() => window.__seacable.getState().phase === 'planning');
await page.waitForTimeout(3000);
let prev = null, stable = 0;
for (let i = 0; i < 60 && stable < 4; i++) {
  const s = await state();
  const p = await w2s(s.anchorA[0], s.anchorA[1]);
  if (prev && Math.abs(p.x - prev.x) < 0.5 && Math.abs(p.y - prev.y) < 0.5) stable++;
  else stable = 0;
  prev = p;
  await page.waitForTimeout(400);
}
const s0 = await state();
const pts = [];
for (let i = 0; i <= 40; i++) {
  const t = i / 40;
  pts.push(await w2s(s0.anchorA[0] + (s0.anchorB[0] - s0.anchorA[0]) * t, s0.anchorA[1] + (s0.anchorB[1] - s0.anchorA[1]) * t));
}
await page.mouse.move(pts[0].x, pts[0].y);
await page.mouse.down();
for (const p of pts.slice(1)) { await page.mouse.move(p.x, p.y, { steps: 2 }); await page.waitForTimeout(8); }
await page.mouse.up();
await page.evaluate(() => window.__seacable.setTimeScale(4));

const t0 = Date.now();
while (Date.now() - t0 < 90000) {
  const s = await state();
  if (s.phase === 'result') break;
  if (s.phase === 'laying') {
    console.log(`ship=${s.shipS.toFixed(1)} td=${s.touchdownS.toFixed(1)}/${s.routeLength.toFixed(1)} gapSea=${s.gapSeabed.toFixed(3)} gapStern=${s.gapStern.toFixed(3)}`);
  }
  await page.waitForTimeout(250);
}
await browser.close();
