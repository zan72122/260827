// エントリーポイント: レンダラ初期化 / リサイズ・回転対応 /
// 適応品質 / メインループ / テスト用フック

import * as THREE from 'three';
import { Game } from './game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const fallback = document.getElementById('fallback') as HTMLDivElement;

function boot(): void {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    if (!renderer.capabilities.isWebGL2) throw new Error('WebGL2 required');
  } catch {
    fallback.style.display = 'flex';
    return;
  }

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const game = new Game(canvas);

  // ---- 内部解像度制御（上限付き・低性能時に段階的に下げる） ----
  let dprCap = Math.min(window.devicePixelRatio || 1, 2);
  let qualityTier = 0; // 0=高 1=中 2=低
  let emaFrame = 16;
  let slowFrames = 0;

  function applySize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
    renderer.setSize(w, h, false);
    game.director.setViewport(w, h);
  }
  window.addEventListener('resize', applySize);
  window.addEventListener('orientationchange', () => setTimeout(applySize, 250));
  applySize();

  function degrade(): void {
    qualityTier++;
    if (qualityTier === 1) {
      dprCap = 1.5;
    } else if (qualityTier === 2) {
      dprCap = 1.2;
      renderer.shadowMap.enabled = false;
      game.site.sun.castShadow = false;
    }
    applySize();
  }

  // ---- コンテキストロスト対応（モバイルSafari） ----
  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault(), false);
  canvas.addEventListener('webglcontextrestored', () => window.location.reload(), false);

  // iOSのダブルタップズーム等の抑止
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());

  let last = performance.now();
  function loop(): void {
    requestAnimationFrame(loop);
    const now = performance.now();
    const rawDt = (now - last) / 1000;
    last = now;
    const dt = Math.min(rawDt, 0.06);

    game.update(dt);
    renderer.render(game.scene, game.director.camera);

    // 適応品質
    emaFrame = emaFrame * 0.94 + rawDt * 1000 * 0.06;
    if (emaFrame > 42 && qualityTier < 2) {
      slowFrames++;
      if (slowFrames > 90) { degrade(); slowFrames = 0; emaFrame = 16; }
    } else {
      slowFrames = Math.max(0, slowFrames - 2);
    }
  }
  loop();

  // ---- 検証・テスト用フック ----
  (window as unknown as Record<string, unknown>).__osc = {
    phase: () => game.getPhase(),
    stats: () => ({ ...game.getStats(), geoCount: renderer.info.memory.geometries, tris: renderer.info.render.triangles, ema: emaFrame }),
    stroke: (pts: [number, number][], durMs?: number) => game.testStroke(pts, durMs),
    timeScale: (v: number) => game.setTimeScale(v),
    reset: () => game.reset(),
  };
  (window as unknown as Record<string, unknown>).__oscDebug = () => game.getDebug();
}

boot();
