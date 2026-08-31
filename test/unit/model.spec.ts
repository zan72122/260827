import { describe, expect, it } from 'vitest';
import { replay, summarize, type RunLog } from '../../src/sim/engine';
import { LogBuilder, REFERENCE_MOUNT, buildReferenceLog } from '../../src/sim/scenarios';
import { GH, GW } from '../../src/sim/protocol';
import { REFERENCE_STATE } from '../../src/micro/basePlate';
import { simulateMounting, type MountParams } from '../../src/sim/mounting';
import { actualFindings, computeMetrics, historySupport, imageOnlyCandidates } from '../../src/sim/findings';
import { FIX_OPTIONS, normalizeImmersion, scaleBathTime } from '../../src/sim/counterfactual';

const mean = (a: Float32Array): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return s / a.length;
};
const rowMean = (a: Float32Array, r: number): number => {
  let s = 0;
  for (let x = 0; x < GW; x++) s += a[r * GW + x];
  return s / GW;
};

interface Opt {
  hemSec?: number;
  acidDips?: number;
  hemLevel?: number;
  waterAfterEosin?: number;
  dehydrate?: boolean;
  xylSec?: number;
  scott?: boolean;
  mount?: MountParams;
  airBeforeHem?: number;
}

/** 基準操作から 1 条件だけ変えたログを作る。 */
function run(o: Opt = {}): RunLog {
  const b = new LogBuilder('spec');
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
  if (o.waterAfterEosin) b.refresh('TAP').soak('TAP', o.waterAfterEosin).air(2);
  if (o.dehydrate !== false) {
    b.soak('A95c', 60).air(2).soak('A95d', 60).air(2);
    b.dips('A100c', 10).air(2).dips('A100d', 10).air(2);
  }
  b.dips('X4', 10).air(2).dips('X5', 10).air(2).dips('X6', 10).air(3);
  b.mount(o.mount ?? REFERENCE_MOUNT);
  return b.build();
}

describe('基準操作', () => {
  it('基準ランの代表値が REFERENCE_STATE と一致する（画像生成の基準点）', () => {
    const s = replay(buildReferenceLog());
    expect(mean(s.field.hemaN)).toBeCloseTo(REFERENCE_STATE.hemaN, 2);
    expect(mean(s.field.hemaB)).toBeCloseTo(REFERENCE_STATE.hemaB, 2);
    expect(mean(s.field.eosin)).toBeCloseTo(REFERENCE_STATE.eosin, 2);
  });

  it('基準ランでは大きな問題が出ない', () => {
    const s = replay(buildReferenceLog());
    expect(actualFindings(computeMetrics(s))).toEqual(['no_major_issue']);
  });

  it('同じログと seed なら同じ結果を再現する', () => {
    const log = buildReferenceLog('seed-a');
    const a = replay(log);
    const b = replay(log);
    for (const k of ['hemaN', 'hemaB', 'eosin', 'blue', 'water', 'cleared', 'dried'] as const) {
      for (let i = 0; i < a.field[k].length; i++) expect(a.field[k][i]).toBe(b.field[k][i]);
    }
    expect(a.mount!.air).toEqual(b.mount!.air);
  });

  it('ディップは浸漬レベルの往復から数える（微小な揺れでは増えない）', () => {
    const b = new LogBuilder('dip');
    b.dips('A100a', 7, 1.2);
    const withDips = replay(b.build());
    expect(withDips.baths.find((x) => x.id === 'A100a')!.dips).toBe(7);

    const j = new LogBuilder('jitter');
    // 全面浸漬したまま細かく揺らす: ディップは 1 回だけ
    j.soak('A100a', 3, 1.15);
    for (let i = 0; i < 60; i++) j.soak('A100a', 0.05, 1.15 + (i % 2 ? 0.02 : -0.02));
    const jitter = replay(j.build());
    expect(jitter.baths.find((x) => x.id === 'A100a')!.dips).toBe(1);
  });
});

describe('受け入れ条件 2: 分別の曝露だけを増やすと核が弱まる', () => {
  it('核ヘマトキシリンが下がり、組織の位置とエオジンは一括変更されない', () => {
    const base = replay(run());
    const over = replay(run({ acidDips: 25 }));
    expect(mean(over.field.hemaN)).toBeLessThan(mean(base.field.hemaN) * 0.85);
    expect(mean(over.field.hemaB)).toBeLessThan(mean(base.field.hemaB));
    // エオジンは無関係に変わらない
    expect(mean(over.field.eosin)).toBeCloseTo(mean(base.field.eosin), 2);
    expect(mean(over.field.paraffin)).toBeCloseTo(mean(base.field.paraffin), 4);
  });
});

