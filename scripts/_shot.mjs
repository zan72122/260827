import { chromium } from '@playwright/test';

export const LAUNCH = {
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox',
  ],
};

const b = await chromium.launch(LAUNCH);
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const logs = [];
p.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
p.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await p.goto('http://127.0.0.1:5173/', { waitUntil: 'load' });
await p.waitForTimeout(2500);
await p.screenshot({ path: 'evidence/shots/01-title.png' });
await p.click('#start');
await p.waitForTimeout(3500);
await p.screenshot({ path: 'evidence/shots/02-play.png' });
console.log(logs.join('\n') || '(no console output)');
await b.close();
