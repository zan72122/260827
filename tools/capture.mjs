/** Drive the whole loop with real pointer gestures and grab a frame per beat. */
import { chromium } from '@playwright/test';

const OUT = process.env.OUT || '/tmp/ctg';
const portrait = process.env.PORTRAIT !== '0';
const tag = process.env.TAG || (portrait ? 'p' : 'l');
const size = portrait ? { width: 390, height: 844 } : { width: 1024, height: 768 };

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('PAGE ERR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE ERR:', m.text()); });
await page.goto(`http://127.0.0.1:4173/?q=${process.env.Q || 'high'}&speed=${process.env.SPEED || '1'}`, { waitUntil: 'load' });
await page.waitForTimeout(3500);

const state = () => page.evaluate(() => ({
  phase: window.__ctg.phase(),
  half: +window.__ctg.halfWidth().toFixed(2),
  fold: +window.__ctg.foldAverage().toFixed(2),
  dry: +window.__ctg.dryReserve().toFixed(2),
  released: +window.__ctg.released().toFixed(2),
  net: +window.__ctg.netCover().toFixed(2),
}));
const anchor = (n) => page.evaluate((k) => window.__ctg.anchor(k), n);
const shot = async (name) => { await page.screenshot({ path: `${OUT}/${tag}_${name}.png` }); };
const log = async (label) => console.log(label, JSON.stringify(await state()));

async function waitPhase(want, timeout = 90000) {
  const t0 = Date.now();
  for (;;) {
    const s = await state();
    if (Array.isArray(want) ? want.includes(s.phase) : s.phase === want) return s;
    if (Date.now() - t0 > timeout) throw new Error(`stuck in ${s.phase}, wanted ${want}`);
    await page.waitForTimeout(200);
  }
}

async function swipe(from, to, steps = 14, hold = 0) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await page.waitForTimeout(16);
  }
  if (hold) await page.waitForTimeout(hold);
  await page.mouse.up();
}

await log('intro');
await shot('01_intro');

// 1. swipe the tree to the shaker
let a = await anchor('tree');
let b = await anchor('lever');
await swipe(a, { x: a.x + Math.max(160, size.width * 0.45), y: a.y + 20 });
await waitPhase('shake');
await log('after swipe');
await shot('02_shaker');

// 2. hold the safety lever
b = await anchor('lever');
await page.mouse.move(b.x, b.y);
await page.mouse.down();
for (let i = 0; i < 26; i++) {
  await page.waitForTimeout(200);
  await page.mouse.move(b.x, b.y);
  if (i === 12) await shot('03_shake');
}
await log('shaking');
await page.mouse.up();
await page.waitForTimeout(900);
await shot('04_shaken');

// 3. swipe on toward the baler
a = await anchor('tree');
await swipe(a, { x: a.x + Math.max(160, size.width * 0.45), y: a.y + 30 });
await waitPhase('bale');
await log('at baler');
await shot('05_mouth');

// 4. crank the rollers
for (let k = 0; k < 90; k++) {
  const r = await anchor('rollers');
  const span = Math.min(size.height * 0.34, 260);
  const mid = Math.min(Math.max(r.y, span / 2 + 30), size.height - span / 2 - 30);
  await swipe({ x: r.x, y: mid - span / 2 }, { x: r.x, y: mid + span / 2 }, 8);
  const st = await state();
  if (k === 8) await shot('06_folding');
  if (st.phase !== 'bale') break;
}
await log('after feed');
await shot('07_netted');
await waitPhase('compare');
await page.waitForTimeout(2500);
await log('compare');
await shot('08_compare');
await waitPhase('release');
await log('hall');
await shot('09_hall');

// 5. pull the net down
for (let k = 0; k < 60; k++) {
  const t = await anchor('tail');
  const y0 = Math.min(size.height - 60, Math.max(80, t.y));
  await swipe({ x: size.width * 0.5, y: y0 }, { x: size.width * 0.5, y: size.height - 30 }, 10);
  const st = await state();
  if (k === 2) await shot('10_opening');
  if (st.phase !== 'release') break;
}
await log('released');
await shot('11_open');
await waitPhase('settle');
await page.waitForTimeout(4000);
await log('settled');
await shot('12_settle');
await browser.close();
