import { chromium } from 'playwright';
const OUT = '/tmp/claude-0/-home-user-260827/c1e376f6-014b-5dc9-8256-d7519e3b3fd2/scratchpad/shots';
const URL = (process.env.URL || 'http://127.0.0.1:4173/') + '?debug=1';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(`[error] ${m.text()}`); });
page.on('pageerror', (e) => errs.push(`[pageerror] ${e.message}`));
await page.goto(URL, { waitUntil: 'load' });
const dbg = () => page.evaluate(() => window.__dbg ?? null);
const waitFor = async (pred, timeout = 300000) => {
  const t0 = Date.now();
  for (;;) { const d = await dbg(); if (d && pred(d)) return d;
    if (Date.now() - t0 > timeout) throw new Error('timeout; last=' + JSON.stringify(d));
    await page.waitForTimeout(100); }
};
const simWait = async (s) => { const d0 = await waitFor(() => true); await waitFor((d) => d.simTime - d0.simTime >= s); };

await waitFor((d) => d.beat === 'awaitFirst');
let d = await dbg();
// start a long stroke, rotate the device mid-stroke, keep drawing, then release
await page.mouse.move(d.cakeCentre.x - 60, d.cakeCentre.y + d.fingerOffset);
await page.mouse.down();
for (let i = 1; i <= 10; i++) { await page.mouse.move(d.cakeCentre.x - 60 + i * 6, d.cakeCentre.y + d.fingerOffset); await simWait(0.05); }
const mid = await dbg();
console.log('mid-stroke piping:', mid.piping, 'rings drawn ok');
await page.setViewportSize({ width: 844, height: 390 });
await simWait(0.5);
const after = await dbg();
console.log('after rotate piping:', after.piping, 'decorations:', after.decorations);
for (let i = 1; i <= 10; i++) { await page.mouse.move(400 + i * 8, 250); await simWait(0.05); }
await page.mouse.up();
await waitFor((x) => !x.piping);
await simWait(1.0);
await page.screenshot({ path: `${OUT}/rotate-midstroke.png` });
const fin = await dbg();
console.log('final', JSON.stringify({ decorations: fin.decorations, kinds: fin.kinds, beat: fin.beat }));
console.log(errs.length ? errs.join('\n') : '(no console errors)');
await browser.close();
