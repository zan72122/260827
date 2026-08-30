import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join, normalize } from 'path';

const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json' };
const root = process.cwd();
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const f = join(root, normalize(p));
    const buf = await readFile(f);
    res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
    res.end(buf);
  } catch (e) { res.writeHead(404); res.end('nope'); }
});
await new Promise(r => server.listen(8099, r));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-lcd-text'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
await page.goto('http://localhost:8099/index.html');
await page.waitForTimeout(3500);

const plan = JSON.parse(process.argv[2] || '[]');
for (const step of plan) {
  await page.evaluate((s) => {
    const g = window.__game;
    if (!g) return;
    if (s.phase) { g.director.setPhase(s.phase); }
    if (s.state) Object.assign(g.piece.state, s.state);
    if (s.settle) { g.rig.t = 1; }
  }, step);
  await page.waitForTimeout(step.wait ?? 900);
  await page.screenshot({ path: `tools/shots/${step.name}.png` });
}
console.log('ERRORS:', JSON.stringify(errors.slice(0, 12), null, 1));
await browser.close();
server.close();
