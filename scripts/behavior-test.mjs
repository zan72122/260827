// Behavioural tests driven through real touch input (CDP), not the debug API.
import { chromium } from 'playwright-core';

const URL = process.env.SHOT_URL ?? 'http://localhost:5173/';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
});
const page = await ctx.newPage();
let errors = 0;
page.on('pageerror', (e) => { errors++; console.error('PAGEERROR:', e.message); });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.icecore !== undefined);
await page.waitForTimeout(800);
const cdp = await ctx.newCDPSession(page);

const prog = () => page.evaluate(() => window.icecore.getProgress());
async function touch(type, x, y) {
  await cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
  });
}
async function swipe(x0, y0, x1, y1, steps = 20, endType = 'touchEnd') {
  await touch('touchStart', x0, y0);
  for (let i = 1; i <= steps; i++) {
    await touch('touchMove', x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
    await page.waitForTimeout(16);
  }
  if (endType === 'cancel') await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  else await touch('touchEnd', x1, y1);
}

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log(`PASS ${name} ${extra}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
};

// 1. upward swipe advances progress (with sideways wandering)
const p0 = await prog();
await swipe(150, 780, 260, 240, 26);
await page.waitForTimeout(400);
const p1 = await prog();
check('up-swipe advances', p1 > p0 + 0.2, `p ${p0.toFixed(3)} -> ${p1.toFixed(3)}`);

// 2. reverse (downward) swipe goes back toward the deep
await swipe(195, 200, 195, 700, 20);
await page.waitForTimeout(400);
const p2 = await prog();
check('down-swipe returns', p2 < p1 - 0.1, `p ${p1.toFixed(3)} -> ${p2.toFixed(3)}`);

// 3. pointercancel mid-swipe: no error, progress kept, can resume
await swipe(195, 700, 195, 400, 10, 'cancel');
await page.waitForTimeout(300);
const p3 = await prog();
await swipe(195, 700, 195, 300, 12);
await page.waitForTimeout(300);
const p3b = await prog();
check('pointercancel survives + resume', p3b > p3, `p ${p3.toFixed(3)} -> ${p3b.toFixed(3)}`);

// 4. full journey by repeated swipes -> completion + replay button
for (let i = 0; i < 14 && (await prog()) < 0.995; i++) {
  await swipe(195, 800, 195, 60, 24);
  await page.waitForTimeout(500);
}
await page.waitForTimeout(2500); // assisted glide to 1.0
const pDone = await prog();
const replayVisible = await page.evaluate(() => document.getElementById('replay').classList.contains('show'));
check('journey completes', pDone > 0.995, `p=${pDone.toFixed(3)}`);
check('replay button shows', replayVisible);

// 5. ten replays: reset then jump around deterministically
let okReplays = 0;
for (let i = 0; i < 10; i++) {
  await page.evaluate(() => document.getElementById('replay').click());
  await page.waitForTimeout(900);
  const pr = await prog();
  await page.evaluate(() => window.icecore.setProgress(Math.random()));
  await page.waitForTimeout(120);
  if (pr < 0.05) okReplays++;
  await page.evaluate(() => window.icecore.setProgress(1));
  await page.waitForTimeout(200);
}
check('10 replays reset cleanly', okReplays === 10, `${okReplays}/10, errors=${errors}`);

// 6. FPS at three stages, default and lowest quality
async function fps() {
  return page.evaluate(() => new Promise((res) => {
    let n = 0; const t0 = performance.now();
    const tick = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else res(n / 2); };
    requestAnimationFrame(tick);
  }));
}
for (const [label, p] of [['deep', 0.2], ['layers', 0.55], ['surface', 0.94]]) {
  await page.evaluate((v) => window.icecore.setProgress(v), p);
  await page.waitForTimeout(400);
  console.log(`FPS ${label}: ${await fps()}`);
}
await page.evaluate(() => window.icecore.setQuality(3));
await page.waitForTimeout(200);
console.log(`FPS surface q3: ${await fps()}`);
await page.evaluate(() => window.icecore.setQuality(0));

// 7. reduced-motion + muted (no gesture audio) reload
await page.emulateMedia({ reducedMotion: 'reduce' });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.icecore !== undefined);
await page.evaluate(() => window.icecore.setProgress(0.5));
await page.waitForTimeout(800);
check('reduced-motion runs', (await prog()) > 0.49 && errors === 0);

console.log(`\n${pass} passed, ${fail} failed, ${errors} page errors`);
await browser.close();
process.exit(fail > 0 || errors > 0 ? 1 : 0);
