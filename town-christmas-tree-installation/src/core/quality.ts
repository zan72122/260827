import * as THREE from 'three';

export type Tier = 'low' | 'mid' | 'high';

export interface QualitySettings {
  tier: Tier;
  dpr: number;
  shadows: boolean;
  shadowMapSize: number;
  snowCount: number;
  residentCount: number;
  treeLodBias: number;
  anisotropy: number;
}

function deviceMemoryGb(): number {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return typeof nav.deviceMemory === 'number' ? nav.deviceMemory : 4;
}

export function detectQuality(renderer: THREE.WebGLRenderer): QualitySettings {
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = deviceMemoryGb();
  const maxDpr = window.devicePixelRatio || 1;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const px = window.screen.width * window.screen.height * maxDpr * maxDpr;

  let tier: Tier = 'mid';
  if (cores <= 4 || mem <= 3) tier = 'low';
  if (cores >= 8 && mem >= 6 && (!coarse || px > 2_500_000)) tier = 'high';

  const anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), tier === 'low' ? 2 : 8);

  if (tier === 'low') {
    return {
      tier,
      dpr: Math.min(maxDpr, 1.5),
      shadows: true,
      shadowMapSize: 1024,
      snowCount: 420,
      residentCount: 26,
      treeLodBias: 0.7,
      anisotropy,
    };
  }
  if (tier === 'high') {
    return {
      tier,
      dpr: Math.min(maxDpr, 2.5),
      shadows: true,
      shadowMapSize: 2048,
      snowCount: 1400,
      residentCount: 54,
      treeLodBias: 1.15,
      anisotropy,
    };
  }
  return {
    tier,
    dpr: Math.min(maxDpr, 2),
    shadows: true,
    shadowMapSize: 1536,
    snowCount: 900,
    residentCount: 40,
    treeLodBias: 1,
    anisotropy,
  };
}
