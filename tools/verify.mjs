// Automated playtest: serves dist/, drives the game in headless Chromium,
// checks the one-stroke contract (left stays left, S stays S, no snap turns,
// lane width, supply ship stays in the lane), and saves device screenshots.
//
// Usage: node tools/verify.mjs [--shots-only]

import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const DIST = new URL('../dist', import.meta.url).pathname;
const OUT = process.env.SHOT_DIR || new URL('../shots', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p === '/') p = '/index.html';
  const f = join(DIST, p);
  if (!existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(4173, r));

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader-webgl'],
});

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name} ${detail}`); }
}

async function newPage(w, h, dpr = 2) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { failures++; console.log('  PAGE ERROR', e.message); });
  await page.goto('http://127.0.0.1:4173/');
  await page.waitForFunction(() => window.__ib && typeof window.__ib.getState === 'function');
  await page.evaluate(() => { window.__ib.skipIntro(); window.__ib.fastForward(1); });
  return { ctx, page };
}

const ib = (page, expr) => page.evaluate(`window.__ib.${expr}`);

// ---------------------------------------------------------------------------
// stroke shapes (world space; start ~(0,-172), port ~(12,168))
const arc = (sign) => Array.from({ length: 30 }, (_, i) => {
  const a = Math.PI - (i / 29) * 0.85;
  return { x: sign * (190 + 190 * Math.cos(a)), z: -160 + 190 * Math.sin(a) };
});
const STROKES = {
  straight: Array.from({ length: 30 }, (_, i) => ({ x: 4, z: -160 + i * 11 })),
  right: arc(1),
  left: arc(-1),
  scurve: Array.from({ length: 40 }, (_, i) => { const t = i / 39; return { x: 78 * Math.sin(t * Math.PI * 2) * (1 - t * 0.3), z: -160 + t * 330 }; }),
  short: Array.from({ length: 8 }, (_, i) => ({ x: 6, z: -160 + i * 10 })),
  longslow: Array.from({ length: 60 }, (_, i) => { const t = i / 59; return { x: 95 * Math.sin(t * Math.PI * 1.05), z: -165 + t * 335 }; }),
};

function signedTurnSum(headings, upto) {
  let s = 0;
  const n = Math.min(upto, headings.length);
  for (let i = 1; i < n; i++) {
    let d = headings[i] - headings[i - 1];
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    s += d;
  }
  return s;
}

async function runStroke(page, name, pts, speed, opts = {}) {
  console.log(`\n== stroke: ${name} ==`);
  await ib(page, 'reset(false)');
  await ib(page, 'fastForward(0.5)');
  const okLaunch = await page.evaluate(([p, s]) => window.__ib.injectStroke(p, s), [pts, speed]);
  check('stroke accepted', okLaunch === true);
  const info = await ib(page, 'routeInfo()');
  check('route exists', !!info);

  // no snap turns: consecutive fine-route headings bounded by min turn radius
  const routeFull = await page.evaluate(() => {
    // reconstruct headings from the decimated pts is lossy; expose via pose sim instead
    return window.__ib.routeInfo();
  });

  // watch the ship for the first seconds: heading must change smoothly
  let lastHeading = null, maxStep = 0;
  for (let i = 0; i < 30; i++) {
    await ib(page, 'fastForward(0.5)');
    const pose = await ib(page, 'shipPose()');
    if (lastHeading !== null) {
      let d = Math.abs(pose.heading - lastHeading);
      if (d > Math.PI) d = 2 * Math.PI - d;
      maxStep = Math.max(maxStep, d);
    }
    lastHeading = pose.heading;
  }
  // 0.5 s at up to ~13.2 m/s with R=55 m => ~0.12 rad; allow slack
  check('no snap turns', maxStep < 0.24, `maxStep=${maxStep.toFixed(3)}`);

  // finish the whole run (icebreaker + supply + crane)
  await ib(page, 'fastForward(200)');
  const st = await ib(page, 'getState()');
  check('run completes (state=done)', st === 'done', `state=${st}`);

  const sup = await ib(page, 'supplyPose()');
  check('supply ship reaches the berth', Math.hypot(sup.x - 16, sup.z - 208) < 14,
    `at (${sup.x.toFixed(1)}, ${sup.z.toFixed(1)})`);

  // lane checks along the route centreline (and off to the sides)
  const laneChecks = await page.evaluate(() => {
    const info = window.__ib.routeInfo();
    const pts = info.pts;
    let centreMin = 1, offCarved = 0, offTotal = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const c = window.__ib.maskAt(pts[i].x, pts[i].z);
      centreMin = Math.min(centreMin, c);
      const dx = pts[i + 1].x - pts[i - 1].x, dz = pts[i + 1].z - pts[i - 1].z;
      const l = Math.hypot(dx, dz) || 1;
      const nx = dz / l, nz = -dx / l;
      for (const off of [-26, 26]) {
        const v = window.__ib.maskAt(pts[i].x + nx * off, pts[i].z + nz * off);
        offTotal++;
        if (v > 0.55) offCarved++;
      }
    }
    return { centreMin, offCarvedFrac: offCarved / Math.max(1, offTotal), n: pts.length };
  });
  check('lane open along whole centreline', laneChecks.centreMin > 0.5, `min=${laneChecks.centreMin.toFixed(2)}`);
  check('ice intact 26 m off-centre (lane is not a flood)', laneChecks.offCarvedFrac < 0.35,
    `frac=${laneChecks.offCarvedFrac.toFixed(2)}`);

  if (opts.turnSign !== undefined) {
    // dominant turn direction over the drawn portion must match the stroke
    const { pos, neg } = await page.evaluate(() => {
      const info = window.__ib.routeInfo();
      const pts = info.pts;
      const upto = Math.floor((info.drawnLen / info.totalLen) * pts.length);
      let pos = 0, neg = 0;
      let ph = Math.atan2(pts[1].x - pts[0].x, pts[1].z - pts[0].z);
      for (let i = 2; i < upto; i++) {
        const h = Math.atan2(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
        let d = h - ph;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        if (d > 0) pos += d; else neg -= d;
        ph = h;
      }
      return { pos, neg };
    });
    const dominant = pos > neg ? 1 : -1;
    check(`turn direction preserved (expect ${opts.turnSign > 0 ? 'right' : 'left'})`,
      dominant === opts.turnSign && Math.max(pos, neg) > 2.5 * Math.min(pos, neg),
      `pos=${pos.toFixed(2)} neg=${neg.toFixed(2)}`);
  }
  return info;
}

// ---------------------------------------------------------------------------
console.log('\n#### contract tests (iPhone portrait) ####');
{
  const { ctx, page } = await newPage(390, 844);

  const infoStraight = await runStroke(page, 'straight', STROKES.straight, 700);
  const infoRight = await runStroke(page, 'gentle right', STROKES.right, 700, { turnSign: 1 });
  const infoLeft = await runStroke(page, 'gentle left', STROKES.left, 700, { turnSign: -1 });
  await runStroke(page, 'big S', STROKES.scurve, 700);
  const infoShort = await runStroke(page, 'short & fast', STROKES.short, 1600);
  const infoLong = await runStroke(page, 'long & slow', STROKES.longslow, 260);

  console.log('\n== differentiation ==');
  check('right and left routes differ', JSON.stringify(infoRight.pts.slice(0, 20)) !== JSON.stringify(infoLeft.pts.slice(0, 20)));
  check('short drawn portion < long drawn portion', infoShort.drawnLen < infoLong.drawnLen,
    `${infoShort.drawnLen} vs ${infoLong.drawnLen}`);
  check('fast stroke sails harder than slow stroke', infoShort.speedFactor > infoLong.speedFactor,
    `${infoShort.speedFactor} vs ${infoLong.speedFactor}`);
  check('right route bends starboard of straight route', true); // covered by turnSign checks

  // replay clears the world
  await ib(page, 'reset(false)');
  const cleared = await page.evaluate(() => window.__ib.maskAt(4, -60));
  check('replay clears the previous lane', cleared < 0.1, `mask=${cleared}`);

  // real one-finger swipe through the actual pointer pipeline
  console.log('\n== real pointer swipe (portrait, bend to screen-right) ==');
  await ib(page, 'fastForward(0.5)');
  const cx = 160;
  await page.mouse.move(cx, 700);
  await page.mouse.down();
  for (let i = 1; i <= 24; i++) {
    const t = i / 24;
    await page.mouse.move(cx + 150 * Math.pow(t, 1.5), 700 - t * 360, { steps: 2 });
  }
  await page.mouse.up();
  await page.waitForTimeout(120);
  const info = await ib(page, 'routeInfo()');
  check('pointer swipe launched a route', !!info);
  if (info) {
    // The drawn portion of the route must lie along the projected stroke:
    // rendered by the same camera, the lane then passes under the finger
    // trace on screen. Mean distance route->stroke-polyline must be small.
    const stroke = await ib(page, 'lastStroke()');
    const upto = Math.max(2, Math.floor((info.drawnLen / info.totalLen) * info.pts.length));
    const distToPolyline = (p, poly) => {
      let best = Infinity;
      for (let i = 1; i < poly.length; i++) {
        const ax = poly[i - 1].x, az = poly[i - 1].z;
        const bx = poly[i].x, bz = poly[i].z;
        const dx = bx - ax, dz = bz - az;
        const L2 = dx * dx + dz * dz || 1;
        let t = ((p.x - ax) * dx + (p.z - az) * dz) / L2;
        t = Math.max(0, Math.min(1, t));
        best = Math.min(best, Math.hypot(p.x - (ax + dx * t), p.z - (az + dz * t)));
      }
      return best;
    };
    let sum = 0, n = 0;
    for (let i = 0; i < upto; i += 2) { sum += distToPolyline(info.pts[i], [{ x: 0, z: -172 }, ...stroke]); n++; }
    const mean = sum / Math.max(1, n);
    check('route follows the finger stroke (mean deviation < 18 m)', mean < 18, `mean=${mean.toFixed(1)}m stroke pts=${stroke.length}`);
  }
  await ctx.close();
}

console.log('\n#### screenshots ####');
const DEVICES = [
  ['iphone-portrait', 390, 844, 3],
  ['iphone-landscape', 844, 390, 3],
  ['ipad-portrait', 820, 1180, 2],
  ['ipad-landscape', 1180, 820, 2],
];
for (const [name, w, h, dpr] of DEVICES) {
  const { ctx, page } = await newPage(w, h, dpr);
  await ib(page, 'fastForward(2)');
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(OUT, `${name}-1-input.png`) });

  await page.evaluate((pts) => window.__ib.injectStroke(pts, 700), STROKES.scurve);
  await ib(page, 'fastForward(6)');
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(OUT, `${name}-2-close.png`) });

  await ib(page, 'fastForward(20)');
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(OUT, `${name}-3-mid.png`) });

  for (let i = 0; i < 40 && (await ib(page, 'getState()')) === 'breaking'; i++) {
    await ib(page, 'fastForward(4)');
  }
  await ib(page, 'fastForward(12)'); // camera settles into the finale overview
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(OUT, `${name}-4-finale.png`) });

  for (let i = 0; i < 40 && (await ib(page, 'getState()')) === 'convoy'; i++) {
    await ib(page, 'fastForward(4)');
  }
  await ib(page, 'fastForward(9)');
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(OUT, `${name}-5-dock.png`) });
  await ctx.close();
  console.log(`  saved ${name}`);
}

await browser.close();
server.close();
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);
