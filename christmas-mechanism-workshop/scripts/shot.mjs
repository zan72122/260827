import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const OUT = process.env.OUT || 'shots';
mkdirSync(OUT, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((res) => {
  server.stdout.on('data', (d) => { if (String(d).includes('Local')) res(); });
  setTimeout(res, 4000);
});

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('PAGE ERR:', m.text()); });
page.on('pageerror', (e) => console.log('PAGE EXCEPTION:', e.message));
await page.goto('http://localhost:4173/?autotest=1', { waitUntil: 'load' });
await page.waitForSelector('#veil', { state: 'detached', timeout: 30000 });
await page.waitForTimeout(5000);
console.log('state', JSON.stringify(await page.evaluate(() => window.__CMW?.state ?? null)));
await page.screenshot({ path: `${OUT}/00-intro.png` });
await browser.close();
server.kill();
