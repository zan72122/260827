export type QualityName = 'low' | 'medium' | 'high';

export type Quality = {
  name: QualityName;
  /** cap on devicePixelRatio */
  pixelRatio: number;
  shadows: boolean;
  shadowSize: number;
  /** 0 = plain background props, 1 = full workshop detail */
  backgroundDetail: number;
  textureDetail: number;
  antialias: boolean;
};

export const QUALITY: Record<QualityName, Quality> = {
  low: {
    name: 'low',
    pixelRatio: 1,
    shadows: false,
    shadowSize: 512,
    backgroundDetail: 0,
    textureDetail: 0,
    antialias: false,
  },
  medium: {
    name: 'medium',
    pixelRatio: 1.6,
    shadows: true,
    shadowSize: 1024,
    backgroundDetail: 1,
    textureDetail: 1,
    antialias: true,
  },
  high: {
    name: 'high',
    pixelRatio: 2,
    shadows: true,
    shadowSize: 2048,
    backgroundDetail: 1,
    textureDetail: 1,
    antialias: true,
  },
};

export const ORDER: QualityName[] = ['low', 'medium', 'high'];

/**
 * The paper's structure is identical at every level. Quality only moves
 * resolution, shadows and background props - never the number of leaves,
 * the cells, or the way the tree deforms.
 */
export function detectQuality(): QualityName {
  const url = new URLSearchParams(location.search).get('q');
  if (url && (ORDER as string[]).includes(url)) return url as QualityName;
  const dpr = window.devicePixelRatio || 1;
  const cores = (navigator as Navigator & { hardwareConcurrency?: number }).hardwareConcurrency ?? 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  if (cores <= 4 && mem <= 3) return 'low';
  if (dpr >= 2 && cores >= 6) return 'high';
  return 'medium';
}
