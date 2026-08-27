// 画面回転で状態（接続・装着・雪の状態）が保持されるかの検証
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
await page.goto('http://localhost:4173/');
await page.waitForTimeout(8000);
const state = () => page.evaluate(() => window.__game.state());
const pos = (n) => page.evaluate((x) => window.__game.screenPos(x), n);

// 1頭目を接続
const pa = await pos('trace0');
await page.mouse.move(pa.x, pa.y);
await page.mouse.down();
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
await page.waitForTimeout(6000);
const before = await state();
console.log('BEFORE ROTATE:', JSON.stringify({ phase: before.phase, hooks: before.hooks, wear: before.wear, snow: before.snow }));

// 回転 (縦 → 横)
await page.setViewportSize({ width: 844, height: 390 });
await page.waitForTimeout(2500);
await page.screenshot({ path: process.argv[2] || '/tmp/rotate_landscape.png' });
const after = await state();
console.log('AFTER ROTATE:', JSON.stringify({ phase: after.phase, hooks: after.hooks, wear: after.wear, snow: after.snow }));
const ok = JSON.stringify(before.hooks) === JSON.stringify(after.hooks) &&
  JSON.stringify(before.wear) === JSON.stringify(after.wear);
console.log(ok ? 'ROTATE STATE PRESERVED ✓' : 'ROTATE STATE MISMATCH ✗');
await browser.close();
