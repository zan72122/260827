import { chromium } from 'playwright';

export const PORTRAIT = { width: 390, height: 844 };
export const LANDSCAPE = { width: 844, height: 390 };

export async function launch(viewport = PORTRAIT, url = 'http://127.0.0.1:4173/?noadapt') {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: true,
    args: [
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--use-gl=angle', '--disable-gpu-sandbox', '--no-sandbox',
      '--enable-webgl', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc',
    ],
  });
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__spanbaum?.ready === true, null, { timeout: 30000 });
  await settle(page, 25);
  return { browser, page, errors };
}

export const stats = (page) => page.evaluate(() => window.__spanbaum.stats());

export async function settle(page, frames = 6) {
  await page.evaluate((n) => new Promise((res) => {
    let i = 0;
    const step = () => (++i >= n ? res() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  }), frames);
}

/** press on the tool, at the point the game says the finger belongs */
export async function grab(page) {
  const s = await stats(page);
  const [x, y] = s.anchorPx;
  await page.mouse.move(x, y);
  await page.mouse.down();
  return { x, y };
}

/** move the finger `px` CSS pixels along the cutting direction (negative = back) */
export async function drag(page, from, px, steps = 12) {
  const [dx, dy] = await page.evaluate(() => {
    const g = window.__spanbaum.game;
    return [g.dirTx, g.dirTy];
  });
  let cur = { ...from };
  for (let i = 1; i <= steps; i++) {
    const k = (px * i) / steps;
    cur = { x: from.x + dx * k, y: from.y + dy * k };
    await page.mouse.move(cur.x, cur.y);
    await settle(page, 1);
  }
  return cur;
}

export async function shot(page, name) {
  await settle(page, 3);
  await page.screenshot({ path: `verify/out/${name}.png` });
}
