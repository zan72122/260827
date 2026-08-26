/**
 * Automated verification: builds are served via `vite preview`, then a real
 * Chromium drives the game — one continuous pointer swipe, checkpoint
 * screenshots on iPhone/iPad portrait+landscape, reverse scrub, rotation,
 * 10 replays, memory growth and console error checks.
 *
 * Usage: node scripts/verify.mjs [--quick] [--shots-only]
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const QUICK = process.argv.includes('--quick');
const OUT = 'verify';
const PORT = 4173;

const CHECKPOINTS = [
  ['01-checkin', 0.02],
  ['02-before-curtain', 0.13],
  ['03-curtain-mid', 0.16],
  ['04-underground', 0.3],
  ['05-screening', 0.47],
  ['06-sorter', 0.607],
  ['07-exit-door', 0.79],
  ['08-aircraft-belly', 0.9],
  ['09-cargo-hold', 0.997],
];

const DEVICES = QUICK
  ? [['iphone-landscape', 844, 390, 2]]
  : [
      ['iphone-portrait', 390, 844, 2],
      ['iphone-landscape', 844, 390, 2],
      ['ipad-portrait', 820, 1180, 2],
      ['ipad-landscape', 1180, 820, 2],
    ];

async function portInUse() {
  try {
    const r = await fetch('http://localhost:' + PORT + '/', { method: 'HEAD' });
    return r.ok;
  } catch {
    return false;
  }
}

async function startServer() {
  if (await portInUse()) return { kill() {} }; // reuse a running preview

  const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: 'pipe',
  });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('preview server timeout')), 15000);
    proc.stdout.on('data', (d) => {
      if (String(d).includes('http')) {
        clearTimeout(t);
        resolve(proc);
      }
    });
    proc.stderr.on('data', (d) => process.stderr.write(d));
  });
}

async function launchBrowser() {
  const exe = '/opt/pw-browsers/chromium';
  if (existsSync(exe)) return chromium.launch({ executablePath: exe });
  return chromium.launch();
}

async function openGame(browser, w, h, dpr, errors) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: dpr,
    hasTouch: true,
    isMobile: true,
  });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[console] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__BAGGAGE_GAME__?.ready === true, { timeout: 15000 });
  await page.waitForTimeout(600); // let the first frames settle
  return { ctx, page };
}

async function setP(page, v) {
  await page.evaluate((x) => window.__BAGGAGE_GAME__.setProgress(x), v);
  await page.waitForTimeout(280); // camera snap + a few frames
}

/** One continuous pointer swipe; samples progress along the way. */
async function swipe(page, w, h, portrait, reverse = false) {
  const samples = [];
  const steps = 60;
  const x0 = portrait ? w * 0.5 : w * 0.08;
  const y0 = portrait ? h * 0.92 : h * 0.55;
  const x1 = portrait ? w * 0.56 : w * 0.95;
  const y1 = portrait ? h * 0.06 : h * 0.48;
  const [ax, ay, bx, by] = reverse ? [x1, y1, x0, y0] : [x0, y0, x1, y1];
  await page.mouse.move(ax, ay);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(ax + (bx - ax) * t, ay + (by - ay) * t, { steps: 1 });
    await page.waitForTimeout(30);
    samples.push(await page.evaluate(() => window.__BAGGAGE_GAME__.getProgress()));
  }
  await page.mouse.up();
  await page.waitForTimeout(700);
  samples.push(await page.evaluate(() => window.__BAGGAGE_GAME__.getProgress()));
  return samples;
}

const server = await startServer();
const browser = await launchBrowser();
const failures = [];
const report = [];

