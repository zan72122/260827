/**
 * shot.mjs — screenshot a dev-server page. Used to look at the work.
 *   node tools/shot.mjs <path> <out.png> [width] [height] [readySymbol]
 */
import { chromium } from 'playwright';

const [, , path = '/preview.html', out = 'captures/preview.png', w = '1680', h = '1680', ready = '__previewReady'] =
  process.argv;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: Number(w), height: Number(h) },
  deviceScaleFactor: 1,
});
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

await page.goto(`http://localhost:5173${path}`, { waitUntil: 'load', timeout: 60000 });
try {
  await page.waitForFunction((sym) => window[sym] === true, ready, { timeout: 120000 });
} catch {
  errors.push(`[timeout] window.${ready} never became true`);
}
await page.waitForTimeout(400);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(errors.length ? errors.join('\n') : 'no console errors');
console.log('wrote', out);
