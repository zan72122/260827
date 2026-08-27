/**
 * qa.mjs — exercises the real gesture path rather than the debug API.
 *
 * Everything else in the harness sets journeyProgress directly. This drives an
 * actual one-finger drag, because the promise the game makes is about a finger.
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:5173/';
const results = [];
const ok = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));

await page.goto(`${BASE}?quality=medium`, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => !!window.__zoom, null, { timeout: 60000 });
await page.waitForTimeout(1500);

const progress = () => page.evaluate(() => window.__zoom.getProgress());
const state = () => page.evaluate(() => window.__zoom.getState());

/** One continuous stroke: press, many small moves, release. */
async function stroke(fromX, fromY, toX, toY, steps = 60, release = true) {
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(fromX + (toX - fromX) * t, fromY + (toY - fromY) * t);
  }
  if (release) await page.mouse.up();
}

// --- 1. a single continuous upward swipe must reach the cellular level ---
await page.evaluate(() => window.__zoom.setProgress(0, true));
await page.waitForTimeout(150);
await stroke(195, 800, 195, 20, 80);
await page.waitForTimeout(400);
let p = await progress();
ok('one continuous upward swipe reaches the cellular level', p > 0.985, `progress=${p.toFixed(4)}`);
const end = await state();
ok('ends at the 40x objective', end.objective === '40x', `objective=${end.objective}, field=${end.fieldMM.toFixed(3)}mm`);

// --- 2. dragging back down returns all the way ---
await stroke(195, 20, 195, 800, 80);
await page.waitForTimeout(400);
p = await progress();
ok('dragging back down returns to the slide', p < 0.02, `progress=${p.toFixed(4)}`);

// --- 3. lifting the finger keeps the ground already covered ---
await page.evaluate(() => window.__zoom.setProgress(0, true));
await stroke(195, 800, 195, 430, 40);
await page.waitForTimeout(120);
const half = await progress();
await page.waitForTimeout(600);
const stillHalf = await progress();
ok('progress persists after the finger lifts', Math.abs(half - stillHalf) < 0.005, `${half.toFixed(4)} -> ${stillHalf.toFixed(4)}`);
await stroke(195, 800, 195, 430, 40);
await page.waitForTimeout(200);
const twoStrokes = await progress();
ok('a second stroke continues rather than restarting', twoStrokes > half * 1.7, `${half.toFixed(4)} -> ${twoStrokes.toFixed(4)}`);

// --- 4. a diagonal stroke covers nearly the same ground as a vertical one ---
await page.evaluate(() => window.__zoom.setProgress(0, true));
await page.waitForTimeout(120);
await stroke(120, 780, 300, 380, 60);
await page.waitForTimeout(250);
const diagonal = await progress();
await page.evaluate(() => window.__zoom.setProgress(0, true));
await page.waitForTimeout(120);
await stroke(195, 780, 195, 380, 60);
await page.waitForTimeout(250);
const vertical = await progress();
const ratio = diagonal / Math.max(vertical, 1e-6);
ok('a 24-degree diagonal stroke is corrected onto the main axis', ratio > 0.92 && ratio < 1.12, `diagonal/vertical=${ratio.toFixed(3)}`);

// --- 5. a nearly horizontal wipe must not drive the dive ---
await page.evaluate(() => window.__zoom.setProgress(0.5, true));
await page.waitForTimeout(120);
await stroke(40, 500, 350, 470, 40);
await page.waitForTimeout(250);
const wipe = await progress();
ok('a near-horizontal wipe barely moves the dive', Math.abs(wipe - 0.5) < 0.06, `progress=${wipe.toFixed(4)}`);

// --- 6. a cancelled gesture must not wedge the controller ---
await page.evaluate(() => window.__zoom.setProgress(0.4, true));
await stroke(195, 600, 195, 400, 20, false);
await page.evaluate(() => {
  const el = document.getElementById('gesture-layer');
  el.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }));
});
await page.mouse.up().catch(() => {});
await page.waitForTimeout(200);
const beforeCancelRecovery = await progress();
await stroke(195, 700, 195, 500, 30);
await page.waitForTimeout(250);
const afterCancel = await progress();
ok('input still works after pointercancel', afterCancel > beforeCancelRecovery + 0.1, `${beforeCancelRecovery.toFixed(3)} -> ${afterCancel.toFixed(3)}`);

