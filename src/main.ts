// Bootstrap: renderer, resize handling (state survives rotation — the game
// state lives entirely in JS, only framing is recomputed), quality scaling.
import * as THREE from 'three';
import { Game } from './game';
import { InputManager } from './input';

const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance'
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

// dynamic resolution: start at min(devicePixelRatio, 2), step down if slow
let pixelRatioCap = Math.min(window.devicePixelRatio || 1, 2);
let currentRatio = pixelRatioCap;

function applySize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setPixelRatio(currentRatio);
  renderer.setSize(w, h);
}
applySize();

const input = new InputManager(renderer.domElement);
const game = new Game(20251224, input, window.innerWidth / window.innerHeight);

window.addEventListener('resize', () => {
  applySize();
  game.rig.setAspect(window.innerWidth / window.innerHeight);
});
window.addEventListener('orientationchange', () => {
  // double-tick: iOS reports stale sizes right after rotation
  setTimeout(() => {
    applySize();
    game.rig.setAspect(window.innerWidth / window.innerHeight);
  }, 120);
});

// fps monitor for the quality ladder
let frames = 0;
let fpsWindowStart = performance.now();
let slowStreak = 0;

const clock = new THREE.Clock();

function frame(): void {
  requestAnimationFrame(frame);
  const dt = clock.getDelta();
  game.update(dt);
  renderer.render(game.scene, game.rig.camera);

  frames++;
  const now = performance.now();
  if (now - fpsWindowStart > 2000) {
    const fps = (frames * 1000) / (now - fpsWindowStart);
    game.fps = fps;
    frames = 0;
    fpsWindowStart = now;
    if (fps < 26 && currentRatio > 1) {
      slowStreak++;
      if (slowStreak >= 2) {
        currentRatio = Math.max(1, currentRatio - 0.25);
        applySize();
        slowStreak = 0;
        if (currentRatio <= 1.25 && renderer.shadowMap.enabled) {
          renderer.shadowMap.enabled = false;
          game.scene.traverse((o) => {
            if (o instanceof THREE.Mesh) o.castShadow = false;
          });
        }
      }
    } else if (fps > 40) {
      slowStreak = 0;
    }
  }
}
frame();

// expose local-only metrics for development probing (never rendered in-game)
import { metrics } from './metrics';
declare global {
  interface Window {
    __santaMetrics?: () => string;
    __santaGame?: Game;
    __screenOf?: (kind: string, index?: number) => { x: number; y: number } | null;
  }
}
window.__santaMetrics = () => metrics.summary();
window.__santaGame = game;

// dev/test helper: project a named object to screen space (used by the
// automated play-through driver; harmless in production)
const tmpV = new THREE.Vector3();
window.__screenOf = (kind: string, index = 0) => {
  let obj: THREE.Object3D | null = null;
  if (kind === 'gift') obj = game.gifts[index]?.hit ?? null;
  else if (kind === 'nose') obj = game.santa.noseHit;
  else if (kind === 'santa') obj = game.santa.head;
  if (!obj) return null;
  obj.updateWorldMatrix(true, false);
  tmpV.setFromMatrixPosition(obj.matrixWorld).project(game.rig.camera);
  return {
    x: (tmpV.x * 0.5 + 0.5) * window.innerWidth,
    y: (-tmpV.y * 0.5 + 0.5) * window.innerHeight
  };
};
