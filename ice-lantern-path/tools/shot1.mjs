// One state, one screenshot, immediate feedback.
import { withPage } from './capture.mjs';
const dev = process.argv[2];
const name = process.argv[3];
const qs = process.argv[4];
const wait = Number(process.argv[5] || 3500);
const phase = process.argv[6];
await withPage(dev, async (page, shot) => {
  if (phase) {
    await page.evaluate(() => window.__game.inner.group.position.set(0, 0.052, 0));
    await page.evaluate((p) => window.__game.setPhase(p), phase);
  }
  await page.waitForTimeout(wait);
  const st = await page.evaluate(() => (window.__game ? window.__game.state : null));
  const p = await shot(`state-${dev}-${name}`);
  console.log('OK', name, dev, JSON.stringify(st), p);
}, { settle: 2000, qs });
