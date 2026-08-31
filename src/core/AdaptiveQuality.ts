import * as THREE from 'three';
import { clamp } from '../util/math';

export interface QualitySettings {
  starTooth: number;
  roundSegments: number;
  petalSamples: number;
  nozzleRings: number;
  cakeRings: number;
  cakeSegs: number;
  bubble: number;
  shadowSize: number;
  maxDpr: number;
  /** extra contact deformation passes */
  contactDetail: number;
}

const LOW: QualitySettings = {
  starTooth: 5,
  roundSegments: 20,
  petalSamples: 22,
  nozzleRings: 14,
  cakeRings: 14,
  cakeSegs: 64,
  bubble: 0.05,
  shadowSize: 512,
  maxDpr: 1.25,
  contactDetail: 0,
};

const MID: QualitySettings = {
  starTooth: 7,
  roundSegments: 26,
  petalSamples: 30,
  nozzleRings: 20,
  cakeRings: 22,
  cakeSegs: 96,
  bubble: 0.085,
  shadowSize: 1024,
  maxDpr: 2.0,
  contactDetail: 1,
};

/** WebGPU-class devices get denser sections, finer bubbles and richer contact. */
const HIGH: QualitySettings = {
  starTooth: 10,
  roundSegments: 34,
  petalSamples: 40,
  nozzleRings: 26,
  cakeRings: 28,
  cakeSegs: 128,
  bubble: 0.125,
  shadowSize: 2048,
  maxDpr: 2.0,
  contactDetail: 2,
};

export type Tier = 'low' | 'mid' | 'high';

export class AdaptiveQuality {
  settings: QualitySettings;
  tier: Tier;
  /** true when the device advertises WebGPU (Safari 26+, recent Chrome) */
  readonly webgpu: boolean;

  private ema = 1 / 60;
  private cooldown = 2.5;
  private currentDpr: number;
  private onShadow: (size: number) => void = () => {};

  constructor(private renderer: THREE.WebGLRenderer) {
    this.webgpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
    const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4;
    const cores = navigator.hardwareConcurrency ?? 4;
    if (this.webgpu && cores >= 6) this.tier = 'high';
    else if (cores >= 4 && mem >= 3) this.tier = 'mid';
    else this.tier = 'low';
    this.settings = { ...(this.tier === 'high' ? HIGH : this.tier === 'mid' ? MID : LOW) };
    this.currentDpr = Math.min(window.devicePixelRatio || 1, this.settings.maxDpr);
    renderer.setPixelRatio(this.currentDpr);
  }

  bindShadowResize(cb: (size: number) => void): void {
    this.onShadow = cb;
  }

  get dpr(): number {
    return this.currentDpr;
  }

  update(dt: number): void {
    this.ema += (dt - this.ema) * 0.05;
    this.cooldown -= dt;
    if (this.cooldown > 0) return;

    const fps = 1 / Math.max(this.ema, 1e-4);
    const maxDpr = Math.min(window.devicePixelRatio || 1, this.settings.maxDpr);
    if (fps < 44 && this.currentDpr > 0.75) {
      this.currentDpr = clamp(this.currentDpr - 0.25, 0.75, maxDpr);
      this.renderer.setPixelRatio(this.currentDpr);
      this.cooldown = 3;
      if (fps < 32) {
        this.settings.shadowSize = Math.max(512, this.settings.shadowSize >> 1);
        this.onShadow(this.settings.shadowSize);
      }
    } else if (fps > 57 && this.currentDpr < maxDpr) {
      this.currentDpr = clamp(this.currentDpr + 0.25, 0.75, maxDpr);
      this.renderer.setPixelRatio(this.currentDpr);
      this.cooldown = 4;
    } else {
      this.cooldown = 2;
    }
  }
}
