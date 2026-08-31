import { BATH_INDEX, TEACHING } from './protocol';
import { AIR, TICK, emptyLog, encodeLevel, type RunLog } from './engine';
import type { MountParams } from './mounting';

/** ログを組み立てるヘルパー（基準例・テスト・反実仮想の生成に使う）。 */
export class LogBuilder {
  log: RunLog;
  constructor(seed = 'reference') {
    this.log = emptyLog(seed);
  }
  private push(bath: number, level: number): void {
    this.log.bath.push(bath);
    this.log.level.push(encodeLevel(level));
  }
  /** 静置浸漬。level 1.15 は切片全体が液面下（余裕あり）。 */
  soak(bathId: string, seconds: number, level = 1.15): this {
    const b = BATH_INDEX[bathId];
    const n = Math.round(seconds / TICK);
    for (let i = 0; i < n; i++) this.push(b, level);
    return this;
  }
  /** ディップ。1 回の往復 = 1 dip。反射神経を測らないので周期は一定。 */
  dips(bathId: string, count: number, periodSec = 1.2, level = 1.15): this {
    const b = BATH_INDEX[bathId];
    const half = Math.max(1, Math.round(periodSec / 2 / TICK));
    for (let c = 0; c < count; c++) {
      for (let i = 0; i < half; i++) this.push(b, level * ((i + 1) / half));
      for (let i = 0; i < half; i++) this.push(b, level * (1 - (i + 1) / half) - 0.2);
    }
    return this;
  }
  /** 一部しか浸けない（液面より上の領域を作る）。 */
  partialSoak(bathId: string, seconds: number, level: number): this {
    return this.soak(bathId, seconds, level);
  }
  /** 空気中（移動・液切り）。 */
  air(seconds: number): this {
    const n = Math.round(seconds / TICK);
    for (let i = 0; i < n; i++) this.push(AIR, -0.25);
    return this;
  }
  refresh(jarId: string): this {
    this.log.marks.push({ tick: this.log.bath.length, kind: 'refresh', jar: jarId });
    return this;
  }
  mount(p: MountParams): this {
    this.log.mount = p;
    return this;
  }
  /** 水道水3回交換（毎回容器の水を入れ替えてから浸ける）。 */
  tapWashThreeChanges(dipsPerChange = 6): this {
    for (let i = 0; i < 3; i++) {
      this.refresh('TAP');
      this.dips('TAP', dipsPerChange, 1.0);
      this.air(2);
    }
    return this;
  }
  build(): RunLog {
    return this.log;
  }
}

export const REFERENCE_MOUNT: MountParams = {
  volumeUl: 26,
  dropY: 27,
  dropX: 0,
  slipY: 2,
  angleSamples: [
    { t: 0, deg: 30 },
    { t: 0.6, deg: 20 },
    { t: 1.4, deg: 10 },
    { t: 2.2, deg: 3 },
    { t: 2.8, deg: 0 },
  ],
};

/**
 * 基準例（教材上の「うまくいった操作」）。
 * S1 の順序に従い、S1 が幅を持って示す条件（核染色 1〜5 分、エオジン 30 秒〜3 分）
 * については TEACHING の教材設定値を用いる。唯一の臨床的正解ではない。
 */
export function buildReferenceLog(seed = 'reference'): RunLog {
  const b = new LogBuilder(seed);
  b.soak('X1', 180).air(3);
  b.soak('X2', 180).air(3);
  b.soak('X3', 180).air(3);
  b.dips('A100a', 10).air(2);
  b.dips('A100b', 10).air(2);
  b.dips('A95a', 10).air(2);
  b.dips('A95b', 10).air(2);
  b.refresh('DI').dips('DI', 10, 1.0).soak('DI', 10).air(2);
  b.soak('HEM', TEACHING.hematoxylinTargetSec).air(3);
  b.tapWashThreeChanges();
  b.dips('ACID', TEACHING.differentiationTargetDips, 1.0).air(2);
  b.tapWashThreeChanges();
  b.dips('SCOTT', 10, 1.0).air(2);
  b.tapWashThreeChanges();
  b.refresh('DI').dips('DI', 8, 1.0).air(4); // 余分な水を切る
  b.dips('A70', 10).air(2);
  b.soak('EOS', TEACHING.eosinTargetSec).air(2);
  b.soak('A95c', 60).air(2);
  b.soak('A95d', 60).air(2);
  b.dips('A100c', 10).air(2);
  b.dips('A100d', 10).air(2);
  b.dips('X4', 10).air(2);
  b.dips('X5', 10).air(2);
  b.dips('X6', 10).air(3);
  b.mount(REFERENCE_MOUNT);
  return b.build();
}
