/**
 * debugApi.ts — DebugProgressAPI.
 *
 * Exposes window.__zoom so the capture harness (and a person with a console) can jump
 * to any point of the dive, force a quality tier, wait for the pyramid to finish, and
 * read back exactly where the landmark ended up on screen. Everything the QA pass
 * needs is here rather than bolted on later.
 */

import type { JourneyState } from '../core/journey';
import type { MultiresolutionTissuePyramid, PyramidBinding } from '../micro/tissuePyramid';
import type { QualityTier } from '../core/quality';

export interface DebugHooks {
  setProgress: (p: number, snap?: boolean) => void;
  getProgress: () => number;
  getJourney: () => JourneyState;
  setQuality: (tier: QualityTier) => void;
  getTier: () => QualityTier;
  capturePoints: Array<{ id: string; p: number; label: string }>;
  ensureLevelsFor: (fieldMM: number) => void;
  residentBytes: () => number;
  building: () => boolean;
  residentLevels: () => number[];
  anchor: () => { x: number; y: number };
  resolutionMM: (na: number) => number;
}

export interface FrameInfo {
  journey: JourneyState;
  fps: number;
  progressRate: number;
  binding: PyramidBinding | null;
  landmarkScreen: { x: number; y: number };
  pyramid: MultiresolutionTissuePyramid;
  tier: QualityTier;
}

export interface DebugSurface {
  frame(info: FrameInfo): void;
}

export function installDebugApi(hooks: DebugHooks): DebugSurface {
  const params = new URLSearchParams(location.search);
  const showOverlay = params.get('debug') === '1';
  const startAt = params.get('p');

  let overlay: HTMLDivElement | null = null;
  let crosshair: HTMLCanvasElement | null = null;
  let latest: FrameInfo | null = null;
  let framesSinceSet = 0;

  if (showOverlay) {
    overlay = document.createElement('div');
    overlay.id = 'debug-overlay';
    document.getElementById('app')?.appendChild(overlay);
    crosshair = document.createElement('canvas');
    crosshair.id = 'debug-crosshair';
    document.getElementById('app')?.appendChild(crosshair);
  }

  const api = {
    /** Jump straight to a point in the dive. `snap` skips the smoothing. */
    setProgress(p: number, snap = true): void {
      hooks.setProgress(p, snap);
      framesSinceSet = 0;
    },
    getProgress: () => hooks.getProgress(),
    /** Everything the current frame believes about the world. */
    getState() {
      const j = hooks.getJourney();
      return {
        progress: j.progress,
        stage: j.stage,
        fieldMM: j.fieldMM,
        objective: j.objective?.id ?? null,
        na: j.objective?.na ?? null,
        workingDistanceMM: j.objective?.workingDistanceMM ?? null,
        ringColor: j.objective?.ringLabel ?? null,
        totalMag: j.totalMag,
        depthOfFieldMM: j.depthOfFieldMM,
        resolutionMM: j.objective ? hooks.resolutionMM(j.objective.na) : null,
        fieldOpen: j.fieldOpen,
        macroWeight: j.macroWeight,
        levelA: latest?.binding?.levelA ?? null,
        levelB: latest?.binding?.levelB ?? null,
        levelBlend: latest?.binding?.blend ?? null,
        residentLevels: hooks.residentLevels(),
        residentMB: +(hooks.residentBytes() / (1024 * 1024)).toFixed(1),
        tier: hooks.getTier(),
        building: hooks.building(),
        fps: Math.round(latest?.fps ?? 0),
      };
    },
    /** Normalised screen position of the hair follicle, for image comparison. */
    landmarkScreen: () => latest?.landmarkScreen ?? hooks.anchor(),
    anchor: () => hooks.anchor(),
    capturePoints: hooks.capturePoints,
    setQuality: (t: QualityTier) => hooks.setQuality(t),
    /** Blocks until the levels needed at the current progress are fully built. */
    async waitReady(minFrames = 3): Promise<void> {
      hooks.ensureLevelsFor(hooks.getJourney().fieldMM);
      while (framesSinceSet < minFrames) {
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
    },
    memory: () => ({
      residentMB: +(hooks.residentBytes() / (1024 * 1024)).toFixed(1),
      levels: hooks.residentLevels(),
      jsHeapMB: (() => {
        const m = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
        return m ? +(m.usedJSHeapSize / (1024 * 1024)).toFixed(1) : null;
      })(),
    }),
  };

  (window as unknown as Record<string, unknown>).__zoom = api;

  if (startAt !== null) {
    const v = Number(startAt);
    if (Number.isFinite(v)) hooks.setProgress(Math.max(0, Math.min(1, v)), true);
  }

  return {
    frame(info: FrameInfo): void {
      latest = info;
      framesSinceSet++;
      if (!overlay || !crosshair) return;

      const j = info.journey;
      overlay.textContent = [
        `p      ${j.progress.toFixed(4)}   ${j.stage}`,
        `field  ${j.fieldMM.toFixed(3)} mm`,
        `obj    ${j.objective ? `${j.objective.id} NA${j.objective.na} ${j.objective.ringLabel}` : '—'}`,
        `mag    ${Math.round(j.totalMag)}x   DOF ${(j.depthOfFieldMM * 1000).toFixed(2)} um`,
        `res    ${j.objective ? (hooks.resolutionMM(j.objective.na) * 1000).toFixed(2) : '—'} um`,
        `level  ${info.binding ? `${info.binding.levelA}->${info.binding.levelB} @${info.binding.blend.toFixed(2)}` : '—'}`,
        `res.lv ${hooks.residentLevels().join(',')}  ${(hooks.residentBytes() / 1048576).toFixed(1)}MB`,
        `mark   ${info.landmarkScreen.x.toFixed(3)}, ${info.landmarkScreen.y.toFixed(3)}`,
        `${info.tier}  ${Math.round(info.fps)}fps`,
      ].join('\n');

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (crosshair.width !== w * dpr || crosshair.height !== h * dpr) {
        crosshair.width = w * dpr;
        crosshair.height = h * dpr;
        crosshair.style.width = `${w}px`;
        crosshair.style.height = `${h}px`;
      }
      const g = crosshair.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const a = hooks.anchor();
      // Green: where the landmark is meant to be. Magenta: where it actually is.
      drawCross(g, a.x * w, a.y * h, 'rgba(120,255,170,0.85)', 22);
      drawCross(g, info.landmarkScreen.x * w, info.landmarkScreen.y * h, 'rgba(255,110,220,0.9)', 13);
    },
  };
}

function drawCross(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  size: number,
): void {
  g.strokeStyle = color;
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(x - size, y);
  g.lineTo(x + size, y);
  g.moveTo(x, y - size);
  g.lineTo(x, y + size);
  g.stroke();
  g.beginPath();
  g.arc(x, y, size * 0.55, 0, Math.PI * 2);
  g.stroke();
}
