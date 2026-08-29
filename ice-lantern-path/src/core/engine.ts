import * as THREE from 'three';
import { Quality, type QualitySettings } from './quality';
import { CameraRig } from './cameraRig';
import { Environment } from '../world/environment';

function urlNumber(key: string, fallback: number) {
  const v = new URLSearchParams(location.search).get(key);
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export class Engine {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  rig = new CameraRig();
  quality: Quality;
  env: Environment;
  canvas: HTMLCanvasElement;
  onUpdate: ((dt: number, elapsed: number) => void) | null = null;
  onResize: ((w: number, h: number) => void) | null = null;
  private clock = new THREE.Clock();
  private maxDt = 0.05;
  private elapsed = 0;
  private raf = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const forced = urlNumber('q', NaN);
    this.quality = new Quality(Number.isFinite(forced) ? forced : undefined);
    // capture harnesses run on a software rasteriser; without this the frame
    // clamp turns every scripted beat into slow motion
    this.maxDt = urlNumber('maxdt', 0.05);
    const q = this.quality.settings;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: q.name !== 'low',
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(q.dpr);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = true;

    this.env = new Environment(this.renderer, this.scene, q);
    this.scene.add(this.env.group);

    this.quality.onChange((s) => this.applyQuality(s));
    window.addEventListener('resize', this.resize);
    window.addEventListener('orientationchange', () => setTimeout(this.resize, 120));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', this.resize);
    this.resize();
  }

  private applyQuality(s: QualitySettings) {
    this.renderer.setPixelRatio(s.dpr);
    this.renderer.shadowMap.enabled = s.shadows;
    this.env.applyQuality(s);
    this.resize();
  }

  resize = () => {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.renderer.setSize(w, h, false);
    this.rig.setViewport(w, h);
    this.onResize?.(w, h);
  };

  start() {
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(this.maxDt, this.clock.getDelta());
      this.elapsed += dt;
      const t0 = performance.now();
      this.onUpdate?.(dt, this.elapsed);
      this.env.update(dt, this.rig.camera);
      this.rig.update(dt);
      this.renderer.render(this.scene, this.rig.camera);
      this.quality.sample(performance.now() - t0);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }
}
