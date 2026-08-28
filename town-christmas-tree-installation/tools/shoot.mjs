import { chromium, devices } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:4173/';
const OUT = 'shots';
fs.mkdirSync(OUT, { recursive: true });

const viewports = [
  { name: 'iphone-portrait', width: 393, height: 852, dpr: 3 },
  { name: 'iphone-landscape', width: 852, height: 393, dpr: 3 },
  { name: 'ipad-portrait', width: 820, height: 1180, dpr: 2 },
  { name: 'ipad-landscape', width: 1180, height: 820, dpr: 2 },
];

const target = process.argv[2] || 'all';
const stagesWanted = (process.argv[3] || '').split(',').filter(Boolean);

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

for (const vp of viewports) {
  if (target !== 'all' && target !== vp.name) continue;
  const ctx = await browser.newContext({
    ...devices['iPhone 13'],
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    userAgent: devices['iPhone 13'].userAgent,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE + '?auto=1&turbo=6&seed=20251224', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.stage() !== 'boot', null, { timeout: 60000 });
  await page.waitForSelector('#boot.hidden', { timeout: 60000 });
  await page.waitForTimeout(1200);

  const seen = new Set();
  const deadline = Date.now() + Number(process.env.DEADLINE || 600000);
  while (Date.now() < deadline) {
    const stage = await page.evaluate(() => window.__game.stage());
    if (!seen.has(stage) && (stagesWanted.length === 0 || stagesWanted.includes(stage))) {
      seen.add(stage);
      await page.waitForTimeout(stage === 'lift' ? 3000 : 4000);
      await page.screenshot({ path: `${OUT}/${vp.name}-${stage}.png` });
      console.log(vp.name, stage, 'captured');
    }
    if (stagesWanted.length && stagesWanted.every((n) => seen.has(n))) break;
    if (stage === 'finale') {
      await page.waitForTimeout(2500);
      await page.screenshot({ path: `${OUT}/${vp.name}-finale-wide.png` });
      break;
    }
    await page.waitForTimeout(400);
  }
  // extra mid-lift frames
  console.log(vp.name, 'errors:', errors.slice(0, 8));
  await ctx.close();
}
await browser.close();
