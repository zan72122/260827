import type { ReagentKind } from './protocol';

/**
 * 試薬ごとの物性（教材モデル）。
 * polarTarget / waterTarget は「切片内の媒体がその試薬に平衡したときの値」。
 * いずれも本教材の近似であり、実測値ではない。
 */
export interface ReagentProps {
  /** 媒体の極性（0 = キシレン等の非極性、1 = 水系）。水系色素の到達性を決める。 */
  polarTarget: number;
  /** 切片内の残留水分の平衡値。 */
  waterTarget: number;
  /** パラフィン溶解の速度定数（1/秒）。 */
  dewax: number;
  /** 透徹（キシレン置換）が進むか。 */
  clears: boolean;
  /** エオジンの溶出速度（1/秒）。 */
  eosinLoss: number;
  /** 目に見える色（無色は null。無色試薬を勝手に着色しないこと）。 */
  tint: [number, number, number] | null;
  /** 液の吸光の強さ（層厚 mm あたり）。無色試薬は 0 に近い。 */
  absorb: number;
  /** UI 表示用の分類。 */
  family: 'solvent' | 'alcohol' | 'aqueous' | 'stain';
}

const P = (o: Partial<ReagentProps> & Pick<ReagentProps, 'polarTarget' | 'waterTarget' | 'family'>): ReagentProps => ({
  dewax: 0,
  clears: false,
  eosinLoss: 0,
  tint: null,
  absorb: 0,
  ...o,
});

export const REAGENTS: Record<ReagentKind, ReagentProps> = {
  xylene: P({ polarTarget: 0.0, waterTarget: 0.0, dewax: 0.017, clears: true, eosinLoss: 0.0, family: 'solvent' }),
  etoh100: P({ polarTarget: 0.35, waterTarget: 0.01, dewax: 0.0006, eosinLoss: 0.0004, family: 'alcohol' }),
  etoh95: P({ polarTarget: 0.55, waterTarget: 0.06, eosinLoss: 0.0012, family: 'alcohol' }),
  etoh70: P({ polarTarget: 0.75, waterTarget: 0.3, eosinLoss: 0.004, family: 'alcohol' }),
  water_tap: P({ polarTarget: 1.0, waterTarget: 1.0, eosinLoss: 0.02, family: 'aqueous' }),
  water_di: P({ polarTarget: 1.0, waterTarget: 1.0, eosinLoss: 0.02, family: 'aqueous' }),
  hematoxylin: P({ polarTarget: 1.0, waterTarget: 1.0, eosinLoss: 0.02, tint: [0.12, 0.05, 0.10], absorb: 0.62, family: 'stain' }),
  acid_alcohol: P({ polarTarget: 0.75, waterTarget: 0.3, eosinLoss: 0.006, family: 'alcohol' }),
  scott: P({ polarTarget: 1.0, waterTarget: 1.0, eosinLoss: 0.02, family: 'aqueous' }),
  eosin: P({ polarTarget: 0.72, waterTarget: 0.25, eosinLoss: 0.0, tint: [0.46, 0.09, 0.14], absorb: 0.46, family: 'stain' }),
};

/** 液膜の組成を表す成分。 */
export const FILM_COMPONENTS = ['water', 'alcohol', 'xylene', 'acid', 'hema', 'eosin'] as const;
export type FilmComponent = (typeof FILM_COMPONENTS)[number];

/** 試薬が液膜に残すときの主成分。 */
export function filmComponentOf(kind: ReagentKind): FilmComponent {
  switch (kind) {
    case 'xylene':
      return 'xylene';
    case 'etoh100':
    case 'etoh95':
    case 'etoh70':
      return 'alcohol';
    case 'acid_alcohol':
      return 'acid';
    case 'hematoxylin':
      return 'hema';
    case 'eosin':
      return 'eosin';
    default:
      return 'water';
  }
}
