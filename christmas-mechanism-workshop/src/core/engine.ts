import * as THREE from 'three';
import { Composite } from './composite';
import { detectTier, tierPreset, type Tier } from './tier';
import { setAnisotropy, setTextureScale } from '../mat/textures';

export type Orientation = 'portrait' | 'landscape';

export class Engine {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly composite: Composite;
  tier: Tier;

  width = 1; height = 1; dpr = 1;
  orientation: Orientation = 'landscape';
  time = 0;

  private rt: THREE.WebGLRenderTarget;
  private updaters: ((dt: number, t: number) => void)[] = [];
  private resizers: ((w: number, h: number, o: Orientation) => void)[] = [];
  private last = 0;
  private frameAvg = 1 / 60;
  private sampleCount = 0;
  private demoted = false;
  fps = 60;
  private lastShown = 0;
  private running = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    const ctx = canvas.getContext('webgl2', {
      alpha: false, antialias: false, powerPreference: 'high-performance',
      stencil: false, depth: true,
    });
    if (!ctx) throw new Error('WebGL2 is required');

    this.renderer = new THREE.WebGLRenderer({
      canvas, context: ctx, antialias: false, alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 0.96;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.localClippingEnabled = true;
    this.renderer.setClearColor(0x070605, 1);

    this.tier = detectTier(ctx);
    this.renderer.shadowMap.enabled = this.tier.shadows;
    setTextureScale(this.tier.textureScale);
    setAnisotropy(Math.min(this.tier.anisotropy,
      this.renderer.capabilities.getMaxAnisotropy()));

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.02, 60);
    this.scene.add(this.camera);

    this.rt = new THREE.WebGLRenderTarget(2, 2, {
      type: THREE.HalfFloatType,
      colorSpace: THREE.LinearSRGBColorSpace,
      depthBuffer: true,
      samples: 0,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.composite = new Composite();
    this.composite.material.uniforms.tScene.value = this.rt.texture;
    this.composite.material.uniforms.uShimmer.value = this.tier.shimmer ? 1 : 0;

    window.addEventListener('resize', this.onResize, { passive: true });
    window.addEventListener('orientationchange', () => setTimeout(this.onResize, 120));
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', this.onResize, { passive: true });
    }
    document.addEventListener('visibilitychange', () => {
      // coming back from a background tab must never fast-forward the rotors
      if (!document.hidden) this.last = performance.now();
    });
    this.onResize();
  }

  onUpdate(fn: (dt: number, t: number) => void) { this.updaters.push(fn); }
  onResizeHook(fn: (w: number, h: number, o: Orientation) => void) {
    this.resizers.push(fn);
    fn(this.width, this.height, this.orientation);
  }

  private onResize = () => {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.dpr = Math.min(window.devicePixelRatio || 1, this.tier.dprCap);
    this.width = w; this.height = h;
    this.orientation = h >= w ? 'portrait' : 'landscape';

    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
    this.rt.setSize(Math.round(w * this.dpr), Math.round(h * this.dpr));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composite.material.uniforms.uAspect.value = w / h;
    for (const fn of this.resizers) fn(w, h, this.orientation);
  };

  /** Drop a notch if the device cannot hold the frame; never climbs back up. */
  private watchPerformance(dt: number) {
    if (this.demoted || this.tier.name === 'low') return;
    this.frameAvg = this.frameAvg * 0.94 + dt * 0.06;
    this.sampleCount++;
    if (this.sampleCount < 180) return;
    if (this.frameAvg > 1 / 34) {
      this.demoted = true;
      const next = this.tier.name === 'high' ? tierPreset('mid') : tierPreset('low');
      this.tier = next;
      this.renderer.shadowMap.enabled = next.shadows;
      this.composite.material.uniforms.uShimmer.value = next.shimmer ? 1 : 0;
      this.dpr = Math.min(window.devicePixelRatio || 1, next.dprCap);
      this.renderer.setPixelRatio(this.dpr);
      this.rt.setSize(Math.round(this.width * this.dpr), Math.round(this.height * this.dpr));
      this.sampleCount = 0;
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      requestAnimationFrame(loop);
      let dt = (now - this.last) / 1000;
      this.last = now;
      if (!(dt > 0)) dt = 1 / 60;
      dt = Math.min(dt, 0.1);   // clamp: a stalled frame must not jump the mechanisms
      this.time += dt;
      for (const fn of this.updaters) fn(dt, this.time);
      this.composite.material.uniforms.uTime.value = this.time;
      this.renderer.setRenderTarget(this.rt);
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.composite.scene, this.composite.camera);
      this.fps = this.fps * 0.9 + (1000 / Math.max(now - (this.lastShown || now - 16), 1)) * 0.1;
      this.lastShown = now;
      this.watchPerformance(dt);
    };
    requestAnimationFrame(loop);
  }

  /** Project a world point into normalised screen uv (0..1, y up). */
  projectUV(p: THREE.Vector3, out: THREE.Vector2) {
    const v = p.clone().project(this.camera);
    out.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
    return out;
  }
  /** Project a world point into css pixels (y down), for the HUD. */
  projectPx(p: THREE.Vector3, out: THREE.Vector2) {
    const v = p.clone().project(this.camera);
    out.set((v.x * 0.5 + 0.5) * this.width, (1 - (v.y * 0.5 + 0.5)) * this.height);
    return out;
  }
}
