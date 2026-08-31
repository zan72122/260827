import { GH, GW, TEACHING } from './protocol';
import type { SimState } from './state';
import { REFERENCE_STATE } from '../micro/basePlate';
import type { RunSummary } from './engine';

// ---------------------------------------------------------------------------
// 完成標本から読み取れる指標
// ---------------------------------------------------------------------------

export interface Metrics {
  hemaN: number;
  hemaB: number;
  blue: number;
  eosin: number;
  paraffin: number;
  haze: number;
  dried: number;
  bubble: number;
  unfilled: number;
  /** 核 / 背景のヘマトキシリン比 */
  nucContrast: number;
  /** 核染色のばらつき（変動係数） */
  unevenNuc: number;
  unevenEosin: number;
  /** ほとんど染まっていない領域の割合 */
  unstainedFrac: number;
  /** 染色が乏しい領域の位置（該当が無ければ null） */
  weakRegion: '上側' | '下側' | '縁' | 'まだら' | null;
}

const mean = (a: Float32Array): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return s / a.length;
};

export function computeMetrics(st: SimState): Metrics {
  const f = st.field;
  const hemaN = mean(f.hemaN);
  const hemaB = mean(f.hemaB);
  const eosin = mean(f.eosin);
  let haze = 0;
  for (let i = 0; i < f.water.length; i++) haze += Math.min(1, 0.9 * (1 - f.cleared[i]) + 1.6 * f.water[i]);
  haze /= f.water.length;

  let bubble = 0;
  let unfilled = 0;
  if (st.mount) {
    bubble = mean(st.mount.air);
    let u = 0;
    for (let i = 0; i < st.mount.coverage.length; i++) u += Math.max(0, 1 - st.mount.coverage[i] - st.mount.air[i]);
    unfilled = u / st.mount.coverage.length;
  }

  let varN = 0;
  let varE = 0;
  for (let i = 0; i < f.hemaN.length; i++) {
    varN += (f.hemaN[i] - hemaN) ** 2;
    varE += (f.eosin[i] - eosin) ** 2;
  }
  varN = Math.sqrt(varN / f.hemaN.length);
  varE = Math.sqrt(varE / f.eosin.length);

  let unstained = 0;
  for (let i = 0; i < f.hemaN.length; i++) if (f.hemaN[i] < 0.25 * REFERENCE_STATE.hemaN) unstained++;
  unstained /= f.hemaN.length;

  return {
    hemaN,
    hemaB,
    blue: mean(f.blue),
    eosin,
    paraffin: mean(f.paraffin),
    haze,
    dried: mean(f.dried),
    bubble,
    unfilled,
    nucContrast: hemaN / (hemaB + 0.05),
    unevenNuc: hemaN > 1e-4 ? varN / hemaN : 0,
    unevenEosin: eosin > 1e-4 ? varE / eosin : 0,
    unstainedFrac: unstained,
    weakRegion: weakRegionOf(st),
  };
}

function weakRegionOf(st: SimState): Metrics['weakRegion'] {
  const f = st.field;
  const rows: number[] = [];
  for (let y = 0; y < GH; y++) {
    let s = 0;
    for (let x = 0; x < GW; x++) s += f.hemaN[y * GW + x] + f.eosin[y * GW + x];
    rows.push(s / GW);
  }
  const avg = rows.reduce((a, b) => a + b, 0) / GH;
  if (avg < 1e-4) return null;
  // 液面より上だった帯は、最も濃く染まった行と比べて明確に弱くなる
  const best = Math.max(...rows);
  const n = Math.ceil(GH * 0.35);
  const top = rows.slice(GH - n).reduce((a, b) => a + b, 0) / n;
  const bottom = rows.slice(0, n).reduce((a, b) => a + b, 0) / n;
  if (best > 1e-4 && top < best * 0.62) return '上側';
  if (best > 1e-4 && bottom < best * 0.62) return '下側';

  let edge = 0;
  let center = 0;
  let ne = 0;
  let nc = 0;
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const v = f.dried[y * GW + x];
      if (x < 2 || x >= GW - 2) {
        edge += v;
        ne++;
      } else {
        center += v;
        nc++;
      }
    }
  }
  if (ne && nc && edge / ne > 0.15 && edge / ne > (center / nc) * 1.5) return '縁';
  const cv = Math.sqrt(rows.reduce((a, b) => a + (b - avg) ** 2, 0) / GH) / avg;
  if (cv > 0.22) return 'まだら';
  return null;
}

