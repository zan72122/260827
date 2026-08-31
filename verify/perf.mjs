/** Frame cost, measured. Software rasteriser here: a lower bound, not a phone. */
import { launch, grab, drag, stats, settle, PORTRAIT } from './harness.mjs';
const low = process.argv.includes('--low');
const { browser, page } = await launch(PORTRAIT, `http://127.0.0.1:4173/?noadapt${low ? '&q=low' : ''}`);
await settle(page, 30);
const measure = async (label) => {
  const r = await page.evaluate(() => new Promise((res) => {
    const t = []; let last = performance.now(); let n = 0;
    const step = () => {
      const now = performance.now(); t.push(now - last); last = now;
      if (++n < 120) requestAnimationFrame(step);
      else { t.sort((a, b) => a - b); res({ median: t[60], p95: t[113], mean: t.reduce((a, b) => a + b) / t.length }); }
    };
    requestAnimationFrame(step);
  }));
  const s = await stats(page);
  console.log(`${label}: median ${r.median.toFixed(1)} ms  p95 ${r.p95.toFixed(1)} ms  | ${s.triangles} tris, ${s.calls} draw calls`);
};
await measure(low ? 'idle (low quality)' : 'idle (high quality)');
const full = (await stats(page)).strokePx;
let p = await grab(page);
await drag(page, p, full * 0.5, 6);
await measure(low ? 'mid-cut (low quality)' : 'mid-cut (high quality)');
const cost = await page.evaluate(() => window.__spanbaum.cutCost(150));
console.log(`  per-frame cut work (CPU, this game's own share): shaving ${cost.shavingMs.toFixed(3)} ms + blank ${cost.blankMs.toFixed(3)} ms = ${cost.totalMs.toFixed(3)} ms`);
console.log('  NOTE: the frame times above come from a software rasteriser in a');
console.log('  container. They are NOT a device measurement and must not be read as one.');
await browser.close();
