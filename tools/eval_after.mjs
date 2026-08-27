// 最初の接続を実行した直後のスクリーンショット（評価用の「接続後」画像）
import { chromium } from 'playwright';
const out = process.argv[2];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
await page.goto('http://localhost:4173/');
await page.waitForTimeout(8000);
const pos = (n) => page.evaluate((x) => window.__game.screenPos(x), n);
const pa = await pos('trace0');
await page.mouse.move(pa.x, pa.y);
await page.mouse.down();
await page.waitForTimeout(80);
let cur = { ...pa };
for (let i = 0; i < 26; i++) {
  const pb = await pos('leader0');
  if (!pb) break;
  const dx = pb.x - cur.x, dy = pb.y - cur.y;
  const d = Math.hypot(dx, dy);
  if (d < 4) break;
  const s = Math.min(d, 60);
  cur = { x: cur.x + dx / d * s, y: cur.y + dy / d * s };
  await page.mouse.move(cur.x, cur.y);
  await page.waitForTimeout(50);
}
await page.mouse.up();
await page.waitForTimeout(2600); // 歩く→張る→そりが動く の途中
await page.screenshot({ path: out });
console.log('STATE:', JSON.stringify(await page.evaluate(() => window.__game.state())));
await browser.close();
