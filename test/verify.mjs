// 実働検証: production build を Chromium(モバイルビューポート) で一周プレイ。
//  1. デバイス×縦横 4構成で、入力中/第一層/積層中/完成 のスクリーンショット
//  2. 検証契約の6形状を高速再生し、完成俯瞰(compare)を保存
//  3. 各段階の内部統計(リング数, 層, ジオメトリ数)を verification/report.json へ
//
// 使い方: node test/verify.mjs [--quick]
// 事前に `npm run build` と `npx vite preview --port 4173` が必要
// (このスクリプト自身が preview サーバーを起動する)

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { SHAPES } from './shapes.mjs';

const PORT = 4173;
const PAGE_URL = `http://localhost:${PORT}/`;
const OUT = new URL('../verification/shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const DEVICES = {
  'iphone-portrait': { width: 390, height: 844, dpr: 2 },
  'iphone-landscape': { width: 844, height: 390, dpr: 2 },
  'ipad-portrait': { width: 834, height: 1194, dpr: 2 },
  'ipad-landscape': { width: 1194, height: 834, dpr: 2 },
};

function startServer() {
  const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: 'pipe', cwd: new URL('..', import.meta.url).pathname,
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('preview server timeout')), 15000);
    proc.stdout.on('data', (d) => {
      if (String(d).includes('localhost')) { clearTimeout(timer); resolve(proc); }
    });
    proc.stderr.on('data', (d) => process.stderr.write(d));
  });
}

async function waitPhase(page, pred, timeoutMs = 90000) {
  const t0 = Date.now();
  for (;;) {
    const ph = await page.evaluate(() => window.__osc?.phase() ?? 'boot');
    if (pred(ph)) return ph;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting phase (last=${ph})`);
    await new Promise(r => setTimeout(r, 120));
  }
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}${name}.png` });
  console.log(`  shot: ${name}.png`);
}

async function newPage(browser, dev) {
  const ctx = await browser.newContext({
    viewport: { width: dev.width, height: dev.height },
    deviceScaleFactor: dev.dpr,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('  PAGE ERROR:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('  console.error:', m.text()); });
  await page.goto(PAGE_URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__osc, { timeout: 10000 });
  return { ctx, page };
}

const report = { runs: [], errors: [] };

async function fullPlaythrough(browser, devName, dev, shape, shapeName, opts = {}) {
  console.log(`\n=== ${devName} / ${shapeName} ===`);
  const { ctx, page } = await newPage(browser, dev);
  const entry = { device: devName, shape: shapeName, stages: {} };
  try {
    // 入力中のスクリーンショット（ストロークを流しながら途中で撮る）
    const strokePromise = page.evaluate(
      ({ pts, dur }) => window.__osc.stroke(pts, dur),
      { pts: shape, dur: opts.strokeMs ?? 5200 },
    );
    await new Promise(r => setTimeout(r, (opts.strokeMs ?? 5200) * 0.55));
    if (opts.captureAll) await shot(page, `${devName}-${shapeName}-1-input`);
    await strokePromise;

    if (opts.timeScale) await page.evaluate((v) => window.__osc.timeScale(v), opts.timeScale);

    // 第一層
    await waitPhase(page, (p) => p.startsWith('printing:first'), 30000);
    if (opts.captureAll) {
      await new Promise(r => setTimeout(r, opts.firstLayerWaitMs ?? 4000));
      const ph = await page.evaluate(() => window.__osc.phase());
      if (ph.startsWith('printing:first')) await shot(page, `${devName}-${shapeName}-2-firstlayer`);
      else await shot(page, `${devName}-${shapeName}-2-firstlayer-late`);
    }
    entry.stages.firstLayer = await page.evaluate(() => window.__osc.stats());

    // 積層中（タイムラプス）
    await waitPhase(page, (p) => p.startsWith('printing:lapse'), 120000);
    if (opts.captureAll) {
      await new Promise(r => setTimeout(r, opts.lapseWaitMs ?? 2500));
      await shot(page, `${devName}-${shapeName}-3-stacking`);
    }
    entry.stages.stacking = await page.evaluate(() => window.__osc.stats());

    // 完成 → 比較
    await waitPhase(page, (p) => p === 'compare', 320000);
    await new Promise(r => setTimeout(r, 2400));
    await shot(page, `${devName}-${shapeName}-4-complete`);
    entry.stages.complete = await page.evaluate(() => window.__osc.stats());

    // 再プレイでリソースが解放されるか
    if (opts.checkReplay) {
      const before = await page.evaluate(() => window.__osc.stats());
      await page.evaluate(() => window.__osc.reset());
      await new Promise(r => setTimeout(r, 800));
      const after = await page.evaluate(() => window.__osc.stats());
      entry.replay = { before, after };
      console.log(`  replay: geoCount ${before.geoCount} -> ${after.geoCount}, rings ${before.rings} -> ${after.rings}`);
    }
    report.runs.push(entry);
  } catch (e) {
    console.error(`  FAILED: ${e.message}`);
    report.errors.push({ device: devName, shape: shapeName, error: e.message });
    await shot(page, `${devName}-${shapeName}-ERROR`);
  } finally {
    await ctx.close();
  }
}

const quick = process.argv.includes('--quick');
const server = await startServer();
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});

try {
  // --- 1. デバイス×縦横で通しプレイ（circleish、やや高速） ---
  const deviceEntries = quick ? Object.entries(DEVICES).slice(0, 1) : Object.entries(DEVICES);
  for (const [name, dev] of deviceEntries) {
    await fullPlaythrough(browser, name, dev, SHAPES.circleish, 'circleish', {
      captureAll: true, timeScale: 8, firstLayerWaitMs: 2500, lapseWaitMs: 2000,
      checkReplay: name === 'iphone-portrait',
    });
  }

  // --- 2. 6形状の形状保存検証（iPhone縦・高速） ---
  const shapeNames = quick ? ['sCurve'] : Object.keys(SHAPES);
  for (const sn of shapeNames) {
    if (sn === 'circleish' && !quick) {
      // circleish は上のデバイス通しで取得済みだが、統一条件でも取り直す
    }
    await fullPlaythrough(browser, 'shape', DEVICES['iphone-portrait'], SHAPES[sn], sn, {
      timeScale: 40, strokeMs: 1500,
    });
  }
} finally {
  writeFileSync(new URL('../verification/report.json', import.meta.url).pathname, JSON.stringify(report, null, 2));
  await browser.close();
  server.kill();
}

console.log('\nDONE. errors:', report.errors.length);
if (report.errors.length) process.exit(1);
