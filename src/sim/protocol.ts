/**
 * 薬液槽カタログと手順定義。
 *
 * 【出典の区別】
 *  - `ref` … [S1] Newcomer Supply "H&E STAINING PROCEDURE WITH HARRIS MODIFIED"
 *            に記載された条件（回数・時間）。原資料の値をそのまま保持する。
 *  - `TEACHING` … 本教材のために設定した係数・容量・レイアウト。
 *            原資料には無い値であり、臨床的な検証を受けていない。
 *  詳細は PROTOCOL.md を参照。
 */

export type ReagentKind =
  | 'xylene'
  | 'etoh100'
  | 'etoh95'
  | 'etoh70'
  | 'water_tap'
  | 'water_di'
  | 'hematoxylin'
  | 'acid_alcohol'
  | 'scott'
  | 'eosin';

export type StationId =
  | 'deparaffin'
  | 'hydration'
  | 'wash'
  | 'nuclear'
  | 'counter'
  | 'dehydrate'
  | 'clearing'
  | 'mount';

export interface StationDef {
  id: StationId;
  labelJa: string;
  labelEn: string;
  /** 作業台上の X 位置(mm)。カメラの寄り先。 */
  benchX: number;
}

export const STATIONS: StationDef[] = [
  { id: 'deparaffin', labelJa: '脱パラフィン', labelEn: 'Deparaffinization', benchX: -720 },
  { id: 'hydration', labelJa: '親水化', labelEn: 'Hydration', benchX: -400 },
  { id: 'wash', labelJa: '水洗', labelEn: 'Washing', benchX: -100 },
  { id: 'nuclear', labelJa: '核染色', labelEn: 'Nuclear stain', benchX: 190 },
  { id: 'counter', labelJa: '細胞質染色', labelEn: 'Counterstain', benchX: 460 },
  { id: 'dehydrate', labelJa: '脱水', labelEn: 'Dehydration', benchX: 760 },
  { id: 'clearing', labelJa: '透徹', labelEn: 'Clearing', benchX: 1060 },
  { id: 'mount', labelJa: '封入', labelEn: 'Mounting', benchX: 1360 },
];

/** 「原資料の条件」表示に使う参照条件。値は [S1] のもの。 */
export interface RefCondition {
  /** S1 が秒数を指定している場合のみ。指定が無い工程は null。 */
  seconds: number | null;
  /** S1 が dip 数を指定している場合のみ。 */
  dips: number | null;
  /** S1 の表現をそのまま日本語化した文字列（秒数を捏造しない）。 */
  text: string;
}

export interface BathDef {
  id: string;
  station: StationId;
  /** ステーション内での並び順（左から）。 */
  slot: number;
  labelJa: string;
  labelEn: string;
  kind: ReagentKind;
  ref: RefCondition;
  /** 教材モデル上の槽容量(mL)。持ち込み希釈の分母。[教材係数] */
  volumeMl: number;
  /** 水洗槽のように交換できる槽か。 */
  replaceable: boolean;
  /** 目視で色が付いて見える液かどうか（無色試薬を勝手に着色しないための明示）。 */
  visiblyColored: boolean;
}

const ref = (text: string, seconds: number | null = null, dips: number | null = null): RefCondition => ({
  seconds,
  dips,
  text,
});

