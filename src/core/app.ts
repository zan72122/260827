import {
  ACESFilmicToneMapping,
  Clock,
  PerspectiveCamera,
  PCFSoftShadowMap,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { Quality } from './quality';
import { Input } from './input';

export type Orientation = 'portrait' | 'landscape';

export class App {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly clock = new Clock();
  readonly quality: Quality;
  readonly input: Input;
  readonly canvas: HTMLCanvasElement;

  orientation: Orientation = 'landscape';
  aspect = 1;
  /** shortest screen edge in CSS pixels, used to keep hit areas thumb-sized */
  shortEdge = 320;

  /** debug time multiplier (`?speed=3`), so a browser harness can drive a
   *  whole run in a reasonable number of frames */
  readonly timeScale: number;
  private onFrame: ((dt: number, elapsed: number) => void) | null = null;
  private elapsed = 0;
  private running = false;
  private resizeListeners: Array<() => void> = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const speedParam = Number(new URLSearchParams(location.search).get('speed'));
    this.timeScale =
      Number.isFinite(speedParam) && speedParam > 0 ? Math.min(8, speedParam) : 1;
    this.quality = new Quality();
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: this.quality.settings.antialias,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    RectAreaLightUniformsLib.init();

    this.camera = new PerspectiveCamera(46, 1, 0.04, 1400);
    this.input = new Input(canvas);

    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('orientationchange', () => setTimeout(this.resize, 120));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', this.resize);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.clock.getDelta();
    });
  }

  onResize(fn: () => void): void {
    this.resizeListeners.push(fn);
  }

  private resize = (): void => {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.aspect = w / h;
    this.orientation = h >= w ? 'portrait' : 'landscape';
    this.shortEdge = Math.min(w, h);
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality.settings.pixelRatio);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
    for (const fn of this.resizeListeners) fn();
  };

  applyQuality(): void {
    this.resize();
  }

  start(fn: (dt: number, elapsed: number) => void): void {
    this.onFrame = fn;
    if (this.running) return;
    this.running = true;
    this.clock.start();
    const tick = (): void => {
      requestAnimationFrame(tick);
      // A tab that has been away should not integrate a five second step.
      const dt = Math.min(this.clock.getDelta(), 1 / 20) * this.timeScale;
      this.elapsed += dt;
      this.input.update(dt);
      this.quality.sample(dt, this.elapsed);
      this.onFrame?.(dt, this.elapsed);
      this.renderer.render(this.scene, this.camera);
    };
    requestAnimationFrame(tick);
  }
}
