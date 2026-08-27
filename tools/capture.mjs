/**
 * capture.mjs — drives the game through every stage of the dive on every target
 * screen and writes the frames out, plus a JSON report of where the landmark landed.
 *
 *   node tools/capture.mjs [baseUrl] [outDir] [--devices=a,b] [--quality=high]
 *
 * The landmark positions in the report are the objective check for
 * "同一ランドマークを見失わない": the follicle must sit on the same screen anchor at
 * every magnification, not merely look similar.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const flag = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};

const BASE = positional[0] ?? 'http://localhost:5173/';
const OUT = positional[1] ?? 'captures/run';
const QUALITY = flag('quality', 'high');

/** Real logical sizes; deviceScaleFactor is kept at 2 so files stay manageable. */
const DEVICES = {
  'iphone-portrait': { width: 390, height: 844, dsf: 2 },
  'iphone-landscape': { width: 844, height: 390, dsf: 2 },
  'iphone-pro-max-portrait': { width: 430, height: 932, dsf: 2 },
  'ipad-portrait': { width: 834, height: 1194, dsf: 2 },
  'ipad-landscape': { width: 1194, height: 834, dsf: 2 },
  // Same phone, reduced-motion preference honoured.
  'iphone-portrait-reduced': { width: 390, height: 844, dsf: 2 },
};

const wanted = flag('devices', '')
  .split(',')
  .filter(Boolean);
const deviceNames = wanted.length ? wanted : Object.keys(DEVICES);

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

const report = { base: BASE, quality: QUALITY, devices: {}, consoleErrors: [] };

for (const name of deviceNames) {
  const d = DEVICES[name];
  if (!d) {
    console.warn('unknown device', name);
    continue;
  }
  const reduced = name.includes('reduced');
  const context = await browser.newContext({
    viewport: { width: d.width, height: d.height },
    deviceScaleFactor: d.dsf,
    isMobile: true,
    hasTouch: true,
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${name}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`${name}: pageerror ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`${name}: requestfailed ${r.url()}`));

  await page.goto(`${BASE}?quality=${QUALITY}`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !!window.__zoom, null, { timeout: 60000 });
  await page.waitForTimeout(1200);

  const dir = path.join(OUT, name);
  await mkdir(dir, { recursive: true });

  const points = await page.evaluate(() => window.__zoom.capturePoints);
  const shots = [];
  for (const pt of points) {
    await page.evaluate((p) => window.__zoom.setProgress(p, true), pt.p);
    await page.evaluate(() => window.__zoom.waitReady(6));
    await page.waitForTimeout(650);
    const state = await page.evaluate(() => ({
      state: window.__zoom.getState(),
      landmark: window.__zoom.landmarkScreen(),
      anchor: window.__zoom.anchor(),
    }));
    const file = path.join(dir, `${String(pt.p.toFixed(2)).replace('.', '_')}-${pt.id}.png`);
    await page.screenshot({ path: file });
    shots.push({ ...pt, file, ...state });
  }

  // Ten full round trips, checking the landmark never drifts and memory stays flat.
  const before = await page.evaluate(() => window.__zoom.memory());
  const drift = [];
  for (let i = 0; i < 10; i++) {
    for (const p of [0, 0.25, 0.5, 0.75, 1.0, 0.75, 0.5, 0.25]) {
      await page.evaluate((v) => window.__zoom.setProgress(v, true), p);
      await page.waitForTimeout(60);
    }
    await page.evaluate(() => window.__zoom.setProgress(0.86, true));
    await page.waitForTimeout(160);
    drift.push(await page.evaluate(() => window.__zoom.landmarkScreen()));
  }
  const after = await page.evaluate(() => window.__zoom.memory());

  report.devices[name] = {
    viewport: d,
    shots: shots.map((s) => ({
      id: s.id,
      p: s.p,
      file: s.file,
      fieldMM: s.state.fieldMM,
      objective: s.state.objective,
      totalMag: Math.round(s.state.totalMag),
      levels: [s.state.levelA, s.state.levelB, s.state.levelBlend],
      residentMB: s.state.residentMB,
      landmark: s.landmark,
      anchor: s.anchor,
    })),
    roundTrip: { before, after, drift },
    errors,
  };
  report.consoleErrors.push(...errors);
  await context.close();
}

await browser.close();
await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));

for (const [name, d] of Object.entries(report.devices)) {
  console.log(`\n== ${name} ==`);
  for (const s of d.shots) {
    const dx = (s.landmark.x - s.anchor.x).toFixed(4);
    const dy = (s.landmark.y - s.anchor.y).toFixed(4);
    console.log(
      `  p=${s.p.toFixed(2)} ${s.id.padEnd(10)} field=${String(s.fieldMM.toFixed(3)).padStart(7)}mm ` +
        `obj=${String(s.objective ?? '-').padEnd(4)} lv=${s.levels[0]}->${s.levels[1]}@${(s.levels[2] ?? 0).toFixed(2)} ` +
        `mem=${s.residentMB}MB  landmarkDelta=(${dx}, ${dy})`,
    );
  }
  const mem = d.roundTrip;
  console.log(`  round trip x10: ${mem.before.residentMB}MB -> ${mem.after.residentMB}MB`);
  if (d.errors.length) console.log('  ERRORS:', d.errors.join('\n   '));
}
console.log(`\nconsole errors total: ${report.consoleErrors.length}`);
