// Headless capture harness. Drives the real game through window.__engine /
// window.__game hooks so screenshots reflect actual play state.
import { chromium } from 'playwright';
import fs from 'node:fs';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = process.env.SHOT_DIR || '/tmp/claude-0/-home-user-260827/0e8baadb-0fa8-5d67-bcfd-03648898f8e9/scratchpad/shots';
const BASE = process.env.URL || 'http://localhost:5173/';

export const DEVICES = {
  'iphone-p': { width: 390, height: 844, dsf: 3 },
  'iphone-l': { width: 844, height: 390, dsf: 3 },
  'ipad-p': { width: 820, height: 1180, dsf: 2 },
  'ipad-l': { width: 1180, height: 820, dsf: 2 },
};

export async function withPage(device, fn, opts = {}) {
  fs.mkdirSync(OUT, { recursive: true });
  const d = DEVICES[device] || DEVICES['iphone-p'];
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: [
      '--enable-unsafe-swiftshader',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--ignore-gpu-blocklist',
      '--no-sandbox',
      // headless suspends rAF for "occluded" windows, which stops the game
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling',
    ],
  });
  const ctx = await browser.newContext({
    viewport: { width: d.width, height: d.height },
    deviceScaleFactor: opts.dsf ?? 1,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('crash', () => errors.push('PAGE CRASHED'));
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) errors.push('NAVIGATED: ' + f.url()); });
  await page.goto(BASE + (opts.qs ?? process.env.QS ?? ''), { waitUntil: 'load' });
  await page.waitForFunction(() => !document.getElementById('boot') && !!window.__game, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(opts.settle ?? 2500);
  const shot = async (name) => {
    await page.screenshot({ path: `${OUT}/${name}.png` });
    return `${OUT}/${name}.png`;
  };
  try {
    await fn(page, shot, d);
  } catch (e) {
    console.log('RUN ERROR:', e.message);
    try { await page.screenshot({ path: `${OUT}/error-state.png` }); } catch {}
    process.exitCode = 1;
  } finally {
    if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.slice(0, 12).join('\n'));
    await browser.close();
  }
}

if (process.argv[2] === 'quick') {
  const dev = process.argv[3] || 'iphone-p';
  await withPage(dev, async (page, shot) => {
    await page.waitForTimeout(1200);
    console.log(await page.evaluate(() => JSON.stringify(window.__engine ? { ok: true, tier: window.__engine.quality.settings.name, calls: window.__engine.renderer.info.render.calls, tris: window.__engine.renderer.info.render.triangles } : { ok: false })));
    console.log(await shot('quick-' + dev));
  });
}
