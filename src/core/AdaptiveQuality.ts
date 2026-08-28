import * as THREE from 'three';

export type QualityTier = 'low' | 'medium' | 'high';

export interface QualityBudget {
  tier: QualityTier;
  dprCap: number;
  snowCount: number;
  shadows: boolean;
  shadowMapSize: number;
  envMapSize: number;
  /** extra loose letters lying around the hall */
  ambientPaper: number;
  highResFaces: boolean;
}

/**
 * WebGL 2 runs every step of the game. Where WebGPU is present we only spend the
 * headroom on paper count, snow and reflection resolution - never on new mechanics.
 */
export class AdaptiveQuality {
  budget: QualityBudget;
  readonly webgpuCapable: boolean;

  /** Software rasterisers (and CI) render below one device pixel; real GPUs never do. */
  private renderScale = 1;
  private samples: number[] = [];
  private lastAdjust = 0;
  private renderer: THREE.WebGLRenderer;
  private onChange: (b: QualityBudget) => void;

  constructor(renderer: THREE.WebGLRenderer, onChange: (b: QualityBudget) => void) {
    this.renderer = renderer;
    this.onChange = onChange;
    this.webgpuCapable = typeof navigator !== 'undefined' && 'gpu' in navigator;

    const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4;
    const cores = navigator.hardwareConcurrency ?? 4;
    const software = isSoftwareRenderer(renderer);
    this.renderScale = software ? 0.7 : 1;
    const strong = mem >= 4 && cores >= 6 && !software;

    const tier: QualityTier = strong ? (this.webgpuCapable ? 'high' : 'medium') : 'low';
    this.budget = makeBudget(tier, this.webgpuCapable);
    this.apply();
  }

  private apply(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, this.budget.dprCap) * this.renderScale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.shadowMap.enabled = this.budget.shadows;
  }

  setTier(tier: QualityTier): void {
    if (this.budget.tier === tier) return;
    this.budget = makeBudget(tier, this.webgpuCapable);
    this.apply();
    this.onChange(this.budget);
  }

  /** Sample frame times and step down before the hall starts to stutter. */
  sample(dt: number, now: number): void {
    this.samples.push(dt);
    if (this.samples.length > 40) this.samples.shift();
    if (this.samples.length < 30 || now - this.lastAdjust < 2) return;

    const sorted = [...this.samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    this.lastAdjust = now;

    if (median > 1 / 34 && this.budget.tier !== 'low') {
      this.setTier(this.budget.tier === 'high' ? 'medium' : 'low');
    } else if (median < 1 / 57 && this.budget.tier === 'low') {
      this.setTier('medium');
    }
  }

  onResize(): void {
    this.apply();
  }
}

/** A software rasteriser gets the low budget from the first frame, not after a stutter. */
function isSoftwareRenderer(renderer: THREE.WebGLRenderer): boolean {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return false;
    const name = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '').toLowerCase();
    return name.includes('swiftshader') || name.includes('llvmpipe') || name.includes('software');
  } catch {
    return false;
  }
}

function makeBudget(tier: QualityTier, webgpu: boolean): QualityBudget {
  const base: Record<QualityTier, QualityBudget> = {
    low: {
      tier: 'low',
      dprCap: 1.5,
      snowCount: 260,
      shadows: false,
      shadowMapSize: 512,
      envMapSize: 128,
      ambientPaper: 4,
      highResFaces: false,
    },
    medium: {
      tier: 'medium',
      dprCap: 2,
      snowCount: 700,
      shadows: true,
      shadowMapSize: 1024,
      envMapSize: 256,
      ambientPaper: 10,
      highResFaces: false,
    },
    high: {
      tier: 'high',
      dprCap: 2.5,
      snowCount: 1200,
      shadows: true,
      shadowMapSize: 2048,
      envMapSize: 256,
      ambientPaper: 16,
      highResFaces: true,
    },
  };
  const b = { ...base[tier] };
  if (webgpu && tier !== 'low') {
    b.snowCount = Math.round(b.snowCount * 1.6);
    b.ambientPaper = Math.round(b.ambientPaper * 1.5);
    b.envMapSize = 512;
  }
  return b;
}
