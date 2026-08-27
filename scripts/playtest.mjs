// Automated playtest: drives real pointer strokes through the game on
// iPhone/iPad-like viewports and checks the invariants from the spec.
// Usage: node scripts/playtest.mjs [--shots-only]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.PLAYTEST_URL || 'http://127.0.0.1:4173/';
const SHOTS = process.env.SHOT_DIR || 'shots';
mkdirSync(SHOTS, { recursive: true });

const results = [];
function report(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
}

async function newPage(browser, viewport) {
  const ctx = await browser.newContext({
    viewport,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text());
  });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__seacable, null, { timeout: 20000 });
  return { ctx, page };
}

const state = (page) => page.evaluate(() => window.__seacable.getState());
const w2s = (page, x, z) => page.evaluate(([a, b]) => window.__seacable.worldToScreen(a, b), [x, z]);

async function waitCamSettle(page) {
  // The rig is a damped spring: wait until the anchor's projected position
  // stops moving before mapping world strokes to screen pixels.
  // Software rendering can be slow, so require several consecutive stable
  // samples after a minimum elapsed time.
  await page.waitForTimeout(3000);
  let prev = null, stable = 0;
  for (let i = 0; i < 80; i++) {
    const s = await state(page);
    const p = await w2s(page, s.anchorA[0], s.anchorA[1]);
    if (prev && Math.abs(p.x - prev.x) < 0.5 && Math.abs(p.y - prev.y) < 0.5) {
      if (++stable >= 4) return;
    } else {
      stable = 0;
    }
    prev = p;
    await page.waitForTimeout(400);
  }
}

async function skipOpening(page) {
  await page.mouse.click(30, 30);
  await page.waitForFunction(() => window.__seacable.getState().phase === 'planning', null, { timeout: 10000 });
  await waitCamSettle(page);
}

/** Build a world-space stroke A->B with a lateral bulge profile, draw it with the mouse. */
async function drawRoute(page, profile, opts = {}) {
  const st = await state(page);
  const [ax, az] = st.anchorA;
  const [bx, bz] = st.anchorB;
  const n = opts.steps ?? 46;
  const pts = [];
  const endT = opts.endT ?? 1;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * endT;
    const x = ax + (bx - ax) * t;
    let z = az + (bz - az) * t + profile(t);
    if (opts.jitter) z += (Math.random() - 0.5) * opts.jitter;
    pts.push([x, z]);
  }
  const screen = [];
  for (const [x, z] of pts) screen.push(await w2s(page, x, z));
  await page.mouse.move(screen[0].x, screen[0].y);
  await page.mouse.down();
  for (const s of screen.slice(1)) {
    await page.mouse.move(s.x, s.y, { steps: 2 });
    await page.waitForTimeout(8);
  }
  await page.mouse.up();
}

function maxTurnAngle(route) {
  let worst = 0;
  for (let i = 1; i < route.length - 1; i++) {
    const ax = route[i][0] - route[i - 1][0], az = route[i][1] - route[i - 1][1];
    const bx = route[i + 1][0] - route[i][0], bz = route[i + 1][1] - route[i][1];
    const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
    if (la < 1e-6 || lb < 1e-6) continue;
    const turn = Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz));
    worst = Math.max(worst, turn / ((la + lb) / 2)); // rad per metre
  }
  return worst;
}

