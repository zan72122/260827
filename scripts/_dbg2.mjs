import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await (await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true })).newPage();
await p.goto('http://127.0.0.1:5173/');
await p.waitForTimeout(2000);
await p.click('#start');
await p.waitForTimeout(2500);
const g = await p.evaluate(() => window.__he.grab());
await p.mouse.move(g.x, g.y+60); await p.mouse.down();
for (let i=1;i<=8;i++) await p.mouse.move(g.x, g.y+60+260*i/8);
await p.mouse.up();
for (const t of [500, 2000, 3500, 5000]) {
  await p.waitForTimeout(t===500?500:1500);
  console.log(t, JSON.stringify(await p.evaluate(() => ({
    level: window.__he.level(), accel: window.__he.accel(), model: window.__he.modelSec(), op: window.__he.opSec(),
    hidden: document.hidden, vis: document.visibilityState, phase: window.__he.phase(), jar: window.__he.jar(),
  }))));
}
await b.close();
