import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
await page.goto('http://localhost:4173/');
await page.waitForTimeout(8000);
const pos = (n) => page.evaluate((x) => window.__game.screenPos(x), n);
console.log('trace0 px:', await pos('trace0'), 'leader0 px:', await pos('leader0'));
console.log('inner:', await page.evaluate(() => [window.innerWidth, window.innerHeight]));
// pointer events debug
await page.evaluate(() => {
  window.__dbg = [];
  const el = document.getElementById('game');
  for (const ev of ['pointerdown','pointermove','pointerup']) {
    el.addEventListener(ev, (e) => window.__dbg.push([ev, Math.round(e.clientX), Math.round(e.clientY)]));
  }
});
const pa = await pos('trace0');
const pb = await pos('leader0');
await page.mouse.move(pa.x, pa.y);
await page.mouse.down();
await page.waitForTimeout(100);
for (let i = 1; i <= 8; i++) {
  await page.mouse.move(pa.x + (pb.x - pa.x) * i / 8, pa.y + (pb.y - pa.y) * i / 8);
  await page.waitForTimeout(60);
  console.log('step', i, 'state t0:', (await page.evaluate(() => window.__game.state())).t0);
}
await page.mouse.up();
console.log('events:', JSON.stringify(await page.evaluate(() => window.__dbg.slice(0, 6))));
console.log('final:', JSON.stringify(await page.evaluate(() => window.__game.state())));
await browser.close();
