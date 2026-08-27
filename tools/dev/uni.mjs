import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('pageerror', e => console.log('ERR', e.message));
await page.goto('http://localhost:5173/?quality=medium&debug=1', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__zoom);
await page.waitForTimeout(1500);
await page.evaluate(() => window.__zoom.setProgress(0.34, true));
await page.evaluate(() => window.__zoom.waitReady(6));
await page.waitForTimeout(400);
const out = await page.evaluate(() => {
  // walk the three.js scene graph the app exposes indirectly: find the fullscreen quad
  const dump = window.__zoomUniforms ? window.__zoomUniforms() : null;
  return dump;
});
console.log(JSON.stringify(out, null, 2));
await b.close();
