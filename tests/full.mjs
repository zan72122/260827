// Required manual-operation test suite.
// Drives every stroke shape with real pointer events, asserts the physical
// invariants, and saves stroke-vs-band evidence for the review pass.
import { launch, openGame, skipIntro, drawStroke, densify, waitDriveDone, waitPhase } from './helpers.mjs';
import fs from 'node:fs';

fs.mkdirSync('screenshots/gestures', { recursive: true });
fs.mkdirSync('screenshots/dev', { recursive: true });

const results = [];
let failures = 0;
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  if (!cond) { failures++; console.log(`  FAIL ${name} ${detail}`); }
  else console.log(`  ok   ${name}`);
}

const CASES = [
  { id: 'straight', pts: [{ x: 0, z: 10 }, { x: 0, z: -12 }], dur: 900 },
  { id: 'bulge-right', pts: [{ x: 0, z: 10 }, { x: 5.5, z: 3 }, { x: 5.5, z: -5 }, { x: 0.5, z: -12 }], dur: 1100 },
  { id: 'bulge-left', pts: [{ x: 0, z: 10 }, { x: -5.5, z: 3 }, { x: -5.5, z: -5 }, { x: -0.5, z: -12 }], dur: 1100 },
  { id: 'gentle-s', pts: [{ x: 0, z: 10 }, { x: 4, z: 4 }, { x: -4, z: -4 }, { x: 0.5, z: -11 }], dur: 1300 },
  { id: 'short', pts: [{ x: 0, z: 10 }, { x: 0.3, z: 5.5 }], dur: 500 },
  { id: 'back-forth', pts: [{ x: 0.2, z: 10 }, { x: 0, z: -2 }, { x: 0.4, z: 9 }], dur: 1400 },
  { id: 'release-mid', pts: [{ x: 0, z: 10 }, { x: -2.5, z: 2 }], dur: 600 },
  { id: 'edge-approach', pts: [{ x: 0, z: 10 }, { x: 7.5, z: 2 }, { x: 9.6, z: -6 }, { x: 9.6, z: -11 }], dur: 1100 }
];

const browser = await launch();

