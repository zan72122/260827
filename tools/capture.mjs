/**
 * Screenshot harness.
 *
 * Drives the built game through a whole session with synthetic pointer events —
 * the same path a finger takes, through the same Pointer Events code — and
 * captures the states named in the acceptance conditions at each of the four
 * representative viewports, plus the extra angles and the alternative lighting
 * used to check that the flower is a solid.
 *
 * The last pass replays the game five times in a row and reads three.js'
 * resource counters after each, so a leak would show up as a rising number.
 *
 * Usage:  npm run build && npm run preview   (in one shell)
 *         node tools/capture.mjs [outDir]
 *
 * Rendering here goes through SwiftShader, which is software: frame times are
 * nothing like a real device, so every wait is synchronised to an actual
 * animation frame rather than to the clock.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4173/';
const OUT = process.argv[2] ?? 'shots';
const ONLY = process.env.ONLY ?? '';

const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844, full: true },
  { name: '844x390', width: 844, height: 390, full: false },
  { name: '768x1024', width: 768, height: 1024, full: false },
  { name: '1024x768', width: 1024, height: 768, full: false },
];

const launch = () =>
  chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });

function driver(page, vp, dir) {
  const frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  const btns = () => page.locator('.ui-choices .ui-btn');
  const settle = async (n = 6) => {
    for (let i = 0; i < n; i++) await frame();
  };
  const waitBtns = async (n, tries = 90, required = true) => {
    for (let i = 0; i < tries; i++) {
      if ((await btns().count()) >= n) return true;
      await frame();
    }
    if (required) throw new Error(`stuck: ${n} picture buttons never appeared in "${await stage()}"`);
    return false;
  };
  const click = async (i) => {
    await btns().nth(i).click({ force: true });
    await frame();
  };
  const arc = async (cx, cy, r, steps) => {
    await page.mouse.move(cx + r, cy);
    await page.mouse.down();
    await frame();
    for (let i = 1; i <= steps; i++) {
      const a = (i / 14) * Math.PI * 2;
      await page.mouse.move(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      await frame();
    }
    await page.mouse.up();
    await frame();
  };
  const swipe = async (x0, y0, x1, y1, steps = 12) => {
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await frame();
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
      await frame();
    }
    await page.mouse.up();
    await frame();
  };
  const shot = async (name) => {
    await page.screenshot({ path: path.join(dir, `${name}.png`) });
    process.stdout.write(`    ${name}\n`);
  };
  const stage = () => page.evaluate(() => window.__kurukuru.stage);
  const waitStage = async (want, tries = 400) => {
    const wanted = Array.isArray(want) ? want : [want];
    for (let i = 0; i < tries; i++) {
      if (wanted.includes(await stage())) return true;
      await frame();
    }
    throw new Error(`stuck: waited for ${wanted.join(' or ')}, still in "${await stage()}"`);
  };
  return { frame, btns, settle, waitBtns, click, arc, swipe, shot, stage, waitStage, vp };
}

async function playThrough(page, vp, dir) {
  const d = driver(page, vp, dir);
  const { width: W, height: H } = vp;
  const cake = { x: W * 0.42, y: H * 0.55, r: Math.min(W, H) * 0.3 };
  const mid = { x: W * 0.5, y: H * 0.5, r: Math.min(W, H) * 0.28 };

  await d.settle(4);
  await d.shot('01-welcome');

  await d.waitBtns(2);
  await d.click(0); // choose the flower place card
  await d.waitStage('smoothing');
  await d.settle(24);
  await d.shot('02-coat-uneven');

  await d.arc(cake.x, cake.y, cake.r, 16);
  await d.settle(3);
  await d.shot('03-coat-smoothed');

  await d.waitBtns(1);
  await d.click(0);
  await d.waitStage('piping');
  await d.settle(24);
  await d.shot('04-nail-and-cone');

  await d.arc(mid.x, mid.y, mid.r, 12);
  await d.shot('05-petal-forming');
  await d.arc(mid.x, mid.y, mid.r, 36);
  await d.settle(4);
  await d.shot('06-inner-whorl');

  await d.waitBtns(2, 90);
  await d.click(1); // add the outer petals
  await d.arc(mid.x, mid.y, mid.r, 48);
  await d.settle(6);
  await d.shot('07-flower-complete');

  if (vp.full) {
    for (const name of ['side', 'back', 'top', 'far']) {
      await page.keyboard.press('v');
      await d.settle(3);
      await d.shot(`08-angle-${name}`);
    }
    await page.keyboard.press('v');
    await page.keyboard.press('v');
    await page.keyboard.press('v');
    await d.settle(3);
    await d.shot('08-angle-room');
    await page.keyboard.press('v');
    await d.settle(3);
    await page.keyboard.press('l');
    await d.settle(8);
    await d.shot('09-light-overcast');
    await page.keyboard.press('l');
    await d.settle(8);
    await d.shot('09-light-evening');
    await page.keyboard.press('l');
    await d.settle(6);
  }

  await d.waitStage('placing');
  await d.settle(30);
  await d.shot('10-lifted-off-paper');
  await page.mouse.click(W * 0.44, H * 0.5);
  await d.settle(40);
  await d.shot('11-flower-on-cake');

  await d.waitBtns(2, 120);
  await d.click(1); // take it to the table
  await d.waitStage('serving');
  await d.settle(60);
  await d.shot('12-candle-lit');

  for (let i = 0; i < 3; i++) {
    await d.swipe(W * 0.2, H * 0.6, W * 0.85, H * 0.42);
  }
  await d.settle(3);
  await d.shot('13-candle-out');

  await d.waitStage(['cutting', 'after'], 600);
  await d.settle(6);
  await d.shot('14-cutting');
  await d.waitStage('after', 900);
  await d.settle(4);
  await d.shot('15-slice-given');
  await d.settle(24);
  await d.shot('16-afterwards');

  return page.evaluate(() => {
    const a = window.__kurukuru;
    return {
      stage: a.stage,
      flowers: a.placed.map((f) => ({
        size: f.record.size,
        colour: f.record.color,
        petals: f.record.petals.length,
        placement: f.record.placement,
        parent: f.group.parent ? f.group.parent.name : null,
      })),
      info: a.rendererInfo(),
    };
  });
}

async function replay(page, rounds) {
  const vp = { width: 390, height: 844 };
  const d = driver(page, vp, OUT);
  const nail = { x: 195, y: 420, r: 110 };
  const samples = [];
  await d.settle(4);
  await d.waitBtns(2);
  await d.click(0);
  await d.waitStage('smoothing');
  await d.settle(20);

  for (let round = 0; round < rounds; round++) {
    if ((await d.stage()) === 'smoothing') {
      await d.arc(180, 460, 110, 10);
      await d.waitBtns(1);
      await d.click(0);
    }
    await d.waitStage('piping');
    await d.settle(20);
    await d.arc(nail.x, nail.y, nail.r, 40);
    await d.settle(4);
    await d.waitBtns(2, 90);
    await d.click(0); // keep it small
    await d.waitStage('placing', 600);
    await d.settle(28);
    await page.mouse.click(170, 430);
    await d.waitBtns(2, 400);
    await d.click(1); // take it to the table
    await d.waitStage('serving', 600);
    await d.settle(50);
    for (let i = 0; i < 3; i++) await d.swipe(80, 520, 330, 400);
    await d.waitStage('after', 1200);
    await d.settle(10);
    samples.push(await page.evaluate(() => window.__kurukuru.rendererInfo()));
    process.stdout.write(`    round ${round + 1}: ${JSON.stringify(samples[samples.length - 1])}\n`);
    await d.waitBtns(2, 300);
    await d.click(0); // make another flower
    await d.waitStage('piping', 300);
    await d.settle(12);
  }
  return samples;
}

const browser = await launch();
await mkdir(OUT, { recursive: true });
const report = [];

for (const vp of VIEWPORTS) {
  if (ONLY && ONLY !== vp.name) continue;
  const dir = path.join(OUT, vp.name);
  await mkdir(dir, { recursive: true });
  console.log(`\n  ${vp.name}`);
  const page = await browser.newPage({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text());
  });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#boot.gone', { timeout: 90000 });
  const result = await playThrough(page, vp, dir);
  await page.close();
  report.push({ viewport: vp.name, errors, ...result });
}

if (!ONLY) {
  console.log('\n  replay x5');
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#boot.gone', { timeout: 90000 });
  const samples = await replay(page, 5);
  await page.close();
  report.push({ viewport: 'replay', errors, samples });
}

await browser.close();
console.log('\n--- report ---');
console.log(JSON.stringify(report, null, 2));
