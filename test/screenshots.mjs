// Real playthrough driver: launches the production build, plays the game with
// synthetic pointer input through the same event path as a finger, verifies
// geometry/diagnostics for the required trajectory matrix, and saves staged
// screenshots at iPhone/iPad viewport sizes.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUT = resolve(ROOT, 'shots');
const PORT = 4611;
const BASE = `http://localhost:${PORT}/?seed=7`;

mkdirSync(OUT, { recursive: true });

function startServer() {
  const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT, stdio: 'ignore'
  });
  return proc;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function waitPhase(page, phase, timeout = 30000) {
  await page.waitForFunction((p) => window.__gc && window.__gc.phase === p, phase, { timeout });
}

// Plan a stroke in sheet coordinates. kind: 'portrait' near->far, 'landscape' left->right.
function planStroke({ hw, hh }, { orient, bulge = 0, slant = 0, wave = 0, span = 1, startInset = 0 }) {
  const pts = [];
  const N = 26;
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    if (orient === 'portrait') {
      const y0 = hh * 0.985 - startInset, y1 = -hh * 0.985 + (1 - span) * 2 * hh;
      const y = y0 + (y1 - y0) * s;
      let x = slant * hw * (s - 0.5) * 2 * 0.5;
      x += bulge * hw * Math.sin(Math.PI * s);
      x += wave * hw * Math.sin(Math.PI * 2 * 0.75 * s);
      pts.push({ x, y });
    } else {
      const x0 = -hw * 0.985 + startInset, x1 = hw * 0.985 - (1 - span) * 2 * hw;
      const x = x0 + (x1 - x0) * s;
      let y = slant * hh * (s - 0.5) * 2 * 0.5;
      y += bulge * hh * Math.sin(Math.PI * s);
      y += wave * hh * Math.sin(Math.PI * 2 * 0.75 * s);
      pts.push({ x, y });
    }
  }
  return pts;
}

async function performStroke(page, pts, { moveDelay = 14, midShot = null } = {}) {
  const offset = await page.evaluate(() => window.__gc.fingerOffsetPx());
  const screenPts = [];
  for (const p of pts) {
    const sp = await page.evaluate(([x, y]) => window.__gc.sheetToScreen(x, y), [p.x, p.y]);
    screenPts.push({ x: sp.x, y: sp.y + offset });
  }
  await page.mouse.move(screenPts[0].x, screenPts[0].y);
  await page.mouse.down();
  await sleep(40);
  for (let i = 1; i < screenPts.length; i++) {
    await page.mouse.move(screenPts[i].x, screenPts[i].y);
    await sleep(moveDelay);
    if (midShot && i === Math.floor(screenPts.length / 2)) await midShot();
  }
  await sleep(40);
  await page.mouse.up();
}

async function pressPliers(page) {
  await waitPhase(page, 'press');
  await sleep(350);
  // in the press phase any touch applies the pliers pressure: tap mid-screen
  const vp = page.viewportSize();
  await page.mouse.move(vp.width / 2, vp.height / 2);
  await page.mouse.down();
  await sleep(60);
  await page.mouse.up();
}

async function playRound(page, strokeOpts, shots = {}) {
  await page.evaluate(() => window.__gc.setTimeScale(2.5));
  await waitPhase(page, 'ready');
  // wait for the scoring camera framing to settle before planning the stroke
  await page.waitForFunction(() => window.__gc.game.director.t >= 1, null, { timeout: 10000 });
  await sleep(250);
  if (shots.before) await shots.before();
  const rect = await page.evaluate(() => window.__gc.sheetRect());
  const pts = planStroke(rect, strokeOpts);
  await performStroke(page, pts, { midShot: shots.mid, moveDelay: strokeOpts.moveDelay ?? 14 });
  // generous timeouts: the CI GPU is a software rasterizer running at a few
  // FPS; on-device this all happens in a couple of seconds
  await waitPhase(page, 'press', 90000);
  if (shots.scored) await shots.scored();
  await page.evaluate(() => window.__gc.setTimeScale(1));
  await pressPliers(page);
  await waitPhase(page, 'crack', 30000);
  if (shots.crack) {
    // capture mid-run: crack front near the middle of the score
    await page.waitForFunction(
      () => window.__gc.game.crackLen > 0.3 * window.__gc.game.ribbon.totalLen,
      null, { timeout: 60000 }
    );
    await shots.crack();
  }
  await waitPhase(page, 'separate', 90000);
  await page.waitForFunction(() => window.__gc.game.phaseT > 0.75, null, { timeout: 60000 });
  if (shots.separate) await shots.separate();
  await page.evaluate(() => window.__gc.setTimeScale(2.5));
  await waitPhase(page, 'lift', 60000);
  await waitPhase(page, 'choice', 90000);
  await sleep(300);
  if (shots.light) await shots.light();
  return page.evaluate(() => window.__gc.diagnostics());
}

