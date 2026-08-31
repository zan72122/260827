import { PROTOCOL_STEPS } from './protocol';
import type { RunSummary } from './engine';

/**
 * 手順書のどこまで進んだかを、訪問履歴から推定する。
 * 練習モードの「誤操作を止める」設定でのみ使う。実践モードでは正解の槽を提示しない。
 */
export function currentStepIndex(sum: RunSummary): number {
  let step = 0;
  const seen = new Set<string>();
  for (const v of sum.visits) {
    while (step < PROTOCOL_STEPS.length && PROTOCOL_STEPS[step].baths.length === 0) step++;
    if (step >= PROTOCOL_STEPS.length) return PROTOCOL_STEPS.length - 1;
    const need = PROTOCOL_STEPS[step].baths;
    if (need.includes(v.bathId) && v.submergedSec > 0.4) {
      seen.add(v.bathId);
      if (need.every((b) => seen.has(b))) {
        step++;
        seen.clear();
      }
    }
  }
  return Math.min(step, PROTOCOL_STEPS.length - 1);
}

export function expectedBaths(sum: RunSummary): string[] {
  return PROTOCOL_STEPS[currentStepIndex(sum)].baths;
}

export function expectedStepText(sum: RunSummary): string {
  const s = PROTOCOL_STEPS[currentStepIndex(sum)];
  return `${s.no}. ${s.ja}（${s.cond}）`;
}