export const BATHS: BathDef[] = [
  // --- 1. 脱パラフィン（S1: three changes of xylene, 3 minutes each）
  { id: 'X1', station: 'deparaffin', slot: 0, labelJa: 'キシレン I', labelEn: 'Xylene I', kind: 'xylene', ref: ref('3分', 180), volumeMl: 250, replaceable: false, visiblyColored: false },
  { id: 'X2', station: 'deparaffin', slot: 1, labelJa: 'キシレン II', labelEn: 'Xylene II', kind: 'xylene', ref: ref('3分', 180), volumeMl: 250, replaceable: false, visiblyColored: false },
  { id: 'X3', station: 'deparaffin', slot: 2, labelJa: 'キシレン III', labelEn: 'Xylene III', kind: 'xylene', ref: ref('3分', 180), volumeMl: 250, replaceable: false, visiblyColored: false },

  // --- 2. 親水化（S1: two changes each of 100% and 95% ethyl alcohols, 10 dips each）
  { id: 'A100a', station: 'hydration', slot: 0, labelJa: '100%エタノール I', labelEn: '100% Ethanol I', kind: 'etoh100', ref: ref('10 dips', null, 10), volumeMl: 250, replaceable: false, visiblyColored: false },
  { id: 'A100b', station: 'hydration', slot: 1, labelJa: '100%エタノール II', labelEn: '100% Ethanol II', kind: 'etoh100', ref: ref('10 dips', null, 10), volumeMl: 250, replaceable: false, visiblyColored: false },
  { id: 'A95a', station: 'hydration', slot: 2, labelJa: '95%エタノール I', labelEn: '95% Ethanol I', kind: 'etoh95', ref: ref('10 dips', null, 10), volumeMl: 250, replaceable: false, visiblyColored: false },
  { id: 'A95b', station: 'hydration', slot: 3, labelJa: '95%エタノール II', labelEn: '95% Ethanol II', kind: 'etoh95', ref: ref('10 dips', null, 10), volumeMl: 250, replaceable: false, visiblyColored: false },

  // --- 3. 水洗（S1: wash well with distilled water / three changes of tap water）
  { id: 'TAP', station: 'wash', slot: 0, labelJa: '水道水槽（交換式）', labelEn: 'Tap water jar (replaceable)', kind: 'water_tap', ref: ref('水道水3回交換'), volumeMl: 250, replaceable: true, visiblyColored: false },
  { id: 'DI', station: 'wash', slot: 1, labelJa: '蒸留水槽（交換式）', labelEn: 'Distilled water jar (replaceable)', kind: 'water_di', ref: ref('十分に洗う / すすぐ'), volumeMl: 250, replaceable: true, visiblyColored: false },

  // --- 4. 核染色（S1: Harris Modified 1–5 min / acid alcohol quickly / Scott 10 dips）
  { id: 'HEM', station: 'nuclear', slot: 0, labelJa: 'ヘマトキシリン Harris Modified', labelEn: 'Hematoxylin, Harris Modified', kind: 'hematoxylin', ref: ref('1〜5分', null), volumeMl: 250, replaceable: false, visiblyColored: true },
  { id: 'ACID', station: 'nuclear', slot: 1, labelJa: '1% 酸アルコール', labelEn: '1% Acid Alcohol', kind: 'acid_alcohol', ref: ref('速やかに（秒数の規定なし）'), volumeMl: 250, replaceable: false, visiblyColored: false },
  { id: 'SCOTT', station: 'nuclear', slot: 2, labelJa: 'Scott 水道水代用液', labelEn: 'Scott Tap Water Substitute', kind: 'scott', ref: ref('10 dips', null, 10), volumeMl: 250, replaceable: false, visiblyColored: false },

  // --- 5. 細胞質染色（S1: drain excess water, 70% alcohol 10 dips / Eosin Y 30 s–3 min）
  { id: 'A70', station: 'counter', slot: 0, labelJa: '70%エタノール', labelEn: '70% Ethanol', kind: 'etoh70', ref: ref('10 dips', null, 10), volumeMl: 250, replaceable: false, visiblyColored: false },
  { id: 'EOS', station: 'counter', slot: 1, labelJa: 'エオジンY 使用液', labelEn: 'Eosin Y Working Solution', kind: 'eosin', ref: ref('30秒〜3分', null), volumeMl: 250, replaceable: false, visiblyColored: true },

  // --- 6. 脱水・透徹（S1: 95% x2 1 min each / 100% x2 10 dips / xylene x3 10 dips）
  { id: 'A95c', station: 'dehydrate', slot: 0, labelJa: '95%エタノール III', labelEn: '95% Ethanol III', kind: 'etoh95', ref: ref('1分', 60), volumeMl: 250, replaceable: false, visiblyColored: false },
  { id: 'A95d', station: 'dehydrate', slot: 1, labelJa: '95%エタノール IV', labelEn: '95% Ethanol IV', kind: 'etoh95', ref: ref('1分', 60), volumeMl: 250, replaceable: false, visiblyColored: false },
  { id: 'A100c', station: 'dehydrate', slot: 2, labelJa: '100%エタノール III', labelEn: '100% Ethanol III', kind: 'etoh100', ref: ref('10 dips', null, 10), volumeMl: 250, replaceable: false, visiblyColored: false },
  { id: 'A100d', station: 'dehydrate', slot: 3, labelJa: '100%エタノール IV', labelEn: '100% Ethanol IV', kind: 'etoh100', ref: ref('10 dips', null, 10), volumeMl: 250, replaceable: false, visiblyColored: false },
  { id: 'X4', station: 'clearing', slot: 0, labelJa: 'キシレン IV', labelEn: 'Xylene IV', kind: 'xylene', ref: ref('10 dips', null, 10), volumeMl: 250, replaceable: false, visiblyColored: false },
  { id: 'X5', station: 'clearing', slot: 1, labelJa: 'キシレン V', labelEn: 'Xylene V', kind: 'xylene', ref: ref('10 dips', null, 10), volumeMl: 250, replaceable: false, visiblyColored: false },
  { id: 'X6', station: 'clearing', slot: 2, labelJa: 'キシレン VI', labelEn: 'Xylene VI', kind: 'xylene', ref: ref('10 dips', null, 10), volumeMl: 250, replaceable: false, visiblyColored: false },
];