async function runLayToEnd(page, tag, screenshotQs = []) {
  await page.evaluate(() => window.__seacable.setTimeScale(4));
  let maxGap = 0, everLaying = false, probeReset = false;
  let maxMs = 0, avgMs = 1;
  const t0 = Date.now();
  const shotsTaken = new Set();
  while (Date.now() - t0 < 90000) {
    const s = await state(page);
    if (s.phase === 'laying') {
      if (!probeReset) {
        probeReset = true;
        await page.evaluate(() => window.__seacable.resetFrameProbe());
        await page.waitForTimeout(300);
        continue;
      }
      maxMs = Math.max(maxMs, s.maxFrameMs);
      avgMs = Math.max(avgMs, s.avgFrameMs);
      everLaying = true;
      maxGap = Math.max(maxGap, s.cableGap);
      const q = s.routeLength ? s.touchdownS / s.routeLength : 0;
      for (const target of screenshotQs) {
        const key = `${tag}-q${target}`;
        if (!shotsTaken.has(key) && q >= target) {
          shotsTaken.add(key);
          await page.screenshot({ path: `${SHOTS}/${key}.png` });
        }
      }
    }
    if (s.phase === 'result') return { maxGap, everLaying, maxMs, avgMs, state: s };
    if (s.phase === 'arrival' && screenshotQs.length && !shotsTaken.has(`${tag}-arrival`)) {
      shotsTaken.add(`${tag}-arrival`);
      await page.screenshot({ path: `${SHOTS}/${tag}-arrival.png` });
    }
    await page.waitForTimeout(400);
  }
  return { maxGap, everLaying, maxMs, avgMs, state: await state(page), timeout: true };
}

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader']
});

// ---------- Scenario 1: portrait iPhone, straight route, full visual pass ----
{
  const { ctx, page } = await newPage(browser, { width: 390, height: 844 });
  await page.screenshot({ path: `${SHOTS}/opening-deck.png` });
  await page.waitForTimeout(5500);
  await page.screenshot({ path: `${SHOTS}/opening-deck2.png` });
  await skipOpening(page);
  await page.screenshot({ path: `${SHOTS}/planning-portrait.png` });

  await drawRoute(page, () => 0);
  const s1 = await state(page);
  report('straight: laying starts', s1.phase === 'laying', `phase=${s1.phase}`);
  const lay = await runLayToEnd(page, 'straight', [0.12, 0.3, 0.45, 0.62, 0.85]);
  report('straight: reaches result', lay.state.phase === 'result', `phase=${lay.state.phase}`);
  report('straight: cable continuous stern->seabed', lay.maxGap < 0.5, `maxGap=${lay.maxGap.toFixed(3)}m`);
  // Software rendering is slow in absolute terms; a *stall* is a spike far
  // above the average frame cost of the same run.
  const hitchRatio = lay.maxMs / Math.max(1, lay.avgMs);
  report('straight: no frame stall through water transition',
    lay.maxMs < 250 || hitchRatio < 8,
    `max=${lay.maxMs.toFixed(1)}ms avg=${lay.avgMs.toFixed(1)}ms ratio=${hitchRatio.toFixed(1)}`);
  await page.screenshot({ path: `${SHOTS}/result-portrait.png` });
  await ctx.close();
}

// ---------- Scenario 2: landscape iPad, big LEFT detour ----------------------
{
  const { ctx, page } = await newPage(browser, { width: 1180, height: 820 });
  await skipOpening(page);
  await page.screenshot({ path: `${SHOTS}/planning-landscape.png` });
  await drawRoute(page, (t) => Math.sin(t * Math.PI) * -34);
  const s = await state(page);
  report('left detour: accepted', s.phase === 'laying', `phase=${s.phase}`);
  const minZ = Math.min(...s.playerRoute.map((p) => p[1]));
  report('left detour: detour preserved (not shortest path)', minZ < -20, `minZ=${minZ.toFixed(1)}`);
  const turn = maxTurnAngle(s.playerRoute);
  report('left detour: no sharp kinks', turn < 1 / 7, `maxTurn=${turn.toFixed(3)} rad/m`);
  const lay = await runLayToEnd(page, 'left', [0.5]);
  report('left detour: completes', lay.state.phase === 'result', `phase=${lay.state.phase}`);
  await page.screenshot({ path: `${SHOTS}/result-landscape.png` });
  await ctx.close();
}