try {
  // ---------- screenshots on every device ----------
  for (const [name, w, h, dpr] of DEVICES) {
    const errors = [];
    const { ctx, page } = await openGame(browser, w, h, dpr, errors);
    const dir = join(OUT, name);
    mkdirSync(dir, { recursive: true });
    for (const [cp, p] of CHECKPOINTS) {
      await setP(page, p);
      await page.screenshot({ path: join(dir, `${cp}.png`) });
      const bagPos = await page.evaluate(() => window.__BAGGAGE_GAME__.bagScreenPosition());
      if (p < 0.995 && (bagPos.x < -50 || bagPos.x > w + 50 || bagPos.y < -50 || bagPos.y > h + 50)) {
        failures.push(`${name}/${cp}: bag off screen (${bagPos.x.toFixed(0)},${bagPos.y.toFixed(0)})`);
      }
    }
    if (errors.length) failures.push(`${name}: ${errors.length} console errors: ${errors[0]}`);
    report.push(`${name}: ${CHECKPOINTS.length} checkpoints captured`);
    await ctx.close();
  }

  if (!QUICK && !process.argv.includes('--shots-only')) {
    // ---------- interaction: one continuous swipe end-to-end (portrait) ----------
    {
      const errors = [];
      const { ctx, page } = await openGame(browser, 390, 844, 2, errors);
      const samples = await swipe(page, 390, 844, true);
      const final = samples[samples.length - 1];
      const monotonicViolations = samples.filter((v, i) => i > 0 && v < samples[i - 1] - 1e-4).length;
      report.push(
        `portrait swipe: final=${final.toFixed(3)} samples=${samples.length} nonMonotonic=${monotonicViolations}`,
      );
      if (final < 0.97) failures.push(`portrait single swipe only reached ${final.toFixed(3)}`);
      if (monotonicViolations > 2) failures.push(`portrait swipe regressed ${monotonicViolations} times`);
      // continuity: no jumps > 0.08 between 30ms samples
      const maxJump = Math.max(...samples.slice(1).map((v, i) => Math.abs(v - samples[i])));
      report.push(`portrait swipe maxJump=${maxJump.toFixed(3)}`);
      if (maxJump > 0.09) failures.push(`portrait swipe jump ${maxJump.toFixed(3)} (should be continuous)`);
      // reverse scrub back to near zero
      const back = await swipe(page, 390, 844, true, true);
      const backFinal = back[back.length - 1];
      report.push(`portrait reverse: final=${backFinal.toFixed(3)}`);
      if (backFinal > 0.05) failures.push(`reverse swipe stuck at ${backFinal.toFixed(3)}`);
      if (errors.length) failures.push(`portrait swipe console errors: ${errors[0]}`);
      await ctx.close();
    }
    // ---------- landscape swipe ----------
    {
      const errors = [];
      const { ctx, page } = await openGame(browser, 844, 390, 2, errors);
      const samples = await swipe(page, 844, 390, false);
      const final = samples[samples.length - 1];
      report.push(`landscape swipe: final=${final.toFixed(3)}`);
      if (final < 0.97) failures.push(`landscape single swipe only reached ${final.toFixed(3)}`);
      if (errors.length) failures.push(`landscape swipe console errors: ${errors[0]}`);
      await ctx.close();
    }
    // ---------- rotation mid-journey ----------
    {
      const errors = [];
      const { ctx, page } = await openGame(browser, 390, 844, 2, errors);
      await setP(page, 0.45);
      await page.setViewportSize({ width: 844, height: 390 });
      await page.waitForTimeout(500);
      const p = await page.evaluate(() => window.__BAGGAGE_GAME__.getProgress());
      const bagPos = await page.evaluate(() => window.__BAGGAGE_GAME__.bagScreenPosition());
      report.push(`rotation: progress kept=${p.toFixed(3)} bag=(${bagPos.x.toFixed(0)},${bagPos.y.toFixed(0)})`);
      if (Math.abs(p - 0.45) > 0.01) failures.push(`rotation lost progress: ${p}`);
      if (bagPos.x < 0 || bagPos.x > 844 || bagPos.y < 0 || bagPos.y > 390)
        failures.push('rotation: bag off screen after rotate');
      if (errors.length) failures.push(`rotation console errors: ${errors[0]}`);
      await ctx.close();
    }
    // ---------- 10 replays + memory growth ----------
    {
      const errors = [];
      const { ctx, page } = await openGame(browser, 844, 390, 2, errors);
      const heap = async () =>
        page.evaluate(() => (performance).memory?.usedJSHeapSize ?? 0);
      await swipe(page, 844, 390, false); // warm up
      const h0 = await heap();
      for (let i = 0; i < 10; i++) {
        await setP(page, 0);
        await swipe(page, 844, 390, false);
      }
      const h1 = await heap();
      const growthMB = (h1 - h0) / 1048576;
      report.push(`10 replays: heap ${(h0 / 1048576).toFixed(1)}MB → ${(h1 / 1048576).toFixed(1)}MB (Δ${growthMB.toFixed(1)}MB)`);
      if (growthMB > 25) failures.push(`memory grew ${growthMB.toFixed(1)}MB over 10 replays`);
      const info = await page.evaluate(() => window.__BAGGAGE_GAME__.rendererInfo());
      report.push(`renderer: ${info.calls} calls, ${info.triangles} tris, ${info.geometries} geoms, ${info.textures} textures`);
      if (errors.length) failures.push(`replay console errors: ${errors[0]}`);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  server.kill();
}

console.log('\n===== REPORT =====');
for (const r of report) console.log('  ' + r);
if (failures.length) {
  console.log('\n===== FAILURES =====');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('\nAll checks passed.');
