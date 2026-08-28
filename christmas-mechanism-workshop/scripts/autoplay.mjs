/**
 * Automated play-through: opens the game, reads the gesture the director is
 * currently asking for, performs it with real pointer input, and walks the
 * whole build from the dark shop to free play - taking screenshots on the way.
 *
 *   node scripts/autoplay.mjs [--portrait] [--rotate] [--out shots]
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };

const OUT = val('--out', 'shots');
const PORTRAIT = has('--portrait');
const ROTATE = has('--rotate');
mkdirSync(OUT, { recursive: true });

const LANDSCAPE = { width: 960, height: 672 };
const PORTRAIT_VP = { width: 672, height: 960 };

const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((res) => {
  server.stdout.on('data', (d) => { if (String(d).includes('Local')) res(); });
  setTimeout(res, 5000);
});

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({
  viewport: PORTRAIT ? PORTRAIT_VP : LANDSCAPE,
  deviceScaleFactor: 1,
  hasTouch: true, isMobile: true,
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => { errors.push(String(e)); console.log('PAGE EXCEPTION:', e.message); });
page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); console.log('PAGE ERR:', m.text()); } });

await page.goto('http://localhost:4173/?autotest=1', { waitUntil: 'load' });
await page.waitForSelector('#veil', { state: 'detached', timeout: 60000 });
await page.waitForTimeout(600);

const read = () => page.evaluate(() => ({ hint: window.__CMW.hint, state: window.__CMW.state }));
/** wait until the camera rail has arrived, then a little longer */
const settle = async (extraMs = 1200, maxMs = 120000) => {
  const t = Date.now();
  while (Date.now() - t < maxMs) {
    const st = (await read()).state;
    if (st.cameraSettled) break;
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(extraMs);
};
const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('  shot', name);
};

async function press(x, y) { await page.mouse.move(x, y); await page.mouse.down(); }
async function glide(fromX, fromY, toX, toY, steps = 16, pause = 12) {
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(fromX + (toX - fromX) * (i / steps),
                          fromY + (toY - fromY) * (i / steps));
    await page.waitForTimeout(pause);
  }
}

async function perform(hint) {
  if (!hint) return false;
  if (hint.kind === 'tap') {
    await page.mouse.click(hint.at.x, hint.at.y);
    return true;
  }
  if (hint.kind === 'swipe') {
    const dy = hint.dir === 'up' ? -1 : 1;
    await press(hint.at.x, hint.at.y);
    await glide(hint.at.x, hint.at.y, hint.at.x, hint.at.y + dy * 120, 14, 14);
    await page.mouse.up();
    return true;
  }
  if (hint.kind === 'drag' || hint.kind === 'arc') {
    await press(hint.from.x, hint.from.y);
    await glide(hint.from.x, hint.from.y, hint.to.x, hint.to.y, 18, 12);
    await page.mouse.up();
    return true;
  }
  if (hint.kind === 'trace') {
    await press(hint.from.x, hint.from.y);
    await glide(hint.from.x, hint.from.y, hint.to.x, hint.to.y, 20, 14);
    await page.waitForTimeout(2200);        // hold the wand on the wick
    await page.mouse.up();
    await page.waitForTimeout(400);
    return true;
  }
  return false;
}

const shotAt = new Map([
  ['sm_wide', '01-smoker-closed'],
  ['sm_section', '02-smoker-section'],
  ['sm_cone', '03-incense'],
  ['sm_light', '04-lighting-incense'],
  ['sm_mouth', '05-smoke-from-mouth'],
  ['py_vanes', '06-pyramid-vanes'],
  ['py_light', '07-pyramid-candles'],
  ['py_rise', '08-flame-to-rotor'],
  ['py_settle', '09-pyramid-turning'],
  ['ch_angels', '10-hanging-angels'],
  ['ch_bells', '11-bells'],
  ['ch_rise', '12-chime-running'],
  ['final_pull', '13-final-pullback'],
  ['freeplay', '14-finished-room'],
]);

