// Capture the required review states directly, at full quality.
import { withPage, DEVICES } from './capture.mjs';

const STATES = [
  ['pour', 'scene=pour'],
  ['freezing', 'scene=freezing'],
  ['innerout', 'scene=innerOut'],
  ['demold', 'scene=demold'],
  ['lit', 'scene=lit'],
  ['finale-half', 'scene=finale&progress=0.45'],
  ['finale-all', 'scene=finale&progress=1'],
];

const devices = (process.argv[2] || Object.keys(DEVICES).join(',')).split(',');
const only = process.argv[3];

for (const dev of devices) {
  for (const [name, qs] of STATES) {
    if (only && only !== name) continue;
    await withPage(dev, async (page, shot) => {
      await page.waitForTimeout(name.startsWith('finale') ? 9000 : 3500);
      await shot(`state-${dev}-${name}`);
      console.log(`${dev} ${name}`);
    }, { settle: 2500, qs: '?' + qs + '&maxdt=0.3' });
  }
}
