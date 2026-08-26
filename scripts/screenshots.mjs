// Screenshot harness: renders the journey at fixed progress values across
// iPhone / iPad portrait+landscape viewports using headless Chromium.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const URL = process.env.SHOT_URL ?? 'http://localhost:5173/';
const OUT = process.env.SHOT_DIR ?? 'shots';
mkdirSync(OUT, { recursive: true });

const DEVICES = {
  'iphone-portrait': { width: 390, height: 844, dpr: 2 },
  'iphone-landscape': { width: 844, height: 390, dpr: 2 },
  'ipad-portrait': { width: 820, height: 1180, dpr: 2 },
  'ipad-landscape': { width: 1180, height: 820, dpr: 2 },
};

const STOPS = [
  ['00-deep', 0.0],
  ['01-break', 0.1],
  ['02-old-layers', 0.5],
  ['03-firn', 0.7],
  ['04-exit-light', 0.84],
  ['05-pre-breakout', 0.895],
  ['06-post-breakout', 0.945],
  ['07-core-revealed', 1.0],
];

const only = process.argv[2]; // optional device filter
const onlyStop = process.argv[3]; // optional stop filter

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

for (const [dev, vp] of Object.entries(DEVICES)) {
  if (only && dev !== only) continue;
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(`[${dev}] pageerror:`, e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.error(`[${dev}] console:`, m.text().slice(0, 200));
  });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.icecore !== undefined, { timeout: 15000 });
  await page.waitForTimeout(1200); // warm up, adaptive quality settle
  for (const [name, p] of STOPS) {
    if (onlyStop && !name.startsWith(onlyStop)) continue;
    await page.evaluate((v) => window.icecore.setProgress(v), p);
    await page.waitForTimeout(700); // camera smoothing catches up
    await page.screenshot({ path: `${OUT}/${dev}_${name}.png` });
    console.log(`${dev}_${name}.png`);
  }
  await ctx.close();
}
await browser.close();
console.log('done');
