// Shared Playwright helpers for the required manual-operation tests.
import { chromium } from 'playwright-core';

export const BASE = 'http://127.0.0.1:4173/';

export async function launch() {
  return chromium.launch({
    headless: true,
    executablePath: '/opt/pw-browsers/chromium',
    args: [
      '--enable-unsafe-swiftshader',
      '--use-angle=swiftshader',
      '--disable-gpu-sandbox',
      '--no-sandbox'
    ]
  });
}

export async function openGame(browser, { width, height, dpr = 2 } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: dpr,
    hasTouch: true,
    isMobile: true
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text()); });
  await page.goto(BASE);
  await page.waitForFunction(() => window.__test && window.__test.phase(), null, { timeout: 20000 });
  return { ctx, page };
}

export async function skipIntro(page) {
  await page.evaluate(() => window.__test.skipIntro());
  await page.waitForFunction(() => window.__test.phase() === 'draw');
  await page.waitForTimeout(400);
}

// stroke: array of world {x,z}; draws it with real pointer events via mouse
export async function drawStroke(page, worldPts, { durationMs = 900 } = {}) {
  const screenPts = await page.evaluate(
    (pts) => pts.map(p => window.__test.worldToScreen(p.x, p.z)), worldPts);
  await page.mouse.move(screenPts[0].x, screenPts[0].y);
  await page.mouse.down();
  const stepDelay = durationMs / screenPts.length;
  for (let i = 1; i < screenPts.length; i++) {
    await page.mouse.move(screenPts[i].x, screenPts[i].y, { steps: 3 });
    await page.waitForTimeout(stepDelay);
  }
  await page.mouse.up();
}

// interpolate helper to densify a polyline of world points
export function densify(pts, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const ft = t * (pts.length - 1);
    const k = Math.min(pts.length - 2, Math.floor(ft));
    const u = ft - k;
    out.push({
      x: pts[k].x * (1 - u) + pts[k + 1].x * u,
      z: pts[k].z * (1 - u) + pts[k + 1].z * u
    });
  }
  return out;
}

export async function waitPhase(page, phase, timeout = 60000) {
  await page.waitForFunction((p) => window.__test.phase() === p, phase, { timeout });
}

export async function waitDriveDone(page, timeout = 90000) {
  await page.waitForFunction(() => ['bandview', 'skate', 'reveal', 'draw'].includes(window.__test.phase()), null, { timeout });
}
