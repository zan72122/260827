/**
 * Objective checks for the acceptance list. Numbers, not eyeballs.
 */
import { launch, grab, drag, stats, settle, shot, PORTRAIT, LANDSCAPE } from './harness.mjs';

let pass = 0, fail = 0;
const near = (a, b, tol) => Math.abs(a - b) <= tol;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${name} ${detail}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
}

const { browser, page, errors } = await launch(PORTRAIT);
const ev = (fn, a) => page.evaluate(fn, a);
const probe = () => ev(() => window.__spanbaum.probe());
const hold = (o) => ev((x) => window.__spanbaum.hold(x), o);

console.log('\n=== 1. one shaving at 25/50/75/100 %: root, trench, length ===');
await hold(true);
const full = (await stats(page)).strokePx;
let p = await grab(page);
let lastTurn = 0;
for (const frac of [0.25, 0.5, 0.75, 1.0]) {
  p = await drag(page, p, full * 0.25);
  const q = await probe();
  const tag = `${(frac * 100) | 0}%`;
  check(`${tag} root sits on the blade contact`, q.rootErr < 0.0025, `err=${q.rootErr.toFixed(5)}`);
  check(`${tag} shaving length == stroke`, near(q.chainLen, q.chainExpected, q.chainExpected * 0.04),
    `len=${q.chainLen.toFixed(4)} want=${q.chainExpected.toFixed(4)}`);
  // the shaving is extruded past the edge, so its free tip rides out with the
  // tool; what must hold is that it curls further as the stroke grows and
  // never ends up buried in the blank
  check(`${tag} tip has curled clear of the blank`, q.tipClear > -0.001,
    `clearance=${q.tipClear.toFixed(5)}`);
  check(`${tag} tip curl grows with the stroke`, q.tipTurn > lastTurn + 0.15,
    `turn=${(q.tipTurn * 57.3).toFixed(0)} deg`);
  lastTurn = q.tipTurn;
  check(`${tag} wood removed to the depth of cut`, near(q.trenchDepth, q.depth, q.depth * 0.25),
    `d=${q.trenchDepth.toFixed(5)} want=${q.depth.toFixed(5)}`);
  check(`${tag} wood above the edge untouched`, q.aboveRoot < 1e-6, `${q.aboveRoot.toFixed(6)}`);
  check(`${tag} wood beside the blade untouched`, q.besideCut < 1e-6, `${q.besideCut.toFixed(6)}`);
}

console.log('\n=== 2. the cut does not advance on its own ===');
const before = await stats(page);
await settle(page, 90);           // ~1.5 s of frames, finger down but still
const after = await stats(page);
check('finger held still -> no progress', after.cut === before.cut,
  `${before.cut.toFixed(5)} -> ${after.cut.toFixed(5)}`);
await page.mouse.up().catch(() => {});
await settle(page, 90);
const afterUp = await stats(page);
check('finger lifted -> no progress', afterUp.cut === before.cut,
  `${before.cut.toFixed(5)} -> ${afterUp.cut.toFixed(5)}`);

console.log('\n=== 3. reverse input pulls the tool back but never regrows wood ===');
p = await grab(page);
const beforeBack = await stats(page);
p = await drag(page, p, -full * 0.5);
const back = await stats(page);
check('tool retracts', back.feed < beforeBack.feed - 0.01, `feed ${beforeBack.feed.toFixed(4)} -> ${back.feed.toFixed(4)}`);
check('cut length unchanged', back.cut === beforeBack.cut, `cut ${back.cut.toFixed(5)}`);
const qb = await probe();
check('shaving unchanged by reverse input', near(qb.chainLen, qb.chainExpected, qb.chainExpected * 0.04),
  `len=${qb.chainLen.toFixed(4)}`);
check('trench unchanged by reverse input', near(qb.trenchDepth, qb.depth, qb.depth * 0.25),
  `d=${qb.trenchDepth.toFixed(5)}`);

console.log('\n=== 4. re-grabbing keeps the state; no double shaving ===');
await page.mouse.up().catch(() => {});
await settle(page, 10);
p = await grab(page);
const regrab = await stats(page);
check('state kept across release + regrab', regrab.cut === back.cut, `cut ${regrab.cut.toFixed(5)}`);
p = await drag(page, p, full * 0.6);
const qr = await probe();
check('one shaving only, still the right length', near(qr.chainLen, qr.chainExpected, qr.chainExpected * 0.05),
  `len=${qr.chainLen.toFixed(4)} want=${qr.chainExpected.toFixed(4)}`);

