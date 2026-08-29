// Last leg through real input: lit -> sled cutscene -> path -> all lit.
import { withPage } from './capture.mjs';

const dev = process.argv[2] || 'iphone-p';
await withPage(dev, async (page, shot) => {
  const state = () => page.evaluate(() => window.__game.state);
  const pt = (n) => page.evaluate((k) => window.__game.screenPointFor(k), n);
  async function waitPhase(p, timeout = 240000) {
    const t0 = Date.now();
    let last = 0;
    for (;;) {
      const s = await state();
      if (s.phase === p && !s.busy) return s;
      if (Date.now() - t0 > last + 10000) {
        last = Date.now() - t0;
        console.log(`  waiting ${p} (${(last / 1000) | 0}s) ${JSON.stringify(s)}`);
      }
      if (Date.now() - t0 > timeout) throw new Error(`timeout ${p}: ${JSON.stringify(s)}`);
      await page.waitForTimeout(250);
    }
  }

  await waitPhase('lit');
  console.log('step: lit');
  await page.click('#hud-primary', { timeout: 20000 });
  console.log('step: carry');
  await waitPhase('finale');
  console.log('step: finale');
  await page.waitForTimeout(1500);
  await shot(`final-${dev}-path`);

  const sw = await pt('switch');
  await page.mouse.move(sw.x, sw.y);
  await page.mouse.down();
  const w = page.viewportSize().width;
  for (let i = 1; i <= 14; i++) {
    await page.mouse.move(sw.x + (i * w * 0.55) / 14, sw.y);
    if (i === 6) await shot(`final-${dev}-lighting`);
  }
  await page.mouse.up();
  await waitPhase('done');
  console.log('step: done');
  await page.waitForTimeout(2500);
  await shot(`final-${dev}-allon`);
  console.log('final state', JSON.stringify(await state()));
}, { settle: 2500, qs: '?scene=lit&maxdt=0.5&fast=2' });