for (const tc of CASES) {
  console.log(`case: ${tc.id}`);
  const { ctx, page } = await openGame(browser, { width: 390, height: 844, dpr: 2 });
  await skipIntro(page);

  // no water film anywhere before the vehicle has driven
  const pre = await page.evaluate(() => [
    window.__test.maskAt(0, 0), window.__test.maskAt(0, 8), window.__test.maskAt(-4, -6)
  ]);
  check(`${tc.id}: no film before pass`, pre.every(p => p.smooth === 0 && p.wet === 0), JSON.stringify(pre));

  await drawStroke(page, densify(tc.pts, 34), { durationMs: tc.dur });
  await page.waitForTimeout(300);
  const phase1 = await page.evaluate(() => window.__test.phase());
  check(`${tc.id}: drive starts`, phase1 === 'drive', phase1);

  await page.evaluate(() => window.__test.setTimeScale(3));

  // sample vehicle motion for teleport detection + ahead-of-vehicle mask
  const motion = await page.evaluate(async () => {
    const samples = [];
    let aheadViolations = 0;
    let frontBandViolations = 0;
    for (let i = 0; i < 24; i++) {
      const v = window.__test.vehicle();
      if (!v.driving) break;
      const f = { x: Math.sin(v.heading), z: Math.cos(v.heading) };
      samples.push({ x: v.x, z: v.z, s: v.speed, t: performance.now() });
      // ahead of the front bumper (rear axle + 4.2m) must still be untouched
      const ahead = window.__test.maskAt(v.x + f.x * 5.5, v.z + f.z * 5.5);
      const rough = Math.abs(v.x + f.x * 5.5) < 7 && Math.abs(v.z + f.z * 5.5) < 14;
      if (rough && (ahead.smooth > 0.05 || ahead.wet > 0.2)) aheadViolations++;
      // the smooth band must not start ahead of the conditioner (front bumper check)
      const front = window.__test.maskAt(v.x + f.x * 3.6, v.z + f.z * 3.6);
      if (front.smooth > 0.05) frontBandViolations++;
      await new Promise(r => setTimeout(r, 250));
    }
    return { samples, aheadViolations, frontBandViolations };
  });
  check(`${tc.id}: nothing resurfaced ahead of vehicle`, motion.aheadViolations === 0, `${motion.aheadViolations}`);
  check(`${tc.id}: band never ahead of front`, motion.frontBandViolations === 0, `${motion.frontBandViolations}`);
  let maxJump = 0;
  for (let i = 1; i < motion.samples.length; i++) {
    const a = motion.samples[i - 1], b = motion.samples[i];
    const dtn = (b.t - a.t) / 1000 * 3; // timeScale
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    maxJump = Math.max(maxJump, d - Math.max(a.s, b.s, 0.6) * dtn * 1.6);
  }
  check(`${tc.id}: no snap/teleport onto the line`, maxJump <= 0.25, maxJump.toFixed(3));

  await waitDriveDone(page, 120000);

  const post = await page.evaluate(() => {
    const T = window.__test;
    const pts = T.pathPoints();
    const total = T.pathTotal();
    const band = T.bandTrace();
    // sample smoothness along the driven band (skip first 2m while conditioner settles)
    const bandSamples = band.slice(2).map(p => T.maskAt(p.x, p.z));
    // width profile across the band middle
    let width = null;
    if (band.length > 6) {
      const i = Math.floor(band.length / 2);
      const a = band[i - 1], b = band[i + 1], c = band[i];
      const dl = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const nx = -(b.z - a.z) / dl, nz = (b.x - a.x) / dl;
      let lo = 0, hi = 0;
      for (let off = -2.5; off <= 2.5; off += 0.08) {
        const m = T.maskAt(c.x + nx * off, c.z + nz * off);
        if (m.smooth > 0.5) { if (off < lo) lo = off; if (off > hi) hi = off; }
      }
      width = hi - lo;
    }
    // far off-path point stays rough
    const off = T.maskAt(-8.5, 5.5);
    return { pts, total, bandLen: band.length, bandSamples, width, off, veh: T.vehicle() };
  });

  check(`${tc.id}: a smooth band always exists`, post.bandLen >= 4, `${post.bandLen}`);
  const smoothRatio = post.bandSamples.filter(s => s.smooth > 0.85).length / Math.max(1, post.bandSamples.length);
  check(`${tc.id}: band continuous along drive`, smoothRatio > 0.95, smoothRatio.toFixed(2));
  if (post.width !== null) {
    check(`${tc.id}: band width matches conditioner (2.2m)`, post.width > 1.7 && post.width < 3.0, `${post.width?.toFixed(2)}m`);
  }
  check(`${tc.id}: undrawn ice stays rough`, post.off.smooth < 0.05, JSON.stringify(post.off));

  if (tc.id === 'bulge-right') {
    const maxX = Math.max(...post.pts.map(p => p.x));
    check('bulge-right: curve preserved in path', maxX > 2.5, maxX.toFixed(2));
    const apex = post.pts.find(p => p.x === maxX);
    const sides = await page.evaluate((a) => ({
      there: window.__test.maskAt(a.x, a.z),
      mirror: window.__test.maskAt(-a.x, a.z)
    }), apex);
    check('bulge-right: band bulges right, not left', sides.there.smooth > 0.8 && sides.mirror.smooth < 0.1, JSON.stringify(sides));
  }
  if (tc.id === 'bulge-left') {
    const minX = Math.min(...post.pts.map(p => p.x));
    check('bulge-left: curve preserved in path', minX < -2.5, minX.toFixed(2));
  }
  if (tc.id === 'gentle-s') {
    const maxX = Math.max(...post.pts.map(p => p.x));
    const minX = Math.min(...post.pts.map(p => p.x));
    check('gentle-s: S shape survives smoothing', maxX > 1.5 && minX < -1.5, `${minX.toFixed(1)}..${maxX.toFixed(1)}`);
    // curvature everywhere within the vehicle's real turning ability
    const curv = await page.evaluate(() => {
      const T = window.__test;
      const b = T.bandTrace();
      let worst = 0;
      for (let i = 2; i < b.length - 2; i++) {
        const p0 = b[i - 2], p1 = b[i], p2 = b[i + 2];
        const ax = p1.x - p0.x, az = p1.z - p0.z, bx = p2.x - p1.x, bz = p2.z - p1.z;
        const cross = ax * bz - az * bx;
        const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz), lc = Math.hypot(p2.x - p0.x, p2.z - p0.z);
        if (la * lb * lc > 1e-6) worst = Math.max(worst, Math.abs(2 * cross / (la * lb * lc)));
      }
      return worst;
    });
    check('gentle-s: band curvature within turn radius', curv < 1 / 2.6, `1/R=${curv.toFixed(3)}`);
  }
  if (tc.id === 'edge-approach') {
    const worstX = Math.max(...post.bandSamples.map((_, i) => 0), // placeholder
      ...await page.evaluate(() => window.__test.bandTrace().map(p => Math.abs(p.x))));
    check('edge-approach: vehicle eases off the boards', worstX < 8.6, worstX.toFixed(2));
  }
  if (tc.id === 'short') {
    check('short: even a short stroke makes a band', post.bandLen >= 4 && post.total < 14, `${post.bandLen}, total=${post.total.toFixed(1)}`);
  }

  await page.screenshot({ path: `screenshots/gestures/${tc.id}-band.png` });
  fs.writeFileSync(`screenshots/gestures/${tc.id}-data.json`, JSON.stringify({
    stroke: tc.pts,
    processedPath: post.pts,
    band: await page.evaluate(() => window.__test.bandTrace())
  }, null, 1));

  // second stroke on the same rink must ADD resurfacing (no wipe of previous mask)
  if (tc.id === 'straight') {
    await waitPhase(page, 'skate', 60000).catch(() => {});
    await page.evaluate(() => window.__test.setTimeScale(4));
    await waitPhase(page, 'draw', 120000);
    await page.evaluate(() => window.__test.setTimeScale(1));
    const keep = await page.evaluate(() => window.__test.maskAt(0, 0));
    check('straight: previous band kept for additive strokes', keep.smooth > 0.9, JSON.stringify(keep));
    // replay reset clears the mask
    await page.evaluate(() => window.__test.reset());
    await page.waitForTimeout(400);
    const cleared = await page.evaluate(() => ({
      a: window.__test.maskAt(0, 0), b: window.__test.maskAt(0, -8)
    }));
    check('replay: mask fully re-initialized', cleared.a.smooth === 0 && cleared.b.smooth === 0, JSON.stringify(cleared));
  }

  await ctx.close();
}

