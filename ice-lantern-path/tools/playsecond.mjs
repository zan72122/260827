// Second half of the chain, from the frozen block onwards, through real input.
import { withPage } from './capture.mjs';

const dev = process.argv[2] || 'iphone-p';
await withPage(dev, async (page, shot) => {
  const state = () => page.evaluate(() => window.__game.state);
  const pt = (n) => page.evaluate((k) => window.__game.screenPointFor(k), n);
  async function waitPhase(p, timeout = 180000, settle = 1800) {
    const t0 = Date.now();
    let last = 0;
    for (;;) {
      const s = await state();
      if (s.phase === p && !s.busy) {
        await page.waitForTimeout(settle);
        return s;
      }
      if (Date.now() - t0 > last + 8000) {
        last = Date.now() - t0;
        console.log(`  waiting ${p} (${(last / 1000) | 0}s) ${JSON.stringify(s)}`);
      }
      if (Date.now() - t0 > timeout) throw new Error(`timeout ${p}: ${JSON.stringify(s)}`);
      await page.waitForTimeout(200);
    }
  }
  async function drag(a, b, steps = 8) {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.waitForTimeout(60);
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
    }
    await page.waitForTimeout(60);
    await page.mouse.up();
  }

  await waitPhase('pullInner');
  console.log('step: pullInner');
  const ih = await pt('innerHandle');
  await page.mouse.move(ih.x, ih.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(ih.x + i * 15, ih.y);
  for (let i = 1; i <= 8; i++) await page.mouse.move(ih.x + 90, ih.y - i * 20);
  await page.mouse.up();
  await page.waitForTimeout(1200);
  await shot(`second-${dev}-inner-out`);
  await waitPhase('pullOuter');
  console.log('step: pullOuter');

  const h = await pt('handle');
  await page.mouse.move(h.x, h.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(h.x, h.y - i * 16);
  await page.mouse.up();
  await page.waitForTimeout(1400);
  await shot(`second-${dev}-half-out`);
  await waitPhase('led');
  console.log('step: led');
  await shot(`second-${dev}-demolded`);

  await drag(await pt('led'), await pt('cavity'), 8);
  await page.waitForTimeout(1600);
  const ledp = await pt('led');
  await page.mouse.click(ledp.x, ledp.y);
  await waitPhase('lit');
  console.log('step: lit');
  await shot(`second-${dev}-lit`);

  await page.click('#hud-primary');
  console.log('step: carry');
  await waitPhase('finale', 180000);
  console.log('step: finale');
  await shot(`second-${dev}-path`);

  const sw = await pt('switch');
  await page.mouse.move(sw.x, sw.y);
  await page.mouse.down();
  const w = page.viewportSize().width;
  for (let i = 1; i <= 14; i++) {
    await page.mouse.move(sw.x + (i * w * 0.55) / 14, sw.y);
    if (i === 6) await shot(`second-${dev}-lighting`);
  }
  await page.mouse.up();
  await page.waitForTimeout(7000);
  await shot(`second-${dev}-finale`);
  console.log('final state', JSON.stringify(await state()));
}, { settle: 2500, qs: '?scene=innerOut&maxdt=0.5&fast=1.5' });
