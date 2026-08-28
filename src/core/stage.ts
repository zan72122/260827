import * as THREE from 'three';
import { clamp } from './util';

export type Orientation = 'portrait' | 'landscape';

/**
 * Renderer + camera + adaptive resolution.
 * The device pixel ratio is capped and then scaled down further when frames
 * get expensive, so a high-DPI iPad never turns its screen into fill-rate cost.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;

  width = 1;
  height = 1;
  orientation: Orientation = 'portrait';

  /** current adaptive scale multiplier applied on top of the DPR cap */
  private quality = 1;
  private qualityTarget = 1;
  private frameCost = 16.7;
  /** 2 = full, 1 = reduced shadows, 0 = shadows off. Only ever steps down. */
  private _tier = 2;
  onTierChange: ((tier: number) => void) | null = null;
  private maxDpr: number;
  private lastResizeKey = '';

  constructor(container: HTMLElement) {
    const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
    const rawDpr = window.devicePixelRatio || 1;
    this.maxDpr = clamp(rawDpr, 1, isIOS ? 2 : 1.9);

    this.renderer = new THREE.WebGLRenderer({
      antialias: rawDpr < 1.6,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
    this.renderer.setClearColor(0x0b0908, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.canvas = this.renderer.domElement;
    container.appendChild(this.canvas);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 60);
    this.scene.fog = new THREE.FogExp2(0x0e0c0a, 0.030);

    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 120));
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => this.resize());
    }
  }

  private resize() {
    const w = Math.max(1, Math.round(window.innerWidth));
    const h = Math.max(1, Math.round(window.innerHeight));
    this.width = w;
    this.height = h;
    this.orientation = w >= h ? 'landscape' : 'portrait';
    const key = `${w}x${h}`;
    if (key !== this.lastResizeKey) this.lastResizeKey = key;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.applyPixelRatio();
  }

  private applyPixelRatio() {
    this.renderer.setPixelRatio(this.maxDpr * this.quality);
    this.renderer.setSize(this.width, this.height, true);
  }

  /**
   * Feed frame time (ms). Resolution gives way first; if that is not enough the
   * stage steps down a quality tier and tells the scene to shed shadow work.
   * Tiers only ever go down, so the picture never flickers between settings.
   */
  reportFrame(ms: number) {
    this.frameCost += (ms - this.frameCost) * 0.06;
    const floor = this._tier === 2 ? 0.72 : 0.5;
    if (this.frameCost > 22 && this.qualityTarget > floor) this.qualityTarget -= 0.05;
    else if (this.frameCost < 13 && this.qualityTarget < 1) this.qualityTarget += 0.02;
    const q = Math.round(this.qualityTarget * 20) / 20;
    if (Math.abs(q - this.quality) > 0.001) {
      this.quality = q;
      this.applyPixelRatio();
    }
    if (this._tier > 0 && this.frameCost > 30 && this.qualityTarget <= floor + 0.001) {
      this._tier--;
      if (this._tier === 0) this.renderer.shadowMap.enabled = false;
      this.renderer.shadowMap.needsUpdate = true;
      this.qualityTarget = Math.min(1, this.qualityTarget + 0.2);
      this.onTierChange?.(this._tier);
    }
  }

  get tier() { return this._tier; }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
