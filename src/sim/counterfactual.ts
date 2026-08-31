import { AIR, cloneLog, decodeLevel, encodeLevel, type RunLog } from './engine';
import { BATHS, BATH_INDEX } from './protocol';
import type { CauseId } from './findings';
import type { MountParams } from './mounting';

/**
 * 反実仮想（1 条件だけ変えたモデル上の比較）。
 * **実際に染め直した対照標本ではない。** 記録した操作ログを 1 箇所だけ書き換えて再生する。
 */
export interface FixOption {
  id: string;
  ja: string;
  /** どの原因への対処か */
  cause: CauseId;
  apply: (log: RunLog) => RunLog;
}

/** 指定した槽での滞在時間を倍率で伸縮する（ディップ波形の形は保つ）。 */
export function scaleBathTime(log: RunLog, bathIds: string[], factor: number): RunLog {
  const set = new Set(bathIds.map((id) => BATH_INDEX[id]));
  const out = cloneLog(log);
  const bath: number[] = [];
  const level: number[] = [];
  const remap: { from: number; to: number }[] = [];
  let i = 0;
  while (i < out.bath.length) {
    const b = out.bath[i];
    let j = i;
    while (j < out.bath.length && out.bath[j] === b) j++;
    const runLen = j - i;
    const newLen = set.has(b) ? Math.max(1, Math.round(runLen * factor)) : runLen;
    remap.push({ from: i, to: bath.length });
    for (let k = 0; k < newLen; k++) {
      const src = i + Math.min(runLen - 1, Math.floor((k * runLen) / newLen));
      bath.push(b);
      level.push(out.level[src]);
    }
    i = j;
  }
  out.bath = bath;
  out.level = level;
  out.marks = remapMarks(out.marks, remap, log.bath.length, bath.length);
  return out;
}

/** 各訪問の最大浸漬レベルが目標に届くよう、その訪問のレベルを一律に拡大する。 */
export function normalizeImmersion(log: RunLog, target = 1.15): RunLog {
  const out = cloneLog(log);
  let i = 0;
  while (i < out.bath.length) {
    const b = out.bath[i];
    let j = i;
    while (j < out.bath.length && out.bath[j] === b) j++;
    if (b !== AIR) {
      let max = -1;
      for (let k = i; k < j; k++) max = Math.max(max, decodeLevel(out.level[k]));
      if (max > 0.05 && max < target) {
        const s = target / max;
        for (let k = i; k < j; k++) {
          const v = decodeLevel(out.level[k]);
          out.level[k] = encodeLevel(v > 0 ? v * s : v);
        }
      }
    }
    i = j;
  }
  return out;
}

/** ある槽より後に現れる、指定した槽での滞在を取り除く。 */
export function removeAfter(log: RunLog, afterBathId: string, removeIds: string[]): RunLog {
  const afterIdx = BATH_INDEX[afterBathId];
  const rm = new Set(removeIds.map((id) => BATH_INDEX[id]));
  const out = cloneLog(log);
  const bath: number[] = [];
  const level: number[] = [];
  const remap: { from: number; to: number }[] = [];
  let seen = false;
  let i = 0;
  while (i < out.bath.length) {
    const b = out.bath[i];
    let j = i;
    while (j < out.bath.length && out.bath[j] === b) j++;
    if (b === afterIdx) seen = true;
    remap.push({ from: i, to: bath.length });
    if (!(seen && rm.has(b))) {
      for (let k = i; k < j; k++) {
        bath.push(b);
        level.push(out.level[k]);
      }
    }
    i = j;
  }
  out.bath = bath;
  out.level = level;
  out.marks = remapMarks(out.marks, remap, log.bath.length, bath.length);
  return out;
}

export function patchMount(log: RunLog, patch: Partial<MountParams>): RunLog {
  const out = cloneLog(log);
  if (out.mount) out.mount = { ...out.mount, ...patch };
  return out;
}

