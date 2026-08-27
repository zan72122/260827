// Device quality tiers. WebGL2 is the baseline; when the device advertises a
// modern GPU path (navigator.gpu) or high core count we raise particle /
// geometry budgets. High-DPI devices get a render buffer cap.
export interface Quality {
  pixelRatioCap: number;
  motes: number;
  sediment: number;
  grass: number;
  fish: number;
  terrainSeg: number;
  waterSeg: number;
}

export function detectQuality(): Quality {
  const nav = navigator as Navigator & { gpu?: unknown; deviceMemory?: number };
  const cores = nav.hardwareConcurrency ?? 4;
  const hasModernGpuPath = typeof nav.gpu !== 'undefined';
  const bigScreen = Math.max(screen.width, screen.height) * (devicePixelRatio || 1) > 2200;

  const high = hasModernGpuPath && cores >= 6;
  const low = cores <= 3;

  if (high) {
    return {
      pixelRatioCap: bigScreen ? 1.8 : 2.0,
      motes: 900, sediment: 260, grass: 520, fish: 14,
      terrainSeg: 150, waterSeg: 128
    };
  }
  if (low) {
    return {
      pixelRatioCap: 1.25,
      motes: 320, sediment: 120, grass: 220, fish: 8,
      terrainSeg: 96, waterSeg: 80
    };
  }
  return {
    pixelRatioCap: bigScreen ? 1.5 : 1.75,
    motes: 600, sediment: 180, grass: 380, fish: 12,
    terrainSeg: 128, waterSeg: 104
  };
}
