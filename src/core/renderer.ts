import * as THREE from 'three';
import { clamp } from './rng';

export type QualityTier = 'low' | 'medium' | 'high';

/** Structural view of the two renderers we support; both expose this subset. */
export interface AnyRenderer {
  domElement: HTMLCanvasElement;
  shadowMap: { enabled: boolean; type: THREE.ShadowMapType };
  toneMapping: THREE.ToneMapping;
  toneMappingExposure: number;
  outputColorSpace: string;
  setSize(w: number, h: number, updateStyle?: boolean): void;
  setPixelRatio(v: number): void;
  render(scene: THREE.Scene, camera: THREE.Camera): unknown;
  setClearColor(color: THREE.ColorRepresentation, alpha?: number): void;
  dispose(): void;
}

export interface QualitySettings {
  tier: QualityTier;
  /** Needle sprigs on the hero tree. */
  sprigCount: number;
  /** Instanced falling debris budget. */
  debrisCount: number;
  shadowMapSize: number;
  textureSize: number;
  /** Radial/height segments multiplier for trunk and branch tubes. */
  geoDetail: number;
  maxPixelRatio: number;
}

function guessTier(): QualityTier {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency ?? 4;
  const mem = nav.deviceMemory ?? 4;
  const px = window.innerWidth * window.innerHeight * Math.min(window.devicePixelRatio, 3);
  if (cores <= 3 || mem <= 2) return 'low';
  if (cores >= 6 && mem >= 4 && px < 5_000_000) return 'high';
  return 'medium';
}

export function qualityFor(tier: QualityTier): QualitySettings {
  switch (tier) {
    case 'low':
      return { tier, sprigCount: 2200, debrisCount: 90, shadowMapSize: 512, textureSize: 256, geoDetail: 0.6, maxPixelRatio: 1.25 };
    case 'medium':
      return { tier, sprigCount: 3000, debrisCount: 150, shadowMapSize: 1024, textureSize: 512, geoDetail: 0.85, maxPixelRatio: 1.75 };
    default:
      return { tier, sprigCount: 3800, debrisCount: 220, shadowMapSize: 2048, textureSize: 512, geoDetail: 1, maxPixelRatio: 2 };
  }
}

export interface RenderSystem {
  renderer: AnyRenderer;
  isWebGPU: boolean;
  quality: QualitySettings;
  resize(): void;
  /** Feeds a frame time (ms) into the adaptive resolution controller. */
  tick(frameMs: number): void;
  size: { w: number; h: number; portrait: boolean };
}

export async function createRenderSystem(container: HTMLElement): Promise<RenderSystem> {
  const params = new URLSearchParams(location.search);
  const forceWebGL = params.get('renderer') === 'webgl';
  const forcedTier = params.get('quality') as QualityTier | null;
  const tier = forcedTier && ['low', 'medium', 'high'].includes(forcedTier) ? forcedTier : guessTier();
  const quality = qualityFor(tier);

  let renderer: AnyRenderer | null = null;
  let isWebGPU = false;

  const gpu = (navigator as Navigator & { gpu?: unknown }).gpu;
  if (gpu && !forceWebGL) {
    try {
      const mod = (await import('three/webgpu')) as unknown as {
        WebGPURenderer: new (p: Record<string, unknown>) => AnyRenderer & { init(): Promise<void> };
      };
      const r = new mod.WebGPURenderer({ antialias: tier !== 'low', alpha: false });
      await r.init();
      renderer = r;
      isWebGPU = true;
    } catch {
      renderer = null;
    }
  }

  if (!renderer) {
    renderer = new THREE.WebGLRenderer({
      antialias: tier !== 'low',
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
  }

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x8b96a0, 1);
  renderer.domElement.setAttribute('aria-hidden', 'true');
  container.appendChild(renderer.domElement);

  let scale = 1;
  const size = { w: 1, h: 1, portrait: true };

  const applySize = () => {
    const w = Math.max(1, container.clientWidth || window.innerWidth);
    const h = Math.max(1, container.clientHeight || window.innerHeight);
    size.w = w;
    size.h = h;
    size.portrait = h >= w;
    const dpr = clamp(window.devicePixelRatio || 1, 1, quality.maxPixelRatio) * scale;
    renderer!.setPixelRatio(clamp(dpr, 0.6, quality.maxPixelRatio));
    renderer!.setSize(w, h, true);
  };
  applySize();

  // Adaptive resolution: keep the frame budget, never chase the device's raw DPR.
  const history: number[] = [];
  let cooldown = 1.5;
  const tick = (frameMs: number) => {
    if (cooldown > 0) {
      cooldown -= frameMs / 1000;
      return;
    }
    history.push(frameMs);
    if (history.length < 45) return;
    const avg = history.reduce((a, b) => a + b, 0) / history.length;
    history.length = 0;
    const before = scale;
    if (avg > 22 && scale > 0.62) scale = Math.max(0.62, scale - 0.12);
    else if (avg < 13.5 && scale < 1) scale = Math.min(1, scale + 0.08);
    if (before !== scale) {
      applySize();
      cooldown = 1.2;
    }
  };

  return { renderer, isWebGPU, quality, resize: applySize, tick, size };
}
