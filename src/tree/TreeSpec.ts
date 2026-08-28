/** A tree individual. Fixed seeds keep every play-through reproducible. */
export interface TreeSpec {
  key: string;
  seed: number;
  height: number;
  /** Radius at the sawn butt end, in metres. */
  trunkRadius: number;
  whorls: number;
  branchesPerWhorl: number;
  /** Length of the lowest branches, in metres - this is what makes a tree "too wide". */
  branchLength: number;
  /** 0 = branches held stiff and level, 1 = soft and hanging. */
  droop: number;
  /** Rest angle from the trunk axis at the bottom whorl, radians. */
  tiltBottom: number;
  tiltTop: number;
  needleDensity: number;
  needleSize: number;
  /** Hue shift for the foliage, -1..1 (blue-green .. yellow-green). */
  needleHue: number;
  barkTone: number;
}

/**
 * Play order. The first tree is the wide teaching tree; after that the rules get
 * re-used on three clearly different shapes - broad, soft/drooping, slim and busy.
 */
export const TREE_VARIANTS: readonly TreeSpec[] = [
  {
    key: 'hero',
    seed: 20241224,
    height: 4.1,
    trunkRadius: 0.098,
    whorls: 10,
    branchesPerWhorl: 6,
    branchLength: 1.58,
    droop: 0.22,
    tiltBottom: 1.5,
    tiltTop: 0.92,
    needleDensity: 1,
    needleSize: 1,
    needleHue: 0,
    barkTone: 1,
  },
  {
    key: 'broad',
    seed: 77315,
    height: 3.8,
    trunkRadius: 0.11,
    whorls: 9,
    branchesPerWhorl: 7,
    branchLength: 1.78,
    droop: 0.12,
    tiltBottom: 1.62,
    tiltTop: 1.05,
    needleDensity: 1.05,
    needleSize: 1.04,
    needleHue: -0.25,
    barkTone: 0.92,
  },
  {
    key: 'soft',
    seed: 31408,
    height: 4.4,
    trunkRadius: 0.09,
    whorls: 11,
    branchesPerWhorl: 6,
    branchLength: 1.5,
    droop: 0.85,
    tiltBottom: 1.78,
    tiltTop: 1.16,
    needleDensity: 0.95,
    needleSize: 1.12,
    needleHue: 0.2,
    barkTone: 1.08,
  },
  {
    key: 'slim',
    seed: 90562,
    height: 4.6,
    trunkRadius: 0.082,
    whorls: 15,
    branchesPerWhorl: 7,
    branchLength: 1.02,
    droop: 0.3,
    tiltBottom: 1.34,
    tiltTop: 0.8,
    needleDensity: 1.15,
    needleSize: 0.9,
    needleHue: -0.1,
    barkTone: 0.98,
  },
];
