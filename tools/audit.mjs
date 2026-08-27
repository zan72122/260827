// Secondary audit: free-play mode, new-house regeneration, hint visuals,
// and rotation persistence (soot trail / stocking / progress must survive).
//   node tools/audit.mjs [--device=ipad-p] [--out=DIR]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
    const [k, v] = a.slice(2).split('=');
    return [k, v ?? true];
  })
);
const DEVICES = {
  'iphone-p': { width: 390, height: 844 },
  'iphone-l': { width: 844, height: 390 },
  'ipad-p': { width: 820, height: 1180 },
  'ipad-l': { width: 1180, height: 820 }
};
const dev = DEVICES[args.device ?? 'ipad-p'];
const outDir = args.out ?? `shots/audit-${args.device ?? 'ipad-p'}`;
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist']
});
const page = await browser.newPage({
  viewport: { width: dev.width, height: dev.height },
  deviceScaleFactor: 1, hasTouch: true, isMobile: true
});
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto('http://127.0.0.1:5173/?debug=1', { waitUntil: 'load' });

let n = 0;
const shot = async (name) => {
  n++;
  const f = path.join(outDir, `${String(n).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: f });
  console.log('shot', f);
};
const phase = () => page.evaluate(() => window.__santaGame?.phase);
const waitPhase = async (arr, timeout = 40000) => {
  await page.waitForFunction(
    (a) => a.includes(window.__santaGame?.phase), arr, { timeout }
  );
  console.log('phase →', await phase());
};
const swipe = async (x0, y0, x1, y1, ms, steps = 20) => {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps);
    await page.waitForTimeout(ms / steps);
  }
  await page.mouse.up();
};
const W = dev.width, H = dev.height, CX = W / 2;

try {
  await page.waitForFunction(() => !!window.__santaGame, { timeout: 15000 });
  await waitPhase(['peek']);
  await page.waitForTimeout(800);
  await shot('peek');

  // ---- hint visuals: force the idle timer ----
  await page.evaluate(() => { window.__santaGame.idleT = 999; });
  await page.waitForTimeout(2500);
  await shot('peek-hint-motes');

  // ---- descend partway, then ROTATE the viewport mid-flue ----
  await swipe(CX, H * 0.3, CX, H * 0.8, 600);
  await swipe(CX, H * 0.3, CX, H * 0.8, 500);
  await waitPhase(['descend'], 20000);
  await swipe(CX, H * 0.3, CX, H * 0.65, 700);
  await page.waitForTimeout(400);
  const before = await page.evaluate(() => ({
    phase: window.__santaGame.phase,
    p: window.__santaGame.p
  }));
  await shot('descend-before-rotate');
  await page.setViewportSize({ width: dev.height, height: dev.width });
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => ({
    phase: window.__santaGame.phase,
    p: window.__santaGame.p
  }));
  await shot('descend-after-rotate');
  console.log('rotation persistence:', JSON.stringify(before), '→', JSON.stringify(after),
    Math.abs(before.p - after.p) < 0.02 && before.phase === after.phase ? 'OK' : 'MISMATCH');
  await page.setViewportSize({ width: dev.width, height: dev.height });
  await page.waitForTimeout(600);

  // ---- finish the loop quickly ----
  for (let i = 0; i < 12; i++) {
    await swipe(CX, H * 0.25, CX, H * 0.85, 200);
    if ((await phase()) !== 'descend') break;
  }
  await waitPhase(['gifts'], 90000);
  await page.waitForTimeout(500);
  for (let i = 0; i < 3; i++) {
    const p = await page.evaluate((idx) => window.__screenOf('gift', idx), i);
    if (p) {
      await page.mouse.move(p.x, p.y);
      await page.mouse.down(); await page.waitForTimeout(60); await page.mouse.up();
    }
    await page.waitForTimeout(1400);
  }
  await shot('stocking-filled');
  await waitPhase(['nose'], 90000);
  await page.waitForTimeout(600);
  const np = await page.evaluate(() => window.__screenOf('nose', 0));
  await page.mouse.move(np.x, np.y);
  await page.mouse.down(); await page.waitForTimeout(60); await page.mouse.up();
  await waitPhase(['awaitUp'], 30000);
  await page.waitForTimeout(2500);
  await swipe(CX, H * 0.75, CX, H * 0.2, 250);
  await waitPhase(['menu'], 120000);
  await page.waitForTimeout(800);
  await shot('menu');

  // ---- free play mode ----
  await page.click('#btn-free');
  await waitPhase(['free'], 60000);
  await page.waitForTimeout(400);
  await shot('free-top');
  await swipe(CX, H * 0.25, CX, H * 0.85, 300);
  await swipe(CX, H * 0.25, CX, H * 0.85, 300);
  await page.waitForTimeout(300);
  await shot('free-bottom');
  // scrub back UP — the reverse move must work
  await swipe(CX, H * 0.75, CX, H * 0.2, 300);
  await swipe(CX, H * 0.75, CX, H * 0.2, 300);
  await page.waitForTimeout(300);
  await shot('free-up-again');
  const freeP = await page.evaluate(() => window.__santaGame.p);
  console.log('free scrub-up p =', freeP.toFixed(2), freeP < 0.7 ? 'OK' : 'SUSPECT');
  await page.click('#exit-free');
  await waitPhase(['menu'], 90000);
  await shot('back-to-menu');

  // ---- new house regeneration ----
  await page.click('#btn-newhouse');
  await waitPhase(['intro', 'walk'], 20000);
  await page.waitForTimeout(2500);
  await shot('newhouse-intro');
  await waitPhase(['peek'], 90000);
  await page.waitForTimeout(1000);
  await shot('newhouse-peek');

  console.log('metrics:', await page.evaluate(() => window.__santaMetrics()));
  console.log('AUDIT DONE');
} catch (e) {
  console.error('AUDIT FAILED at', await phase().catch(() => '?'), e.message);
  await shot('FAIL');
  process.exitCode = 1;
} finally {
  await browser.close();
}
