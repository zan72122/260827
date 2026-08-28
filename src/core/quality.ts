/**
 * Device tiering and the degradation ladder.
 *
 * The ladder is fixed by design and applied in this order: snow particles,
 * distant tree density, shadow map resolution, environment probe refresh,
 * pixel ratio. The environment probes are painted and pre-filtered once at
 * boot and never re-rendered, so that fourth rung already costs nothing per
 * frame and there is nothing left to take off it.
 *
 * Horse gait, bell swing and audio scheduling are never scaled down.
 */

export type Tier = 'low' | 'mid' | 'high';

export interface QualitySettings {
  tier: Tier;
  /** upper bound applied to window.devicePixelRatio */
  pixelRatio: number;
  /** airborne snow flakes around the camera */
  snowFlakes: number;
  /** trees scattered across the middle + far distance */
  treeCount: number;
  /** shadow map edge size, 0 disables dynamic shadows */
  shadowSize: number;
  /** how many bells get an individually simulated inner clapper */
  heroBells: number;
  /** hoof spray / breath billboards alive at once */
  puffBudget: number;
  antialias: boolean;
}

const PRESETS: Record<Tier, Omit<QualitySettings, 'tier'>> = {
  low: {
    pixelRatio: 1.35,
    snowFlakes: 220,
    treeCount: 120,
    shadowSize: 1024,
    heroBells: 2,
    puffBudget: 40,
    antialias: false,
  },
  mid: {
    pixelRatio: 1.8,
    snowFlakes: 520,
    treeCount: 260,
    shadowSize: 1536,
    heroBells: 3,
    puffBudget: 70,
    antialias: true,
  },
  high: {
    pixelRatio: 2.0,
    snowFlakes: 900,
    treeCount: 420,
    shadowSize: 2048,
    heroBells: 3,
    puffBudget: 110,
    antialias: true,
  },
};

function guessTier(): Tier {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mem = nav.deviceMemory ?? 4;
  const cores = navigator.hardwareConcurrency ?? 4;
  const px = window.screen.width * window.screen.height * (window.devicePixelRatio || 1);

  // Very small or very weak devices start conservative; they can still be
  // promoted by the runtime sampler if frames stay cheap.
  if (mem <= 2 || cores <= 3) return 'low';
  if (mem >= 8 && cores >= 6 && px > 1.6e6) return 'high';
  return 'mid';
}

export class Quality {
  settings: QualitySettings;
  readonly reducedMotion: boolean;
  private frameTimes: number[] = [];
  private lastChange = 0;
  private listeners: Array<(s: QualitySettings) => void> = [];

  constructor(forced?: Tier) {
    const tier = forced ?? guessTier();
    this.settings = { tier, ...PRESETS[tier] };
    this.reducedMotion =
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  onChange(fn: (s: QualitySettings) => void): void {
    this.listeners.push(fn);
  }

  /** Called once per rendered frame with the frame duration in seconds. */
  sample(dt: number, now: number): void {
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    if (now - this.lastChange < 6) return;

    if (avg > 1 / 34 && this.settings.tier !== 'low') {
      this.step(this.settings.tier === 'high' ? 'mid' : 'low');
      this.lastChange = now;
    } else if (avg < 1 / 57 && this.settings.tier === 'low') {
      this.step('mid');
      this.lastChange = now;
    }
  }

  private step(tier: Tier): void {
    this.settings = { tier, ...PRESETS[tier] };
    for (const fn of this.listeners) fn(this.settings);
  }
}
