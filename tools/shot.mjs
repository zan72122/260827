// クイックスクリーンショット: node shot.mjs <w> <h> <outfile> [waitMs] [script]
import { chromium } from 'playwright';

const [w, h, out, waitMs = '4000', script = ''] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({
  viewport: { width: +w, height: +h },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true
});
page.on('console', (m) => { if (m.type() === 'error') console.log('PAGE ERROR:', m.text()); });
page.on('pageerror', (e) => console.log('PAGE EXCEPTION:', e.message));
await page.goto('http://localhost:4173/' + (process.env.QS || ''));
await page.waitForTimeout(+waitMs);
if (script) {
  const result = await page.evaluate(script);
  console.log('EVAL:', JSON.stringify(result));
}
await page.screenshot({ path: out });
const state = await page.evaluate(() => window.__game ? window.__game.state() : null);
const perf = await page.evaluate(() => window.__game ? window.__game.perf() : null);
console.log('STATE:', JSON.stringify(state));
console.log('PERF:', JSON.stringify(perf));
await browser.close();