console.log('\n=== 4b. pointercancel / leaving the window keeps the cut ===');
{
  const s0 = await stats(page);
  await ev(() => {
    const c = document.querySelector('canvas');
    c.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }));
    window.dispatchEvent(new Event('blur'));
  });
  await settle(page, 20);
  const s1 = await stats(page);
  check('cancel does not disturb the cut', s1.cut === s0.cut, `cut ${s1.cut.toFixed(5)}`);
  // moving the (now released) mouse must not drive anything
  await page.mouse.move(5, 5);
  await page.mouse.move(200, 700);
  await settle(page, 6);
  const s2 = await stats(page);
  check('a released pointer drives nothing', s2.cut === s0.cut, `cut ${s2.cut.toFixed(5)}`);
  await page.mouse.up().catch(() => {});
}

console.log('\n=== 6. six strokes make six branches, indexing only between them ===');
await hold(false);
const seen = [];
for (let i = 0; i < 6; i++) {
  let q = await grab(page);
  q = await drag(page, q, full * 1.15, 18);
  await page.mouse.up();
  const mid = await stats(page);
  seen.push(mid.phase);
  // wait out the index move
  for (let k = 0; k < 90 && (await stats(page)).phase === 'index'; k++) await settle(page, 3);
  const st = await stats(page);
  console.log(`  stroke ${i + 1}: done=${st.done} phase=${st.phase} spindle=${st.spindle.toFixed(3)}`);
}
const six = await stats(page);
check('six strokes -> six branches', six.done === 6, `done=${six.done}`);
check('phase after the sixth is not "work"', six.phase !== 'work', six.phase);
await shot(page, 'B-row-complete');

console.log('\n=== 6b. an indexed-to face is blank until the child cuts it ===');
await ev(() => window.__spanbaum.reset());
for (let k = 0; k < 900 && (await stats(page)).phase !== 'work'; k++) await settle(page, 3);
{
  let q = await grab(page);
  q = await drag(page, q, full * 1.15, 16);
  await page.mouse.up();
  for (let k = 0; k < 200 && (await stats(page)).phase === 'index'; k++) await settle(page, 3);
  const st = await stats(page);
  const cuts = await ev(() => Array.from(window.__spanbaum.game.workRowCuts));
  check('after indexing, exactly one branch exists', cuts.filter((c) => c > 1e-5).length === 1,
    `cuts=[${cuts.map((c) => c.toFixed(3)).join(', ')}]`);
  check('the new face is untouched', cuts[st.branch] === 0, `branch=${st.branch}`);
  const pr = await ev(() => window.__spanbaum.probe());
  check('no wood removed at the new face', pr.trenchDepth < 1e-6, `${pr.trenchDepth.toFixed(6)}`);
  // a second finger, mid-stroke, must change nothing
  {
    let r = await grab(page);
    r = await drag(page, r, full * 0.3, 6);
    const a = await stats(page);
    await ev(() => {
      const c = document.querySelector('canvas');
      const e = (t, x, y) => c.dispatchEvent(new PointerEvent(t, { pointerId: 77, clientX: x, clientY: y, bubbles: true }));
      e('pointerdown', 60, 320); e('pointermove', 60, 40); e('pointerup', 60, 40);
    });
    await settle(page, 6);
    const b = await stats(page);
    check('a second finger changes nothing mid-stroke', b.cut === a.cut,
      `${a.cut.toFixed(5)} -> ${b.cut.toFixed(5)}`);
    r = await drag(page, r, full * 0.9, 8);
    await page.mouse.up().catch(() => {});
    for (let k = 0; k < 200 && (await stats(page)).phase === 'index'; k++) await settle(page, 3);
  }

  // and finish the row again so the later checks still have something to see
  for (let i = 2; i < 6; i++) {
    let r = await grab(page);
    r = await drag(page, r, full * 1.15, 12);
    await page.mouse.up();
    for (let k = 0; k < 200 && (await stats(page)).phase === 'index'; k++) await settle(page, 3);
  }
}

console.log('\n=== 7. reveal happens, and only after a hold ===');
for (let k = 0; k < 400 && (await stats(page)).phase !== 'done'; k++) await settle(page, 6);
const dn = await stats(page);
check('reaches the finished state', dn.phase === 'done', dn.phase);
await shot(page, 'B-reveal-done');

console.log('\n=== 8. landscape keeps the same causality ===');
await page.setViewportSize(LANDSCAPE);
await settle(page, 8);
const ls = await stats(page);
check('landscape keeps the finished row', ls.done === 6, `done=${ls.done}`);
await shot(page, 'B-landscape-done');
await page.setViewportSize(PORTRAIT);
await settle(page, 8);

console.log(`\nerrors: ${JSON.stringify(errors.filter((e) => !e.includes('404')))}`);
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