// ---------- Scenario 3: RIGHT detour + rotation mid-lay ----------------------
{
  const { ctx, page } = await newPage(browser, { width: 390, height: 844 });
  await skipOpening(page);
  await drawRoute(page, (t) => Math.sin(t * Math.PI) * 30);
  let s = await state(page);
  report('right detour: accepted', s.phase === 'laying', `phase=${s.phase}`);
  const maxZ = Math.max(...s.playerRoute.map((p) => p[1]));
  report('right detour: detour preserved', maxZ > 18, `maxZ=${maxZ.toFixed(1)}`);
  const routeLenBefore = s.routeLength;
  // Rotate the device mid-lay.
  await page.waitForTimeout(1500);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(800);
  s = await state(page);
  report('rotation keeps route & progress', s.phase === 'laying' && Math.abs(s.routeLength - routeLenBefore) < 0.01,
    `phase=${s.phase} len=${s.routeLength.toFixed(1)} vs ${routeLenBefore.toFixed(1)}`);
  const lay = await runLayToEnd(page, 'right', []);
  report('right detour: completes after rotation', lay.state.phase === 'result', `phase=${lay.state.phase}`);
  await ctx.close();
}

// ---------- Scenario 4: gentle S-curve ---------------------------------------
{
  const { ctx, page } = await newPage(browser, { width: 390, height: 844 });
  await skipOpening(page);
  await drawRoute(page, (t) => Math.sin(t * Math.PI * 2) * 22);
  const s = await state(page);
  report('S-curve: accepted', s.phase === 'laying', `phase=${s.phase}`);
  const zs = s.playerRoute.map((p) => p[1]);
  report('S-curve: both lobes preserved', Math.min(...zs) < -10 && Math.max(...zs) > 10,
    `z range ${Math.min(...zs).toFixed(1)}..${Math.max(...zs).toFixed(1)}`);
  const lay = await runLayToEnd(page, 's', []);
  report('S-curve: completes', lay.state.phase === 'result', `phase=${lay.state.phase}`);
  await ctx.close();
}

// ---------- Scenario 5: short/incomplete stroke ------------------------------
{
  const { ctx, page } = await newPage(browser, { width: 390, height: 844 });
  await skipOpening(page);
  await drawRoute(page, () => 0, { endT: 0.4 });
  await page.waitForTimeout(600);
  const s = await state(page);
  report('short stroke: no punishment, back to planning', s.phase === 'planning', `phase=${s.phase}`);
  await page.screenshot({ path: `${SHOTS}/incomplete-feedback.png` });
  // ...and an immediate retry works:
  await drawRoute(page, () => 0);
  const s2 = await state(page);
  report('short stroke: instant retry works', s2.phase === 'laying', `phase=${s2.phase}`);
  await ctx.close();
}

// ---------- Scenario 6: jittery stroke ---------------------------------------
{
  const { ctx, page } = await newPage(browser, { width: 390, height: 844 });
  await skipOpening(page);
  await drawRoute(page, () => 0, { jitter: 6, steps: 80 });
  const s = await state(page);
  report('jitter: accepted', s.phase === 'laying', `phase=${s.phase}`);
  const turn = maxTurnAngle(s.playerRoute);
  report('jitter: smoothed below min bend radius', turn < 1 / 7, `maxTurn=${turn.toFixed(3)} rad/m`);
  await ctx.close();
}

// ---------- Scenario 7: near-rock route + replay -----------------------------
{
  const { ctx, page } = await newPage(browser, { width: 1180, height: 820 });
  await skipOpening(page);
  // Hug the top edge where rock patches often are; must still lay (surface
  // lay over rock, no failure).
  await drawRoute(page, (t) => Math.sin(t * Math.PI) * 42);
  const s = await state(page);
  report('near-rock: still accepted (guidance not failure)', s.phase === 'laying', `phase=${s.phase}`);
  const lay = await runLayToEnd(page, 'rock', [0.5]);
  report('near-rock: completes', lay.state.phase === 'result', `phase=${lay.state.phase}`);
  // Replay: press the replay button (bottom center-ish) via DOM.
  await page.evaluate(() => document.querySelector('.sc-replay')?.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true })));
  await page.waitForTimeout(1500);
  const s2 = await state(page);
  report('replay: back to planning with new seed', s2.phase === 'planning' && s2.playCount === 1,
    `phase=${s2.phase} playCount=${s2.playCount}`);
  await page.screenshot({ path: `${SHOTS}/replay-planning.png` });
  await ctx.close();
}

await browser.close();
const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} checks passed`);
process.exit(fails.length ? 1 : 0);
