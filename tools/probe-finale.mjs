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
page.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });
await page.goto(URL, { waitUntil: 'load' });
const dbg = () => page.evaluate(() => window.__dbg ?? null);
const waitFor = async (p, t = 600000) => { const t0 = Date.now(); for (;;) { const d = await dbg(); if (d && p(d)) return d; if (Date.now() - t0 > t) throw new Error('timeout ' + JSON.stringify(d)); await page.waitForTimeout(120); } };
const simWait = async (s) => { const d0 = await waitFor(() => true); await waitFor((d) => d.simTime - d0.simTime >= s); };

await waitFor((d) => d.beat === 'awaitFirst');
for (let k = 0; k < 5; k++) {
  const d = await dbg();
  const a = (k / 5) * Math.PI * 2;
  await page.mouse.move(d.cakeCentre.x + Math.cos(a) * 46, d.cakeCentre.y + Math.sin(a) * 30 + d.fingerOffset);
  await page.mouse.down();
  await simWait(0.8);
  await page.mouse.up();
  await waitFor((x) => !x.piping);
  await simWait(0.6);
  if (k === 0) await waitFor((x) => x.beat === 'free');
}
console.log('after 5 strokes', JSON.stringify(await dbg()));
// idle hints, then the finale turntable
await simWait(9);
await page.screenshot({ path: `${OUT}/hints-idle.png` });
await waitFor((d) => d.beat === 'finale');
await simWait(5);
await page.screenshot({ path: `${OUT}/finale.png` });
console.log('finale', JSON.stringify(await dbg()));
// a touch must leave the finale and let piping resume
const d2 = await dbg();
await page.mouse.click(d2.cakeCentre.x, d2.cakeCentre.y + d2.fingerOffset);
await simWait(2.5);
console.log('after touch', JSON.stringify({ beat: (await dbg()).beat, dec: (await dbg()).decorations }));
console.log(errs.length ? errs.join('\n') : '(no errors)');
await browser.close();
