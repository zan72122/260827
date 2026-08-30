import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join, normalize } from 'path';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const root = process.cwd();
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const b = await readFile(join(root, normalize(p)));
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(b);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(8099, r));

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('PAGEERR', e.message));
await page.goto('http://localhost:8099/index.html?tier=low&res=0.35');
await page.waitForTimeout(4000);

// Deterministic gesture simulation: fixed timestep, no rendering in the loop.
const out = await page.evaluate(() => {
  const g = window.__game, D = g.director, P = g.piece, I = g.input;
  const step = (n, dt = 1 / 60) => {
    for (let i = 0; i < n; i++) {
      I.anyInputAt = performance.now() / 1000;   // pretend the child is present
      D.update(dt, i * dt); P.update(dt, i * dt);
    }
  };
  const res = {};

  D.setPhase('spin'); P.reset(); P.ang.fill(0);
  // one-drag diagnostic
  const before = P.state.heat;
  for (let k = 0; k < 6; k++) { I.dxFrame += 35; step(3); }
  const midSpin = D.spinVel;
  step(45);
  res.diag = {
    heatAfter1: +P.state.heat.toFixed(4), before, midSpin: +midSpin.toFixed(2),
    sectors: Array.from(P.ang).map(v => +v.toFixed(2)),
    flamePhase: +P.flamePhase.toFixed(2), spin: +P.state.spin.toFixed(2),
  };
  P.reset(); P.ang.fill(0); D.setPhase('spin'); D.spinVel = 0;

  let drags = 0, peakSpin = 0;
  while (D.phase === 'spin' && drags < 40) {
    drags++;
    for (let k = 0; k < 6; k++) { I.dxFrame += 35; step(3); peakSpin = Math.max(peakSpin, Math.abs(D.spinVel)); }
    step(45);
  }
  res.spin = {
    drags, heat: +P.state.heat.toFixed(2),
    revPerDrag: +(P.state.spin / drags / 6.283).toFixed(2),
    peakRevPerSec: +(peakSpin / 6.283).toFixed(2),
  };

  D.setPhase('blow');
  let puffs = 0;
  while (D.phase === 'blow' && puffs < 30) {
    puffs++;
    for (let k = 0; k < 6; k++) { I.upFrame += 40; step(3); }
    step(30);
  }
  res.blow = { puffs, bulge: +P.state.bulgeTarget.toFixed(2) };

  D.setPhase('silver'); step(60);
  let sd = 0;
  while (D.phase === 'silver' && sd < 40) {
    sd++;
    for (let k = 0; k < 6; k++) { I.dxFrame += 35; step(3); }
    step(30);
  }
  res.silver = { drags: sd, silver: +P.state.silver.toFixed(2) };
  res.phaseAfter = D.phase;
  return res;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
server.close();
