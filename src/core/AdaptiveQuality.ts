import type { WebGLRenderer } from 'three';
import { clamp, damp } from './math';

export type QualityTier = 'low' | 'mid' | 'high';

export interface QualityProfile {
  tier: QualityTier;
  /** Multiplier on lamp instance count along every light strand. */
  lampDensity: number;
  /** Number of distinct sector light proxies allowed to be lit at once. */
  lightProxies: number;
  /** Spectator instance count in the far ring. */
  crowdCount: number;
  /** Particle budget for bark chips, breath and snow motes. */
  particles: number;
  /** Needle sprig instances per branch at the highest LOD. */
  foliageDensity: number;
  shadows: boolean;
  shadowMapSize: number;
  /** Screen-space reflection strength on the wet paving (fake, envmap based). */
  groundReflection: number;
  /** Set when the platform exposes WebGPU; only boosts density, never gates. */
  gpuBoost: boolean;
}

const BASE: Record<QualityTier, QualityProfile> = {
  low: {
    tier: 'low',
    lampDensity: 0.45,
    lightProxies: 3,
    crowdCount: 90,
    particles: 60,
    foliageDensity: 0.62,
    shadows: false,
    shadowMapSize: 512,
    groundReflection: 0.25,
    gpuBoost: false,
  },
  mid: {
    tier: 'mid',
    lampDensity: 0.75,
    lightProxies: 4,
    crowdCount: 180,
    particles: 140,
    foliageDensity: 0.85,
    shadows: true,
    shadowMapSize: 1024,
    groundReflection: 0.45,
    gpuBoost: false,
  },
  high: {
    tier: 'high',
    lampDensity: 1,
    lightProxies: 5,
    crowdCount: 300,
    particles: 240,
    foliageDensity: 1,
    shadows: true,
    shadowMapSize: 2048,
    groundReflection: 0.6,
    gpuBoost: false,
  },
};

const hasWebGPU = (): boolean =>
  typeof navigator !== 'undefined' && 'gpu' in navigator && !!(navigator as { gpu?: unknown }).gpu;

/**
 * Picks a starting quality tier from the device, then keeps the render
 * resolution inside a frame-time budget. WebGL 2 always carries the whole
 * ceremony; a WebGPU-capable device only earns denser lamps, more spectators
 * and a stronger wet-stone reflection.
 */
export class AdaptiveQuality {
  readonly profile: QualityProfile;
  readonly maxDpr: number;
  private dpr: number;
  private smoothedFrameMs = 16.7;
  private cooldown = 0;

  constructor(private readonly renderer: WebGLRenderer) {
    const hardwareThreads = navigator.hardwareConcurrency ?? 4;
    const mem = (navigator as { deviceMemory?: number }).deviceMemory ?? 4;
    const coarse = matchMedia('(pointer: coarse)').matches;
    let tier: QualityTier = 'mid';
    if (hardwareThreads <= 4 || mem <= 3) tier = 'low';
    else if (!coarse && hardwareThreads >= 8 && mem >= 8) tier = 'high';

    const gpuBoost = hasWebGPU();
    const base = BASE[tier];
    this.profile = {
      ...base,
      gpuBoost,
      lampDensity: base.lampDensity * (gpuBoost ? 1.35 : 1),
      crowdCount: Math.round(base.crowdCount * (gpuBoost ? 1.3 : 1)),
      particles: Math.round(base.particles * (gpuBoost ? 1.4 : 1)),
      groundReflection: clamp(base.groundReflection * (gpuBoost ? 1.25 : 1), 0, 0.85),
    };

    // Hard DPR ceiling: phone screens gain nothing above ~2 for this scene.
    this.maxDpr = Math.min(window.devicePixelRatio || 1, tier === 'low' ? 1.35 : 2);
    this.dpr = this.maxDpr;
    renderer.setPixelRatio(this.dpr);
  }

  get pixelRatio(): number {
    return this.dpr;
  }

  /** Call once per frame with the measured frame time in milliseconds. */
  update(frameMs: number, dt: number): void {
    this.smoothedFrameMs = damp(this.smoothedFrameMs, clamp(frameMs, 4, 120), 4, dt);
    this.cooldown -= dt;
    if (this.cooldown > 0) return;

    const minDpr = 0.66;
    if (this.smoothedFrameMs > 25 && this.dpr > minDpr) {
      this.dpr = Math.max(minDpr, this.dpr - 0.15);
      this.renderer.setPixelRatio(this.dpr);
      this.cooldown = 1.2;
    } else if (this.smoothedFrameMs < 15 && this.dpr < this.maxDpr) {
      this.dpr = Math.min(this.maxDpr, this.dpr + 0.1);
      this.renderer.setPixelRatio(this.dpr);
      this.cooldown = 2.5;
    }
  }
}
