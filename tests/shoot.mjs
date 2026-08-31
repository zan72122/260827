import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:4173/';
const OUT = process.env.OUT || 'shots';
fs.mkdirSync(OUT, { recursive: true });

const args = process.argv.slice(2);
const mode = args[0] || 'smoke';

const PHONE = { width: 390, height: 844 };
const LAND = { width: 844, height: 390 };

async function newPage(browser, viewport) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.gameDebug, null, { timeout: 90000 });
  await page.evaluate(() => { window.gameDebug.skipIntro(); window.gameDebug.hideHint(); });
  await page.waitForTimeout(400);
  return { ctx, page, errors };
}

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: [
    '--disable-background-networking',
    '--disable-component-update',
    '--no-first-run',
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});

if (mode === 'smoke') {
  const { page, errors } = await newPage(browser, PHONE);
  for (const v of [0, 0.15, 0.25, 0.5, 0.75, 1]) {
    await page.evaluate((x) => window.gameDebug.setOpen(x), v);
    await page.waitForTimeout(250);
    await page.screenshot({ timeout: 90000, path: `${OUT}/smoke-${Math.round(v * 100)}.png` });
  }
  console.log('info', JSON.stringify(await page.evaluate(() => window.gameDebug.info())));
  console.log('errors', JSON.stringify(errors));
}

if (mode === 'poses') {
  const { page, errors } = await newPage(browser, PHONE);
  const views = {
    front: [0, 6, 0.62, 0.14],
    oblique: [40, 22, 0.62, 0.14],
    back: [180, 6, 0.62, 0.14],
    top: [20, 78, 0.60, 0.14],
  };
  for (const p of [0, 25, 50, 75, 100]) {
    await page.evaluate((x) => window.gameDebug.setOpen(x / 100), p);
    for (const [name, v] of Object.entries(views)) {
      await page.evaluate((v) => window.gameDebug.setView(...v), v);
      await page.waitForTimeout(160);
      await page.screenshot({ timeout: 90000, path: `${OUT}/pose-${String(p).padStart(3, '0')}-${name}.png` });
    }
  }
  console.log('errors', JSON.stringify(errors));
}

if (mode === 'closeup') {
  const { page } = await newPage(browser, PHONE);
  const views = JSON.parse(process.env.VIEWS || '[[35,12,0.26,0.16]]');
  const opens = JSON.parse(process.env.OPENS || '[30,60,100]');
  for (const p of opens) {
    await page.evaluate((x) => window.gameDebug.setOpen(x / 100), p);
    for (let i = 0; i < views.length; i++) {
      await page.evaluate((v) => window.gameDebug.setView(...v), views[i]);
      await page.waitForTimeout(200);
      await page.screenshot({ timeout: 90000, path: `${OUT}/closeup-${p}-v${i}.png` });
    }
  }
}

if (mode === 'diag') {
  const { page } = await newPage(browser, PHONE);
  for (const p of [25, 50, 75]) {
    await page.evaluate((x) => window.gameDebug.setOpen(x / 100), p);
    for (const az of [0, 90, 180, 270]) {
      await page.evaluate((a) => window.gameDebug.setView(a, 34, 0.70, 0.14), az);
      await page.waitForTimeout(160);
      await page.screenshot({ timeout: 90000, path: `${OUT}/diag-${p}-az${az}.png` });
    }
  }
}

if (mode === 'land') {
  const { page } = await newPage(browser, LAND);
  for (const p of [0, 45, 100]) {
    await page.evaluate((x) => window.gameDebug.setOpen(x / 100), p);
    await page.waitForTimeout(200);
    await page.screenshot({ timeout: 90000, path: `${OUT}/land-${p}.png` });
  }
}

await browser.close();
