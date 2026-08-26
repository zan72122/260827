// 単発スクリーンショット: 指定フェーズ到達後に撮影（視覚調整の高速反復用）
// node test/snap.mjs <phasePrefix> <outName> [timeScale] [waitAfterMs] [shape] [w] [h]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { SHAPES } from './shapes.mjs';

const [phasePrefix = 'printing:first', outName = 'snap', ts = '1', waitAfter = '3000', shapeName = 'circleish', W = '390', H = '844'] = process.argv.slice(2);
const OUT = new URL('../verification/shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const PORT = 4175;
const proc = spawn('./node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], {
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
const page = await (await browser.newContext({
  viewport: { width: Number(W), height: Number(H) }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
})).newPage();
page.on('pageerror', e => console.error('PAGE ERROR:', e.message));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__osc);

await page.evaluate(({ pts, sc }) => { window.__osc.timeScale(sc); return window.__osc.stroke(pts, 2600); },
  { pts: SHAPES[shapeName], sc: Number(ts) });

const t0 = Date.now();
for (;;) {
  const ph = await page.evaluate(() => window.__osc.phase());
  if (ph.startsWith(phasePrefix)) break;
  if (Date.now() - t0 > 400000) { console.error('timeout, phase=', ph); break; }
  await new Promise(r => setTimeout(r, 150));
}
await new Promise(r => setTimeout(r, Number(waitAfter)));
await page.screenshot({ path: `${OUT}${outName}.png` });
console.log('saved', outName, 'phase=', await page.evaluate(() => window.__osc.phase()));
await browser.close();
proc.kill();
process.exit(0);
