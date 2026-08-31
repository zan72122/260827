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
const waitFor = async (p, t = 400000) => { const t0 = Date.now(); for (;;) { const d = await dbg(); if (d && p(d)) return d; if (Date.now() - t0 > t) throw new Error('timeout ' + JSON.stringify(d)); await page.waitForTimeout(80); } };
const simWait = async (s) => { const d0 = await waitFor(() => true); await waitFor((d) => d.simTime - d0.simTime >= s); };

await waitFor((d) => d.beat === 'awaitFirst');
let d = await dbg();
await page.mouse.move(d.cakeCentre.x, d.cakeCentre.y + d.fingerOffset);
await page.mouse.down(); await simWait(0.9); await page.mouse.up();
await waitFor((x) => !x.piping);
await waitFor((x) => x.beat === 'free');
await simWait(2.5);

for (const [rad, turns, steps, dt] of [[26, 2.4, 46, 0.028], [34, 1.2, 34, 0.04], [18, 3.0, 54, 0.026]]) {
  await simWait(2.4);
  d = await dbg();
  const cx = d.cakeCentre.x + 30, cy = d.cakeCentre.y + 10 + d.fingerOffset;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const a = t * Math.PI * 2 * turns;
    await page.mouse.move(cx + rad * Math.cos(a) - rad, cy + rad * Math.sin(a));
    await simWait(dt);
  }
  const mid = await dbg();
  await page.mouse.up();
  await waitFor((x) => !x.piping);
  await simWait(0.8);
  const s = await dbg();
  console.log(`r=${rad} turns=${turns} -> ${s.kinds[s.kinds.length - 1]} (oscTotal ${mid.oscTotal}, live ${mid.liveKind})`);
}
await page.screenshot({ path: `${OUT}/rosette-test.png` });
console.log(errs.length ? errs.join('\n') : '(no errors)');
await browser.close();