// ---------------------------------------------------------------------------
// 所見（学習者が選ぶ選択肢）
// ---------------------------------------------------------------------------

export type FindingId =
  | 'nuc_pale'
  | 'nuc_dark'
  | 'bg_dark'
  | 'nuc_reddish'
  | 'eos_pale'
  | 'eos_dark'
  | 'uneven'
  | 'band_weak'
  | 'haze'
  | 'bubble'
  | 'unfilled'
  | 'no_major_issue';

export const FINDINGS: { id: FindingId; ja: string; group: '核' | '背景' | 'エオジン' | 'むら' | '観察妨害' | '総合' }[] = [
  { id: 'nuc_pale', ja: '核が淡い／輪郭が読み取りにくい', group: '核' },
  { id: 'nuc_dark', ja: '核が濃すぎてクロマチンが潰れる', group: '核' },
  { id: 'nuc_reddish', ja: '核の色調が青紫でなく赤褐色寄り', group: '核' },
  { id: 'bg_dark', ja: '核以外（背景）に青紫がかなり残る', group: '背景' },
  { id: 'eos_pale', ja: 'エオジンが淡く細胞質のコントラストが乏しい', group: 'エオジン' },
  { id: 'eos_dark', ja: 'エオジンが濃く核所見が読みにくい', group: 'エオジン' },
  { id: 'uneven', ja: '染色が場所によって不均一', group: 'むら' },
  { id: 'band_weak', ja: '帯状に染色が乏しい領域がある', group: 'むら' },
  { id: 'haze', ja: '全体が曇って（すりガラス様に）不鮮明', group: '観察妨害' },
  { id: 'bubble', ja: '視野内に気泡がある', group: '観察妨害' },
  { id: 'unfilled', ja: '封入剤が届かず乾いて見える領域がある', group: '観察妨害' },
  { id: 'no_major_issue', ja: '大きな問題はない', group: '総合' },
];

const R = REFERENCE_STATE;

/** 標本状態から、実際に成立している所見を求める。 */
export function actualFindings(m: Metrics): FindingId[] {
  const out: FindingId[] = [];
  if (m.hemaN < 0.78 * R.hemaN) out.push('nuc_pale');
  if (m.hemaN > 1.22 * R.hemaN) out.push('nuc_dark');
  if (m.hemaB > 0.31) out.push('bg_dark');
  if (m.blue < 0.62) out.push('nuc_reddish');
  if (m.eosin < 0.78 * R.eosin) out.push('eos_pale');
  if (m.eosin > 1.28 * R.eosin) out.push('eos_dark');
  if (m.unevenNuc > 0.30 || m.unevenEosin > 0.30) out.push('uneven');
  if (m.weakRegion === '上側' || m.weakRegion === '下側') out.push('band_weak');
  if (m.haze > 0.28) out.push('haze');
  if (m.bubble > 0.03) out.push('bubble');
  if (m.unfilled > 0.05) out.push('unfilled');
  if (out.length === 0) out.push('no_major_issue');
  return out;
}

// ---------------------------------------------------------------------------
// 原因候補
// ---------------------------------------------------------------------------

export type CauseId =
  | 'deparaffin'
  | 'hydration'
  | 'hema_short'
  | 'hema_long'
  | 'over_diff'
  | 'under_diff'
  | 'no_blue'
  | 'eosin_short'
  | 'eosin_long'
  | 'eosin_washed'
  | 'dehydrate'
  | 'clearing'
  | 'partial_immersion'
  | 'drying'
  | 'mount_volume'
  | 'mount_speed'
  | 'mount_position';

