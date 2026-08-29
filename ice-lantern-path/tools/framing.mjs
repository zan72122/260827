// Every phase, every device: is the thing the player must touch on screen?
import { withPage, DEVICES } from './capture.mjs';

const CHECKS = [
  ['intro', ['moldCenter', 'pitcher']],
  ['assemble', ['inner', 'moldCenter']],
  ['decorate', ['decor0', 'decor3', 'moldCenter']],
  ['fill', ['pitcher', 'moldCenter']],
  ['shelve', ['outer']],
  ['pullInner', ['innerHandle', 'moldCenter']],
  ['pullOuter', ['handle', 'outer']],
  ['led', ['led', 'moldCenter']],
];

let bad = 0;
for (const dev of Object.keys(DEVICES)) {

  await withPage(dev, async (page, shot, d) => {
    for (const [phase, targets] of CHECKS) {
      await page.evaluate((p) => window.__game.setPhase(p), phase);
      // put the rig in the state the phase actually runs in
      if (phase !== 'assemble' && phase !== 'intro') {
        await page.evaluate(() => window.__game.inner.group.position.set(0, 0.052, 0));
      }
      await page.waitForTimeout(1700);
      for (const t of targets) {
        const pt = await page.evaluate((k) => window.__game.screenPointFor(k), t);
        if (!pt) { console.log(`${dev} ${phase} ${t}: NO POINT`); bad++; continue; }
        const okx = pt.x > d.width * 0.06 && pt.x < d.width * 0.94;
        const oky = pt.y > d.height * 0.06 && pt.y < d.height * 0.9;
        if (!okx || !oky) {
          console.log(`${dev} ${phase} ${t}: OFF FRAME ${pt.x.toFixed(0)},${pt.y.toFixed(0)} of ${d.width}x${d.height}`);
          bad++;
          await shot(`framing-${dev}-${phase}-${t}`);
        }
      }
    }
    console.log(`${dev} checked`);
  }, { settle: 2500, qs: '?maxdt=0.3&fast=3' });
}
console.log(bad === 0 ? 'FRAMING OK' : `FRAMING ISSUES: ${bad}`);
