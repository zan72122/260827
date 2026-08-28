import { chromium } from 'playwright';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
const seen = new Set();
page.on('pageerror', (e) => {
  const k = e.stack?.split('\n').slice(0, 4).join('\n') ?? String(e);
  if (!seen.has(k)) { seen.add(k); console.log('--- ERROR ---\n' + k); }
});
await page.goto('http://localhost:4173/?auto=1&seed=20251224', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.stage() !== 'boot', null, { timeout: 60000 });
const deadline = Date.now() + Number(process.env.SECS || 300) * 1000;
let last = '';
while (Date.now() < deadline) {
  const s = await page.evaluate(() => window.__game.stage());
  if (s !== last) { console.log('stage:', s, new Date().toISOString().slice(14, 19)); last = s; }
  if (s === 'finale') break;
  await page.waitForTimeout(500);
}
console.log('final stage', last);
await browser.close();
