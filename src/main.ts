import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Game } from './game';

const container = document.getElementById('app')!;
const canvas = document.createElement('canvas');
container.appendChild(canvas);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const game = new Game(container, canvas, window.innerWidth / window.innerHeight);

// neutral environment reflections so steel and paint read as real materials
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  game.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  game.scene.environmentIntensity = 0.4;
  pmrem.dispose();
}

let prCap = game.quality.pixelRatioCap;
function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, prCap));
  renderer.setSize(w, h);
  game.director.setAspect(w / h);
}
resize();
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 250));

// adaptive resolution: if frames stay slow, trade pixels for fluid input
let slowFrames = 0;
let last = performance.now();
let fpsAcc = 0;
let fpsN = 0;

let costAcc = 0;
let costN = 0;

function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  fpsAcc += dt;
  fpsN++;
  const t0 = performance.now();
  if (dt > 0.03) slowFrames++;
  else slowFrames = Math.max(0, slowFrames - 1);
  if (slowFrames > 40 && prCap > 1.1) {
    prCap -= 0.25;
    slowFrames = 0;
    resize();
  }
  game.update(dt, window.innerWidth, window.innerHeight);
  renderer.render(game.scene, game.director.camera);
  costAcc += performance.now() - t0;
  costN++;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// verification hook (harmless in production)
declare global {
  interface Window {
    __game?: {
      debug: Game['debug'];
      fps: () => number;
      screenBall: () => { x: number; y: number };
      calm: () => void;
      pick: (k: 'brick' | 'block' | 'concrete') => void;
      frameCostMs: () => number;
    };
  }
}
window.__game = {
  debug: game.debug,
  fps: () => {
    const f = fpsN / Math.max(fpsAcc, 1e-6);
    fpsAcc = 0;
    fpsN = 0;
    return f;
  },
  screenBall: () => {
    const p = game.debug.ballPos.clone().project(game.director.camera);
    return { x: ((p.x + 1) / 2) * window.innerWidth, y: ((1 - p.y) / 2) * window.innerHeight };
  },
  calm: () => game.calmBall(),
  pick: (k) => game.pickWall(k),
  frameCostMs: () => {
    const c = costN ? costAcc / costN : 0;
    costAcc = 0;
    costN = 0;
    return c;
  },
};
