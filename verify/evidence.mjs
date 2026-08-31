/** Produces the images used as evidence, in both orientations. */
import { launch, grab, drag, shot, stats, settle, PORTRAIT, LANDSCAPE } from './harness.mjs';

const view = process.argv.includes('--landscape') ? LANDSCAPE : PORTRAIT;
const tag = view === LANDSCAPE ? 'L' : 'P';
const { browser, page, errors } = await launch(view);
const ev = (fn, a) => page.evaluate(fn, a);
const hold = (o) => ev((x) => window.__spanbaum.hold(x), o);
const focus = (a, d, e) => ev(([x, y, z]) => window.__spanbaum.focus(x, y, z), [a, d, e]);
const restore = () => ev(() => window.__spanbaum.restoreCamera());

await shot(page, `${tag}0-start`);
await hold(true);
const full = (await stats(page)).strokePx;
let p = await grab(page);
for (const frac of [25, 50, 75, 100]) {
  p = await drag(page, p, full * 0.25);
  await shot(page, `${tag}1-cut-${frac}`);
  if (frac === 50 || frac === 100) {
    await focus(1.45, 0.40, 0.14); await shot(page, `${tag}2-curl-${frac}-side`);
    await focus(-1.45, 0.40, 0.14); await shot(page, `${tag}2-curl-${frac}-back`);
    await restore();
  }
}
await page.mouse.up();
await hold(false);
await settle(page, 4);
// let the first index finish, then cut the remaining five
for (let k = 0; k < 120 && (await stats(page)).phase !== 'work'; k++) await settle(page, 3);
await shot(page, `${tag}3-after-index`);
for (let i = 1; i < 6; i++) {
  let q = await grab(page);
  q = await drag(page, q, full * 1.15, 16);
  await page.mouse.up();
  for (let k = 0; k < 120 && (await stats(page)).phase === 'index'; k++) await settle(page, 3);
}
await shot(page, `${tag}4-row-complete`);
for (let k = 0; k < 500 && (await stats(page)).phase !== 'done'; k++) await settle(page, 6);
await shot(page, `${tag}5-done`);

// the reset is an exchange: the finished blank leaves, a new unfinished one
// arrives. Catch it mid-swap.
await ev(() => window.__spanbaum.reset());
await settle(page, 14);
await shot(page, `${tag}6-swap`);
for (let k = 0; k < 300 && (await stats(page)).phase !== 'work'; k++) await settle(page, 3);
await shot(page, `${tag}7-new-blank`);

// where a real fingertip sits relative to the blade and the start of the curl
{
  let q = await grab(page);
  q = await drag(page, q, (await stats(page)).strokePx * 0.55, 10);
  const s2 = await stats(page);
  await ev(([ax, ay, cx, cy]) => {
    const d = document.createElement('div');
    d.id = 'fingermark';
    d.style.cssText = `position:fixed;left:0;top:0;pointer-events:none;z-index:9;
      width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;
      background:rgba(255,120,120,.34);border:2px solid rgba(255,90,90,.9);
      transform:translate(${ax}px,${ay}px)`;
    document.body.appendChild(d);
    const m = document.createElement('div');
    m.id = 'contactmark';
    m.style.cssText = `position:fixed;left:0;top:0;pointer-events:none;z-index:9;
      width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;
      border:2px solid rgba(90,200,255,.95);transform:translate(${cx}px,${cy}px)`;
    document.body.appendChild(m);
  }, [s2.anchorPx[0], s2.anchorPx[1], s2.contactPx[0], s2.contactPx[1]]);
  await shot(page, `${tag}8-finger-vs-blade`);
  console.log(`${tag} finger-to-blade = ${s2.handleOffsetPx.toFixed(1)} CSS px`);
  await ev(() => { document.getElementById('fingermark')?.remove(); document.getElementById('contactmark')?.remove(); });
  await page.mouse.up();
}
console.log(tag, JSON.stringify(await stats(page)));
console.log('errors', errors.filter((e) => !e.includes('404')));
await browser.close();
