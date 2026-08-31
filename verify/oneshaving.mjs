import { launch, grab, drag, shot, stats } from './harness.mjs';

const { browser, page, errors } = await launch();
const focus = (az, d, e) => page.evaluate(([a, dd, ee]) => window.__spanbaum.focus(a, dd, ee), [az, d, e]);
const iso = (on) => page.evaluate((o) => window.__spanbaum.isolate(o), on);
const restore = () => page.evaluate(() => { window.__spanbaum.isolate(false); window.__spanbaum.restoreCamera(); });

console.log('env map present:', (await stats(page)).env);
const full = (await stats(page)).strokePx;
let p = await grab(page);

for (const frac of [0.25, 0.5, 0.75, 1.0]) {
  p = await drag(page, p, full * 0.25);
  const st = await stats(page);
  console.log(`cut ${(frac*100)|0}%  cut=${st.cut.toFixed(4)} feed=${st.feed.toFixed(4)} ${st.phase}`);
  await iso(true);
  await focus(0.0, 0.62, 0.16);   await shot(page, `A-${(frac*100)|0}-front`);
  await focus(1.50, 0.62, 0.16);  await shot(page, `A-${(frac*100)|0}-side`);
  await focus(-1.50, 0.62, 0.16); await shot(page, `A-${(frac*100)|0}-back`);
  await iso(false);
  await focus(0.35, 0.75, 0.20);  await shot(page, `A-${(frac*100)|0}-tool`);
  await restore();
}
console.log('errors', errors.filter(e => !e.includes('404')));
await browser.close();
