// ビードジオメトリの数値検査: リング頂点の広がり(幅/高さ)をダンプ
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { SHAPES } from './shapes.mjs';

const PORT = 4174;
const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'pipe', cwd: new URL('..', import.meta.url).pathname,
});
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('server timeout')), 15000);
  proc.stdout.on('data', (d) => { if (String(d).includes('localhost')) { clearTimeout(t); res(); } });
});

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--enable-unsafe-swiftshader'],
});
const page = await (await browser.newContext({ viewport: { width: 500, height: 800 } })).newPage();
page.on('pageerror', e => console.error('PAGE ERROR:', e.message));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__osc);

await page.evaluate((pts) => window.__osc.stroke(pts, 1200), SHAPES.circleish);
// 印刷開始まで待つ
for (let i = 0; i < 200; i++) {
  const ph = await page.evaluate(() => window.__osc.phase());
  if (ph.startsWith('printing')) break;
  await new Promise(r => setTimeout(r, 200));
}
await new Promise(r => setTimeout(r, 6000));

const dump = await page.evaluate(() => {
  const g = window.__oscDebug?.();
  return g;
});
console.log(JSON.stringify(dump, null, 2));
await browser.close();
proc.kill();
