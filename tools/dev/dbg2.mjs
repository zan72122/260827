import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://localhost:5173/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const out = [];
page.on('console', (m) => out.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => out.push('PAGEERROR ' + e.message + '\n' + (e.stack||'')));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(6000);
const state = await page.evaluate(() => (window.__zoom ? window.__zoom.getState() : 'no debug api'));
await browser.close();
console.log(out.join('\n').slice(0, 4000));
console.log('STATE:', JSON.stringify(state));