let last = '';
let stall = 0;
let steps = 0;
let rotated = false;
const seen = new Set();
const t0 = Date.now();

while (Date.now() - t0 < 2600000) {
  const { hint, state } = await read();
  if (state.step !== last) {
    console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] step ${state.step} (${state.progress})`);
    last = state.step;
    stall = 0;
    const name = shotAt.get(state.step);
    if (name && !seen.has(name)) {
      seen.add(name);
      const slow = ['py_rise', 'ch_rise', 'final_pull', 'sm_mouth', 'py_settle', 'sm_section'];
      await settle(slow.includes(state.step) ? 16000 : 2500);
      await shot(name);
    }
  }
  // rotate the device in the middle of the build: everything already lit,
  // turning or smoking must survive it, and the rest must be playable
  if (ROTATE && !rotated && state.step === 'ch_angels') {
    rotated = true;
    const before = state;
    console.log('  rotating mid-build ->', PORTRAIT ? 'landscape' : 'portrait');
    await page.setViewportSize(PORTRAIT ? LANDSCAPE : PORTRAIT_VP);
    await page.waitForTimeout(3500);
    const after = (await read()).state;
    console.log('   before:', before.orientation, 'py', before.pyramidOmega,
                'ch', before.chimesOmega, 'smoking', before.smoking,
                'vanes', before.counts.vanes, 'strikes', before.counts.strikes);
    console.log('   after :', after.orientation, 'py', after.pyramidOmega,
                'ch', after.chimesOmega, 'smoking', after.smoking,
                'vanes', after.counts.vanes, 'strikes', after.counts.strikes);
    await shot('19-after-rotation');
  }

  if (state.free) break;
  if (hint) { await perform(hint); steps++; stall = 0; }
  else { await page.waitForTimeout(500); stall++; }
  if (stall > 0 && stall % 40 === 0) console.log('   waiting in', state.step, JSON.stringify(state.counts), state.pyramidOmega, state.chimesOmega);
  if (stall > 400) { console.log('STALLED at', state.step, JSON.stringify(state)); break; }
  await page.waitForTimeout(140);
}

let st = (await read()).state;
console.log('reached free play:', st.free, JSON.stringify(st));
await page.waitForTimeout(2500);
await shot('14-finished-room');

if (ROTATE) {
  console.log('rotating the finished room back...');
  await page.setViewportSize(PORTRAIT ? PORTRAIT_VP : LANDSCAPE);
  await page.waitForTimeout(3500);
  st = (await read()).state;
  console.log('finished room after rotating back:', JSON.stringify(st));
  await shot('15-rotated-back');
}

/* ---- free play: reopen the smoker, then change the vane angle ---- */
console.log('free play: smoker');
await page.click('#pips .pip:nth-child(1)');
await page.waitForTimeout(2200);
for (let i = 0; i < 6; i++) {
  const { hint } = await read();
  if (!hint) { await page.waitForTimeout(500); continue; }
  await perform(hint);
  await page.waitForTimeout(900);
}
await shot('16-freeplay-smoker');

console.log('free play: pyramid vane angle');
await page.click('#pips .pip:nth-child(2)');
await page.waitForTimeout(2400);
const before = (await read()).state.pyramidPitch;
const { hint: ah } = await read();
if (ah) await perform(ah);
await page.waitForTimeout(1500);
const after = (await read()).state;
console.log(`vane pitch ${before} -> ${after.pyramidPitch}, omega ${after.pyramidOmega}`);
await shot('17-freeplay-vanes');

console.log('free play: chimes');
await page.click('#pips .pip:nth-child(3)');
await page.waitForTimeout(2400);
const { hint: bh } = await read();
if (bh) await perform(bh);
await page.waitForTimeout(1800);
await shot('18-freeplay-bells');

const final = (await read()).state;
console.log('FINAL', JSON.stringify(final, null, 1));
console.log('gestures performed:', steps);
console.log('page errors:', errors.length);
await browser.close();
server.kill();
process.exit(errors.length ? 1 : 0);
