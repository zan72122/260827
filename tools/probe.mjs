import { chromium } from 'playwright';

const OUT = '/tmp/claude-0/-home-user-260827/c1e376f6-014b-5dc9-8256-d7519e3b3fd2/scratchpad/shots';
const URL = (process.env.URL || 'http://127.0.0.1:4173/') + '?debug=1';

const VIEWPORTS = {
  iphonePortrait: { width: 390, height: 844 },
  iphoneLandscape: { width: 844, height: 390 },
  ipadPortrait: { width: 820, height: 1180 },
  ipadLandscape: { width: 1180, height: 820 },
};

const mode = process.argv[2] || 'iphonePortrait';
const vp = VIEWPORTS[mode];
const stage = process.argv[3] || 'all';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errs.push(`[pageerror] ${e.message}`));

await page.goto(URL, { waitUntil: 'load' });
const dbg = () => page.evaluate(() => window.__dbg ?? null);
const waitFor = async (pred, timeout = 300000) => {
  const t0 = Date.now();
  for (;;) {
    const d = await dbg();
    if (d && pred(d)) return d;
    if (Date.now() - t0 > timeout) throw new Error('timeout; last=' + JSON.stringify(d));
    await page.waitForTimeout(100);
  }
};
const simWait = async (sec) => {
  const d0 = await waitFor(() => true);
  await waitFor((d) => d.simTime - d0.simTime >= sec);
};
const shot = (n) => page.screenshot({ path: `${OUT}/${mode}-${n}.png` });

await waitFor((d) => d.simTime > 0.35);
await shot('01-macro');
await waitFor((d) => d.beat === 'introApproach');
await simWait(1.3);
await shot('02-approach');
await waitFor((d) => d.beat === 'awaitFirst');
await simWait(0.6);
await shot('03-await');

async function stroke(x, y, holdSec, path, name) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  if (path) {
    for (let i = 1; i <= path.steps; i++) {
      const p = path.fn(i / path.steps);
      await page.mouse.move(x + p.x, y + p.y);
      await simWait(path.dt ?? 0.05);
    }
  } else {
    await simWait(holdSec);
  }
  if (name) await shot(`${name}-live`);
  await page.mouse.up();
  await waitFor((d) => !d.piping);
  await simWait(1.7);
  if (name) await shot(name);
}

// where to press so the piping point lands near a screen position
const pressAt = async (sx, sy) => ({ x: sx, y: sy + (await dbg()).fingerOffset });

let d = await dbg();
let c = await pressAt(d.cakeCentre.x, d.cakeCentre.y);
await stroke(c.x, c.y, 1.2, null, '04-star');
await waitFor((x) => x.beat === 'presentNozzles' || x.beat === 'free');
await simWait(1.6);
await shot('05-bench');
await waitFor((x) => x.beat === 'free');
await simWait(1.2);
await shot('06-free');
console.log('after first star', JSON.stringify(await dbg()));

if (stage !== 'intro') {
  d = await dbg();
  c = await pressAt(d.cakeCentre.x - 40, d.cakeCentre.y - 16);
  await stroke(c.x, c.y, 0, { steps: 10, dt: 0.055, fn: (t) => ({ x: 40 * t, y: 0 }) }, '07-shell');

  d = await dbg();
  c = await pressAt(d.cakeCentre.x + 46, d.cakeCentre.y + 4);
  await stroke(c.x, c.y, 0, {
    steps: 46, dt: 0.028,
    fn: (t) => ({ x: 26 * Math.cos(t * Math.PI * 2.4) - 26, y: 26 * Math.sin(t * Math.PI * 2.4) }),
  }, '08-rosette');

  d = await dbg();
  c = await pressAt(d.cakeCentre.x - 78, d.cakeCentre.y + 36);
  await stroke(c.x, c.y, 0, { steps: 34, dt: 0.05, fn: (t) => ({ x: 156 * t, y: -14 * Math.sin(t * Math.PI) }) }, '09-rope');

  d = await dbg();
  c = await pressAt(d.cakeCentre.x - 70, d.cakeCentre.y - 52);
  await stroke(c.x, c.y, 0, {
    steps: 48, dt: 0.04,
    fn: (t) => ({ x: 136 * t, y: 15 * Math.sin(t * Math.PI * 7) }),
  }, '10-ribbon');
  console.log('gestures', JSON.stringify((await dbg()).kinds));

  // ---- swap to the round tip, then the petal tip -------------------------
  for (const want of ['round', 'petal']) {
    // let the gesture shot finish before reading screen positions
    await simWait(2.4);
    d = await dbg();
    const b = d.bench.find((n) => n.id === want);
    if (!b) { console.log('bench tip missing', want, JSON.stringify(d.bench)); continue; }
    await page.mouse.move(b.x, b.y);
    await page.mouse.down();
    const steps = 16;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      await page.mouse.move(b.x + (d.socket.x - b.x) * t, b.y + (d.socket.y - b.y) * t);
      await simWait(0.04);
    }
    await page.mouse.up();
    await simWait(1.4);
    await shot(`11-${want}-attached`);
    console.log('nozzle now', (await dbg()).nozzle);

    d = await dbg();
    c = await pressAt(d.cakeCentre.x + (want === 'round' ? -30 : 34), d.cakeCentre.y + 54);
    await stroke(c.x, c.y, 0.9, null, `12-${want}-hold`);
    d = await dbg();
    c = await pressAt(d.cakeCentre.x - 60, d.cakeCentre.y + (want === 'round' ? 72 : -74));
    await stroke(c.x, c.y, 0, { steps: 30, dt: 0.045, fn: (t) => ({ x: 124 * t, y: 10 * Math.sin(t * Math.PI * 4) }) }, `13-${want}-move`);
  }
}

await shot('14-final');
console.log('final', JSON.stringify(await dbg()));
console.log('--- console ---');
console.log(errs.length ? errs.join('\n') : '(none)');
await browser.close();
