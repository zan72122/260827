// Screenshot matrix: 4 device sizes × (before / during / conditioner closeup /
// complete) plus intro, skate and snow-tank-reveal evidence on one device.
import { launch, openGame, skipIntro, drawStroke, densify, waitPhase } from './helpers.mjs';
import fs from 'node:fs';

const DEVICES = [
  { name: 'phone-small-375x667', width: 375, height: 667, dpr: 2 },
  { name: 'phone-large-430x932', width: 430, height: 932, dpr: 3 },
  { name: 'tablet-768x1024', width: 768, height: 1024, dpr: 2 },
  { name: 'phone-landscape-844x390', width: 844, height: 390, dpr: 2 }
];

const STROKE = [{ x: 0, z: 10 }, { x: 4.5, z: 3 }, { x: -3.5, z: -5 }, { x: 0.5, z: -11.5 }];

const browser = await launch();
fs.mkdirSync('screenshots/devices', { recursive: true });

const only = process.argv[2];
for (const dev of DEVICES) {
  if (only && !dev.name.includes(only)) continue;
  console.log(`device: ${dev.name}`);
  const dir = `screenshots/devices/${dev.name}`;
  fs.mkdirSync(dir, { recursive: true });
  const { ctx, page } = await openGame(browser, dev);

  if (dev.name === 'phone-large-430x932') {
    // capture the wordless intro on one device (timed by in-game clock)
    fs.mkdirSync('screenshots/intro', { recursive: true });
    const atIntroT = async (t, path) => {
      await page.waitForFunction((tt) => window.__test.introT() >= tt || window.__test.phase() !== 'intro', t, { timeout: 60000 });
      await page.screenshot({ path });
    };
    await atIntroT(1.3, 'screenshots/intro/1-rough-ice-closeup.png');
    await atIntroT(3.4, 'screenshots/intro/2-waiting-skater.png');
    await atIntroT(5.9, 'screenshots/intro/3-conditioner-lowering.png');
    await atIntroT(7.9, 'screenshots/intro/4-facing-down-rink.png');
    await waitPhase(page, 'draw', 30000);
  } else {
    await skipIntro(page);
  }
  await page.waitForTimeout(2200);   // hint sparkles visible
  await page.screenshot({ path: `${dir}/1-before-drive.png` });

  await drawStroke(page, densify(STROKE, 34), { durationMs: 1200 });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${dir}/2-driving-start.png` });

  // conditioner closeup: low chase camera once well into the low-cam window
  await page.waitForFunction(() => {
    const v = window.__test.vehicle();
    return v.progress / Math.max(1, window.__test.pathTotal()) > 0.3;
  }, null, { timeout: 90000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${dir}/3-conditioner-closeup.png` });

  // headless software rendering is slow on big viewports — hurry the tail
  await page.evaluate(() => window.__test.setTimeScale(2.5));
  await waitPhase(page, 'bandview', 240000);
  await page.evaluate(() => window.__test.setTimeScale(1));
  // headless renders slowly (game time < real time) — give the camera time
  // to settle on the wide shot before capturing
  await page.waitForTimeout(7000);
  await page.screenshot({ path: `${dir}/4-complete-band.png` });

  if (dev.name === 'phone-large-430x932') {
    await waitPhase(page, 'skate', 30000);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: 'screenshots/intro/5-skater-on-band.png' });
    await waitPhase(page, 'reveal', 60000);
    await page.waitForTimeout(6500);
    await page.screenshot({ path: 'screenshots/intro/6-snow-tank-reveal.png' });
  }
  await ctx.close();
}

await browser.close();
console.log('DEVICES OK');