export interface CauseDef {
  id: CauseId;
  ja: string;
  /** その原因があれば起こり得る所見。 */
  expects: FindingId[];
  /** 根拠になり得る操作の説明（学習者向け）。 */
  evidenceHint: string;
}

export const CAUSES: CauseDef[] = [
  { id: 'deparaffin', ja: '脱パラフィンが不十分', expects: ['nuc_pale', 'eos_pale', 'uneven', 'band_weak'], evidenceHint: 'キシレン槽での時間・槽数' },
  { id: 'hydration', ja: '親水化が不十分（アルコール系列・水洗が足りない）', expects: ['nuc_pale', 'uneven'], evidenceHint: 'エタノール系列と蒸留水の通し方' },
  { id: 'hema_short', ja: 'ヘマトキシリンの染色時間が短い', expects: ['nuc_pale'], evidenceHint: 'ヘマトキシリン槽での時間' },
  { id: 'hema_long', ja: 'ヘマトキシリンの染色時間が長い', expects: ['nuc_dark', 'bg_dark'], evidenceHint: 'ヘマトキシリン槽での時間' },
  { id: 'over_diff', ja: '分別が過剰（酸アルコールが長い／回数が多い）', expects: ['nuc_pale'], evidenceHint: '酸アルコールでのディップ数・時間' },
  { id: 'under_diff', ja: '分別が不足', expects: ['bg_dark', 'nuc_dark'], evidenceHint: '酸アルコールでのディップ数・時間' },
  { id: 'no_blue', ja: '色出し（Scott 液）が不足', expects: ['nuc_reddish'], evidenceHint: 'Scott 液でのディップ数' },
  { id: 'eosin_short', ja: 'エオジンの染色時間が短い', expects: ['eos_pale'], evidenceHint: 'エオジン槽での時間' },
  { id: 'eosin_long', ja: 'エオジンの染色時間が長い', expects: ['eos_dark'], evidenceHint: 'エオジン槽での時間' },
  { id: 'eosin_washed', ja: 'エオジン後に水系・低濃度アルコールで色が抜けた', expects: ['eos_pale'], evidenceHint: 'エオジンの後にどの槽へ入れたか' },
  { id: 'dehydrate', ja: '脱水が不十分で水分が残った', expects: ['haze', 'eos_dark'], evidenceHint: '95%・100% エタノールでの時間' },
  { id: 'clearing', ja: '透徹が不十分', expects: ['haze'], evidenceHint: 'キシレン（後半）でのディップ数' },
  { id: 'partial_immersion', ja: '切片の一部が液面より上にあった', expects: ['band_weak', 'uneven', 'nuc_pale', 'eos_pale'], evidenceHint: '各槽での浸漬の深さ' },
  { id: 'drying', ja: '工程の途中で切片を乾かした', expects: ['uneven', 'nuc_dark'], evidenceHint: '空気中に置いていた時間' },
  { id: 'mount_volume', ja: '封入剤の量が適切でない', expects: ['unfilled', 'bubble'], evidenceHint: '押し出した封入剤の量' },
  { id: 'mount_speed', ja: 'カバーガラスを下ろす速度が速すぎた', expects: ['bubble'], evidenceHint: 'カバーガラスを下ろすのにかけた時間' },
  { id: 'mount_position', ja: '封入剤の位置／カバーガラスの接触位置が適切でない', expects: ['unfilled', 'bubble'], evidenceHint: '封入剤を落とした位置と接触辺の位置' },
];

export const causeById = (id: CauseId): CauseDef => CAUSES.find((c) => c.id === id)!;

export interface Support {
  cause: CauseId;
  /** 0..1。履歴がその原因をどれだけ支持するか。 */
  strength: number;
  detail: string;
}

const T = TEACHING;

