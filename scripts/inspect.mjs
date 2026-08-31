/**
 * Developer inspection views.  The joinery has to hold up from behind, from
 * above and from underneath, not only from the playing camera.
 *
 *   npm run build && npx vite preview --port 4173 --strictPort   (in one shell)
 *   node scripts/inspect.mjs                                     (in another)
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('docs/shots');
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL ?? 'http://localhost:4173/';

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 700, height: 900 }, deviceScaleFactor: 1.6 });
page.on('pageerror', (e) => console.error('  page error:', e.message));
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.game, null, { timeout: 30000 });
await page.evaluate(() => {
  window.game.fastForward(1);
  window.game.finishAssemblyInstantly();
  window.game.fastForward(2.5);
});
for (const view of ['back', 'top', 'under', 'side', 'joint']) {
  await page.evaluate((v) => window.game.devView(v), view);
  await page.screenshot({ path: path.join(OUT, `inspect-${view}.png`) });
  console.log('->', `inspect-${view}.png`);
}
await browser.close();
