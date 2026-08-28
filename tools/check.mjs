import { chromium } from 'playwright';
import fs from 'node:fs';

const URL = process.env.URL ?? 'http://127.0.0.1:4173/';
const OUT = 'shots';
const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DPR = Number(process.env.DPR ?? 2);

const DEVICES = {
  'iphone-portrait': { width: 390, height: 844 },
  'iphone-landscape': { width: 844, height: 390 },
  'ipad-portrait': { width: 820, height: 1180 },
};

const report = [];
let browser;

async function makePage(dev) {
  const ctx = await browser.newContext({
    viewport: { width: dev.width, height: dev.height },
    deviceScaleFactor: DPR,
    hasTouch: true,
    isMobile: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  await page.goto(URL, { waitUntil: 'load' });
  await frames(page, 4);
  await page.mouse.click(dev.width / 2, dev.height * 0.4);
  return { ctx, page, errors };
}

const st = (page) => page.evaluate(() => window.__game.debugState());
const press = (page, v) => page.evaluate((x) => window.__game.forcePress(x), v);
const tap = (page) => page.evaluate(() => window.__game.forceTap());
const frames = (page, n) =>
  page.evaluate(
    (k) =>
      new Promise((res) => {
        let i = 0;
        const tick = () => (++i >= k ? res(null) : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    n,
  );

async function until(page, pred, label, maxFrames = 900) {
  for (let i = 0; i < maxFrames; i++) {
    const s = await st(page);
    if (pred(s)) return s;
    await frames(page, 1);
  }
  throw new Error(`timeout: ${label} (last ${JSON.stringify(await st(page))})`);
}

const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });

async function oneCycleTo(page, wantFish) {
  // wait for `wantFish` bites, retrying drops until the shoal obliges
  for (let attempt = 0; attempt < 14; attempt++) {
    await until(page, (s) => s.phase === 'wait', 'wait phase');
    const got = await until(
      page,
      (s) => s.hooked >= wantFish || (s.phase === 'wait' && s.bitesDone === 1),
      'bites',
      600,
    ).catch(() => null);
    const s = got ?? (await st(page));
    if (s.hooked >= wantFish) return s;
    // reel in what is there and drop again
    await press(page, true);
    await until(page, (x) => x.phase === 'mobile', 'mobile (retry)');
    await press(page, false);
    await frames(page, 6);
    await tap(page);
    await until(page, (x) => x.phase === 'tank', 'tank (retry)');
    await tap(page);
    await until(page, (x) => x.phase === 'deploy' || x.phase === 'wait', 'redeploy (retry)');
  }
  throw new Error(`never reached ${wantFish} fish`);
}

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  browser = await chromium.launch({
    executablePath: EXEC,
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
    ],
  });

  // ================= one fish: reel the moment the tip ticks
  {
    const { ctx, page, errors } = await makePage(DEVICES['iphone-portrait']);
    await until(page, (s) => s.hooked >= 1, 'first bite');
    await frames(page, 20); // let the camera settle on the rod tip
    await shot(page, '01-first-bite');
    await press(page, true);
    await until(page, (s) => s.topFishY > -0.16, 'first silver near surface');
    await shot(page, '02-one-approaching');
    await until(page, (s) => s.topFishY > 0.05, 'first fish out');
    await shot(page, '03-one-crossing');
    const s = await until(page, (x) => x.phase === 'mobile', 'mobile');
    await press(page, false);
    await frames(page, 10);
    await shot(page, '04-one-mobile');
    report.push({ case: 'one-fish', fish: s.fish, hooked: s.hooked, errors: [...errors] });
    await ctx.close();
  }

  // ================= two fish, with a deliberate stop halfway
  {
    const { ctx, page, errors } = await makePage(DEVICES['iphone-portrait']);
    await oneCycleTo(page, 2);
    await frames(page, 22);
    await shot(page, '05-second-signal');
    await press(page, true);
    await until(page, (s) => s.topFishY > 0.12, 'first fish clear');
    await press(page, false);
    await until(page, (s) => s.motor < 0.02, 'spool stopped');
    const paused = await st(page);
    await frames(page, 30);
    const stillPaused = await st(page);
    await shot(page, '06-paused-first-up-second-below');
    await press(page, true);
    const s = await until(page, (x) => x.phase === 'mobile', 'mobile');
    await press(page, false);
    await frames(page, 12);
    await shot(page, '07-two-mobile');
    report.push({
      case: 'two-fish',
      fish: s.fish,
      pausedLineOut: paused.lineOut,
      afterHoldingStill: stillPaused.lineOut,
      driftWhilePaused: +(paused.lineOut - stillPaused.lineOut).toFixed(4),
      errors: [...errors],
    });
    await ctx.close();
  }

  // ================= three fish, then unhook, tank, redeploy
  {
    const { ctx, page, errors } = await makePage(DEVICES['iphone-portrait']);
    const b = await oneCycleTo(page, 3);
    await frames(page, 22);
    await shot(page, '08-third-signal');
    await press(page, true);
    await until(page, (s) => s.topFishY > 0.05, 'fish 1 out');
    await shot(page, '09-three-first-out');
    await until(page, (s) => s.lineOut <= 2.14, 'fish 2 out');
    await shot(page, '10-three-second-out');
    await until(page, (s) => s.lineOut <= 1.8, 'fish 3 out');
    await shot(page, '11-three-third-out');
    const s = await until(page, (x) => x.phase === 'mobile', 'mobile');
    await press(page, false);
    await frames(page, 16);
    await shot(page, '12-three-mobile');
    report.push({ case: 'three-fish', round: b.round, fish: s.fish, errors: [...errors] });

    await tap(page);
    await frames(page, 10);
    await shot(page, '13-unhook');
    await until(page, (x) => x.phase === 'tank', 'tank');
    await frames(page, 14);
    await shot(page, '14-tank');
    await tap(page);
    const back = await until(page, (x) => x.phase === 'deploy' || x.phase === 'wait', 'redeploy');
    await shot(page, '15-redeploy');
    report.push({ case: 'cycle-restart', round: back.round, phase: back.phase, errors: [...errors] });
    await ctx.close();
  }

  // ================= landscape, then rotate mid-wind
  {
    const { ctx, page, errors } = await makePage(DEVICES['iphone-landscape']);
    await oneCycleTo(page, 2);
    await frames(page, 22);
    await shot(page, '16-landscape-wait');
    await press(page, true);
    await until(page, (s) => s.topFishY > 0.05, 'fish out (landscape)');
    await shot(page, '17-landscape-reveal');
    await press(page, false);
    await until(page, (s) => s.motor < 0.02, 'stopped');
    const before = await st(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await frames(page, 20);
    const after = await st(page);
    await shot(page, '18-after-rotation');
    await press(page, true);
    const s = await until(page, (x) => x.phase === 'mobile', 'mobile after rotation');
    await press(page, false);
    await frames(page, 12);
    await shot(page, '19-rotated-mobile');
    report.push({
      case: 'rotation',
      beforeRotate: { fish: before.fish, lineOut: before.lineOut, round: before.round },
      afterRotate: { fish: after.fish, lineOut: after.lineOut, round: after.round },
      final: { fish: s.fish, phase: s.phase },
      errors: [...errors],
    });
    await ctx.close();
  }

  // ================= iPad portrait
  {
    const { ctx, page, errors } = await makePage(DEVICES['ipad-portrait']);
    await oneCycleTo(page, 2);
    await press(page, true);
    const s = await until(page, (x) => x.phase === 'mobile', 'mobile (ipad)');
    await press(page, false);
    await frames(page, 12);
    await shot(page, '20-ipad-mobile');
    report.push({ case: 'ipad', fish: s.fish, errors: [...errors] });
    await ctx.close();
  }

  await browser.close();
  console.log(JSON.stringify(report, null, 2));
}

run().catch(async (e) => {
  console.error('FAILED', e.message);
  console.log(JSON.stringify(report, null, 2));
  await browser?.close();
  process.exit(1);
});
