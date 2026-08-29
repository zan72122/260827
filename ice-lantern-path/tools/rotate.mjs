// Rotation test: state must survive an orientation change mid-beat.
import { withPage } from './capture.mjs';

const CASES = [
  ['pour', 'scene=pour'],
  ['freezing', 'scene=freezing'],
  ['demold', 'scene=demold'],
  ['lit', 'scene=lit'],
];

for (const [name, qs] of CASES) {
  await withPage('iphone-p', async (page, shot) => {
    await page.waitForTimeout(3000);
    const before = await page.evaluate(() => window.__game.state);
    await shot(`rot-${name}-portrait`);
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(3000);
    const after = await page.evaluate(() => window.__game.state);
    await shot(`rot-${name}-landscape`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(2000);
    const back = await page.evaluate(() => window.__game.state);
    const same =
      before.phase === after.phase &&
      after.phase === back.phase &&
      Math.abs(before.freeze - after.freeze) < 0.25 &&
      before.ledSeated === after.ledSeated;
    console.log(`${name}: ${same ? 'OK' : 'MISMATCH'}`);
    console.log('   portrait ', JSON.stringify(before));
    console.log('   landscape', JSON.stringify(after));
    console.log('   back     ', JSON.stringify(back));
  }, { settle: 2000, qs: '?' + qs + '&maxdt=0.3' });
}
