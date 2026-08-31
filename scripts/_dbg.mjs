import { chromium } from '@playwright/test';
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],
});
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
p.on('console', (m) => { if (m.type()==='error') console.log('[console]', m.text()); });
await p.goto('http://127.0.0.1:5173/', { waitUntil: 'load' });
await p.waitForTimeout(2200);
await p.click('#start');
await p.waitForTimeout(2500);
console.log('hint visible', await p.locator('#hint').isVisible());
await p.locator('#hint button').click().catch(e=>console.log('hint click fail', e.message));
const g = await p.evaluate(() => window.__he.grab());
console.log('grab', g, 'rackY', await p.evaluate(()=>window.__he.rackY()), 'level', await p.evaluate(()=>window.__he.level()));
const el = await p.evaluate(({x,y}) => { const e = document.elementFromPoint(x, y+60); return e ? e.id + '.' + e.className : null; }, g);
console.log('elementAtGrab', el);
await p.mouse.move(g.x, g.y + 60);
await p.mouse.down();
for (let i=1;i<=8;i++) await p.mouse.move(g.x, g.y+60+ (260*i)/8);
console.log('during drag rackY', await p.evaluate(()=>window.__he.rackY()));
await p.mouse.up();
console.log('after drag rackY', await p.evaluate(()=>window.__he.rackY()), 'level', await p.evaluate(()=>window.__he.level()));
await p.screenshot({ path: 'evidence/shots/dbg.png' });
await b.close();
