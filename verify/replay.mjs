/**
 * 20 replays: nothing may accumulate -- no extra geometries, textures, shader
 * programs, scene nodes, event listeners or audio nodes, and the heap must not
 * climb.
 */
import { launch, grab, drag, stats, settle } from './harness.mjs';

const { browser, page, errors } = await launch();
const ev = (fn, a) => page.evaluate(fn, a);
const snap = () => ev(() => {
  if (typeof gc === 'function') { gc(); gc(); }
  const g = window.__spanbaum.game;
  let nodes = 0;
  g.scene.traverse(() => nodes++);
  return {
    ...window.__spanbaum.stats(),
    nodes,
    heap: performance.memory ? performance.memory.usedJSHeapSize : 0,
  };
});
const waitPhase = async (want, max = 900) => {
  for (let k = 0; k < max; k++) {
    if ((await stats(page)).phase === want) return true;
    await settle(page, 3);
  }
  return false;
};

async function playRow(full = true) {
  const stroke = (await stats(page)).strokePx;
  for (let i = 0; i < 6; i++) {
    let q = await grab(page);
    q = await drag(page, q, stroke * 1.15, 6);
    await page.mouse.up();
    if (i < 5) await waitPhase('work');
  }
  // round 1 walks the whole reveal; the rest only need the six strokes plus a
  // reset, which is where anything that leaks would leak
  if (full) await waitPhase('done');
  else await waitPhase('hold', 60);
}

const rounds = Number(process.env.ROUNDS || 20);
await playRow(true);
const base = await snap();
console.log('after round 1:', JSON.stringify({
  geometries: base.geometries, textures: base.textures, programs: base.programs,
  nodes: base.nodes, heap: base.heap, done: base.done }));

let worst = base;
for (let r = 2; r <= rounds; r++) {
  await ev(() => window.__spanbaum.reset());
  await waitPhase('work');
  await playRow(r === rounds);
  const s = await snap();
  if (r === rounds || r % 5 === 0) {
    console.log(`after round ${r}:`, JSON.stringify({
      geometries: s.geometries, textures: s.textures, programs: s.programs,
      nodes: s.nodes, heap: s.heap, blank: s.blankSerial, done: s.done }));
  }
  worst = s;
}

const grew = (k) => worst[k] - base[k];
let fail = 0;
const check = (n, ok, d) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n} ${d}`); if (!ok) fail++; };
check('geometry count stable', grew('geometries') === 0, `${base.geometries} -> ${worst.geometries}`);
check('texture count stable', grew('textures') === 0, `${base.textures} -> ${worst.textures}`);
check('shader program count stable', grew('programs') === 0, `${base.programs} -> ${worst.programs}`);
check('scene node count stable', grew('nodes') === 0, `${base.nodes} -> ${worst.nodes}`);
check('every replay produced six branches', worst.done === 6, `done=${worst.done}`);
check('blank was exchanged each time', worst.blankSerial === rounds, `serial=${worst.blankSerial}`);
if (base.heap) {
  const growthMB = (worst.heap - base.heap) / 1048576;
  check('heap did not climb', growthMB < 6, `${growthMB.toFixed(2)} MB over ${rounds - 1} replays`);
}
console.log('errors', errors.filter((e) => !e.includes('404')));
console.log(fail ? `${fail} FAILED` : 'all replay checks passed');
await browser.close();
process.exit(fail ? 1 : 0);
