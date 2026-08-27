import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('ERR', e.message));
await page.goto('http://localhost:5173/?quality=medium&mark=1', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__zoom);
await page.waitForTimeout(1500);
for (const i of [2]) {
  const url = await page.evaluate((n) => window.__zoomDumpLevel(n), i);
  if (!url) { console.log('level', i, 'not ready'); continue; }
  await writeFile(`captures/level-${i}.png`, Buffer.from(url.split(',')[1], 'base64'));
  console.log('wrote captures/level-' + i + '.png');
}
await b.close();
