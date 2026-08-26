// Stroke↔band correspondence evidence: after each drive completes, overlay
// the child's raw stroke (yellow) and the conditioner trace (cyan) on the
// settled wide shot, so a reviewer can match one-stroke differences to the
// resurfaced band.
import { launch, openGame, skipIntro, drawStroke, densify, waitPhase } from './helpers.mjs';
import fs from 'node:fs';

const CASES = [
  { id: 'straight', pts: [{ x: 0, z: 10 }, { x: 0, z: -12 }] },
  { id: 'bulge-right', pts: [{ x: 0, z: 10 }, { x: 5.5, z: 3 }, { x: 5.5, z: -5 }, { x: 0.5, z: -12 }] },
  { id: 'bulge-left', pts: [{ x: 0, z: 10 }, { x: -5.5, z: 3 }, { x: -5.5, z: -5 }, { x: -0.5, z: -12 }] },
  { id: 'gentle-s', pts: [{ x: 0, z: 10 }, { x: 4, z: 4 }, { x: -4, z: -4 }, { x: 0.5, z: -11 }] }
];

fs.mkdirSync('screenshots/evidence', { recursive: true });
const browser = await launch();

for (const tc of CASES) {
  console.log('evidence:', tc.id);
  const { ctx, page } = await openGame(browser, { width: 390, height: 844, dpr: 2 });
  await skipIntro(page);
  await drawStroke(page, densify(tc.pts, 34), { durationMs: 1100 });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__test.setTimeScale(3));
  await waitPhase(page, 'bandview', 180000);
  await page.evaluate(() => window.__test.setTimeScale(1));
  await page.waitForTimeout(7000);   // camera settles on the wide view

  // clean band shot first
  await page.screenshot({ path: `screenshots/evidence/${tc.id}-1-band.png` });

  // then the same frame with stroke (yellow) + conditioner trace (cyan) overlaid
  await page.evaluate(() => {
    const T = window.__test;
    const cv = document.createElement('canvas');
    cv.id = 'evidence-overlay';
    cv.width = innerWidth * devicePixelRatio;
    cv.height = innerHeight * devicePixelRatio;
    cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:50';
    document.body.appendChild(cv);
    const g = cv.getContext('2d');
    g.scale(devicePixelRatio, devicePixelRatio);
    const draw = (pts, color, w) => {
      if (!pts || pts.length < 2) return;
      g.strokeStyle = color;
      g.lineWidth = w;
      g.setLineDash([10, 8]);
      g.beginPath();
      pts.forEach((p, i) => {
        const s = T.worldToScreen(p.x, p.z);
        i ? g.lineTo(s.x, s.y) : g.moveTo(s.x, s.y);
      });
      g.stroke();
    };
    draw(T.lastStroke(), 'rgba(255,210,40,0.95)', 4);
    g.setLineDash([]);
    draw(T.bandTrace(), 'rgba(40,220,255,0.9)', 2);
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `screenshots/evidence/${tc.id}-2-overlay.png` });
  fs.writeFileSync(`screenshots/evidence/${tc.id}-data.json`, JSON.stringify(await page.evaluate(() => ({
    stroke: window.__test.lastStroke(),
    band: window.__test.bandTrace()
  })), null, 1));
  await ctx.close();
}
await browser.close();
console.log('EVIDENCE OK');
