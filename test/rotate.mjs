// 画面回転テスト: 積層中に縦→横→縦と回転し、
// 軌跡・生成済み層・フェーズが保持されることを確認する
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { SHAPES } from './shapes.mjs';

const PORT = 4177;
const proc = spawn('./node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'pipe', cwd: new URL('..', import.meta.url).pathname,
});
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('server timeout')), 15000);
  proc.stdout.on('data', (d) => { if (String(d).includes('localhost')) { clearTimeout(t); res(); } });
});
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.on('pageerror', e => console.error('PAGE ERROR:', e.message));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__osc);

await page.evaluate((pts) => { window.__osc.timeScale(10); return window.__osc.stroke(pts, 2500); }, SHAPES.ellipse);
// 積層フェーズまで進める
for (;;) {
  const ph = await page.evaluate(() => window.__osc.phase());
  if (ph.startsWith('printing:lapse')) break;
  await new Promise(r => setTimeout(r, 300));
}
const before = await page.evaluate(() => window.__osc.stats());
console.log('before rotate:', JSON.stringify(before));

// 横向きへ回転
await page.setViewportSize({ width: 844, height: 390 });
await new Promise(r => setTimeout(r, 1500));
const mid = await page.evaluate(() => window.__osc.stats());
console.log('landscape:    ', JSON.stringify(mid));
await page.screenshot({ path: new URL('../verification/shots/rotate-landscape.png', import.meta.url).pathname });

// 縦へ戻す
await page.setViewportSize({ width: 390, height: 844 });
await new Promise(r => setTimeout(r, 1500));
const after = await page.evaluate(() => window.__osc.stats());
console.log('back portrait:', JSON.stringify(after));

const ok = mid.rings >= before.rings && after.rings >= mid.rings
  && String(mid.phase).startsWith('printing') && mid.totalLen === before.totalLen;
console.log(ok ? 'ROTATE TEST: OK (経路・層とも保持)' : 'ROTATE TEST: FAILED');
await browser.close();
proc.kill();
process.exit(ok ? 0 : 1);