// --- 7. the idle hint fires without any arrow or text appearing ---
await page.evaluate(() => window.__zoom.setProgress(0.05, true));
await page.waitForTimeout(4200);
const textOnScreen = await page.evaluate(() => {
  const app = document.getElementById('app');
  return (app?.innerText ?? '').replace(/\s+/g, '');
});
ok('no instructional text or arrows on screen', textOnScreen.length === 0, `visible text length=${textOnScreen.length}`);

// --- 8. frame pacing ---
// Two separate numbers, because they have different causes. Steady state is the
// compositing cost with no pyramid level being built; the dive figure includes level
// generation. NOTE: this harness runs on SwiftShader, a CPU rasteriser. A heavy
// fragment shader is precisely what that is worst at, so treat these as a regression
// tripwire, not as a prediction of frame times on a phone GPU.
async function measureFrames(label, action, want = 40, timeoutMs = 30000) {
  await page.evaluate(() => {
    window.__frames = [];
    window.__watch = true;
    let last = performance.now();
    const tick = (t) => {
      window.__frames.push(t - last);
      last = t;
      if (window.__watch) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await action();
  // Wait for a real sample rather than a fixed wall-clock window: at a few frames per
  // second a fixed wait collects almost nothing and the measurement silently passes.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const n = await page.evaluate(() => window.__frames.length);
    if (n >= want + 5) break;
    await page.waitForTimeout(250);
  }
  const frames = await page.evaluate(() => {
    window.__watch = false;
    return window.__frames.slice(5);
  });
  const sorted = [...frames].sort((a, b) => a - b);
  if (sorted.length < 10) return { label, n: sorted.length, p50: NaN, p95: NaN };
  return {
    label,
    n: sorted.length,
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
  };
}

await page.evaluate(() => window.__zoom.setProgress(0.86, true));
await page.evaluate(() => window.__zoom.waitReady(8));
// Wait out the pyramid's pre-building of the next level, so "steady" really is the
// compositing cost and nothing else.
const quietBy = Date.now() + 40000;
while (Date.now() < quietBy) {
  if (!(await page.evaluate(() => window.__zoom.getState().building))) break;
  await page.waitForTimeout(300);
}
await page.waitForTimeout(400);
const steady = await measureFrames('steady', async () => {});
ok(
  'steady-state compositing keeps up (software renderer)',
  Number.isFinite(steady.p95) && steady.p95 < 350,
  `n=${steady.n} median=${steady.p50.toFixed(1)}ms p95=${steady.p95.toFixed(1)}ms`,
);

await page.evaluate(() => window.__zoom.setProgress(0, true));
await page.waitForTimeout(300);
const dive = await measureFrames('dive', async () => {
  await stroke(195, 800, 195, 20, 25);
}, 60);
console.log(
  `INFO  fast dive including level generation: n=${dive.n} median=${dive.p50.toFixed(1)}ms ` +
    `p95=${dive.p95.toFixed(1)}ms (CPU rasteriser; not representative of a phone GPU)`,
);

// --- 9. orientation change mid-dive ---
await page.evaluate(() => window.__zoom.setProgress(0.7, true));
await page.setViewportSize({ width: 844, height: 390 });
await page.waitForTimeout(700);
const land = await state();
const landMark = await page.evaluate(() => ({ m: window.__zoom.landmarkScreen(), a: window.__zoom.anchor() }));
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(700);
const back = await state();
ok(
  'rotating mid-dive keeps progress, field and the landmark',
  Math.abs(land.progress - 0.7) < 1e-6 &&
    Math.abs(land.fieldMM - back.fieldMM) < 1e-6 &&
    Math.abs(landMark.m.x - landMark.a.x) < 1e-4 &&
    Math.abs(landMark.m.y - landMark.a.y) < 1e-4,
  `field ${land.fieldMM.toFixed(4)} both ways, landmark delta (${(landMark.m.x - landMark.a.x).toFixed(5)}, ${(landMark.m.y - landMark.a.y).toFixed(5)})`,
);

ok('no console errors during the whole session', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
