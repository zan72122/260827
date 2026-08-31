import type { QualityTier } from '../render3d/materials';

/** 端末に合わせて描画負荷を段階的に落とす。評価画像はここでぼかさない。 */
export class QualityController {
  tier: QualityTier;
  dpr: number;
  private samples: number[] = [];
  private lastChange = 0;
  onChange: ((t: QualityTier, dpr: number) => void) | null = null;

  constructor(initial?: QualityTier) {
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
    const cores = navigator.hardwareConcurrency ?? 4;
    this.tier = initial ?? (mem >= 6 && cores >= 6 ? 'medium' : 'low');
    this.dpr = Math.min(window.devicePixelRatio || 1, this.tier === 'low' ? 1.25 : 2);
  }

  /** 毎フレームの所要時間(ms)を渡す。継続的に遅ければ 1 段落とす。 */
  sample(ms: number, now: number): void {
    this.samples.push(ms);
    if (this.samples.length < 90) return;
    const sorted = this.samples.slice().sort((a, b) => a - b);
    const p80 = sorted[Math.floor(sorted.length * 0.8)];
    this.samples.length = 0;
    if (now - this.lastChange < 4000) return;
    if (p80 > 32 && (this.tier !== 'low' || this.dpr > 1)) {
      this.lastChange = now;
      if (this.dpr > 1.05) this.dpr = Math.max(1, this.dpr - 0.35);
      else if (this.tier === 'high') this.tier = 'medium';
      else if (this.tier === 'medium') this.tier = 'low';
      this.onChange?.(this.tier, this.dpr);
    }
  }
}
