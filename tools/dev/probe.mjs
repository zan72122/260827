import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:5173/?quality=medium', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__zoom);
await page.waitForTimeout(2500);
const info = await page.evaluate(async () => {
  const mod = await import('/src/micro/specimen.ts');
  const pyr = await import('/src/micro/tissuePyramid.ts');
  window.__zoom.setProgress(0.34, true);
  await window.__zoom.waitReady(6);
  return {
    hero: mod.HERO_TISSUE,
    heroSlide: mod.HERO_SLIDE,
    covers: [...pyr.LEVEL_COVER_MM],
    state: window.__zoom.getState(),
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
