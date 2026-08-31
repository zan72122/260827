import { ROWS, ROW_PITCH, ROW_Y0, OPEN_RADIUS } from '../config';

/**
 * The tree silhouette cut into every leaf and into both covers.
 *
 * A tier is a bough: the radius tapers from its bottom row to its top row and
 * then steps back out at the next tier. Tier limits sit exactly on glue rows,
 * so each step happens across the 3 mm glue band and reads as a cut notch
 * rather than a smeared slope.
 */
type Tier = { jBot: number; jTop: number; rBot: number; rTop: number };

const K = OPEN_RADIUS;

export const TIERS: Tier[] = [
  { jBot: 0, jTop: 3, rBot: 0.113 * K, rTop: 0.113 * K }, // trunk
  { jBot: 3, jTop: 8, rBot: 1.0 * K, rTop: 0.748 * K },
  { jBot: 8, jTop: 12, rBot: 0.861 * K, rTop: 0.635 * K },
  { jBot: 12, jTop: 16, rBot: 0.722 * K, rTop: 0.496 * K },
  { jBot: 16, jTop: 20, rBot: 0.557 * K, rTop: 0.287 * K },
  { jBot: 20, jTop: 23, rBot: 0.339 * K, rTop: 0.052 * K },
];

export function rowY(j: number): number {
  return ROW_Y0 + j * ROW_PITCH;
}

function evalTier(t: Tier, j: number): number {
  const s = (j - t.jBot) / (t.jTop - t.jBot);
  // Slightly convex taper: boughs droop.
  const e = s * s * 0.32 + s * 0.68;
  return t.rBot + (t.rTop - t.rBot) * e;
}

/** Radius just below glue row j (the tier that ends at j). */
export function radiusBelow(j: number): number {
  for (let i = TIERS.length - 1; i >= 0; i--) {
    const t = TIERS[i];
    if (j > t.jBot && j <= t.jTop) return evalTier(t, j);
  }
  return evalTier(TIERS[0], 0);
}

/** Radius just above glue row j (the tier that starts at j). */
export function radiusAbove(j: number): number {
  for (let i = 0; i < TIERS.length; i++) {
    const t = TIERS[i];
    if (j >= t.jBot && j < t.jTop) return evalTier(t, j);
  }
  return evalTier(TIERS[TIERS.length - 1], ROWS - 1);
}

/** Continuous silhouette, used by the covers and by hit-test proxies. */
export function radiusAtY(y: number): number {
  const j = (y - ROW_Y0) / ROW_PITCH;
  const jc = Math.max(0, Math.min(ROWS - 1, j));
  const lo = Math.floor(jc);
  const hi = Math.min(ROWS - 1, lo + 1);
  const f = jc - lo;
  return radiusAbove(lo) * (1 - f) + radiusBelow(hi) * f;
}