/** 操作履歴と標本状態から、特に支持される原因を求める。 */
export function historySupport(sum: RunSummary, st: SimState, m: Metrics): Support[] {
  const out: Support[] = [];
  const secIn = (id: string): number => sum.visits.filter((v) => v.bathId === id).reduce((a, v) => a + v.submergedSec, 0);
  const dipsIn = (id: string): number => sum.visits.filter((v) => v.bathId === id).reduce((a, v) => a + v.dips, 0);

  const xyleneFront = secIn('X1') + secIn('X2') + secIn('X3');
  if (m.paraffin > 0.05) {
    out.push({
      cause: 'deparaffin',
      strength: Math.min(1, m.paraffin * 3),
      detail: `キシレン I〜III の合計浸漬は ${xyleneFront.toFixed(0)} 秒（原手順は各3分＝合計540秒）。切片に平均 ${(m.paraffin * 100).toFixed(0)}% のパラフィンが残っている。`,
    });
  }

  const hemSec = secIn('HEM');
  if (hemSec > 0 && hemSec < 0.6 * T.hematoxylinTargetSec && m.hemaN < 0.8 * R.hemaN) {
    out.push({
      cause: 'hema_short',
      strength: Math.min(1, (T.hematoxylinTargetSec - hemSec) / T.hematoxylinTargetSec),
      detail: `ヘマトキシリンに ${hemSec.toFixed(0)} 秒（教材の基準は ${T.hematoxylinTargetSec} 秒、原手順の範囲は1〜5分）。背景のヘマトキシリンも ${m.hemaB.toFixed(2)} と残っており、抜きすぎではなく入れ不足の形。`,
    });
  }
  if (hemSec > 1.6 * T.hematoxylinTargetSec && m.hemaN > R.hemaN) {
    out.push({
      cause: 'hema_long',
      strength: Math.min(1, hemSec / (3 * T.hematoxylinTargetSec)),
      detail: `ヘマトキシリンに ${hemSec.toFixed(0)} 秒（教材の基準は ${T.hematoxylinTargetSec} 秒）。`,
    });
  }

  const acidDips = dipsIn('ACID');
  const acidSec = secIn('ACID');
  if (acidSec > 0 && m.hemaN < 0.8 * R.hemaN && m.hemaB < 0.09) {
    out.push({
      cause: 'over_diff',
      strength: Math.min(1, acidDips / (T.differentiationTargetDips * 3)),
      detail: `酸アルコールで ${acidDips} ディップ／${acidSec.toFixed(1)} 秒（教材の目安は ${T.differentiationTargetDips} ディップ前後。原手順は「速やかに」で秒数の規定なし）。背景が ${m.hemaB.toFixed(2)} まで落ちており、核まで抜けた形。`,
    });
  }
  if (m.hemaB > 0.31) {
    out.push({
      cause: 'under_diff',
      strength: Math.min(1, (m.hemaB - 0.2) * 3),
      detail: `酸アルコールは ${acidDips} ディップ／${acidSec.toFixed(1)} 秒。背景のヘマトキシリンが ${m.hemaB.toFixed(2)} 残っている。`,
    });
  }

  const scottDips = dipsIn('SCOTT');
  if (m.blue < 0.62) {
    out.push({
      cause: 'no_blue',
      strength: Math.min(1, 1 - m.blue),
      detail: `Scott 液は ${scottDips} ディップ（原手順は 10 dips）。色出しは色素量ではなく色調を変える工程で、分別とは別に扱う。`,
    });
  }

  const eosSec = secIn('EOS');
  if (eosSec > 0 && eosSec < 0.6 * T.eosinTargetSec && m.eosin < 0.8 * R.eosin) {
    out.push({
      cause: 'eosin_short',
      strength: Math.min(1, (T.eosinTargetSec - eosSec) / T.eosinTargetSec),
      detail: `エオジンに ${eosSec.toFixed(0)} 秒（教材の基準は ${T.eosinTargetSec} 秒、原手順の範囲は30秒〜3分）。`,
    });
  }
  if (eosSec > 2.2 * T.eosinTargetSec && m.eosin > R.eosin) {
    out.push({
      cause: 'eosin_long',
      strength: 0.7,
      detail: `エオジンに ${eosSec.toFixed(0)} 秒（教材の基準は ${T.eosinTargetSec} 秒）。`,
    });
  }

  // エオジンの後に水系・低濃度アルコールへ入れたか
  const eosIdx = sum.visits.findIndex((v) => v.bathId === 'EOS');
  if (eosIdx >= 0) {
    const after = sum.visits.slice(eosIdx + 1);
    const aqueous = after.filter((v) => ['TAP', 'DI', 'A70'].includes(v.bathId));
    const aqSec = aqueous.reduce((a, v) => a + v.submergedSec, 0);
    if (aqSec > 3 && m.eosin < 0.85 * R.eosin) {
      out.push({
        cause: 'eosin_washed',
        strength: Math.min(1, aqSec / 30),
        detail: `エオジンの後に ${aqueous.map((v) => v.bathId).join('・')} へ計 ${aqSec.toFixed(0)} 秒入れている。水はエオジンを溶かし出す（[S3] は水をエオジンの分別に使うと述べている）。`,
      });
    }
  }

  const dehydSec = secIn('A95c') + secIn('A95d') + secIn('A100c') + secIn('A100d');
  if (m.haze > 0.28) {
    out.push({
      cause: 'dehydrate',
      strength: Math.min(1, m.haze),
      detail: `脱水（95%・100%）の合計は ${dehydSec.toFixed(0)} 秒。切片の残留水分は ${(metricsWater(st) * 100).toFixed(0)}%、透徹の進行は ${(metricsCleared(st) * 100).toFixed(0)}%。`,
    });
    const clearDips = dipsIn('X4') + dipsIn('X5') + dipsIn('X6');
    out.push({
      cause: 'clearing',
      strength: Math.min(1, m.haze * 0.8),
      detail: `透徹のキシレンは計 ${clearDips} ディップ（原手順は各10 dips×3槽）。水分が残っているとキシレンに置換されない。`,
    });
  }

  // 浸漬不足（液面より上に出ていた）
  const shallow = sum.visits.filter((v) => v.maxLevel < 0.98 && v.submergedSec > 1);
  if (shallow.length && (m.weakRegion === '上側' || m.unevenNuc > 0.3 || m.unevenEosin > 0.3)) {
    const worst = shallow.reduce((a, b) => (a.maxLevel < b.maxLevel ? a : b));
    out.push({
      cause: 'partial_immersion',
      strength: Math.min(1, 1 - worst.maxLevel),
      detail: `${worst.bathId} で切片の ${(Math.max(0, worst.maxLevel) * 100).toFixed(0)}% までしか液面下に入っていない。液面より上だった範囲がそのまま反応不足になる。`,
    });
  }

  if (m.dried > 0.05) {
    out.push({
      cause: 'drying',
      strength: Math.min(1, m.dried * 2),
      detail: `工程の途中で空気中に最大 ${sum.maxAirSec.toFixed(0)} 秒置いている。液膜が尽きた後の乾燥が ${(m.dried * 100).toFixed(0)}% 進んでいる。`,
    });
  }

  if (sum.mount) {
    const mp = sum.mount;
    const lower = mp.angleSamples.length ? mp.angleSamples[mp.angleSamples.length - 1].t : 0;
    if (m.bubble > 0.03 && lower < 0.8) {
      out.push({
        cause: 'mount_speed',
        strength: Math.min(1, 1 - lower),
        detail: `カバーガラスを ${lower.toFixed(2)} 秒で下ろしている。前線が届く前に隙間が閉じた場所に空気が残る。`,
      });
    }
    if (m.unfilled > 0.05 || (m.bubble > 0.03 && mp.volumeUl < 14)) {
      out.push({
        cause: 'mount_volume',
        strength: Math.min(1, Math.abs(26 - mp.volumeUl) / 26),
        detail: `押し出した封入剤は ${mp.volumeUl.toFixed(0)} µL。24×50mm のカバーガラス全面を厚さ約 0.02mm で満たすには 20〜30 µL 程度が必要（教材モデルの計算）。`,
      });
    }
    const gap = Math.abs(mp.dropY - (mp.slipY + 25));
    if ((m.unfilled > 0.05 || m.bubble > 0.03) && gap > 14) {
      out.push({
        cause: 'mount_position',
        strength: Math.min(1, gap / 30),
        detail: `封入剤を落とした位置（下端から ${mp.dropY.toFixed(0)}mm）とカバーガラスの中央（${(mp.slipY + 25).toFixed(0)}mm）が ${gap.toFixed(0)}mm ずれている。`,
      });
    }
  }

  out.sort((a, b) => b.strength - a.strength);
  return out;
}

