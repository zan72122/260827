import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
const out = [];
page.on('console', (m) => out.push(m.text()));
page.on('pageerror', (e) => out.push('PAGEERROR ' + e.message));
await page.goto('http://localhost:5173/preview.html', { waitUntil: 'load' });
await page.waitForTimeout(3000);
await browser.close();
const txt = out.join('\n');
// print only the error report portion
const i = txt.indexOf('ERROR:');
console.log(i >= 0 ? txt.slice(Math.max(0, i - 400), i + 2500) : txt.slice(0, 3000));
