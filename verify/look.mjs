import { launch, shot, stats, PORTRAIT, LANDSCAPE } from './harness.mjs';
const land = process.argv.includes('--landscape');
const { browser, page, errors } = await launch(land ? LANDSCAPE : PORTRAIT);
const s = await stats(page);
console.log('phase', s.phase, 'tri', s.triangles, 'calls', s.calls,
  'strokePx', s.strokePx.toFixed(1), 'handleOffsetPx', s.handleOffsetPx.toFixed(1),
  'contactPx', s.contactPx.map(v=>v.toFixed(0)).join(','), 'anchorPx', s.anchorPx.map(v=>v.toFixed(0)).join(','));
await shot(page, land ? 'look-landscape' : 'look');
if (errors.length) console.log('ERRORS', errors);
await browser.close();
