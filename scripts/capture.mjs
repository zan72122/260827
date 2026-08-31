/**
 * Drive the whole piece with real pointer events at each target viewport and
 * keep the screen evidence.
 *
 * Nothing here reaches into the game to move it along: every step is a press,
 * a drag and a release on the canvas, the same events a finger produces, so a
 * capture that succeeds is also a statement that the input path works.
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = 'docs/evidence';
const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844 },
  { name: '844x390', width: 844, height: 390 },
  { name: '820x1180', width: 820, height: 1180 },
  { name: '1180x820', width: 1180, height: 820 },
];

mkdirSync(OUT, { recursive: true });

const server = await createServer({ server: { port: 5177 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

const log = [];

async function state(page) {
  return page.evaluate(() => window.game.debug());
}

/** A press-drag-release made of real pointer events. */
async function drag(page, from, to, steps = 26, holdMs = 24) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
    await page.waitForTimeout(holdMs);
  }
  await page.mouse.up();
}

async function tap(page, at) {
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.up();
}

/** Screen position of a named grab target, in CSS pixels. */
async function spot(page, name) {
  return page.evaluate((n) => window.game.spotOf(n), name);
}

async function settle(page, ms = 900) {
  await page.waitForTimeout(ms);
}

async function play(page, tag, opts = {}) {
  const shots = opts.shots ?? [];
  const shot = async (label) => {
    if (!shots.length || shots.includes(label)) {
      await page.screenshot({ path: `${OUT}/${tag}-${label}.png` });
    }
    log.push({ tag, label, ...(await state(page)) });
  };

  await page.waitForTimeout(1600);
  await shot('1-before-balance');

  // 1. slide the counterweight until the head hangs level. The stopping rule
  // is the one a child has: the head has stopped leaning, so let go.
  for (let i = 0; i < 20; i++) {
    const st = await state(page);
    if (st.stage !== 'balance') break;
    if (Math.abs(st.restPitchDeg) < 3.5) break;
    const s = await spot(page, 'grip');
    const push = Math.max(6, Math.min(26, Math.abs(st.restPitchDeg) * 1.1));
    const dir = st.restPitchDeg > 0 ? 1 : -1;
    await drag(page, { x: s.x, y: s.y }, { x: s.x + s.ax * push * dir, y: s.y + s.ay * push * dir }, 5, 16);
    await page.waitForTimeout(240);
  }
  await settle(page, 1400);
  await shot('2-balanced');

  // 2. carry the head into the opening, along the route.
  // The route is longer in screen pixels on a wide screen than on a narrow
  // one, so the pull is generous and the loop simply repeats until the head is
  // seated rather than assuming a fixed number of strokes.
  for (let i = 0; i < 24; i++) {
    const st = await state(page);
    if (st.stage !== 'insert') break;
    const s = await spot(page, 'head');
    await drag(page, { x: s.x, y: s.y }, { x: s.x + s.ax * 140, y: s.y + s.ay * 140 }, 14, 14);
    await page.waitForTimeout(200);
  }
  await settle(page, 900);
  await shot('3-seated');

  // 3. pull the thread in: the head lifts off the rest, the rim opens up
  for (let i = 0; i < 12; i++) {
    const st = await state(page);
    if (st.stage !== 'thread' || st.lift > 4.4) break;
    const s = await spot(page, 'toggle');
    await drag(page, { x: s.x, y: s.y }, { x: s.x + s.ax * 40, y: s.y + s.ay * 40 }, 8, 18);
    await page.waitForTimeout(200);
  }
  await shot('4-lifted');

  // 4. one short action to knot the length that was chosen
  for (let i = 0; i < 8; i++) {
    const st = await state(page);
    if (st.stage !== 'thread') break;
    const s = await spot(page, 'tie');
    await tap(page, { x: s.x, y: s.y });
    await page.waitForTimeout(320);
  }
  await settle(page, 2600);
  await shot('5-tied');

  // 5. press the head and let it go
  const h = await spot(page, 'head');
  await tap(page, { x: h.x, y: h.y });
  await page.waitForTimeout(200);
  await shot('6-first-nod');
  await settle(page, 3200);
  await shot('7-finished');

  // 6. touch it again -- a small touch gives a small nod
  const h2 = await spot(page, 'head');
  await tap(page, { x: h2.x, y: h2.y });
  await page.waitForTimeout(180);
  const smallPeak = await peakOf(page, 1.6);
  await shot('8-touch-again');

  // 7. and a firm push gives a bigger one, from the same mechanism
  await settle(page, 2400);
  const h3 = await spot(page, 'head');
  await drag(page, { x: h3.x, y: h3.y }, { x: h3.x, y: h3.y + 96 }, 12, 14);
  await page.waitForTimeout(160);
  const bigPeak = await peakOf(page, 1.6);
  await shot('9-firm-push');
  log.push({ tag, label: 'nod-peaks', ...(await state(page)), smallPeak, bigPeak });
}

