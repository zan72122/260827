import { launch, grab, drag, shot, stats } from './harness.mjs';
const { browser, page, errors } = await launch();
const ev = (fn, arg) => page.evaluate(fn, arg);
const focus = (az, d, e) => ev(([a, dd, ee]) => window.__spanbaum.focus(a, dd, ee), [az, d, e]);
const show = (o) => ev((oo) => window.__spanbaum.show(oo), o);
const hold = (o) => ev((oo) => window.__spanbaum.hold(oo), o);
const restore = () => ev(() => window.__spanbaum.restoreCamera());

await hold(true);
const full = (await stats(page)).strokePx;
let p = await grab(page);
for (const frac of [0.25, 0.5, 0.75, 1.0]) {
  p = await drag(page, p, full * 0.25);
  const st = await stats(page);
  console.log(`${(frac*100)|0}%: cut=${st.cut.toFixed(4)} feed=${st.feed.toFixed(4)} ${st.phase}`);
  const tag = (frac*100)|0;
  await show({ premade: false, tool: false, child: true });
  await focus(0.95, 0.52, 0.16); await shot(page, `S${tag}-a-shaving`);
  await focus(1.60, 0.52, 0.16); await shot(page, `S${tag}-b-profile`);
  await focus(-0.95, 0.52, 0.16); await shot(page, `S${tag}-c-behind`);
  await show({ child: false });
  await focus(0.55, 0.45, 0.14); await shot(page, `S${tag}-d-trench`);
  await show({ premade: true, tool: true, child: true });
  await focus(0.75, 0.95, 0.16); await shot(page, `S${tag}-e-tool`);
  await restore();
}
await restore(); await shot(page, 'S-game-view');
console.log('errors', errors.filter(e => !e.includes('404')));
await browser.close();