async function run() {
  const only = process.argv[2] || 'all'; // all | cases | matrix | cleanup
  const server = startServer();
  await sleep(1500);
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });

  const results = { cases: {}, matrix: {}, cleanup: null };

  // ---- functional trajectory matrix -------------------------------------
  const cases = [
    ['straight-vertical', { w: 390, h: 844 }, { orient: 'portrait', bulge: 0 }],
    ['bulge-right', { w: 390, h: 844 }, { orient: 'portrait', bulge: 0.42 }],
    ['bulge-left', { w: 390, h: 844 }, { orient: 'portrait', bulge: -0.42 }],
    ['diagonal', { w: 390, h: 844 }, { orient: 'portrait', slant: 0.9 }],
    ['gentle-wave', { w: 844, h: 390 }, { orient: 'landscape', wave: 0.35 }],
    ['short-fast', { w: 390, h: 844 }, { orient: 'portrait', bulge: 0.2, span: 0.45, startInset: 0.1, moveDelay: 4 }],
    ['long-slow', { w: 844, h: 390 }, { orient: 'landscape', bulge: 0.25, moveDelay: 40 }],
    ['inset-start', { w: 390, h: 844 }, { orient: 'portrait', bulge: 0.3, startInset: 0.07, span: 0.8 }]
  ];

  mkdirSync(resolve(OUT, 'judge'), { recursive: true });
  mkdirSync(resolve(OUT, 'cases'), { recursive: true });

  for (const [name, vp, opts] of (only === 'all' || only === 'cases' ? cases : [])) {
    const ctx = await browser.newContext({
      viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1, hasTouch: true
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(BASE);
    try {
      const diag = await playRound(page, opts, {
        separate: async () => {
          await page.screenshot({ path: resolve(OUT, 'judge', `${name}.png`), timeout: 60000 });
        }
      });
      diag.pageErrors = errors;
      results.cases[name] = diag;
      writeFileSync(resolve(OUT, 'cases', `${name}.json`), JSON.stringify(diag, null, 2));
      console.log(`case ${name}: phase=${diag.phase} areaErr=${diag.validation?.areaError} ` +
        `open=${diag.validation?.reports.map(r => r.openEdges).join('/')} errors=${errors.length}`);
    } catch (e) {
      const diag = await page.evaluate(() => window.__gc?.diagnostics()).catch(() => null);
      console.log(`case ${name}: FAILED ${e.message.split('\n')[0]} phase=${diag?.phase}`);
      results.cases[name] = { error: String(e), pageErrors: errors, diag };
      await page.screenshot({ path: resolve(OUT, 'cases', `${name}-fail.png`) }).catch(() => {});
    }
    await ctx.close();
  }

  // ---- staged screenshots at the four required viewports ------------------
  const viewports = [
    ['iphone-portrait', 390, 844, 2],
    ['iphone-landscape', 844, 390, 2],
    ['ipad-portrait', 820, 1180, 1],
    ['ipad-landscape', 1180, 820, 1]
  ];
  for (const [name, w, h, dsf] of (only === 'all' || only === 'matrix' ? viewports : [])) {
    const dir = resolve(OUT, name);
    mkdirSync(dir, { recursive: true });
    const ctx = await browser.newContext({
      viewport: { width: w, height: h }, deviceScaleFactor: dsf, hasTouch: true
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(BASE);
    const orient = w < h ? 'portrait' : 'landscape';
    try {
      const shot = (file) => () =>
        page.screenshot({ path: resolve(dir, file), timeout: 60000 });
      const diag = await playRound(page, { orient, bulge: 0.35 }, {
        before: shot('1-before.png'),
        mid: shot('2-scoring.png'),
        crack: shot('3-crack.png'),
        separate: shot('4-separated.png'),
        light: shot('5-light.png')
      });
      diag.pageErrors = errors;
      results.matrix[name] = diag;
      console.log(`viewport ${name}: ok (errors=${errors.length})`);
    } catch (e) {
      const diag = await page.evaluate(() => window.__gc?.diagnostics()).catch(() => null);
      console.log(`viewport ${name}: FAILED ${e.message.split('\n')[0]} phase=${diag?.phase}`);
      results.matrix[name] = { error: String(e), pageErrors: errors, diag };
      await page.screenshot({ path: resolve(dir, 'fail.png') }).catch(() => {});
    }
    await ctx.close();
  }

  // ---- replay resource cleanup: 3 rounds in one page ----------------------
  if (only === 'all' || only === 'cleanup') {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true
    });
    const page = await ctx.newPage();
    await page.goto(BASE);
    const mem = [];
    for (let r = 0; r < 3; r++) {
      await playRound(page, { orient: 'portrait', bulge: r === 1 ? -0.3 : 0.3 });
      mem.push(await page.evaluate(() => window.__gc.diagnostics().memory));
      if (r < 2) {
        await page.evaluate((idx) => window.__gc.newRound(idx), (r + 2) % 5);
      }
    }
    results.cleanup = mem;
    console.log('cleanup memory per round:', JSON.stringify(mem));
    await ctx.close();
  }

  // ---- quick pose check: portrait mid-scoring only ------------------------
  if (only === 'pose') {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true
    });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.evaluate(() => window.__gc.setTimeScale(2.5));
    await waitPhase(page, 'ready');
    await page.waitForFunction(() => window.__gc.game.director.t >= 1, null, { timeout: 10000 });
    const rect = await page.evaluate(() => window.__gc.sheetRect());
    await performStroke(page, planStroke(rect, { orient: 'portrait', bulge: 0.35 }), {
      midShot: () => page.screenshot({ path: resolve(OUT, 'pose-mid.png'), timeout: 60000 })
    });
    await waitPhase(page, 'press', 90000);
    await page.screenshot({ path: resolve(OUT, 'pose-press.png'), timeout: 60000 });
    await ctx.close();
  }

  // ---- orientation change mid-flow: score + split state must survive ------
  if (only === 'all' || only === 'rotate') {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true
    });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.evaluate(() => window.__gc.setTimeScale(2.5));
    await waitPhase(page, 'ready');
    await page.waitForFunction(() => window.__gc.game.director.t >= 1, null, { timeout: 10000 });
    const rect = await page.evaluate(() => window.__gc.sheetRect());
    await performStroke(page, planStroke(rect, { orient: 'portrait', bulge: 0.35 }));
    await waitPhase(page, 'press', 90000);
    const before = await page.evaluate(() => window.__gc.diagnostics());
    // rotate to landscape mid-flow
    await page.setViewportSize({ width: 844, height: 390 });
    await sleep(1200);
    const afterRot = await page.evaluate(() => window.__gc.diagnostics());
    await page.screenshot({ path: resolve(OUT, 'rotate-press-landscape.png'), timeout: 60000 });
    await pressPliers(page);
    await waitPhase(page, 'separate', 90000);
    await page.waitForFunction(() => window.__gc.game.phaseT > 0.75, null, { timeout: 60000 });
    // rotate back to portrait after separation
    await page.setViewportSize({ width: 390, height: 844 });
    await sleep(1200);
    await page.screenshot({ path: resolve(OUT, 'rotate-separated-portrait.png'), timeout: 60000 });
    const after = await page.evaluate(() => window.__gc.diagnostics());
    results.rotate = { before, afterRot, after };
    console.log(`rotate: scoreLen ${before.curveLen.toFixed(3)} -> ${afterRot.curveLen.toFixed(3)}, ` +
      `phase ${before.phase} -> ${afterRot.phase} -> ${after.phase}, areaErr=${after.validation?.areaError}`);
    await ctx.close();
  }

  writeFileSync(resolve(OUT, 'results.json'), JSON.stringify(results, null, 2));
  await browser.close();
  server.kill();
  console.log('done');
}

run().catch((e) => { console.error(e); process.exit(1); });