export const BATH_INDEX: Record<string, number> = Object.fromEntries(BATHS.map((b, i) => [b.id, i]));
export const bathById = (id: string): BathDef => BATHS[BATH_INDEX[id]];

/** 手順書（実践モードでも参照可）。S1 の順序をそのまま並べる。 */
export interface ProtocolStep {
  no: number;
  ja: string;
  en: string;
  baths: string[];
  /** S1 が示す条件の表現。秒数が無いものは秒数を書かない。 */
  cond: string;
}

export const PROTOCOL_STEPS: ProtocolStep[] = [
  { no: 1, ja: 'キシレン3槽で十分に脱パラフィンする', en: 'Deparaffinize in three changes of xylene', baths: ['X1', 'X2', 'X3'], cond: '各3分' },
  { no: 2, ja: '100%エタノール2槽を通す', en: 'Two changes of 100% ethanol', baths: ['A100a', 'A100b'], cond: '各10 dips' },
  { no: 3, ja: '95%エタノール2槽を通す', en: 'Two changes of 95% ethanol', baths: ['A95a', 'A95b'], cond: '各10 dips' },
  { no: 4, ja: '蒸留水で十分に洗う', en: 'Wash well with distilled water', baths: ['DI'], cond: '「十分に」（秒数の規定なし）' },
  { no: 5, ja: 'ヘマトキシリン Harris Modified で核染色', en: 'Stain in Hematoxylin, Harris Modified', baths: ['HEM'], cond: '1〜5分（濃度の好みによる）' },
  { no: 6, ja: '水道水を3回交換して十分に洗う', en: 'Wash well in three changes of tap water', baths: ['TAP'], cond: '3回交換' },
  { no: 7, ja: '1% 酸アルコールで速やかに分別する', en: 'Differentiate quickly in 1% acid alcohol', baths: ['ACID'], cond: '「速やかに」（秒数の規定なし）' },
  { no: 8, ja: '水道水を3回交換して十分に洗う', en: 'Wash well in three changes of tap water', baths: ['TAP'], cond: '3回交換' },
  { no: 9, ja: 'Scott 水道水代用液で色出しする', en: 'Blue in Scott Tap Water Substitute', baths: ['SCOTT'], cond: '10 dips' },
  { no: 10, ja: '水道水3回交換で洗い、蒸留水ですすぐ', en: 'Wash in three changes of tap water; rinse in distilled water', baths: ['TAP', 'DI'], cond: '3回交換 + すすぎ' },
  { no: 11, ja: '余分な水を切り、70%エタノールを通す', en: 'Drain excess water; 70% ethanol', baths: ['A70'], cond: '10 dips' },
  { no: 12, ja: 'エオジンY 使用液で対比染色', en: 'Counterstain in Eosin Y Working Solution', baths: ['EOS'], cond: '30秒〜3分（濃度の好みによる）' },
  { no: 13, ja: '95%エタノール2槽で脱水', en: 'Two changes of 95% ethanol', baths: ['A95c', 'A95d'], cond: '各1分' },
  { no: 14, ja: '100%エタノール2槽で脱水', en: 'Two changes of 100% ethanol', baths: ['A100c', 'A100d'], cond: '各10 dips' },
  { no: 15, ja: 'キシレン3槽で透徹', en: 'Clear in three changes of xylene', baths: ['X4', 'X5', 'X6'], cond: '各10 dips' },
  { no: 16, ja: '適合する封入剤とカバーガラスで封入', en: 'Coverslip with compatible mounting medium', baths: [], cond: '（S1 に量・速度の規定なし）' },
];

