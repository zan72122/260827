import * as THREE from 'three';

export type QualityTier = 'low' | 'mid' | 'high';

/**
 * AdaptiveQuality — picks a starting tier from the device, then watches the
 * frame time and steps down (never up past the device ceiling) so that phones
 * keep a steady frame during the reveal, which is the moment that matters.
 *
 * WebGPU availability is used only as a capability signal: when present we
 * spend the extra headroom on section materials and micro-geometry
 * (clearcoat + sheen on cut faces, denser achenes, larger flesh textures).
 * Rendering itself always runs on WebGL 2 so no feature depends on WebGPU.
 */
export class AdaptiveQuality {
  tier: QualityTier = 'mid';
  ceiling: QualityTier = 'high';
  hasWebGPU = false;
  maxAnisotropy = 1;

  private samples: number[] = [];
  private lastChange = 0;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
    this.hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;

    const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4;
    const cores = navigator.hardwareConcurrency ?? 4;
    const px = window.screen.width * window.screen.height * (window.devicePixelRatio || 1);

    if (mem <= 2 || cores <= 4) this.ceiling = 'mid';
    if (mem <= 2 && cores <= 4 && px < 1_500_000) this.ceiling = 'low';
    if (mem >= 6 && cores >= 6) this.ceiling = 'high';
    this.tier = this.ceiling;
    this.apply();
  }

  /** Device pixel ratio actually used for the drawing buffer. */
  get pixelRatio(): number {
    const dpr = window.devicePixelRatio || 1;
    const cap = this.tier === 'high' ? 2.5 : this.tier === 'mid' ? 2 : 1.5;
    return Math.min(dpr, cap);
  }

  /** Texture edge length for close-up procedural maps. */
  get textureSize(): number {
    if (this.tier === 'low') return 512;
    if (this.tier === 'mid') return 1024;
    return this.hasWebGPU ? 2048 : 1024;
  }

  /** Radial segments used for the near LOD of a strawberry slice. */
  get berrySegments(): number {
    return this.tier === 'low' ? 48 : this.tier === 'mid' ? 96 : 144;
  }

  /** Achene (seed) instances placed around the skin band at near LOD. */
  get acheneCount(): number {
    if (this.tier === 'low') return 0;
    if (this.tier === 'mid') return 22;
    return this.hasWebGPU ? 44 : 32;
  }

  /** Angular resolution of the cream height field. Always a multiple of 12. */
  get creamAngularSegments(): number {
    return this.tier === 'low' ? 96 : this.tier === 'mid' ? 144 : 192;
  }

  /** Extra material richness on freshly revealed cut faces. */
  get richSections(): boolean {
    return this.tier !== 'low';
  }

  /**
   * 0 = plain cut faces, 1 = wet clearcoat and fibre relief, 2 = the same plus
   * finer outlines and stronger micro relief. Level 2 is the only thing WebGPU
   * buys: the game runs every feature on WebGL 2, and the extra headroom is
   * spent on the section, which is what the child is looking at.
   */
  get sectionDetail(): 0 | 1 | 2 {
    if (this.tier === 'low') return 0;
    return this.hasWebGPU && this.tier === 'high' ? 2 : 1;
  }

  /** Outline resolution of the welded hull the knife is intersected with. */
  get sectionSegments(): number {
    return this.tier === 'low' ? 72 : this.sectionDetail === 2 ? 224 : 144;
  }

  get shadowMapSize(): number {
    return this.tier === 'low' ? 1024 : this.tier === 'mid' ? 1536 : 2048;
  }

  private apply(): void {
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type =
      this.tier === 'low' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  }

  /** Call once per frame with the measured frame time in ms. */
  sample(dtMs: number, now: number): boolean {
    this.samples.push(dtMs);
    if (this.samples.length < 90) return false;
    const sorted = this.samples.slice().sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    this.samples.length = 0;
    if (now - this.lastChange < 4000) return false;
    if (median > 26 && this.tier !== 'low') {
      this.tier = this.tier === 'high' ? 'mid' : 'low';
      this.lastChange = now;
      this.apply();
      return true;
    }
    return false;
  }
}
