// Full automated play-through driving the real pointer input.
import { withPage } from './capture.mjs';

const dev = process.argv[2] || 'iphone-p';
const tag = process.argv[3] || dev;
const SHOT = (process.env.SHOTS || '').split(',').filter(Boolean);

const wantShot = (name) => SHOT.length === 0 || SHOT.includes(name);

await withPage(dev, async (page, shot) => {
  const state = () => page.evaluate(() => window.__game.state);
  const pt = (n) => page.evaluate((k) => window.__game.screenPointFor(k), n);
  const log = (...a) => console.log(...a);

  async function waitPhase(p, timeout = 180000, settle = 1900) {
    const t0 = Date.now();
    let last = 0;
    for (;;) {
      const s = await state();
      if (s.phase === p && !s.busy) {
        // let the camera rig finish easing before sampling screen points
        await page.waitForTimeout(settle);
        return s;
      }
      if (Date.now() - t0 > last + 5000) {
        last = Date.now() - t0;
        console.log(`  waiting for ${p} (${(last / 1000) | 0}s) at ${JSON.stringify(s)}`);
      }
      if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for ${p}, now ${JSON.stringify(s)}`);
      await page.waitForTimeout(150);
    }
  }
  async function drag(a, b, steps = 8, hold = 60) {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.waitForTimeout(hold);
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
    }
    await page.waitForTimeout(hold);
    await page.mouse.up();
  }

  console.log('step: start');
  await page.click('#hud-primary');
  await waitPhase('assemble');
  if (wantShot('assemble')) await shot(`${tag}-01-assemble`);

  console.log('step: assemble ok');
  await drag(await pt('inner'), await pt('moldCenter'), 8);
  await waitPhase('decorate');
  if (wantShot('decorate')) await shot(`${tag}-02-decorate`);

  console.log('step: decorate');
  let s = await state();
  for (let i = 0; i < 6 && s.phase === 'decorate'; i++) {
    const from = await pt('decor' + i);
    const to = await pt('gap' + ((i % 6) + 1));
    if (!from || !to) break;
    await drag(from, to, 6, 40);
    await page.waitForTimeout(180);
    s = await state();
    console.log('  decor', i, 'placed', s.placed);
  }
  if ((await state()).phase === 'decorate') {
    console.log('  clicking done button');
    await page.click('#hud-primary', { timeout: 4000 }).catch((e) => console.log('  (no button)', e.message.slice(0, 40)));
  }
  await waitPhase('fill');
  if (wantShot('fill')) await shot(`${tag}-03-fill`);

  console.log('step: fill');
  await drag(await pt('pitcher'), await pt('pourPose'), 8);
  await page.waitForTimeout(600);
  const centre = await pt('moldCenter');
  await page.mouse.move(centre.x, centre.y + 120);
  await page.mouse.down();
  let shotMid = false;
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(120);
    if (i % 12 === 0) console.log('  pouring level', (await state()).level.toFixed(2));
    const st = await state();
    if (st.level > 0.45 && !shotMid) {
      shotMid = true;
      if (wantShot('pouring')) await shot(`${tag}-04-pouring`);
    }
    if (st.phase !== 'fill') break;
  }
  await page.mouse.up();
  await waitPhase('shelve');
  if (wantShot('shelve')) await shot(`${tag}-05-shelve`);

  console.log('step: shelve');
  const mold = await pt('outer');
  await page.mouse.click(mold.x, mold.y);
  await page.waitForTimeout(2200);
  await page.click('#hud-primary');

  console.log('step: freeze');
  let halfShot = false;
  for (let i = 0; i < 200; i++) {
    const st = await state();
    if (st.phase === 'freeze' && st.freeze > 0.45 && !halfShot) {
      halfShot = true;
      if (wantShot('freezing')) await shot(`${tag}-06-freezing`);
    }
    if (st.phase === 'pullInner' && !st.busy) break;
    await page.waitForTimeout(200);
  }
  await waitPhase('pullInner');
  if (wantShot('pullInner')) await shot(`${tag}-07-pullinner`);

  console.log('step: pullInner');
  const ih = await pt('innerHandle');
  await page.mouse.move(ih.x, ih.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(ih.x + i * 15, ih.y);
  for (let i = 1; i <= 8; i++) await page.mouse.move(ih.x + 90, ih.y - i * 20);
  await page.mouse.up();
  await page.waitForTimeout(700);
  if (wantShot('innerOut')) await shot(`${tag}-08-inner-out`);
  await waitPhase('pullOuter');

  console.log('step: pullOuter');
  const h = await pt('handle');
  await page.mouse.move(h.x, h.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(h.x, h.y - i * 16);
  await page.mouse.up();
  await page.waitForTimeout(900);
  if (wantShot('halfOut')) await shot(`${tag}-09-half-out`);
  await waitPhase('led');
  if (wantShot('demolded')) await shot(`${tag}-10-demolded`);

  console.log('step: led');
  await drag(await pt('led'), await pt('cavity'), 8);
  await page.waitForTimeout(900);
  const ledp = await pt('led');
  await page.mouse.click(ledp.x, ledp.y);
  await page.waitForTimeout(1600);
  if (wantShot('lit')) await shot(`${tag}-11-lit`);
  await waitPhase('lit');

  console.log('step: lit');
  await page.click('#hud-primary');
  await page.waitForTimeout(7000);
  if (wantShot('path')) await shot(`${tag}-12-path`);
  await waitPhase('finale', 120000);

  console.log('step: finale');
  const sw = await pt('switch');
  await page.mouse.move(sw.x, sw.y);
  await page.mouse.down();
  for (let i = 1; i <= 16; i++) {
    await page.mouse.move(sw.x + (i * page.viewportSize().width * 0.55) / 16, sw.y);
    await page.waitForTimeout(90);
    if (i === 7 && wantShot('lighting')) await shot(`${tag}-13-lighting`);
  }
  await page.mouse.up();
  await page.waitForTimeout(3500);
  if (wantShot('finale')) await shot(`${tag}-14-finale`);
  log('final state', JSON.stringify(await state()));
});
