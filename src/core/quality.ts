/**
 * quality.ts — one place that decides how hard to push the device.
 *
 * The dive itself, the multiresolution switching and the circular field all work
 * identically at every tier; quality only changes texture sizes, supersampling and
 * how many pyramid levels stay resident.
 */

export type QualityTier = 'low' | 'medium' | 'high';

export interface QualitySettings {
  tier: QualityTier;
  /** Edge length of each generated pyramid level, in texels. */
  levelTexels: number;
  /** Supersamples per texel while generating a level. */
  levelSamples: 1 | 2 | 4;
  /** How many levels may stay in GPU memory at once. */
  maxResidentLevels: number;
  /** Upper bound on devicePixelRatio. */
  maxPixelRatio: number;
  /** Texel rows generated per frame while a level is being built. */
  generationStrips: number;
  /** Whether the 3D scene draws its more expensive trimmings. */
  richMicroscope: boolean;
}

const TABLE: Record<QualityTier, Omit<QualitySettings, 'tier'>> = {
  low: {
    levelTexels: 768,
    levelSamples: 1,
    maxResidentLevels: 3,
    maxPixelRatio: 1.5,
    generationStrips: 6,
    richMicroscope: false,
  },
  medium: {
    levelTexels: 1024,
    levelSamples: 2,
    maxResidentLevels: 4,
    maxPixelRatio: 2.0,
    generationStrips: 6,
    richMicroscope: true,
  },
  high: {
    levelTexels: 1280,
    levelSamples: 2,
    maxResidentLevels: 5,
    maxPixelRatio: 2.6,
    generationStrips: 8,
    richMicroscope: true,
  },
};

/**
 * Picks a starting tier. Deliberately conservative: the dive must stay smooth under
 * a four-year-old's thumb, and the app promotes or demotes itself once real frame
 * times are known.
 */
export function detectQuality(): QualityTier {
  const forced = new URLSearchParams(location.search).get('quality');
  if (forced === 'low' || forced === 'medium' || forced === 'high') return forced;

  const dm = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const cores = navigator.hardwareConcurrency ?? 4;
  const px = window.devicePixelRatio || 1;
  const shortSide = Math.min(window.innerWidth, window.innerHeight) * px;

  if ((dm !== undefined && dm <= 3) || cores <= 4) return 'low';
  // Large, dense panels (iPad Pro, Pro Max phones) have the GPU to match.
  if (cores >= 6 && shortSide >= 1000) return 'high';
  return 'medium';
}

export function qualitySettings(tier: QualityTier): QualitySettings {
  return { tier, ...TABLE[tier] };
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
