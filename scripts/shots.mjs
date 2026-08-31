/**
 * Screen evidence: partway through the joinery, mid wind, and the moment just
 * after the hand lets go — at each of the four screen sizes the game targets.
 *
 *   npm run build && npx vite preview --port 4173 --strictPort   (in one shell)
 *   npm run shots                                                (in another)
 *
 * CHROMIUM_PATH can point at a local Chromium build.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('docs/shots');
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL ?? 'http://localhost:4173/';
const LIFT = 42;

const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844 },
  { name: '844x390', width: 844, height: 390 },
  { name: '820x1180', width: 820, height: 1180 },
  { name: '1180x820', width: 1180, height: 820 },
];

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('  page error:', e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.game, null, { timeout: 30000 });
  const ff = (s) => page.evaluate((n) => window.game.fastForward(n), s);
  const shot = async (n) => {
    await page.screenshot({ path: path.join(OUT, `${vp.name}-${n}.png`) });
    console.log('  ->', `${vp.name}-${n}.png`);
  };
  console.log(vp.name);
  await ff(3.6);
  await shot('1-start');

  // fit the first board, and stop with it halfway down its groove
  const pick = await page.evaluate(() => window.game.pickTarget());
  const joint = await page.evaluate(() => window.game.jointTargets());
  await page.mouse.move(pick.x, pick.y);
  await page.mouse.down();
  await ff(0.15);
  for (let i = 1; i <= 8; i++) {
    const t = i / 8;
    await page.mouse.move(
      pick.x + (joint.entry.x - pick.x) * t,
      pick.y + (joint.entry.y + LIFT - pick.y) * t,
    );
    await ff(0.07);
  }
  await ff(0.4);
  for (let i = 1; i <= 5; i++) {
    const t = (i / 8) * 0.55;
    await page.mouse.move(
      joint.entry.x + (joint.seated.x - joint.entry.x) * t,
      joint.entry.y + LIFT + (joint.seated.y - joint.entry.y) * t,
    );
    await ff(0.08);
  }
  await ff(0.3);
  await shot('2-fitting');

  // push it home
  for (let i = 1; i <= 6; i++) {
    const t = i / 6;
    await page.mouse.move(
      joint.entry.x + (joint.seated.x - joint.entry.x) * t,
      joint.entry.y + LIFT + (joint.seated.y - joint.entry.y) * t,
    );
    await ff(0.08);
  }
  await ff(0.4);
  await page.mouse.up();
  await ff(1.4);
  await shot('3-seated');

  // the finished tree, wound by hand
  await page.evaluate(() => window.game.finishAssemblyInstantly());
  await ff(2.2);
  const grip = await page.evaluate(() => window.game.gripTarget());
  const R = Math.max(40, Math.min(grip.r * 0.8, Math.min(vp.width, vp.height) * 0.28));
  await page.mouse.move(grip.x + R, grip.y);
  await page.mouse.down();
  const steps = 110;
  for (let i = 1; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2 * 2.2; // clockwise = winding
    await page.mouse.move(grip.x + Math.cos(a) * R, grip.y + Math.sin(a) * R);
    if (i === Math.round(steps * 0.65)) {
      await ff(0.05);
      await shot('4-winding');
    }
  }
  await ff(0.05);
  await page.mouse.up();
  await ff(0.55); // the tree has just started to turn
  await shot('5-just-released');
  await ff(4);
  await shot('6-playing');

  console.log('  state:', JSON.stringify(await page.evaluate(() => window.game.debug())));
  await ctx.close();
}

await browser.close();