/**
 * 教材設定値。**これらは [S1] の記載ではない。**
 * 反応の向き（どちらへ動くか）は S2/S3 の記述に沿わせているが、
 * 速度定数・上限値は本ゲームが 5〜10 分で完了するように選んだ教材係数であり、
 * 実試薬の反応速度を検証したものではない。
 */
export const TEACHING = {
  /** 教材上の推奨核染色時間（S1 の 1〜5 分の範囲内から選択）。 */
  hematoxylinTargetSec: 180,
  /** 教材上の推奨エオジン時間（S1 の 30 秒〜3 分の範囲内から選択）。 */
  eosinTargetSec: 60,
  /** 教材上の分別の目安 dip 数。S1 は「速やかに」としか書いていない。 */
  differentiationTargetDips: 5,

  /** 状態マップの解像度（切片を覆う低解像度2Dグリッド）。 */
  gridW: 20,
  gridH: 14,

  /** 切片の載る位置（スライド下端からの mm）。教材モデル。 */
  sectionY0mm: 18,
  sectionY1mm: 32,
  sectionX0mm: 4,
  sectionX1mm: 22,

  /** 化学モデルの固定タイムステップ（教材内モデル時間・秒）。 */
  tickSec: 0.05,

  // ---- 速度定数（すべて教材係数。単位は 1/秒） ----
  kDewaxXylene: 0.017,
  kDewaxEtoh100: 0.0006,
  kPolar: 0.35,
  kWater: 0.06,
  kWaterInXylene: 0.004,
  kClear: 0.4,

  kHemaNuc: 0.0075,
  hemaNucMax: 1.35,
  kHemaBg: 0.02,
  hemaBgMax: 0.55,

  kDiffBg: 0.5,
  kDiffNuc: 0.04,
  /** 色出し後は分別されにくくなる係数。 */
  bluedProtection: 0.7,

  kBlue: 0.85,

  kEosin: 0.02,
  eosinMax: 1.3,
  kEosinLossWater: 0.02,
  kEosinLoss70: 0.004,
  kEosinLoss95: 0.0012,
  kEosinLoss100: 0.0004,

  /** 液膜（1行あたり mL 相当の無次元量）。 */
  filmBase: 0.010,
  /** 引き上げ速度による液膜増加（Landau–Levich 的な傾向のみを模した教材式）。 */
  filmSpeedGain: 0.9,
  /** 液切り時の液膜減衰。 */
  kDrain: 0.55,
  filmDrainFloor: 0.25,
  /** 空気中での液膜蒸発（1/秒）。 */
  kEvap: 0.030,
  /** 液膜が尽きてから乾燥障害が進む速度。 */
  kDry: 0.02,
  /** 乾燥が始まるまでの猶予（秒）。通常の移動では罰しない。 */
  dryGraceSec: 12,

  /**
   * スライド近傍の境界層の体積(mL)。[教材係数]
   * 引き上げ時に新しくできる液膜は、槽の中心の液ではなくこの境界層の液からできる、
   * という近似。「水を3回交換する」ことの意味をモデル化するために置いた。
   */
  boundaryMl: 3,
  /** 境界層が槽全体へ拡散して薄まる速度(1/秒)。[教材係数] */
  kDisperse: 0.12,
  /** 水洗槽の汚れ表示の飽和量。 */
  washSaturation: 0.9,
  kWashFilm: 0.9,

  /** 液膜による槽汚染の効き（1回の持ち込みで槽が失活しない大きさ）。 */
  carryoverGain: 1.0,
} as const;

export const GW = TEACHING.gridW;
export const GH = TEACHING.gridH;
export const NCELL = GW * GH;
