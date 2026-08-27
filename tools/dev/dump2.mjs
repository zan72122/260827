import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('pageerror', e => console.log('ERR', e.message));
await page.goto('http://localhost:5173/?quality=medium&mark=1&debug=1', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__zoom);
await page.waitForTimeout(1500);
await page.evaluate(() => window.__zoom.setProgress(0.34, true));
await page.evaluate(() => window.__zoom.waitReady(6));
await page.waitForTimeout(500);
console.log('uniforms', JSON.stringify(await page.evaluate(() => window.__zoomUniforms())));
console.log('state', JSON.stringify(await page.evaluate(() => window.__zoom.getState())));
const url = await page.evaluate(() => window.__zoomDumpLevel(2));
await writeFile('captures/level2-at034.png', Buffer.from(url.split(',')[1], 'base64'));
await b.close();
console.log('ok');
