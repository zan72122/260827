import { chromium } from 'playwright';
const OUT = '/tmp/claude-0/-home-user-260827/c1e376f6-014b-5dc9-8256-d7519e3b3fd2/scratchpad/shots';
const URL = (process.env.URL || 'http://127.0.0.1:4173/') + '?debug=1';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(URL, { waitUntil: 'load' });
const dbg = () => page.evaluate(() => window.__dbg ?? null);
const waitFor = async (p, t = 300000) => { const t0 = Date.now(); for (;;) { const d = await dbg(); if (d && p(d)) return d; if (Date.now() - t0 > t) throw new Error('timeout ' + JSON.stringify(d)); await page.waitForTimeout(80); } };
const simWait = async (s) => { const d0 = await waitFor(() => true); await waitFor((d) => d.simTime - d0.simTime >= s); };

await waitFor((d) => d.beat === 'awaitFirst');
let d = await dbg();
await page.mouse.move(d.cakeCentre.x, d.cakeCentre.y + d.fingerOffset);
await page.mouse.down(); await simWait(0.9); await page.mouse.up();
await waitFor((x) => !x.piping);
await waitFor((x) => x.beat === 'free');
await simWait(1.0);

for (const [amp, cycles, span, steps, dt] of [[15, 3.5, 136, 48, 0.04], [11, 4.5, 120, 60, 0.032]]) {
  d = await dbg();
  const x0 = d.cakeCentre.x - span / 2;
  const y0 = d.cakeCentre.y - 40 + d.fingerOffset;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  let maxOsc = 0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(x0 + span * t, y0 + amp * Math.sin(t * Math.PI * 2 * cycles));
    await simWait(dt);
    const s = await dbg();
    maxOsc = Math.max(maxOsc, s.osc);
  }
  const mid = await dbg();
  console.log('during: osc', mid.osc, 'max', maxOsc, 'ribbon', mid.ribbon, 'liveKind', mid.liveKind);
  await page.mouse.up();
  await waitFor((x) => !x.piping);
  await simWait(0.8);
  console.log('result kinds', JSON.stringify((await dbg()).kinds));
}
await page.screenshot({ path: `${OUT}/ribbon-test.png` });
console.log(errs.length ? errs.join('\n') : '(no errors)');
await browser.close();
