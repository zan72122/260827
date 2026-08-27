/**
 * Automated playtest: drives the built game in headless Chromium with the
 * exact gestures from the spec (hold, sweeps, circle, fast/slow, short tap,
 * off-canvas) and asserts on the game's debug API. Also captures
 * screenshots into playtest/shots/ for visual review.
 *
 * Usage: npm run build && npm run playtest
 */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shotDir = path.join(root, 'playtest', 'shots');
mkdirSync(shotDir, { recursive: true });

const PORT = 4173;
const results = [];
let failures = 0;

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

async function startServer() {
  const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: root, stdio: 'pipe', detached: true,
  });
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('preview server timeout')), 20000);
    proc.stdout.on('data', (d) => {
      if (String(d).includes('localhost')) { clearTimeout(to); resolve(); }
    });
    proc.on('exit', (c) => reject(new Error(`preview exited ${c}`)));
  });
  return proc;
}

const st = (page) => page.evaluate(() => {
  const g = window.__ffgame;
  return {
    mode: g.mode, fires: g.fires, impact: g.impact, fps: g.fps,
    camQuat: g.camQuat, open: g.openAmount, wetTotal: g.wetTotal(),
    pixelRatio: g.pixelRatio,
  };
});
const wetAt = (page, x, z) => page.evaluate(([a, b]) => window.__ffgame.wetAt(a, b), [x, z]);
const reset = (page) => page.evaluate(() => window.__ffgame.reset());
const fingerFor = (page, i) => page.evaluate((n) => window.__ffgame.fingerPointForSpot(n), i);

