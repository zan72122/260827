// チョーク/墨出し線のデバッグ: 描画途中スクリーンショット + 内部状態
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { SHAPES } from './shapes.mjs';

const PORT = 4176;
const proc = spawn('./node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'pipe', cwd: new URL('..', import.meta.url).pathname,
});
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('server timeout')), 15000);
  proc.stdout.on('data', (d) => { if (String(d).includes('localhost')) { clearTimeout(t); res(); } });
});
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
page.on('pageerror', e => console.error('PAGE ERROR:', e.message));
page.on('console', m => { if (m.type() === 'error') console.error('console.error:', m.text()); });
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__osc);

// 待たずにストローク開始（時間をかけて描く）
await page.evaluate((pts) => { window.__osc.stroke(pts, 6000); }, SHAPES.rightBulge);
await new Promise(r => setTimeout(r, 3200));
console.log('mid:', JSON.stringify(await page.evaluate(() => window.__oscDebug().stroke)));
await page.screenshot({ path: new URL('../verification/shots/debug-midstroke.png', import.meta.url).pathname });
await new Promise(r => setTimeout(r, 4000));
console.log('after:', JSON.stringify(await page.evaluate(() => window.__oscDebug().stroke)));
console.log('phase:', await page.evaluate(() => window.__osc.phase()));
await page.screenshot({ path: new URL('../verification/shots/debug-poststroke.png', import.meta.url).pathname });
await browser.close();
proc.kill();
process.exit(0);