describe('受け入れ条件 3: 浸漬しなかった範囲だけが変わる', () => {
  it('液面より上だった行は染まらず、浸かった行は基準どおりに染まる', () => {
    const s = replay(run({ hemLevel: 0.55 }));
    const low = rowMean(s.field.hemaN, 1);
    const high = rowMean(s.field.hemaN, GH - 2);
    expect(low).toBeGreaterThan(0.5);
    expect(high).toBeLessThan(0.05);
    // エオジンは全面浸漬しているので、行によるばらつきは小さいままである
    const eosRows = Array.from({ length: GH }, (_, r) => rowMean(s.field.eosin, r));
    const spread = (Math.max(...eosRows) - Math.min(...eosRows)) / mean(s.field.eosin);
    expect(spread).toBeLessThan(0.05);
  });
});

describe('受け入れ条件 4: エオジン後の水・脱水は核とは別に効く', () => {
  it('エオジンの後に水へ戻すとエオジンだけが薄くなる', () => {
    const base = replay(run());
    const washed = replay(run({ waterAfterEosin: 40 }));
    expect(mean(washed.field.eosin)).toBeLessThan(mean(base.field.eosin) * 0.75);
    expect(mean(washed.field.hemaN)).toBeCloseTo(mean(base.field.hemaN), 2);
  });

  it('脱水を省くと残留水分が増えて透徹が進まない（曇りの原因）', () => {
    const base = replay(run());
    const nodry = replay(run({ dehydrate: false }));
    expect(mean(nodry.field.water)).toBeGreaterThan(mean(base.field.water) * 3);
    expect(mean(nodry.field.cleared)).toBeLessThan(mean(base.field.cleared) * 0.3);
    expect(actualFindings(computeMetrics(nodry))).toContain('haze');
    // 核染色は無関係に変わらない
    expect(mean(nodry.field.hemaN)).toBeCloseTo(mean(base.field.hemaN), 2);
  });
});

describe('受け入れ条件 5: 封入の量と接触経路が結果を変える', () => {
  it('速く下ろすと気泡が増える', () => {
    const slow = simulateMounting(REFERENCE_MOUNT);
    const fast = simulateMounting({ ...REFERENCE_MOUNT, angleSamples: [{ t: 0, deg: 30 }, { t: 0.1, deg: 0 }] });
    expect(mean(slow.air)).toBeLessThan(0.01);
    expect(mean(fast.air)).toBeGreaterThan(0.2);
  });

  it('封入剤が少ないと被覆できる面積が減る', () => {
    const enough = simulateMounting(REFERENCE_MOUNT);
    const few = simulateMounting({ ...REFERENCE_MOUNT, volumeUl: 6 });
    const coveredArea = (m: { coverage: Float32Array }): number => mean(m.coverage);
    expect(coveredArea(enough)).toBeGreaterThan(0.99);
    expect(few.bubbles.length).toBeGreaterThan(0);
  });

  it('封入剤を切片から離れた位置に少量落とすと切片に未充填が出る', () => {
    const off = simulateMounting({
      ...REFERENCE_MOUNT,
      volumeUl: 10,
      dropY: 5,
      angleSamples: [{ t: 0, deg: 30 }, { t: 0.5, deg: 0 }],
    });
    expect(mean(off.coverage)).toBeLessThan(0.95);
  });
});

describe('受け入れ条件 6: 似た所見を異なる履歴から作り分けられる', () => {
  it('過分別と核染色不足はどちらも「核が淡い」を出すが、履歴で区別できる', () => {
    const over = replay(run({ acidDips: 25 }));
    const short = replay(run({ hemSec: 45 }));
    const mo = computeMetrics(over);
    const ms = computeMetrics(short);
    expect(actualFindings(mo)).toContain('nuc_pale');
    expect(actualFindings(ms)).toContain('nuc_pale');

    // 画像だけからは両方が候補になる
    const cands = imageOnlyCandidates(actualFindings(mo));
    expect(cands).toContain('over_diff');
    expect(cands).toContain('hema_short');

    // 履歴を見ると支持される原因が分かれる
    const so = historySupport(summarize(run({ acidDips: 25 })), over, mo).map((x) => x.cause);
    const ss = historySupport(summarize(run({ hemSec: 45 })), short, ms).map((x) => x.cause);
    expect(so).toContain('over_diff');
    expect(so).not.toContain('hema_short');
    expect(ss).toContain('hema_short');
    expect(ss).not.toContain('over_diff');
  });
});

