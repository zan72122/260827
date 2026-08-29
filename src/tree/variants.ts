/** Four real trees on the lot. Same species family, different habit. */
export interface TreeVariant {
  id: string;
  seed: number;
  height: number;
  buttRadius: number;
  /** natural half width at the widest whorl, metres */
  spread: number;
  whorls: number;
  branchesMin: number;
  branchesMax: number;
  /** branch elevation at the bottom whorl / at the top (rad, + is upward) */
  elevBottom: number;
  elevTop: number;
  /** extra droop added along each branch segment */
  droop: number;
  subPerSegment: number;
  tuftScale: number;
  /** how much dry old foliage it carries */
  dryness: number;
  needleTint: number;
}

export const VARIANTS: TreeVariant[] = [
  {
    // 1st: the broad one that plainly will not fit the loading frame
    id: 'broad',
    seed: 20481,
    height: 3.95,
    buttRadius: 0.108,
    spread: 1.72,
    whorls: 15,
    branchesMin: 7,
    branchesMax: 9,
    elevBottom: 0.06,
    elevTop: 0.5,
    droop: 0.1,
    subPerSegment: 2,
    tuftScale: 1.55,
    dryness: 1,
    needleTint: 0.0,
  },
  {
    // 2nd: wider still, shorter, heavy lower whorls
    id: 'wide',
    seed: 71263,
    height: 3.6,
    buttRadius: 0.118,
    spread: 1.86,
    whorls: 13,
    branchesMin: 8,
    branchesMax: 10,
    elevBottom: -0.05,
    elevTop: 0.42,
    droop: 0.13,
    subPerSegment: 2,
    tuftScale: 1.62,
    dryness: 0.86,
    needleTint: 0.05,
  },
  {
    // 3rd: soft, weeping branches
    id: 'soft',
    seed: 33907,
    height: 4.15,
    buttRadius: 0.1,
    spread: 1.48,
    whorls: 14,
    branchesMin: 6,
    branchesMax: 8,
    elevBottom: -0.24,
    elevTop: 0.16,
    droop: 0.31,
    subPerSegment: 2,
    tuftScale: 1.5,
    dryness: 0.7,
    needleTint: -0.04,
  },
  {
    // 4th: slim but very densely branched
    id: 'dense',
    seed: 58194,
    height: 4.4,
    buttRadius: 0.094,
    spread: 1.06,
    whorls: 18,
    branchesMin: 8,
    branchesMax: 11,
    elevBottom: 0.2,
    elevTop: 0.62,
    droop: 0.06,
    subPerSegment: 3,
    tuftScale: 1.34,
    dryness: 0.78,
    needleTint: 0.03,
  },
];