/** press at a sequence of screen points over duration ms (single stroke) */
async function stroke(page, pts, durationMs, { hold = 0, screenshotAt = null, shotName = '' } = {}) {
  const steps = Math.max(2, Math.round(durationMs / 16));
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const fi = t * (pts.length - 1);
    const i0 = Math.min(pts.length - 2, Math.floor(fi));
    const k = fi - i0;
    const x = pts[i0].x + (pts[i0 + 1].x - pts[i0].x) * k;
    const y = pts[i0].y + (pts[i0 + 1].y - pts[i0].y) * k;
    await page.mouse.move(x, y);
    await page.waitForTimeout(16);
    if (screenshotAt !== null && Math.abs(t - screenshotAt) < 0.5 / steps) {
      await page.screenshot({ path: path.join(shotDir, shotName) });
    }
  }
  if (hold > 0) await page.waitForTimeout(hold);
  await page.mouse.up();
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });

  try {
    // ============ iPhone portrait ============
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('pageerror', (e) => { check('no page errors', false, String(e)); });
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForFunction(() => !!window.__ffgame, null, { timeout: 15000 });
    // headless SwiftShader runs ~6fps; widen the dt clamp so game time
    // tracks wall time and real-device gesture timings stay meaningful
    await page.evaluate(() => window.__ffgame.setTimeScale(5));

    check('starts in title mode', (await st(page)).mode === 'title');
    await page.screenshot({ path: path.join(shotDir, '01-title-portrait.png') });

    // tap the start droplet (no text anywhere)
    await page.mouse.click(195, 422);
    await page.waitForTimeout(1200);
    check('intro running after start tap', (await st(page)).mode === 'intro');
    await page.screenshot({ path: path.join(shotDir, '02-intro-truck.png') });
    await page.waitForTimeout(2200);
    await page.screenshot({ path: path.join(shotDir, '03-intro-coupling.png') });
    await page.waitForTimeout(1800);
    await page.screenshot({ path: path.join(shotDir, '04-intro-pressurize.png') });
    await page.waitForFunction(() => window.__ffgame.mode === 'play', null, { timeout: 30000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(shotDir, '05-play-idle-portrait.png') });

    // ---- gesture 1: hold still on the center (brick) fire
    {
      const before = (await st(page)).fires;
      const f = await fingerFor(page, 1);
      const q0 = (await st(page)).camQuat;
      await stroke(page, [f, f], 2600, { screenshotAt: 0.5, shotName: '06-spray-hold.png' });
      const after = (await st(page)).fires;
      const q1 = (await st(page)).camQuat;
      check('held spray weakens the targeted fire', before[1] - after[1] > 0.5, `Δ=${(before[1] - after[1]).toFixed(2)}`);
      check('distant fires untouched by center hold',
        before[0] - after[0] < 0.05 && before[2] - after[2] < 0.05,
        `Δ0=${(before[0] - after[0]).toFixed(3)} Δ2=${(before[2] - after[2]).toFixed(3)}`);
      const qd = q0.map((v, i) => Math.abs(v - q1[i])).reduce((a, b) => a + b, 0);
      check('camera did not rotate during spray', qd < 1e-6, `Δq=${qd}`);
      const spotWet = await page.evaluate(() => {
        const p = window.__ffgame.firePos(1);
        return window.__ffgame.wetAt(p.x, p.z);
      });
      check('dwell point is soaked', spotWet > 0.8, `wet=${spotWet.toFixed(2)}`);
    }

    // ---- gesture 2: left→right→left sweep across all three fires
    await reset(page);
    {
      const fl = await fingerFor(page, 0);
      const fr = await fingerFor(page, 2);
      const before = (await st(page)).fires;
      await stroke(page, [fl, fr, fl], 2800, { screenshotAt: 0.35, shotName: '07-spray-sweep.png' });
      const after = (await st(page)).fires;
      // the straight L↔R line passes through fires 0 and 2; the center brick
      // fire sits ~2.4m behind that line and must NOT get extinguished by it
      check('L-R-L sweep weakens both fires on the path', before[0] - after[0] > 0.3 && before[2] - after[2] > 0.3,
        `Δ=[${after.map((v, i) => (before[i] - v).toFixed(2)).join(', ')}]`);
      check('fire off the sweep line barely changes', before[1] - after[1] < 0.25,
        `Δ1=${(before[1] - after[1]).toFixed(2)}`);
      // impact-point continuity across the sweep: bounded speed, no teleporting
      const trace = await page.evaluate(() => window.__ffgame.impactTrace());
      let maxSpeed = 0, minX = Infinity, maxX = -Infinity;
      for (let i = 0; i < trace.length; i++) {
        minX = Math.min(minX, trace[i].x);
        maxX = Math.max(maxX, trace[i].x);
        if (i === 0) continue;
        const d = Math.hypot(trace[i].x - trace[i - 1].x, trace[i].z - trace[i - 1].z);
        const dtI = Math.max(1e-3, trace[i].t - trace[i - 1].t);
        maxSpeed = Math.max(maxSpeed, d / dtI);
      }
      const span = maxX - minX;
      check('impact point sweeps continuously (no teleporting)', trace.length > 10 && span > 3 && maxSpeed < 25,
        `samples=${trace.length} span=${span.toFixed(1)}m maxSpeed=${maxSpeed.toFixed(1)}m/s`);
      const bandWet = await page.evaluate(() => {
        const a = window.__ffgame.firePos(0), b = window.__ffgame.firePos(2);
        let s = 0;
        for (let k = 0; k <= 6; k++) {
          s += window.__ffgame.wetAt(a.x + ((b.x - a.x) * k) / 6, a.z + ((b.z - a.z) * k) / 6) > 0.05 ? 1 : 0;
        }
        return s;
      });
      check('sweep leaves a continuous wet band', bandWet >= 6, `${bandWet}/7 samples wet`);
    }

    // ---- gesture 3: right→left single pass (opposite direction works too)
    await reset(page);
    {
      const fl = await fingerFor(page, 0);
      const fr = await fingerFor(page, 2);
      const before = (await st(page)).fires;
      await stroke(page, [fr, fl], 1500);
      const after = (await st(page)).fires;
      check('R→L sweep also works', before[0] - after[0] > 0.2 && before[2] - after[2] > 0.2,
        `Δ=[${after.map((v, i) => (before[i] - v).toFixed(2)).join(', ')}]`);
    }

    // ---- gesture 4: fast vs slow sweep → gently different wetting
    let fastWet, slowWet;
    await reset(page);
    {
      const fl = await fingerFor(page, 0);
      const fr = await fingerFor(page, 2);
      await stroke(page, [fl, fr], 550);
      // measure midway between spot0 and spot2
      fastWet = await page.evaluate(() => {
        const a = window.__ffgame.firePos(0), b = window.__ffgame.firePos(2);
        return window.__ffgame.wetAt((a.x + b.x) / 2, (a.z + b.z) / 2);
      });
      await reset(page);
      await stroke(page, [fl, fr], 3200);
      slowWet = await page.evaluate(() => {
        const a = window.__ffgame.firePos(0), b = window.__ffgame.firePos(2);
        return window.__ffgame.wetAt((a.x + b.x) / 2, (a.z + b.z) / 2);
      });
      check('slow sweep soaks more than fast sweep', slowWet > fastWet * 1.4 && fastWet > 0.01,
        `fast=${fastWet.toFixed(3)} slow=${slowWet.toFixed(3)}`);
    }

    // ---- gesture 5: circle → ring of wetness
    await reset(page);
    {
      const c = await page.evaluate(() => window.__ffgame.fingerPointForWorld(0, 0, 10.5));
      const R = 90;
      const pts = [];
      for (let a = 0; a <= 20; a++) {
        pts.push({ x: c.x + Math.cos((a / 20) * Math.PI * 2) * R, y: c.y + Math.sin((a / 20) * Math.PI * 2) * R * 0.8 });
      }
      await stroke(page, pts, 2600, { screenshotAt: 0.6, shotName: '08-spray-circle.png' });
      // the wet ring should follow the actual traced loop and leave the
      // loop's center drier than its rim
      const ring = await page.evaluate(() => {
        const g = window.__ffgame;
        const tr = g.impactTrace();
        if (tr.length < 8) return null;
        let cx = 0, cz = 0, minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
        for (const p of tr) {
          cx += p.x; cz += p.z;
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
          minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
        }
        cx /= tr.length; cz /= tr.length;
        const rim = [0.125, 0.375, 0.625, 0.875].map((f) => {
          const p = tr[Math.floor(f * tr.length)];
          return g.wetAt(p.x, p.z);
        });
        return { rim, center: g.wetAt(cx, cz), spanX: maxX - minX, spanZ: maxZ - minZ };
      });
      const rimMean = ring ? ring.rim.reduce((a, b) => a + b, 0) / 4 : 0;
      check('circle gesture wets along the traced loop', !!ring && ring.rim.every((v) => v > 0.1) && ring.spanX > 1.2 && ring.spanZ > 1.2,
        ring ? `rim=[${ring.rim.map((v) => v.toFixed(2))}] span=${ring.spanX.toFixed(1)}x${ring.spanZ.toFixed(1)}m` : 'no trace');
      check('loop center stays drier than its rim', !!ring && ring.center < rimMean * 0.6,
        ring ? `center=${ring.center.toFixed(2)} rimMean=${rimMean.toFixed(2)}` : 'no trace');
    }

    // ---- gesture 6: short tap → brief spray, no crash
    await reset(page);
    {
      const f = await fingerFor(page, 1);
      await page.mouse.move(f.x, f.y);
      await page.mouse.down();
      await page.waitForTimeout(120);
      await page.mouse.up();
      await page.waitForTimeout(500);
      const s = await st(page);
      check('short tap opens then closes the nozzle', s.open < 0.1 && s.wetTotal > 0.01,
        `open=${s.open.toFixed(2)} wet=${s.wetTotal.toFixed(2)}`);
    }

    // ---- gesture 7: finger leaves the canvas mid-stroke (synthetic, off-viewport coords)
    await reset(page);
    {
      const f = await fingerFor(page, 1);
      const err = await page.evaluate(async (start) => {
        const canvas = document.getElementById('game-canvas');
        const fire = (type, x, y) => canvas.dispatchEvent(new PointerEvent(type, {
          pointerId: 99, clientX: x, clientY: y, bubbles: true, isPrimary: true, pointerType: 'touch',
        }));
        try {
          fire('pointerdown', start.x, start.y);
          const waits = (ms) => new Promise((r) => setTimeout(r, ms));
          for (let i = 0; i <= 20; i++) {
            // wander off the bottom-right of the canvas and back
            fire('pointermove', start.x + i * 40, start.y + i * 60);
            await waits(30);
          }
          for (let i = 20; i >= 0; i--) {
            fire('pointermove', start.x + i * 40, start.y + i * 30);
            await waits(30);
          }
          const g = window.__ffgame;
          const stillActive = g.impact.active;
          fire('pointerup', start.x, start.y);
          return { stillActive };
        } catch (e) {
          return { error: String(e) };
        }
      }, f);
      check('gesture survives leaving the canvas', !err.error && err.stillActive === true,
        JSON.stringify(err));
      const s = await st(page);
      check('off-canvas impact stays clamped in the arena',
        Math.abs(s.impact.x) <= 7.6 && s.impact.z >= 3.1 && s.impact.z <= 17.1,
        `impact=(${s.impact.x.toFixed(1)}, ${s.impact.z.toFixed(1)})`);
    }

    // ---- rotation: state survives portrait↔landscape
    await reset(page);
    {
      const f = await fingerFor(page, 0);
      await stroke(page, [f, f], 1500);
      const before = await st(page);
      await page.setViewportSize({ width: 844, height: 390 });
      await page.waitForTimeout(600);
      const after = await st(page);
      const firesKept = before.fires.every((v, i) => Math.abs(v - after.fires[i]) < 0.05);
      const wetKept = Math.abs(before.wetTotal - after.wetTotal) < 0.5;
      check('fire + wet state survive rotation', firesKept && wetKept,
        `fires ${before.fires.map((v) => v.toFixed(2))} → ${after.fires.map((v) => v.toFixed(2))}, wet ${before.wetTotal.toFixed(1)}→${after.wetTotal.toFixed(1)}`);
      await page.screenshot({ path: path.join(shotDir, '09-landscape.png') });
    }

    // ---- landscape spray + full extinguish → calm → replay
    {
      for (let i = 0; i < 3; i++) {
        for (let round = 0; round < 4; round++) {
          const fires = (await st(page)).fires;
          if (fires[i] < 0.03) break;
          const f = await fingerFor(page, i);
          await stroke(page, [f, f], 1600);
          await page.waitForTimeout(120);
        }
      }
      const s = await st(page);
      check('all fires can be put out', s.fires.every((v) => v < 0.05), `fires=[${s.fires.map((v) => v.toFixed(2))}]`);
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(shotDir, '10-calm-after.png') });
      check('calm mode after extinguishing', (await st(page)).mode === 'calm');
      await page.waitForFunction(() => document.getElementById('replay-btn').classList.contains('visible'), null, { timeout: 8000 });
      check('replay button appears', true);
      const box = await page.locator('#replay-btn').boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(400);
      const s2 = await st(page);
      check('replay restores the same layout', s2.mode === 'play' && s2.fires.every((v) => v > 0.9) && s2.wetTotal < 0.5,
        `fires=[${s2.fires.map((v) => v.toFixed(2))}] wet=${s2.wetTotal.toFixed(2)}`);
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(shotDir, '11-replayed.png') });
    }

    // ---- perf snapshot under heavy spray (headless swiftshader = worst case)
    {
      const f = await fingerFor(page, 2);
      await stroke(page, [f, f], 2000);
      const s = await st(page);
      console.log(`INFO  headless-fps=${s.fps.toFixed(1)} pixelRatio=${s.pixelRatio}`);
    }

    // ============ iPad-ish check: skip intro with a tap, finger occlusion geometry
    const page2 = await browser.newPage({ viewport: { width: 820, height: 1180 } });
    await page2.goto(`http://localhost:${PORT}/`);
    await page2.waitForFunction(() => !!window.__ffgame, null, { timeout: 15000 });
    await page2.evaluate(() => window.__ffgame.setTimeScale(5));
    await page2.mouse.click(410, 590); // start
    await page2.waitForTimeout(800);
    await page2.mouse.click(410, 590); // tap during intro = skip
    await page2.waitForTimeout(300);
    check('tap during intro skips to play (first spray reachable without text)',
      (await st(page2)).mode === 'play');
    // finger-vs-impact separation: the impact projects well above the finger
    const sep = await page2.evaluate(() => {
      const g = window.__ffgame;
      const p = g.fingerPointForSpot(1);
      const q = g.screenPointForWorld(g.firePos(1).x, 0, g.firePos(1).z);
      return p.y - q.y; // finger sits this many px below the aim point
    });
    check('impact point sits well above the finger', sep > 80, `${sep.toFixed(0)}px`);
    const fx = await fingerFor(page2, 1);
    await stroke(page2, [fx, fx], 1400, { screenshotAt: 0.7, shotName: '12-ipad-portrait-spray.png' });
    await page2.close();

    await page.close();
  } finally {
    await browser.close();
    try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill(); }
  }

  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
