import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
for (const [name, q] of [['nopatch','&nopatch=1'], ['nospec','&nospec=1'], ['both','&nopatch=1&nospec=1']]) {
  const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.goto(`http://localhost:5173/?quality=high${q}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__zoom);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `captures/toggle-${name}.png` });
  await page.close();
}
await b.close(); console.log('ok');
