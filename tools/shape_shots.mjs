// Capture one finale-overview screenshot per stroke shape, for the
// independent "can you read the child's stroke back from the lane?" check.

import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const DIST = new URL('../dist', import.meta.url).pathname;
const OUT = process.argv[2] || new URL('../shots-shapes', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript' };
const server = createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p === '/') p = '/index.html';
  const f = join(DIST, p);
  if (!existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(4174, r));

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader-webgl'],
});

const mk = (f, n = 40) => Array.from({ length: n }, (_, i) => { const t = i / (n - 1); const p = f(t); return { x: p[0], z: p[1] }; });
const SHAPES = {
  straight: mk((t) => [4, -160 + t * 320], 30),
  right: mk((t) => { const a = Math.PI - t * 0.85; return [190 + 190 * Math.cos(a), -160 + 190 * Math.sin(a)]; }, 30),
  left: mk((t) => { const a = Math.PI - t * 0.85; return [-(190 + 190 * Math.cos(a)), -160 + 190 * Math.sin(a)]; }, 30),
  scurve: mk((t) => [78 * Math.sin(t * Math.PI * 2) * (1 - t * 0.3), -160 + t * 330]),
};

const ctx = await browser.newContext({ viewport: { width: 780, height: 1180 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:4174/');
await page.waitForFunction(() => window.__ib);
await page.evaluate(() => { window.__ib.skipIntro(); window.__ib.fastForward(1); });

for (const [name, pts] of Object.entries(SHAPES)) {
  await page.evaluate(() => window.__ib.reset(false));
  await page.evaluate(() => window.__ib.fastForward(0.5));
  await page.evaluate((p) => window.__ib.injectStroke(p, 700), pts);
  for (let i = 0; i < 45 && (await page.evaluate(() => window.__ib.getState())) === 'breaking'; i++) {
    await page.evaluate(() => window.__ib.fastForward(4));
  }
  await page.evaluate(() => window.__ib.fastForward(14)); // finale camera settles
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(OUT, `lane-${name}.png`) });
  console.log('saved', name);
}
await browser.close();
server.close();
