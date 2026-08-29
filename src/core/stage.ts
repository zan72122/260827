/**
 * Renderer shell: WebGL2 (the path every iOS Safari build supports today) with
 * adaptive resolution and a quality tier that steps down before frames drop.
 */
import * as THREE from 'three';
import { budgetFor, guessTier, stepTier, type QualityBudget, type Tier } from './quality';

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  budget: QualityBudget;

  private resolutionScale = 1;
  private frameAvg = 16.7;
  private slowFor = 0;
  private fastFor = 0;
  private onBudget: ((b: QualityBudget) => void) | null = null;
  private width = 1;
  private height = 1;

  constructor(canvas: HTMLCanvasElement) {
    const tier: Tier = guessTier();
    this.budget = budgetFor(tier);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: tier !== 'low',
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = this.budget.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 260);
    this.scene.add(this.camera);

    this.resize();
    window.addEventListener('resize', this.resize, { passive: true });
    window.addEventListener('orientationchange', () => {
      // iOS reports the old size during the rotation itself.
      setTimeout(this.resize, 60);
      setTimeout(this.resize, 260);
    });
  }

  get aspect(): number {
    return this.width / this.height;
  }

  get portrait(): boolean {
    return this.height >= this.width;
  }

  get cssWidth(): number {
    return this.width;
  }

  get cssHeight(): number {
    return this.height;
  }

  onBudgetChange(fn: (b: QualityBudget) => void): void {
    this.onBudget = fn;
  }

  private resize = (): void => {
    this.width = Math.max(1, window.innerWidth);
    this.height = Math.max(1, window.innerHeight);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.applyPixelRatio();
  };

  private applyPixelRatio(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, this.budget.maxPixelRatio);
    this.renderer.setPixelRatio(dpr * this.resolutionScale);
    this.renderer.setSize(this.width, this.height, false);
  }

  /** Call once per frame with the measured frame time (ms). */
  govern(frameMs: number): void {
    this.frameAvg += (Math.min(frameMs, 120) - this.frameAvg) * 0.08;
    const dt = frameMs / 1000;
    if (this.frameAvg > 21.5) {
      this.slowFor += dt;
      this.fastFor = 0;
    } else if (this.frameAvg < 13.5) {
      this.fastFor += dt;
      this.slowFor = 0;
    } else {
      this.slowFor = Math.max(0, this.slowFor - dt * 0.5);
      this.fastFor = Math.max(0, this.fastFor - dt * 0.5);
    }

    if (this.slowFor > 1.4) {
      this.slowFor = 0;
      if (this.resolutionScale > 0.68) {
        this.resolutionScale = Math.max(0.68, this.resolutionScale - 0.14);
        this.applyPixelRatio();
      } else if (this.budget.tier !== 'low') {
        this.setTier(stepTier(this.budget.tier, -1));
      }
    } else if (this.fastFor > 7 && this.resolutionScale < 1) {
      this.fastFor = 0;
      this.resolutionScale = Math.min(1, this.resolutionScale + 0.1);
      this.applyPixelRatio();
    }
  }

  private setTier(tier: Tier): void {
    this.budget = budgetFor(tier);
    this.renderer.shadowMap.enabled = this.budget.shadows;
    this.applyPixelRatio();
    this.onBudget?.(this.budget);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