function remapMarks(marks: RunLog['marks'], remap: { from: number; to: number }[], oldLen: number, newLen: number): RunLog['marks'] {
  return marks.map((m) => {
    let to = newLen;
    for (let i = remap.length - 1; i >= 0; i--) {
      if (remap[i].from <= m.tick) {
        to = remap[i].to + (m.tick - remap[i].from);
        break;
      }
    }
    void oldLen;
    return { ...m, tick: Math.min(newLen, Math.max(0, to)) };
  });
}

const SMOOTH_LOWER = [
  { t: 0, deg: 30 },
  { t: 0.8, deg: 20 },
  { t: 1.7, deg: 10 },
  { t: 2.6, deg: 3 },
  { t: 3.2, deg: 0 },
];

/** 「次にどの 1 条件を変えるか」の選択肢。 */
export const FIX_OPTIONS: FixOption[] = [
  { id: 'hema_more', ja: 'ヘマトキシリンの時間を長くする', cause: 'hema_short', apply: (l) => scaleBathTime(l, ['HEM'], 1.8) },
  { id: 'hema_less', ja: 'ヘマトキシリンの時間を短くする', cause: 'hema_long', apply: (l) => scaleBathTime(l, ['HEM'], 0.5) },
  { id: 'acid_less', ja: '分別（酸アルコール）を短く／回数を減らす', cause: 'over_diff', apply: (l) => scaleBathTime(l, ['ACID'], 0.35) },
  { id: 'acid_more', ja: '分別（酸アルコール）を長く／回数を増やす', cause: 'under_diff', apply: (l) => scaleBathTime(l, ['ACID'], 2.2) },
  { id: 'scott_more', ja: 'Scott 液での色出しを十分に行う', cause: 'no_blue', apply: (l) => scaleBathTime(l, ['SCOTT'], 2.5) },
  { id: 'xylene_more', ja: '脱パラフィン（キシレン）の時間を長くする', cause: 'deparaffin', apply: (l) => scaleBathTime(l, ['X1', 'X2', 'X3'], 2.5) },
  { id: 'immerse_full', ja: '各槽で切片全体を液面下に入れる', cause: 'partial_immersion', apply: (l) => normalizeImmersion(l) },
  { id: 'eosin_more', ja: 'エオジンの時間を長くする', cause: 'eosin_short', apply: (l) => scaleBathTime(l, ['EOS'], 2) },
  { id: 'eosin_less', ja: 'エオジンの時間を短くする', cause: 'eosin_long', apply: (l) => scaleBathTime(l, ['EOS'], 0.5) },
  { id: 'no_water_after_eosin', ja: 'エオジンの後に水系の槽へ戻さない', cause: 'eosin_washed', apply: (l) => removeAfter(l, 'EOS', ['TAP', 'DI', 'A70']) },
  { id: 'dehydrate_more', ja: '脱水（95%・100%）を十分に行う', cause: 'dehydrate', apply: (l) => scaleBathTime(l, ['A95c', 'A95d', 'A100c', 'A100d'], 2.2) },
  { id: 'clearing_more', ja: '透徹（キシレン）を十分に行う', cause: 'clearing', apply: (l) => scaleBathTime(l, ['X4', 'X5', 'X6'], 2.2) },
  { id: 'mount_slower', ja: 'カバーガラスをゆっくり下ろす', cause: 'mount_speed', apply: (l) => patchMount(l, { angleSamples: SMOOTH_LOWER }) },
  { id: 'mount_volume', ja: '封入剤の量を 26 µL にする', cause: 'mount_volume', apply: (l) => patchMount(l, { volumeUl: 26 }) },
  {
    id: 'mount_center',
    ja: '封入剤をカバーガラスの中央に落とす',
    cause: 'mount_position',
    apply: (l) => patchMount(l, { dropY: (l.mount?.slipY ?? 2) + 25, dropX: 0 }),
  },
];

export const BATH_IDS = BATHS.map((b) => b.id);
