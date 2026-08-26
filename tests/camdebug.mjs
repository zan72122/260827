import { launch, openGame, skipIntro, drawStroke, densify, waitPhase } from './helpers.mjs';

const browser = await launch();
const { page } = await openGame(browser, { width: 430, height: 932, dpr: 2 });
await skipIntro(page);
await page.evaluate(() => {
  window.__ev = [];
  const c = document.querySelector('canvas');
  for (const t of ['pointerdown', 'pointermove', 'pointerup']) {
    c.addEventListener(t, (e) => window.__ev.push([t, e.clientX | 0, e.clientY | 0]));
  }
});
await drawStroke(page, densify([{ x: 0, z: 10 }, { x: 0, z: -12 }], 30), { durationMs: 800 });
console.log('stroke:', await page.evaluate(() => JSON.stringify({ phase: window.__test.phase(), last: (window.__test.lastStroke()||[]).length, ev: window.__ev.length, first: window.__ev.slice(0,3) })));
await page.evaluate(() => window.__test.setTimeScale(3));
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(1500);
  console.log('poll', await page.evaluate(() => JSON.stringify({ p: window.__test.phase(), v: window.__test.vehicle() })));
  const ph = await page.evaluate(() => window.__test.phase());
  if (ph === 'bandview' || ph === 'skate') break;
}
await page.evaluate(() => window.__test.setTimeScale(1));
for (let i = 0; i < 5; i++) {
  await page.waitForTimeout(2000);
  console.log(await page.evaluate(() => {
    const g = window.__test;
    return JSON.stringify({ phase: g.phase(), cam: g.debugCam ? g.debugCam() : null });
  }));
}
await page.screenshot({ path: 'screenshots/dev/camdebug.png' });
await browser.close();
