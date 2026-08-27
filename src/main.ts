import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Game } from './game';
import { audio } from './audio';

// ---------------------------------------------------------------------------
// 起動・描画ループ・動的品質調整。
// 高DPI端末でも描画解像度は上限 2.0。フレーム時間を実測して段階調整する。
// ---------------------------------------------------------------------------

const canvas = document.getElementById('game') as HTMLCanvasElement;

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance'
});
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const DPR_CAP = 2.0;
const dprSteps = [1.0, 1.3, 1.6, Math.min(window.devicePixelRatio || 1, DPR_CAP)];
let dprIndex = dprSteps.length - 1;
renderer.setPixelRatio(dprSteps[dprIndex]);

const game = new Game(canvas, window.innerWidth / window.innerHeight);

// 金属（鈴・金具）の映り込み用の環境
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  game.scene.environment = envTex;
  game.scene.environmentIntensity = 0.35;
  pmrem.dispose();
}

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  game.rig.resize(w / h);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 60));
resize();

// --- 動的品質: 1.2秒窓の平均フレーム時間で解像度を段階調整 -------------------
let frameAcc = 0;
let frameN = 0;
let qualityCooldown = 0;
let fpsNow = 60;

function adjustQuality(avgMs: number): void {
  if (qualityCooldown > 0) {
    qualityCooldown--;
    return;
  }
  if (avgMs > 27 && dprIndex > 0) {
    dprIndex--;
    renderer.setPixelRatio(dprSteps[dprIndex]);
    qualityCooldown = 3;
  } else if (avgMs > 30 && dprIndex === 0 && renderer.shadowMap.enabled) {
    // 最終手段: 影を落とす
    renderer.shadowMap.enabled = false;
    qualityCooldown = 6;
  } else if (avgMs < 15 && dprIndex < dprSteps.length - 1) {
    dprIndex++;
    renderer.setPixelRatio(dprSteps[dprIndex]);
    qualityCooldown = 3;
  }
}

const clock = new THREE.Clock();
function loop(): void {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.1);
  frameAcc += dt;
  frameN++;
  if (frameAcc > 1.2) {
    const avgMs = (frameAcc / frameN) * 1000;
    fpsNow = 1000 / avgMs;
    adjustQuality(avgMs);
    frameAcc = 0;
    frameN = 0;
  }
  game.update(dt);
  renderer.render(game.scene, game.rig.camera);
}
loop();

// --- 検証用フック（ゲームプレイには関与しない） ------------------------------
declare global {
  interface Window {
    __game: {
      state: () => Record<string, unknown>;
      screenPos: (name: string) => { x: number; y: number } | null;
      swipeImpulse: (v: number) => void;
      perf: () => Record<string, unknown>;
    };
  }
}
window.__game = {
  state: () => game.stateSummary,
  screenPos: (name: string) => game.screenPosOf(name, window.innerWidth, window.innerHeight),
  swipeImpulse: (v: number) => game.debugSwipeImpulse(v),
  perf: () => ({
    fps: +fpsNow.toFixed(1),
    pixelRatio: renderer.getPixelRatio(),
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    programs: renderer.info.programs?.length ?? 0,
    audioTransient: audio.transientNodes,
    audioPersistent: audio.persistentNodes
  })
};