/** Largest departure from the resting posture over the next `secs`. */
async function peakOf(page, secs) {
  const end = Date.now() + secs * 1000;
  let peak = 0;
  while (Date.now() < end) {
    const s = await state(page);
    peak = Math.max(peak, Math.abs(s.pitchDeg - s.restPitchDeg));
    await page.waitForTimeout(45);
  }
  return peak;
}

for (const vp of VIEWPORTS) {
  const page = await browser.newPage({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    hasTouch: true,
  });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:5177/', { waitUntil: 'networkidle' });
  await play(page, vp.name);
  if (errs.length) console.log(`!! ${vp.name}`, errs);
  await page.close();
}

// rotation and a cancelled gesture, mid-flow
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  await page.goto('http://localhost:5177/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  // a second finger arriving mid-drag must be ignored, not fought over
  {
    const g = await spot(page, 'grip');
    const before = (await state(page)).weightT;
    await page.mouse.move(g.x, g.y);
    await page.mouse.down();
    await page.mouse.move(g.x + g.ax * 14, g.y + g.ay * 14);
    const mid = (await state(page)).weightT;
    await page.evaluate(() => {
      const c = document.querySelector('#app canvas');
      const at = { bubbles: true, pointerId: 77, pointerType: 'touch', clientX: 20, clientY: 20 };
      c.dispatchEvent(new PointerEvent('pointerdown', at));
      c.dispatchEvent(new PointerEvent('pointermove', { ...at, clientX: 300, clientY: 700 }));
      c.dispatchEvent(new PointerEvent('pointerup', { ...at, clientX: 300, clientY: 700 }));
    });
    const afterSecond = (await state(page)).weightT;
    await page.mouse.move(g.x + g.ax * 28, g.y + g.ay * 28);
    await page.mouse.up();
    const afterFirst = (await state(page)).weightT;
    log.push({
      tag: 'resilience',
      label: 'second-finger',
      ...(await state(page)),
      movedByFirst: Math.abs(mid - before) > 0.01,
      movedBySecond: Math.abs(afterSecond - mid) > 0.001,
      firstStillInControl: Math.abs(afterFirst - afterSecond) > 0.01,
    });
  }

  // start a drag, then cancel it outright
  const s = await spot(page, 'grip');
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.move(s.x + 30, s.y + 10);
  await page.evaluate(() => {
    document.querySelector('#app canvas').dispatchEvent(
      new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }),
    );
  });
  await page.mouse.up().catch(() => {});
  await page.waitForTimeout(400);
  const afterCancel = await state(page);
  // rotate mid-flow and keep going
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(800);
  const afterRotate = await state(page);
  log.push({ tag: 'resilience', label: 'after-cancel', ...afterCancel });
  log.push({ tag: 'resilience', label: 'after-rotate', ...afterRotate });

  // carry on from where the rotation left it, and rotate again mid-thread
  for (let i = 0; i < 20; i++) {
    const st = await state(page);
    if (st.stage !== 'balance' || Math.abs(st.restPitchDeg) < 3.5) break;
    const g = await spot(page, 'grip');
    const push = Math.max(6, Math.min(26, Math.abs(st.restPitchDeg) * 1.1));
    const dir = st.restPitchDeg > 0 ? 1 : -1;
    await drag(page, { x: g.x, y: g.y }, { x: g.x + g.ax * push * dir, y: g.y + g.ay * push * dir }, 5, 16);
    await page.waitForTimeout(240);
  }
  await settle(page, 1400);
  for (let i = 0; i < 24; i++) {
    const st = await state(page);
    if (st.stage !== 'insert') break;
    const s = await spot(page, 'head');
    await drag(page, { x: s.x, y: s.y }, { x: s.x + s.ax * 140, y: s.y + s.ay * 140 }, 14, 14);
    await page.waitForTimeout(200);
  }
  await settle(page, 700);
  await page.setViewportSize({ width: 820, height: 1180 }); // rotate mid-thread
  await page.waitForTimeout(900);
  log.push({ tag: 'resilience', label: 'rotated-mid-thread', ...(await state(page)) });
  await page.screenshot({ path: `${OUT}/rotate-midflow.png` });
  for (let i = 0; i < 24; i++) {
    const st = await state(page);
    if (st.stage !== 'thread' || st.lift > 4.4) break;
    const s = await spot(page, 'toggle');
    await drag(page, { x: s.x, y: s.y }, { x: s.x + s.ax * 120, y: s.y + s.ay * 120 }, 14, 16);
    await page.waitForTimeout(240);
  }
  for (let i = 0; i < 14; i++) {
    const st = await state(page);
    if (st.stage !== 'thread') break;
    const s = await spot(page, 'tie');
    await tap(page, { x: s.x, y: s.y });
    await page.waitForTimeout(320);
  }
  await settle(page, 2600);
  // A child taps until something happens; so does this.
  for (let i = 0; i < 4; i++) {
    const st = await state(page);
    if (st.stage === 'play') break;
    const h = await spot(page, 'head');
    if (i === 0) console.log('resilience head target at', JSON.stringify(h));
    await tap(page, { x: h.x, y: h.y });
    await settle(page, 3200);
  }
  log.push({ tag: 'resilience', label: 'finished-after-rotations', ...(await state(page)) });
  await page.screenshot({ path: `${OUT}/resilience-finished.png` });
  await page.close();
}

