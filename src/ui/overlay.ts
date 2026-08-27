import * as THREE from 'three';
import { Chart } from './chart';
import type { Seabed } from '../world/terrain';

// DOM overlay: icon-only (no reading required for a 4-year-old).
export class Overlay {
  private root: HTMLElement;
  private skipEl: HTMLElement | null = null;
  private resultEl: HTMLElement | null = null;
  private chart: Chart | null = null;
  private resultT0 = 0;
  private playerPts: THREE.Vector3[] = [];
  private altPts: THREE.Vector3[] = [];
  private signalOn = false;
  private raf = 0;
  onReplay: (() => void) | null = null;
  onSkip: (() => void) | null = null;

  constructor() {
    this.root = document.getElementById('overlay')!;
    const style = document.createElement('style');
    style.textContent = `
      @keyframes sc-pulse { 0%,100% { opacity: .5; transform: scale(1);} 50% { opacity: 1; transform: scale(1.12);} }
      @keyframes sc-fadein { from { opacity: 0;} to { opacity: 1;} }
      .sc-skip {
        position: absolute; right: max(18px, env(safe-area-inset-right)); bottom: max(18px, env(safe-area-inset-bottom));
        width: 58px; height: 58px; border-radius: 50%;
        background: rgba(255,255,255,0.22); backdrop-filter: blur(4px);
        display: flex; align-items: center; justify-content: center;
        pointer-events: auto; animation: sc-pulse 1.6s infinite;
      }
      .sc-result {
        position: absolute; inset: 0; display: flex; flex-direction: column;
        align-items: center; justify-content: center; gap: 14px;
        background: rgba(8, 30, 44, 0.55); pointer-events: auto;
        animation: sc-fadein .6s ease; padding: max(10px, env(safe-area-inset-top)) 10px max(10px, env(safe-area-inset-bottom));
      }
      .sc-chartwrap {
        background: #efe7d2; border-radius: 14px; padding: 10px;
        box-shadow: 0 12px 40px rgba(0,0,0,.4);
        max-width: min(92vw, 720px); max-height: 70vh;
      }
      .sc-chartwrap canvas { display: block; width: 100%; height: auto; border-radius: 8px; }
      .sc-replay {
        width: 74px; height: 74px; border-radius: 50%; border: none;
        background: #f2b632; box-shadow: 0 6px 18px rgba(0,0,0,.35);
        display: flex; align-items: center; justify-content: center;
        pointer-events: auto; animation: sc-pulse 2s infinite;
      }
    `;
    document.head.appendChild(style);
  }

  /** Chevron icon during the opening deck tour: tap anywhere to skip. */
  showSkip(): void {
    if (this.skipEl) return;
    const el = document.createElement('div');
    el.className = 'sc-skip';
    el.innerHTML = `<svg width="30" height="30" viewBox="0 0 24 24" fill="none">
      <path d="M5 4l8 8-8 8M12 4l8 8-8 8" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.onSkip?.();
    });
    this.root.appendChild(el);
    this.skipEl = el;
  }

  hideSkip(): void {
    this.skipEl?.remove();
    this.skipEl = null;
  }

  showResult(
    seabed: Seabed,
    playerPts: THREE.Vector3[],
    altPts: THREE.Vector3[]
  ): void {
    this.hideResult();
    const el = document.createElement('div');
    el.className = 'sc-result';
    const wrap = document.createElement('div');
    wrap.className = 'sc-chartwrap';
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 428;
    wrap.appendChild(canvas);
    el.appendChild(wrap);
    const btn = document.createElement('button');
    btn.className = 'sc-replay';
    btn.innerHTML = `<svg width="38" height="38" viewBox="0 0 24 24" fill="none">
      <path d="M4 12a8 8 0 1 0 2.4-5.7" stroke="#3a2c08" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M6 2v5h5" stroke="#3a2c08" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
    btn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.onReplay?.();
    });
    el.appendChild(btn);
    this.root.appendChild(el);
    this.resultEl = el;
    this.chart = new Chart(canvas);
    this.chart.prepare(seabed);
    this.playerPts = playerPts;
    this.altPts = altPts;
    this.resultT0 = performance.now();
    this.signalOn = false;
    setTimeout(() => { this.signalOn = true; }, 700);
    const tick = () => {
      if (!this.resultEl || !this.chart) return;
      const t = (performance.now() - this.resultT0) / 1000;
      this.chart.draw(this.playerPts, this.altPts, t, this.signalOn);
      this.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  hideResult(): void {
    cancelAnimationFrame(this.raf);
    this.resultEl?.remove();
    this.resultEl = null;
    this.chart = null;
  }
}
