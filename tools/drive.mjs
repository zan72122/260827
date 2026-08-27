// Automated play-through driver: walks the whole loop on a phone/tablet
// viewport, taking screenshots at every beat. Usage:
//   node tools/drive.mjs [--device=iphone-p|iphone-l|ipad-p|ipad-l] [--out=DIR] [--flow=full|quick|free]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
    const [k, v] = a.slice(2).split('=');
    return [k, v ?? true];
  })
);

// dpr 1 in the headless (software-GL) test environment; real devices run 2
const DEVICES = {
  'iphone-p': { width: 390, height: 844, dpr: 1 },
  'iphone-l': { width: 844, height: 390, dpr: 1 },
  'ipad-p': { width: 820, height: 1180, dpr: 1 },
  'ipad-l': { width: 1180, height: 820, dpr: 1 }
};
const dev = DEVICES[args.device ?? 'iphone-p'];
const outDir = args.out ?? `shots/${args.device ?? 'iphone-p'}`;
const flow = args.flow ?? 'full';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist']
});
const page = await browser.newPage({
  viewport: { width: dev.width, height: dev.height },
  deviceScaleFactor: dev.dpr,
  hasTouch: true,
  isMobile: true
});
page.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text()); });
page.on('pageerror', e => console.log('[pageerror]', e.message));

await page.goto('http://127.0.0.1:5173/?debug=1', { waitUntil: 'load' });

let shotN = 0;
async function shot(name) {
  shotN++;
  const file = path.join(outDir, `${String(shotN).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file });
  console.log('shot', file);
}

async function phase() {
  return page.evaluate(() => window.__santaGame?.phase);
}

async function waitPhase(want, timeout = 30000) {
  await page.waitForFunction(
    (w) => window.__santaGame && window.__santaGame.phase === w,
    want,
    { timeout }
  );
  console.log('phase →', want);
}

// pointer-event swipe via mouse (InputManager listens to pointer events)
async function swipe(x0, y0, x1, y1, ms, steps = 24) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps);
    await page.waitForTimeout(ms / steps);
  }
  await page.mouse.up();
}

async function tapAt(x, y) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(70);
  await page.mouse.up();
}

async function tapObject(kind, index = 0) {
  const p = await page.evaluate(([k, i]) => window.__screenOf(k, i), [kind, index]);
  if (!p) throw new Error(`no screen pos for ${kind}[${index}]`);
  console.log(`tap ${kind}[${index}] @`, Math.round(p.x), Math.round(p.y));
  await tapAt(p.x, p.y);
}

const W = dev.width, H = dev.height;
const CX = W / 2;

try {
  await page.waitForFunction(() => !!window.__santaGame, { timeout: 15000 });
  await page.waitForTimeout(1200);
  await shot('intro');

  await waitPhase('walk', 20000).catch(() => {});
  await page.waitForTimeout(2500);
  await shot('walk');
  await waitPhase('peek', 30000);
  await page.waitForTimeout(1500);
  await shot('peek');

  // wait for a hint cycle so we can audit the invitation
  if (flow === 'full') {
    await page.waitForTimeout(5500);
    await shot('peek-hint');
  }

  // first downward swipe: slow-ish so the squeeze is visible
  await swipe(CX, H * 0.35, CX, H * 0.8, 700);
  await page.waitForTimeout(300);
  await shot('entry-mid');
  await swipe(CX, H * 0.3, CX, H * 0.85, 600);
  await page.waitForTimeout(400);
  const ph = await phase();
  if (ph === 'entry') {
    await swipe(CX, H * 0.25, CX, H * 0.85, 500);
  }
  await waitPhase('descend', 10000);
  await shot('descend-top');

  // slow scrub
  await swipe(CX, H * 0.3, CX, H * 0.6, 900);
  await page.waitForTimeout(200);
  await shot('descend-slow');

  // pause mid-flue (wobble)
  await page.waitForTimeout(900);
  await shot('descend-paused');

  // lateral lean
  await swipe(CX, H * 0.5, CX - W * 0.3, H * 0.55, 500);
  await shot('descend-lean');

  if (flow === 'full') {
    // scrub back up (retry) then down fast
    await swipe(CX, H * 0.7, CX, H * 0.25, 400);
    await page.waitForTimeout(300);
    await shot('descend-retry-up');
  }

  // fast swipes to the bottom
  for (let i = 0; i < 10; i++) {
    await swipe(CX, H * 0.25, CX, H * 0.85, 220);
    const p = await phase();
    if (p !== 'descend') break;
  }
  await waitPhase('landing', 15000);
  await page.waitForTimeout(700);
  await shot('landing');
  await page.waitForTimeout(2600);
  await shot('landed-room');

  await waitPhase('gifts', 20000);
  await page.waitForTimeout(800);
  await shot('gifts');

  for (let i = 0; i < 3; i++) {
    await tapObject('gift', i);
    await page.waitForTimeout(1500);
    await shot(`stocking-${i + 1}`);
  }

  await waitPhase('nose', 25000);
  await page.waitForTimeout(1800);
  await shot('nose-closeup');
  await tapObject('nose');
  await page.waitForTimeout(900);
  await shot('nose-touch');

  await waitPhase('awaitUp', 10000);
  await page.waitForTimeout(400);
  // upward swipe (queued if the anticipation beat is still playing)
  await swipe(CX, H * 0.75, CX, H * 0.2, 300);
  await page.waitForFunction(
    () => ['ascend', 'roofReturn', 'menu'].includes(window.__santaGame.phase),
    null, { timeout: 15000 }
  );
  console.log('phase →', await phase());
  await page.waitForTimeout(500);
  await shot('ascend');

  await page.waitForFunction(
    () => ['roofReturn', 'menu'].includes(window.__santaGame.phase),
    null, { timeout: 20000 }
  );
  await page.waitForTimeout(1000);
  await shot('roof-return');

  await waitPhase('menu', 20000);
  await page.waitForTimeout(1200);
  await shot('menu');

  if (flow === 'full') {
    // replay: same house again — must be ≤2 taps back to the signature move
    await page.click('#btn-again');
    await waitPhase('walk', 20000).catch(() => {});
  await page.waitForTimeout(2500);
  await shot('walk');
  await waitPhase('peek', 30000);
    await page.waitForTimeout(800);
    await shot('replay-peek');
    // quick descent to check soot accumulation from run 1 persists
    await swipe(CX, H * 0.3, CX, H * 0.85, 500);
    await swipe(CX, H * 0.25, CX, H * 0.85, 400);
    await waitPhase('descend', 12000);
    await swipe(CX, H * 0.3, CX, H * 0.7, 500);
    await shot('replay-descend-soot');
  }

  console.log('metrics:', await page.evaluate(() => window.__santaMetrics()));
  console.log('DONE flow=' + flow);
} catch (e) {
  console.error('FAILED at phase', await phase().catch(() => '?'), e.message);
  await shot('FAIL');
  process.exitCode = 1;
} finally {
  await browser.close();
}
