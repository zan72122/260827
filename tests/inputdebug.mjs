import { launch, openGame, skipIntro, drawStroke, densify } from './helpers.mjs';

const browser = await launch();
const { page } = await openGame(browser, { width: 430, height: 932, dpr: 2 });
await skipIntro(page);
await page.evaluate(() => {
  window.__ev = [];
  const c = document.querySelector('canvas');
  for (const t of ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'touchstart']) {
    c.addEventListener(t, (e) => window.__ev.push([t, e.clientX | 0, e.clientY | 0]));
  }
});
await drawStroke(page, densify([{ x: 0, z: 10 }, { x: 0, z: -12 }], 30), { durationMs: 800 });
await page.waitForTimeout(500);
console.log('events:', await page.evaluate(() => JSON.stringify(window.__ev.slice(0, 6))), 'count', await page.evaluate(() => window.__ev.length));
console.log('phase:', await page.evaluate(() => window.__test.phase()), 'veh:', await page.evaluate(() => JSON.stringify(window.__test.vehicle())));
await browser.close();