function metricsWater(st: SimState): number {
  return mean(st.field.water);
}
function metricsCleared(st: SimState): number {
  return mean(st.field.cleared);
}

/** 画像だけから考えられる原因候補（履歴を見ない）。 */
export function imageOnlyCandidates(findings: FindingId[]): CauseId[] {
  const set = new Set<CauseId>();
  for (const f of findings) {
    if (f === 'no_major_issue') continue;
    for (const c of CAUSES) if (c.expects.includes(f)) set.add(c.id);
  }
  return [...set];
}

// ---------------------------------------------------------------------------
// 手順からの逸脱（像に出ていないものも記録する）
// ---------------------------------------------------------------------------

export interface Deviation {
  text: string;
  /** 今回の像に強く出ているか */
  visible: boolean;
}

export function procedureDeviations(sum: RunSummary, m: Metrics): Deviation[] {
  const out: Deviation[] = [];
  const dipsIn = (id: string): number => sum.visits.filter((v) => v.bathId === id).reduce((a, v) => a + v.dips, 0);
  const visitsOf = (id: string): number => sum.visits.filter((v) => v.bathId === id).length;

  const tapRefresh = sum.refreshes.filter((r) => r.jar === 'TAP').length;
  if (tapRefresh < 9) {
    out.push({
      text: `原手順は「水道水を3回交換して十分に洗う」を核染色後・分別後・色出し後の3回求めている（計9回の交換）。今回の交換は ${tapRefresh} 回。`,
      visible: false,
    });
  }
  for (const [id, need, label] of [
    ['X1', 180, 'キシレン I'],
    ['X2', 180, 'キシレン II'],
    ['X3', 180, 'キシレン III'],
  ] as const) {
    const s = sum.visits.filter((v) => v.bathId === id).reduce((a, v) => a + v.submergedSec, 0);
    if (s < need * 0.8) out.push({ text: `${label} は原手順で3分。今回は ${s.toFixed(0)} 秒。`, visible: m.paraffin > 0.05 });
  }
  for (const [id, label] of [
    ['A100a', '100%エタノール I'],
    ['A100b', '100%エタノール II'],
    ['A95a', '95%エタノール I'],
    ['A95b', '95%エタノール II'],
    ['A70', '70%エタノール'],
    ['SCOTT', 'Scott 液'],
    ['A100c', '100%エタノール III'],
    ['A100d', '100%エタノール IV'],
    ['X4', 'キシレン IV'],
    ['X5', 'キシレン V'],
    ['X6', 'キシレン VI'],
  ] as const) {
    const d = dipsIn(id);
    if (visitsOf(id) === 0) out.push({ text: `${label} を通していない（原手順は 10 dips）。`, visible: true });
    else if (d < 8) out.push({ text: `${label} は ${d} ディップ（原手順は 10 dips）。`, visible: false });
  }
  for (const [id, label] of [
    ['A95c', '95%エタノール III'],
    ['A95d', '95%エタノール IV'],
  ] as const) {
    const s = sum.visits.filter((v) => v.bathId === id).reduce((a, v) => a + v.submergedSec, 0);
    if (s < 48) out.push({ text: `${label} は ${s.toFixed(0)} 秒（原手順は1分）。`, visible: m.haze > 0.28 });
  }
  return out;
}