describe('受け入れ条件 7: 練習と実践で標本状態が一致する', () => {
  it('同じ入力ログなら、モード情報を持たないシミュレーションは同じ結果になる', () => {
    // 標本状態は RunLog（槽・レベル・交換・封入）だけから決まる。
    // モードは案内とフィードバックのタイミングにしか影響しない。
    const log = run({ hemSec: 120, acidDips: 8 });
    const a = replay(log);
    const b = replay(JSON.parse(JSON.stringify(log)) as RunLog);
    expect(mean(a.field.hemaN)).toBe(mean(b.field.hemaN));
    expect(mean(a.field.eosin)).toBe(mean(b.field.eosin));
    expect(computeMetrics(a)).toEqual(computeMetrics(b));
  });
});

describe('乾燥と持ち越し', () => {
  it('通常の移動に必要な数秒では乾燥障害が起きない', () => {
    const b = new LogBuilder('dry');
    b.soak('X1', 180).air(3).soak('X2', 180).air(8);
    b.dips('A100a', 10).air(6).dips('A95a', 10).air(9);
    const s = replay(b.build());
    expect(mean(s.field.dried)).toBe(0);
  });

  it('長く空気中に置くと乾燥が進み、縁から先に強く出る', () => {
    const b = new LogBuilder('dry2');
    b.soak('X1', 180).air(3).dips('A100a', 10).air(85);
    const s = replay(b.build());
    expect(mean(s.field.dried)).toBeGreaterThan(0.3);
    const edge = s.field.dried[7 * GW + 0];
    const center = s.field.dried[7 * GW + Math.floor(GW / 2)];
    expect(edge).toBeGreaterThan(center);
  });

  it('1 枚の持ち込みで大きな新鮮槽が失活しない', () => {
    const s = replay(buildReferenceLog());
    for (const b of s.baths) {
      expect(b.water).toBeLessThan(0.4);
    }
  });
});

describe('反実仮想', () => {
  it('分別を減らすと過分別の所見が解消する', () => {
    const log = run({ acidDips: 25 });
    const before = actualFindings(computeMetrics(replay(log)));
    expect(before).toContain('nuc_pale');
    const fix = FIX_OPTIONS.find((f) => f.id === 'acid_less')!;
    const after = actualFindings(computeMetrics(replay(fix.apply(log))));
    expect(after).not.toContain('nuc_pale');
  });

  it('浸漬を全面に直すと帯状の未染色が解消する', () => {
    const log = run({ hemLevel: 0.55 });
    expect(actualFindings(computeMetrics(replay(log)))).toContain('band_weak');
    const fixed = normalizeImmersion(log);
    expect(actualFindings(computeMetrics(replay(fixed)))).not.toContain('band_weak');
  });

  it('槽の時間を伸縮しても他の槽の履歴は保たれる', () => {
    const log = run();
    const scaled = scaleBathTime(log, ['HEM'], 0.25);
    const a = summarize(log);
    const b = summarize(scaled);
    expect(b.visits.length).toBe(a.visits.length);
    const hemA = a.visits.find((v) => v.bathId === 'HEM')!;
    const hemB = b.visits.find((v) => v.bathId === 'HEM')!;
    expect(hemB.submergedSec).toBeLessThan(hemA.submergedSec * 0.4);
    const eosA = a.visits.find((v) => v.bathId === 'EOS')!;
    const eosB = b.visits.find((v) => v.bathId === 'EOS')!;
    expect(eosB.submergedSec).toBeCloseTo(eosA.submergedSec, 1);
  });
});

describe('水の交換', () => {
  it('同じ水に出し入れするだけでは交換にならない（世代が増えない）', () => {
    const same = new LogBuilder('w1');
    same.soak('HEM', 60).air(2).refresh('TAP');
    for (let i = 0; i < 3; i++) same.dips('TAP', 4, 1.0).air(2);
    const s1 = replay(same.build());
    expect(s1.baths.find((b) => b.id === 'TAP')!.generation).toBe(1);

    const changed = new LogBuilder('w2');
    changed.soak('HEM', 60).air(2);
    for (let i = 0; i < 3; i++) changed.refresh('TAP').dips('TAP', 4, 1.0).air(2);
    const s2 = replay(changed.build());
    expect(s2.baths.find((b) => b.id === 'TAP')!.generation).toBe(3);
    // 交換したほうが境界層に残る色素が少ない
    expect(s2.baths.find((b) => b.id === 'TAP')!.dye).toBeLessThanOrEqual(
      s1.baths.find((b) => b.id === 'TAP')!.dye,
    );
  });
});
