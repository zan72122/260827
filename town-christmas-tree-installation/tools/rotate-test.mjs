/**
 * Verifies that rotating the device mid-installation preserves the whole
 * process state (stage, hoist, rigging, wires, lights) and that the controls
 * stay inside the visible area.
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const ctx = await browser.newContext({
  viewport: { width: 393, height: 852 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:4173/?auto=1&turbo=6&seed=777', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.stage() !== 'boot', null, { timeout: 60000 });
await page.waitForSelector('#boot.hidden');

const snapshot = async () => page.evaluate(() => window.__game.state());

const checkControls = async (label) => {
  const bad = await page.evaluate(() => {
    const out = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    for (const el of document.querySelectorAll('#hud .control-layer > *, #hud .toggles, #hud .steps')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) {
        out.push({ cls: el.className, r: [r.left | 0, r.top | 0, r.right | 0, r.bottom | 0], vw, vh });
      }
    }
    return out;
  });
  if (bad.length) console.log('OFF-SCREEN CONTROLS', label, JSON.stringify(bad));
  else console.log('controls fit', label);
};

const waitStage = async (name, timeout = 300000) => {
  await page.waitForFunction((n) => window.__game.stage() === n, name, { timeout, polling: 500 });
};

await waitStage('lift');
await page.waitForTimeout(6000);
const before = await snapshot();
await checkControls('portrait/lift');
await page.setViewportSize({ width: 852, height: 393 });
await page.waitForTimeout(1500);
const after = await snapshot();
await checkControls('landscape/lift');
console.log('before', JSON.stringify(before));
console.log('after ', JSON.stringify(after));
const kept =
  before.stage === after.stage &&
  Math.abs(before.theta - after.theta) < 0.12 &&
  before.slings === after.slings &&
  before.outriggers === after.outriggers;
console.log(kept ? 'STATE PRESERVED across rotation' : 'STATE LOST across rotation');

await waitStage('wrap');
await page.waitForTimeout(4000);
const w1 = await snapshot();
await checkControls('landscape/wrap');
await page.setViewportSize({ width: 393, height: 852 });
await page.waitForTimeout(1500);
const w2 = await snapshot();
await checkControls('portrait/wrap');
console.log('wrap before', JSON.stringify(w1));
console.log('wrap after ', JSON.stringify(w2));
console.log(
  Math.abs(w1.wrap - w2.wrap) < 0.08 && w1.guys === w2.guys && Math.abs(w1.treeY - w2.treeY) < 0.05
    ? 'LIGHT/WIRE STATE PRESERVED across rotation'
    : 'LIGHT/WIRE STATE LOST',
);

await waitStage('finale');
await page.waitForTimeout(3000);
await checkControls('portrait/finale');
console.log('errors', errors.slice(0, 5));
await browser.close();
