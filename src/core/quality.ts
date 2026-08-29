/** Runtime quality budget. Falls back gracefully instead of dropping frames. */
export type Tier = 'high' | 'mid' | 'low';

export interface QualityBudget {
  tier: Tier;
  /** fraction of needle sprays kept on the hero tree */
  sprayDensity: number;
  /** live shed-debris particles */
  debrisMax: number;
  shadowMapSize: number;
  shadows: boolean;
  /** upper bound on the device pixel ratio we ever ask for */
  maxPixelRatio: number;
  /** trunk / branch radial segments */
  radialSegments: number;
}

const BUDGETS: Record<Tier, QualityBudget> = {
  high: {
    tier: 'high',
    sprayDensity: 1,
    debrisMax: 260,
    shadowMapSize: 1024,
    shadows: true,
    maxPixelRatio: 2,
    radialSegments: 8,
  },
  mid: {
    tier: 'mid',
    sprayDensity: 0.8,
    debrisMax: 160,
    shadowMapSize: 768,
    shadows: true,
    maxPixelRatio: 1.7,
    radialSegments: 6,
  },
  low: {
    tier: 'low',
    sprayDensity: 0.58,
    debrisMax: 90,
    shadowMapSize: 512,
    shadows: true,
    maxPixelRatio: 1.35,
    radialSegments: 5,
  },
};

export function budgetFor(tier: Tier): QualityBudget {
  return { ...BUDGETS[tier] };
}

export function guessTier(): Tier {
  // A device can misreport its capability; allow an explicit override so a
  // build can be checked at a chosen budget.
  const forced = new URLSearchParams(location.search).get('q');
  if (forced === 'high' || forced === 'mid' || forced === 'low') return forced;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency ?? 4;
  const mem = nav.deviceMemory ?? 0;
  // iOS Safari reports neither deviceMemory nor a useful core count, and the
  // devices this game targets are comfortably fast — start them high and let
  // the frame-time governor step down if a particular one cannot hold it.
  const ua = navigator.userAgent;
  const apple =
    /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (apple) return 'high';
  if (cores <= 4 || (mem > 0 && mem <= 3)) return 'low';
  if (cores >= 8 && mem >= 8) return 'high';
  return 'mid';
}

const ORDER: Tier[] = ['low', 'mid', 'high'];

export function stepTier(tier: Tier, dir: -1 | 1): Tier {
  const i = ORDER.indexOf(tier);
  return ORDER[Math.max(0, Math.min(ORDER.length - 1, i + dir))];
}
