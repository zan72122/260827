export type Tier = 'low' | 'medium' | 'high';

export interface QualitySettings {
  tier: Tier;
  pixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  dropCapacity: number;
  transmission: boolean;
  bodySegments: number;
  radialSegments: number;
  envSize: number;
  tankFish: number;
}

const PRESETS: Record<Tier, Omit<QualitySettings, 'tier' | 'pixelRatio'>> = {
  low: {
    shadows: false,
    shadowMapSize: 512,
    dropCapacity: 64,
    transmission: false,
    bodySegments: 30,
    radialSegments: 16,
    envSize: 128,
    tankFish: 0,
  },
  medium: {
    shadows: true,
    shadowMapSize: 1024,
    dropCapacity: 150,
    transmission: false,
    bodySegments: 44,
    radialSegments: 22,
    envSize: 256,
    tankFish: 0,
  },
  high: {
    shadows: true,
    shadowMapSize: 2048,
    dropCapacity: 260,
    transmission: true,
    bodySegments: 56,
    radialSegments: 28,
    envSize: 256,
    tankFish: 2,
  },
};

/** WebGPU availability is used purely as an uplift signal for drop density,
 *  fish surface quality and ambient fish count. The game loop itself is WebGL2. */
export function hasWebGPU(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

function guessTier(): Tier {
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4;
  const cores = navigator.hardwareConcurrency ?? 4;
  const coarse = matchMedia('(pointer: coarse)').matches;
  if (mem <= 3 || cores <= 4) return coarse ? 'low' : 'medium';
  if (hasWebGPU() && cores >= 8) return 'high';
  return coarse ? 'medium' : 'high';
}

export function initialQuality(): QualitySettings {
  const tier = guessTier();
  const cap = tier === 'low' ? 1.5 : 2;
  return {
    tier,
    pixelRatio: Math.min(devicePixelRatio || 1, cap),
    ...PRESETS[tier],
  };
}

/** Adaptive quality: only pixel ratio, shadows and drop density move at runtime,
 *  so that geometry and materials stay stable through a reveal. */
export class AdaptiveQuality {
  private acc = 0;
  private frames = 0;
  private cooldown = 3;
  private lowered = 0;

  constructor(
    public settings: QualitySettings,
    private readonly onChange: (s: QualitySettings) => void,
  ) {}

  update(dt: number): void {
    if (this.lowered >= 2) return;
    this.acc += dt;
    this.frames++;
    if (this.acc < 1) return;
    const fps = this.frames / this.acc;
    this.acc = 0;
    this.frames = 0;
    if (this.cooldown > 0) {
      this.cooldown--;
      return;
    }
    if (fps < 34) {
      this.lowered++;
      this.cooldown = 4;
      const s = this.settings;
      if (s.pixelRatio > 1.05) {
        s.pixelRatio = Math.max(1, s.pixelRatio * 0.75);
      } else if (s.shadows) {
        s.shadows = false;
      }
      s.dropCapacity = Math.max(48, Math.round(s.dropCapacity * 0.55));
      this.onChange(s);
    }
  }
}
