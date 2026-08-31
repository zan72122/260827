import { describe, it } from 'vitest';
import { writePng } from '../util/png';
import { proceduralColonSchematic } from '../../src/micro/basePlate';
import { compose } from '../../src/micro/compose';
import { fieldsFromState } from '../../src/micro/fields';
import { replay, type RunLog } from '../../src/sim/engine';
import { LogBuilder, REFERENCE_MOUNT } from '../../src/sim/scenarios';
import type { MountParams } from '../../src/sim/mounting';

interface Opt { hemSec?: number; acidDips?: number; hemLevel?: number; waterAfterEosin?: number; dehydrate?: boolean; xylSec?: number; scott?: boolean; mount?: MountParams; airBeforeHem?: number }
function run(o: Opt = {}): RunLog {
  const b = new LogBuilder('v');
  const xs = o.xylSec ?? 180;
  b.soak('X1', xs).air(3).soak('X2', xs).air(3).soak('X3', xs).air(3);
  b.dips('A100a', 10).air(2).dips('A100b', 10).air(2).dips('A95a', 10).air(2).dips('A95b', 10).air(2);
  b.refresh('DI').dips('DI', 10, 1.0).soak('DI', 10).air(o.airBeforeHem ?? 2);
  b.soak('HEM', o.hemSec ?? 180, o.hemLevel ?? 1.15).air(3);
  b.tapWashThreeChanges();
  b.dips('ACID', o.acidDips ?? 5, 1.0).air(2);
  b.tapWashThreeChanges();
  if (o.scott !== false) b.dips('SCOTT', 10, 1.0).air(2);
  b.tapWashThreeChanges();
  b.refresh('DI').dips('DI', 8, 1.0).air(4);
  b.dips('A70', 10).air(2).soak('EOS', 60).air(2);
  if (o.waterAfterEosin) { b.refresh('TAP').soak('TAP', o.waterAfterEosin).air(2); }
  if (o.dehydrate !== false) {
    b.soak('A95c', 60).air(2).soak('A95d', 60).air(2);
    b.dips('A100c', 10).air(2).dips('A100d', 10).air(2);
  }
  b.dips('X4', 10).air(2).dips('X5', 10).air(2).dips('X6', 10).air(3);
  b.mount(o.mount ?? REFERENCE_MOUNT);
  return b.build();
}

describe('preview', () => {
  it('renders variants', () => {
    const plate = proceduralColonSchematic(760, 570, 'colon');
    const cases: [string, RunLog][] = [
      ['reference', run()],
      ['overdiff', run({ acidDips: 25 })],
      ['short-hema', run({ hemSec: 45 })],
      ['partial', run({ hemLevel: 0.55 })],
      ['water-after-eosin', run({ waterAfterEosin: 40 })],
      ['no-dehydrate', run({ dehydrate: false })],
      ['short-xylene', run({ xylSec: 12 })],
      ['no-scott', run({ scott: false })],
      ['dried', run({ airBeforeHem: 120 })],
      ['fast-coverslip', run({ mount: { ...REFERENCE_MOUNT, angleSamples: [{ t: 0, deg: 30 }, { t: 0.12, deg: 0 }] } })],
      ['low-mountant', run({ mount: { ...REFERENCE_MOUNT, volumeUl: 9, dropY: 14, angleSamples: [{ t: 0, deg: 30 }, { t: 0.5, deg: 0 }] } })],
    ];
    for (const [name, log] of cases) {
      const st = replay(log);
      const img = compose(plate, fieldsFromState(st), { seed: name });
      writePng(`evidence/case-${name}.png`, img.data, img.width, img.height);
    }
  }, 120000);
});
