// Quick smoke test: boot, skip intro, draw a straight line, verify the band.
import { launch, openGame, skipIntro, drawStroke, densify, waitDriveDone } from './helpers.mjs';
import fs from 'node:fs';

const browser = await launch();
const { page } = await openGame(browser, { width: 390, height: 844, dpr: 2 });
await page.waitForTimeout(1200);
fs.mkdirSync('screenshots/dev', { recursive: true });
await page.screenshot({ path: 'screenshots/dev/smoke-intro.png' });

await skipIntro(page);
await page.screenshot({ path: 'screenshots/dev/smoke-draw.png' });

// straight line from vehicle toward the skater
await drawStroke(page, densify([{ x: 0, z: 10 }, { x: 0, z: -12 }], 30));
await page.waitForTimeout(500);
console.log('phase after stroke:', await page.evaluate(() => window.__test.phase()));
console.log('vehicle:', await page.evaluate(() => window.__test.vehicle()));
console.log('pathTotal:', await page.evaluate(() => window.__test.pathTotal()));

// mid-drive checks
await page.evaluate(() => window.__test.setTimeScale(3));
await page.waitForTimeout(2500);
const mid = await page.evaluate(() => {
  const v = window.__test.vehicle();
  const f = { x: Math.sin(v.heading), z: Math.cos(v.heading) };
  return {
    v,
    aheead: window.__test.maskAt(v.x + f.x * 4, v.z + f.z * 4),
    behind: window.__test.maskAt(v.x - f.x * 3, v.z - f.z * 3)
  };
});
console.log('mid-drive:', JSON.stringify(mid));
await page.screenshot({ path: 'screenshots/dev/smoke-drive.png' });

await waitDriveDone(page);
await page.screenshot({ path: 'screenshots/dev/smoke-done.png' });
const final = await page.evaluate(() => ({
  phase: window.__test.phase(),
  onPath: window.__test.maskAt(0, 0),
  offPath: window.__test.maskAt(6, 0),
  band: window.__test.bandTrace().length
}));
console.log('final:', JSON.stringify(final));
await browser.close();
console.log('SMOKE OK');
