// Manual full-chain runner: drives every step and writes screenshots for
// eyeballing the build outside the assertion suite.
//   node tests/smoke.mjs            (portrait)
//   LANDSCAPE=1 node tests/smoke.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const OUT = process.env.SHOT_DIR ?? 'shots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const landscape = process.env.LANDSCAPE === '1';
const page = await browser.newPage({
  viewport: landscape ? { width: 892, height: 412 } : { width: 412, height: 892 },
  // Software rendering: keep the capture cheap so a frame is always ready.
  deviceScaleFactor: 1,
});
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

page.setDefaultTimeout(120000);
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__tree, null, { timeout: 30000 });

const st = () => page.evaluate(() => window.__tree.state());
const tick = (sec) => page.evaluate((v) => window.__tree.tick(v), sec);
const has = (id) => page.evaluate((i) => window.__tree.hasControl(i), id);
const drag = (id, a) => page.evaluate(([i, v]) => window.__tree.drag(i, v), [id, a]);
const hold = (id, on) => page.evaluate(([i, v]) => window.__tree.hold(i, v), [id, on]);
const pressBtn = (id) => page.evaluate((i) => window.__tree.press(i), id);
const shot = async (n) => {
  const s = await st();
  console.log('shot', n, s.phase, 'raise', s.raiseFraction.toFixed(2), 'canopy', s.canopyRadius.toFixed(2));
  // Let a real animation frame render the current state before capturing.
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${n}.png` });
};
const until = async (fn, simSeconds, onTick, slice = 0.2) => {
  let s = await st();
  for (let t = 0; t < simSeconds && !fn(s); t += slice) {
    if (onTick) await onTick(s);
    await tick(slice);
    s = await st();
  }
  return s;
};

await tick(4);
await shot('01-arrival');
await pressBtn('begin');
await until((s) => s.phase !== 'rigging', 40, () => drag('hook', 0.12));
await shot('02-rigging');

await hold('hoist', true);
await until((s) => s.raiseFraction > 0.35, 30);
await shot('03-raising');
await until((s) => s.raiseFraction > 0.75, 30);
await shot('04-raising-high');
await until((s) => s.phase === 'seating', 30);
await shot('05-upright');
await until((s) => s.phase === 'plumbing', 40);
await hold('hoist', false);
await shot('06-seated');

await until((s) => s.phase !== 'plumbing', 180, async (s) => {
  let k = 0;
  for (let i = 1; i < s.guyTensions.length; i++) if (s.guyTensions[i] < s.guyTensions[k]) k = i;
  await drag(`drum${k}`, -0.06);
});
await shot('07-plumb');

await until((s) => s.phase !== 'release', 60, () => drag('strap', 1.2));
await shot('08-released');

for (let i = 0; i < 40 && !(await has('reel')); i++) await page.waitForTimeout(200);
await until((s) => s.harnessPayOut >= 0.999, 40, () => drag('reel', 0.25));
await shot('09-harness-paid-out');
await hold('winch', true);
await until((s) => s.phase === 'star', 40);
await hold('winch', false);
await shot('10-harness-up');

await hold('hoist', true);
await until((s) => s.starProgress > 0.5, 40);
await shot('11-star-lift');
await until((s) => s.phase === 'test', 40);
await hold('hoist', false);
await shot('12-star-seated');

await pressBtn('test');
await until((s) => s.lighting === 'stalled', 20);
await shot('13-sector-fault');
await until((s) => s.lighting !== 'stalled', 20, () => drag('plug', 0.7));
await until((s) => s.phase === 'ceremony', 30);
await until(() => false, 5, undefined, 0.5);
await shot('14-ceremony');
await pressBtn('enable');
await tick(0.4);
await shot('15-ramp');
await until((s) => s.phase === 'finale', 10, undefined, 0.1);
await tick(1.5);
await shot('16-lit');
console.log('final', JSON.stringify(await st()).slice(0, 400));
console.log('errors', errors);
await browser.close();
