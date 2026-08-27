import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('pageerror', e => console.log('ERR', e.message));
await page.goto('http://localhost:5173/?quality=medium&mark=1&debug=1', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__zoom);
await page.waitForTimeout(2000);
for (const p of [0.34, 0.86]) {
  await page.evaluate(v => window.__zoom.setProgress(v, true), p);
  await page.evaluate(() => window.__zoom.waitReady(6));
  await page.waitForTimeout(700);
  await page.screenshot({ path: `captures/mark-${String(p).replace('.','_')}.png` });
}
await b.close();
console.log('done');
