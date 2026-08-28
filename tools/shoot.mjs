// Drives the built game in a real browser and captures screenshots.
// Usage: node tools/shoot.mjs <preset> [script]
import { chromium, devices } from 'playwright';
import fs from 'node:fs';

const PRESETS = {
  'iphone-p': { width: 390, height: 844, dpr: 1, touch: true },
  'iphone-l': { width: 844, height: 390, dpr: 1, touch: true },
  'ipad-p': { width: 820, height: 1180, dpr: 1, touch: true },
  'ipad-l': { width: 1180, height: 820, dpr: 1, touch: true },
  desk: { width: 1280, height: 800, dpr: 1, touch: false },
  small: { width: 720, height: 450, dpr: 1, touch: false },
  tiny: { width: 420, height: 260, dpr: 1, touch: false },
  smallp: { width: 450, height: 720, dpr: 1, touch: false },
};

const preset = process.argv[2] ?? 'desk';
const scriptName = process.argv[3] ?? 'boot';
const p = PRESETS[preset];
const reduced = process.env.REDUCED === '1';

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME || undefined,
  args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--no-sandbox', '--disable-dev-shm-usage',
    ...(process.env.ALLOW_AUTOPLAY ? ['--autoplay-policy=no-user-gesture-required'] : []),
  ],
});
const ctx = await browser.newContext({
  viewport: { width: p.width, height: p.height },
  deviceScaleFactor: p.dpr,
  hasTouch: p.touch,
  isMobile: p.touch,
  userAgent: p.touch ? devices['iPhone 13'].userAgent : undefined,
  reducedMotion: reduced ? 'reduce' : 'no-preference',
});
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));

const shot = async (name) => {
  await page.screenshot({ path: `shots/${preset}-${name}.png` });
  console.log('shot', `${preset}-${name}`);
};

// Pointer helpers that emit real Pointer Events, including intermediate moves.
const swipe = async (x0, y0, x1, y1, steps = 16, stepMs = 12) => {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
    await page.waitForTimeout(stepMs);
  }
  await page.mouse.up();
};
const drag = swipe;
const tap = async (x, y) => { await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(40); await page.mouse.up(); };

await page.goto(process.env.URL ?? 'http://127.0.0.1:4173/', { waitUntil: 'load' });
await page.waitForTimeout(2500);

const scripts = JSON.parse(fs.readFileSync(new URL('./scripts.json', import.meta.url), 'utf8'));
const steps = scripts[scriptName] ?? [];
let W = p.width, H = p.height;
const px = (v, axis) => (typeof v === 'string' && v.endsWith('%') ? (parseFloat(v) / 100) * (axis === 'x' ? W : H) : v);

for (const s of steps) {
  if (s.wait) await page.waitForTimeout(s.wait);
  else if (s.shot) await shot(s.shot);
  else if (s.tap) await tap(px(s.tap[0], 'x'), px(s.tap[1], 'y'));
  else if (s.swipe) await swipe(px(s.swipe[0], 'x'), px(s.swipe[1], 'y'), px(s.swipe[2], 'x'), px(s.swipe[3], 'y'), s.steps ?? 16, s.stepMs ?? 12);
  else if (s.drag) await drag(px(s.drag[0], 'x'), px(s.drag[1], 'y'), px(s.drag[2], 'x'), px(s.drag[3], 'y'), s.steps ?? 20, s.stepMs ?? 14);
  else if (s.eval) console.log(s.label ?? 'eval', JSON.stringify(await page.evaluate(s.eval)));
  else if (s.viewport) {
    await page.setViewportSize({ width: s.viewport[0], height: s.viewport[1] });
    W = s.viewport[0]; H = s.viewport[1];
    console.log('viewport', s.viewport.join('x'));
  }
  else if (s.dragStrap) {
    const st = await page.evaluate('window.game.debugState()');
    const from = st.strapCarry, to = st.neckScreen;
    if (!from || !to) { console.log('dragStrap: missing', JSON.stringify(st.strapCarry), JSON.stringify(st.neckScreen)); continue; }
    console.log('dragStrap', JSON.stringify(from), '->', JSON.stringify(to));
    await drag(from[0], from[1], to[0], to[1], 18, 35);
  }
  else if (s.dragBell !== undefined) {
    // Read the live on-screen positions and drag tray bell -> socket.
    const st = await page.evaluate('window.game.debugState()');
    const from = st.trayScreen[s.dragBell.from ?? 0];
    const to = st.socketScreen[s.dragBell.to ?? 0];
    if (!from || !to) { console.log('dragBell: missing', s.dragBell, st.trayScreen?.length, st.socketScreen?.length); continue; }
    console.log('dragBell', JSON.stringify(from), '->', JSON.stringify(to));
    await drag(from[0], from[1], to[0], to[1], s.steps ?? 14, s.stepMs ?? 40);
  }
}

fs.writeFileSync(`shots/${preset}-${scriptName}.log`, logs.join('\n'));
if (logs.length) console.log('--- console ---\n' + logs.slice(0, 40).join('\n'));
await browser.close();
