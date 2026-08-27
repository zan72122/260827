import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('pageerror', e => console.log('ERR', e.message));
await page.goto('http://localhost:5173/?quality=high', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__zoom);
await page.waitForTimeout(2500);
for (const i of [0, 1]) {
  const url = await page.evaluate(n => window.__zoomDumpLevel(n), i);
  if (url) await writeFile(`captures/lvl${i}.png`, Buffer.from(url.split(',')[1], 'base64'));
}
await b.close(); console.log('ok');
