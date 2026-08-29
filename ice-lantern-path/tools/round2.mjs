// Verify the "make another one" loop: from a finished lantern, start round 2.
import { withPage } from './capture.mjs';

await withPage('iphone-p', async (page, shot) => {
  await page.waitForTimeout(3000);
  const before = await page.evaluate(() => window.__game.state);
  await page.click('#hud-secondary');
  await page.waitForTimeout(6000);
  const after = await page.evaluate(() => window.__game.state);
  await shot('round2-assemble');
  console.log('before', JSON.stringify(before));
  console.log('after ', JSON.stringify(after));
  console.log(after.round === 2 && after.phase === 'assemble' ? 'ROUND2 OK' : 'ROUND2 FAILED');
}, { settle: 2000, qs: '?scene=lit&maxdt=0.3&fast=2' });