await browser.close();
await server.close();
writeFileSync(`${OUT}/capture-log.json`, JSON.stringify(log, null, 1));
const bad = log.filter(
  (r) =>
    (r.label === '7-finished' && r.stage !== 'play') ||
    (r.label === 'finished-after-rotations' && r.stage !== 'play') ||
    (r.label === 'nod-peaks' && !(r.bigPeak > r.smallPeak * 1.6)) ||
    (r.label === 'second-finger' &&
      !(r.movedByFirst && !r.movedBySecond && r.firstStillInControl)),
);
for (const r of log) {
  console.log(
    `${r.tag.padEnd(10)} ${r.label.padEnd(18)} ${r.stage.padEnd(9)} wT=${r.weightT.toFixed(2)} ` +
      `rest=${r.restPitchDeg.toFixed(1)} pitch=${r.pitchDeg.toFixed(1)} gap=${r.rimGap.toFixed(1)} ` +
      `lift=${r.lift.toFixed(1)} s=${r.insertS.toFixed(2)} tri=${r.triangles} dc=${r.drawCalls}` +
      (r.smallPeak === undefined ? '' : ` smallNod=${r.smallPeak.toFixed(1)} firmNod=${r.bigPeak.toFixed(1)}`) +
      (r.movedByFirst === undefined
        ? ''
        : ` first=${r.movedByFirst} second=${r.movedBySecond} stillFirst=${r.firstStillInControl}`),
  );
}
if (bad.length) {
  console.error('did not reach the finished doll at:', bad.map((b) => b.tag).join(', '));
  process.exitCode = 1;
}