// --- orientation change mid-game -------------------------------------------
{
  console.log('case: rotate-mid-drive');
  const { ctx, page } = await openGame(browser, { width: 390, height: 844, dpr: 2 });
  await skipIntro(page);
  await drawStroke(page, densify([{ x: 0, z: 10 }, { x: 3, z: 0 }, { x: 0, z: -11 }], 30), { durationMs: 1000 });
  await page.waitForTimeout(1500);
  await page.setViewportSize({ width: 844, height: 390 });   // rotate to landscape mid-drive
  await page.waitForTimeout(1200);
  const st = await page.evaluate(() => ({ phase: window.__test.phase(), v: window.__test.vehicle() }));
  check('rotate: game continues after rotation', st.phase === 'drive' && st.v.driving, JSON.stringify(st.phase));
  await page.evaluate(() => window.__test.setTimeScale(3));
  await waitDriveDone(page, 120000);
  await page.screenshot({ path: 'screenshots/gestures/rotate-mid-drive-band.png' });
  const done = await page.evaluate(() => window.__test.bandTrace().length);
  check('rotate: band completed after rotation', done > 10, `${done}`);

  // and draw the NEXT stroke in landscape (continue after rotating)
  await page.evaluate(() => window.__test.setTimeScale(4));
  await waitPhase(page, 'draw', 180000);
  await page.evaluate(() => window.__test.setTimeScale(1));
  await page.waitForTimeout(600);
  const v = await page.evaluate(() => window.__test.vehicle());
  const tgt = densify([{ x: v.x, z: v.z }, { x: -4, z: 0 }, { x: -1, z: 9 }], 26);
  await drawStroke(page, tgt, { durationMs: 900 });
  await page.waitForTimeout(400);
  const p2 = await page.evaluate(() => window.__test.phase());
  check('rotate: next stroke works in landscape', p2 === 'drive', p2);
  await ctx.close();
}

await browser.close();
fs.writeFileSync('screenshots/gestures/results.json', JSON.stringify(results, null, 1));
console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures ? 1 : 0);
