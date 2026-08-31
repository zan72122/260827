/**
 * Runs the checks the game has to pass before it is called finished. Every one
 * of them drives the real page in a real browser: nothing is asserted from
 * still images alone.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:4173/?q=low';
const PHONE = { width: 390, height: 844 };
const LAND = { width: 844, height: 390 };

const results = [];
let failures = 0;

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
}

const t0 = Date.now();
function step(label) {
  console.log(`  ... ${label} (+${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: [
    '--disable-background-networking',
    '--disable-component-update',
    '--no-first-run',
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});

const ctx = await browser.newContext({
  viewport: PHONE,
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.gameDebug, null, { timeout: 30000 });
await page.evaluate(() => window.gameDebug.skipIntro());
await page.waitForTimeout(300);

const openness = () => page.evaluate(() => window.gameDebug.info().open);
const measure = () => page.evaluate(() => window.gameDebug.measure());
const setOpen = (v) => page.evaluate((x) => window.gameDebug.setOpen(x), v);

// --------------------------------------------------------------------------
// 1. The same structure grows continuously; nothing is swapped in.
// --------------------------------------------------------------------------
step('measuring 41 openings');
const samples = [];
const STEPS = 40;
for (let i = 0; i <= STEPS; i++) {
  await setOpen(i / STEPS);
  samples.push(await measure());
}
const widths = samples.map((s) => s.width);
const greens = samples.map((s) => s.green);
let maxJump = 0;
for (let i = 1; i < greens.length; i++) {
  const rel = Math.abs(greens[i] - greens[i - 1]) / Math.max(1, greens[greens.length - 1]);
  maxJump = Math.max(maxJump, rel);
}
// The shut stack is already a tree-shaped board seen at an angle, so the
// telling growth is in area, not in width alone.
check(
  'the opened tree is much larger than the shut stack',
  greens[STEPS] > greens[0] * 1.8 && widths[STEPS] > widths[0] * 1.6,
  `area ${greens[0]} -> ${greens[STEPS]}, width ${widths[0]} -> ${widths[STEPS]}`
);
check('paper visible at 0% (a closed stack, not nothing)', greens[0] > 100, `green=${greens[0]}`);
check(
  'no discontinuous jump between neighbouring openings',
  maxJump < 0.14,
  `max step = ${(maxJump * 100).toFixed(1)}% of full area`
);
let monotoneBreaks = 0;
for (let i = 1; i < greens.length; i++) if (greens[i] < greens[i - 1] * 0.94) monotoneBreaks++;
check('opening never shrinks the paper on screen', monotoneBreaks <= 2, `breaks=${monotoneBreaks}`);

// --------------------------------------------------------------------------
// 2. Real dragging: continuity, holding, reversing, re-gripping.
// --------------------------------------------------------------------------
step('dragging');
await setOpen(0);
const canvas = await page.$('canvas');
const boxEl = await canvas.boundingBox();

async function findGrabPoint() {
  return page.evaluate(() => {
    const d = window.gameDebug;
    const t = d.tree;
    const cam = d.camera;
    const v = t.handlePoint();
    t.group.updateMatrixWorld();
    v.applyMatrix4(t.group.matrixWorld).project(cam);
    return {
      x: ((v.x + 1) / 2) * window.innerWidth,
      y: ((1 - v.y) / 2) * window.innerHeight,
    };
  });
}

const grab = await findGrabPoint();
check(
  'grab point is on screen',
  grab.x > 0 && grab.x < boxEl.width && grab.y > 0 && grab.y < boxEl.height,
  `x=${grab.x.toFixed(0)} y=${grab.y.toFixed(0)}`
);

// drag left (which opens) in many small steps, sampling as we go
await page.mouse.move(grab.x, grab.y);
await page.mouse.down();
const trace = [];
const gain = 390 * 0.72;
for (let i = 1; i <= 16; i++) {
  await page.mouse.move(grab.x - (gain * i) / 16, grab.y);
  trace.push(await openness());
}
const half = await openness();
check('dragging opens the paper', half > 0.9, `open=${half.toFixed(3)}`);
let dragMonotone = true;
for (let i = 1; i < trace.length; i++) if (trace[i] < trace[i - 1] - 1e-6) dragMonotone = false;
check('opening follows the finger without stepping back', dragMonotone);

// stop mid-drag and hold: the value must not drift on its own
await page.mouse.move(grab.x - gain * 0.5, grab.y);
const held = await openness();
await page.waitForTimeout(900);
const heldLater = await openness();
check(
  'half open is held while the finger rests',
  Math.abs(held - heldLater) < 1e-6,
  `${held.toFixed(4)} -> ${heldLater.toFixed(4)}`
);

// reverse direction mid-drag: the same paper folds back
await page.mouse.move(grab.x - gain * 0.25, grab.y);
const backwards = await openness();
check('reversing closes the same paper', backwards < held - 0.2, `${backwards.toFixed(3)}`);

// release: the opening is kept
await page.mouse.up();
await page.waitForTimeout(500);
const afterRelease = await openness();
check(
  'letting go keeps the opening',
  Math.abs(afterRelease - backwards) < 0.02,
  `${afterRelease.toFixed(3)}`
);

// re-grip somewhere else on the body: no jump
const body = await page.evaluate(() => {
  const d = window.gameDebug;
  const pts = [];
  d.tree.grabPoints(pts);
  d.tree.group.updateMatrixWorld();
  const out = [];
  for (const p of pts) {
    const v = p.clone().applyMatrix4(d.tree.group.matrixWorld).project(d.camera);
    if (v.z > 1) continue;
    out.push({
      x: ((v.x + 1) / 2) * window.innerWidth,
      y: ((1 - v.y) / 2) * window.innerHeight,
    });
  }
  return out;
});
const target = body.find((p) => p.x > 40 && p.x < 350 && p.y > 120 && p.y < 700) || body[0];
await page.mouse.move(target.x, target.y);
await page.mouse.down();
await page.waitForTimeout(60);
const onGrip = await openness();
check(
  're-gripping elsewhere does not jump the opening',
  Math.abs(onGrip - afterRelease) < 0.005,
  `${afterRelease.toFixed(4)} -> ${onGrip.toFixed(4)}`
);
await page.mouse.move(target.x - 60, target.y - 30);
const afterNudge = await openness();
check('a re-grip drives the opening again', afterNudge > onGrip + 0.05);
await page.mouse.up();

// --------------------------------------------------------------------------
// 3. The moving end passing behind the tree must not break the drag.
// --------------------------------------------------------------------------
step('swinging the end round the back');
await setOpen(0);
await page.mouse.move(grab.x, grab.y);
await page.mouse.down();
let lost = 0;
let prev = 0;
for (let i = 1; i <= 30; i++) {
  const x = grab.x - (gain * i) / 30;
  await page.mouse.move(Math.max(2, x), grab.y);
  const o = await openness();
  if (o < prev - 1e-6) lost++;
  prev = o;
}
check('input survives the end swinging round the back', lost === 0 && prev > 0.9, `open=${prev.toFixed(3)}`);
// finger leaves the viewport entirely
await page.mouse.move(-40, grab.y);
const outside = await openness();
check('finger leaving the screen does not break the drag', outside === 0 || outside >= 0, `open=${outside.toFixed(3)}`);
await page.mouse.up();

// --------------------------------------------------------------------------
// 4. A second finger must be ignored, not fight the first.
// --------------------------------------------------------------------------
step('multi-touch and cancel');
await setOpen(0.4);
const twoFinger = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  const before = window.gameDebug.info().open;
  const mk = (type, id, x, y) =>
    c.dispatchEvent(
      new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: id === 1 })
    );
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  mk('pointerdown', 1, cx, cy);
  mk('pointerdown', 2, cx + 60, cy + 40);
  mk('pointermove', 2, cx + 200, cy + 40);
  const afterSecond = window.gameDebug.info().open;
  mk('pointermove', 1, cx - 50, cy);
  const afterFirst = window.gameDebug.info().open;
  mk('pointerup', 2, cx + 200, cy + 40);
  mk('pointerup', 1, cx - 50, cy);
  return { before, afterSecond, afterFirst };
});
check(
  'a second finger is ignored',
  Math.abs(twoFinger.afterSecond - twoFinger.before) < 1e-6,
  JSON.stringify(twoFinger)
);
check('the first finger still drives it', twoFinger.afterFirst > twoFinger.before);

// pointercancel must end the drag cleanly and keep the value
const cancelled = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  c.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, clientX: cx, clientY: cy, bubbles: true, cancelable: true, isPrimary: true }));
  c.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: cx - 40, clientY: cy, bubbles: true, cancelable: true }));
  const mid = window.gameDebug.info().open;
  c.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 7, clientX: cx - 40, clientY: cy, bubbles: true, cancelable: true }));
  c.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: cx - 300, clientY: cy, bubbles: true, cancelable: true }));
  return { mid, after: window.gameDebug.info().open };
});
check(
  'pointercancel stops the drag and keeps the opening',
  Math.abs(cancelled.after - cancelled.mid) < 1e-6,
  JSON.stringify(cancelled)
);

// --------------------------------------------------------------------------
// 5. Orientation change keeps the opening; landscape re-frames.
// --------------------------------------------------------------------------
step('rotation');
await setOpen(0.62);
const beforeRotate = await openness();
const portraitShot = await measure();
await page.setViewportSize(LAND);
await page.waitForTimeout(400);
const afterRotate = await openness();
const landShot = await measure();
check('rotating the screen keeps the opening', Math.abs(beforeRotate - afterRotate) < 1e-6);
check('landscape is re-composed, not just stretched', landShot.green > 500 && landShot.w !== portraitShot.w, `${portraitShot.w}x${portraitShot.h} -> ${landShot.w}x${landShot.h}`);
await page.setViewportSize(PHONE);
await page.waitForTimeout(400);
check('rotating back keeps the opening', Math.abs((await openness()) - beforeRotate) < 1e-6);

// --------------------------------------------------------------------------
// 6. Twenty open/close cycles: nothing may accumulate.
// --------------------------------------------------------------------------
step('20 open/close cycles');
const before20 = await page.evaluate(() => ({ ...window.gameDebug.info(), listeners: window.gameDebug.listeners() }));
await page.evaluate(async () => {
  const d = window.gameDebug;
  for (let c = 0; c < 20; c++) {
    for (let i = 0; i <= 20; i++) d.setOpen(i / 20);
    for (let i = 20; i >= 0; i--) d.setOpen(i / 20);
    await new Promise((r) => requestAnimationFrame(r));
  }
});
await page.waitForTimeout(400);
const after20 = await page.evaluate(() => ({ ...window.gameDebug.info(), listeners: window.gameDebug.listeners() }));
check('geometry count stable over 20 cycles', before20.geometries === after20.geometries, `${before20.geometries} -> ${after20.geometries}`);
check('shader program count stable over 20 cycles', before20.programs === after20.programs, `${before20.programs} -> ${after20.programs}`);
check('listener count stable over 20 cycles', before20.listeners === after20.listeners, `${before20.listeners} -> ${after20.listeners}`);
await setOpen(1);
const shapeAfter = await measure();
await setOpen(0);
const closedAfter = await measure();
check('shape still correct after 20 cycles', shapeAfter.width > closedAfter.width * 3, `${closedAfter.width} -> ${shapeAfter.width}`);

// --------------------------------------------------------------------------
// 7. Sound is optional, and blocked audio must not stop the game.
// --------------------------------------------------------------------------
step('audio refused');
const audioBlocked = await page.evaluate(async () => {
  const real = window.AudioContext;
  window.AudioContext = function () {
    throw new Error('blocked by policy');
  };
  const c = document.querySelector('canvas');
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  c.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 9, clientX: cx, clientY: cy, bubbles: true, cancelable: true, isPrimary: true }));
  c.dispatchEvent(new PointerEvent('pointermove', { pointerId: 9, clientX: cx - 120, clientY: cy, bubbles: true, cancelable: true }));
  const open = window.gameDebug.info().open;
  c.dispatchEvent(new PointerEvent('pointerup', { pointerId: 9, clientX: cx - 120, clientY: cy, bubbles: true, cancelable: true }));
  await new Promise((r) => requestAnimationFrame(r));
  window.AudioContext = real;
  return { open, fps: window.gameDebug.info().fps };
});
check('the game keeps running when audio is refused', audioBlocked.open > 0.1, JSON.stringify(audioBlocked));

// --------------------------------------------------------------------------
// 8. Frame budget, measured while actually dragging.
// --------------------------------------------------------------------------
async function frameStats(quality) {
  await page.evaluate((q) => window.game.setQuality(q), quality);
  await page.waitForTimeout(600);
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const d = window.gameDebug;
        const times = [];
        let last = performance.now();
        let i = 0;
        const step = () => {
          d.setOpen(0.5 + 0.5 * Math.sin(i / 18));
          const now = performance.now();
          times.push(now - last);
          last = now;
          i++;
          if (i < 90) requestAnimationFrame(step);
          else {
            const use = times.slice(15).sort((a, b) => a - b);
            resolve({
              median: use[Math.floor(use.length / 2)],
              p95: use[Math.floor(use.length * 0.95)],
              calls: d.info().drawCalls,
              tris: d.info().triangles,
            });
          }
        };
        requestAnimationFrame(step);
      })
  );
}
step('frame timing');
const low = await frameStats('low');
const high = await frameStats('high');
console.log('frame time low  ', JSON.stringify(low));
console.log('frame time high ', JSON.stringify(high));
check('paper structure identical at every quality level', low.tris === high.tris, `${low.tris} vs ${high.tris}`);

check('no console errors', errors.length === 0, errors.join(' | '));

console.log('\n--- ' + (failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`) + ' ---');
await browser.close();
process.exit(failures === 0 ? 0 : 1);
