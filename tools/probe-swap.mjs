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

for (const want of ['round', 'petal', 'openStar']) {
  d = await dbg();
  const b = d.bench.find((n) => n.id === want);
  if (!b) { console.log('missing', want, JSON.stringify(d.bench)); continue; }
  console.log('drag', want, 'from', b.x, b.y, 'to', d.socket.x, d.socket.y);
  await page.mouse.move(b.x, b.y);
  await page.mouse.down();
  await simWait(0.05);
  console.log('  dragging =', (await dbg()).dragging);
  for (let i = 1; i <= 14; i++) {
    const t = i / 14;
    await page.mouse.move(b.x + (d.socket.x - b.x) * t, b.y + (d.socket.y - b.y) * t);
    await simWait(0.04);
  }
  await page.mouse.up();
  await simWait(1.5);
  const s = await dbg();
  console.log('  ->', s.nozzle, 'drop', JSON.stringify(s.lastDrop), 'decorations', s.decorations);
}
await page.screenshot({ path: `${OUT}/swap-test.png` });
console.log(errs.length ? errs.join('\n') : '(no errors)');
await browser.close();
