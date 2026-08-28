export type TierName = 'low' | 'mid' | 'high';

export interface Tier {
  name: TierName;
  dprCap: number;
  shadows: boolean;
  shadowMapSize: number;
  smokeCount: number;
  dustCount: number;
  snowCount: number;
  shimmer: boolean;
  anisotropy: number;
  textureScale: number;
}

const TIERS: Record<TierName, Tier> = {
  low: { name: 'low', dprCap: 1.25, shadows: false, shadowMapSize: 512,
         smokeCount: 26, dustCount: 46, snowCount: 130, shimmer: false,
         anisotropy: 2, textureScale: 0.5 },
  mid: { name: 'mid', dprCap: 1.75, shadows: true, shadowMapSize: 1024,
         smokeCount: 40, dustCount: 90, snowCount: 220, shimmer: true,
         anisotropy: 4, textureScale: 0.75 },
  high: { name: 'high', dprCap: 2.0, shadows: true, shadowMapSize: 2048,
          smokeCount: 56, dustCount: 140, snowCount: 320, shimmer: true,
          anisotropy: 8, textureScale: 1 },
};

/** Static guess from device hints; refined at runtime by the frame-time watcher. */
export function detectTier(gl: WebGL2RenderingContext | WebGLRenderingContext): Tier {
  const dm = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4;
  const cores = navigator.hardwareConcurrency ?? 4;
  const px = window.screen.width * window.screen.height * (window.devicePixelRatio || 1) ** 2;

  let renderer = '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '');
  } catch { /* blocked by privacy settings; fall through to heuristics */ }

  let score = 0;
  if (cores >= 6) score += 1;
  if (cores >= 8) score += 1;
  if (dm >= 4) score += 1;
  if (dm >= 8) score += 1;
  if (px > 4.0e6) score -= 1;
  if (/apple\s*(a1[5-9]|a[2-9]\d|m[1-9])/i.test(renderer)) score += 2;
  if (/apple\s*a(9|10|11|12)/i.test(renderer)) score -= 2;
  if (/(adreno\s*[45]\d\d|mali-t)/i.test(renderer)) score -= 2;

  if (score <= 0) return { ...TIERS.low };
  if (score <= 2) return { ...TIERS.mid };
  return { ...TIERS.high };
}

export function tierPreset(name: TierName): Tier { return { ...TIERS[name] }; }
