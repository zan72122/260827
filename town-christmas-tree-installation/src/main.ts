import * as THREE from 'three';
import './ui/hud.css';
import { AudioKit } from './core/audio';
import { detectQuality } from './core/quality';
import { CameraRig } from './game/camera';
import { Director } from './game/director';
import { Hud } from './ui/hud';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud') as HTMLElement;
const boot = document.getElementById('boot') as HTMLElement;
const bootBar = boot.querySelector('.boot-bar i') as HTMLElement;
const bootStart = document.getElementById('boot-start') as HTMLButtonElement;

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
  alpha: false,
  stencil: false,
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const quality = detectQuality(renderer);
renderer.setPixelRatio(quality.dpr);

const audio = new AudioKit();
const rig = new CameraRig();
let scene = new THREE.Scene();
let director: Director | null = null;

const params = new URLSearchParams(location.search);
const autoplay = params.get('auto') === '1';
const seedParam = params.get('seed');

// Honour the OS accessibility preference out of the box.
const prefersCalm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
let soundOn = true;
let gentleMotion = prefersCalm;
let gentleLights = prefersCalm;

const hud = new Hud(hudRoot, {
  guide: () => director?.onGuide(),
  outrigger: (i) => director?.onOutrigger(i),
  jacks: () => director?.onJacks(),
  slingDrag: (i, x, y, phase) => director?.onSlingDrag(i, x, y, phase),
  lever: (v) => director?.onLever(v),
  tagLine: (v) => director?.onTagLine(v),
  capstan: (t) => director?.onCapstan(t),
  spiral: (p) => director?.onSpiral(p),
  star: () => director?.onStar(),
  bigSwitch: () => director?.onSwitch(),
  menu: (action) => {
    if (!director) return;
    if (action === 'relight') director.replayLighting();
    else if (action === 'again') rebuild(director.seed);
    else rebuild((Math.random() * 0xffffffff) >>> 0);
  },
  toggle: (kind, value) => {
    if (kind === 'sound') {
      soundOn = value;
      audio.setMuted(!value);
    } else if (kind === 'motion') {
      // Pressed "on" means full motion; the alternative is the calm setting.
      gentleMotion = !value;
      director?.onToggleMotion(gentleMotion);
    } else {
      gentleLights = !value;
      director?.onToggleLights(gentleLights);
    }
  },
  anyInput: () => {
    void audio.unlock();
  },
}, { motion: !prefersCalm, glow: !prefersCalm });

function sizeRenderer(): void {
  const w = Math.max(1, window.innerWidth);
  const h = Math.max(1, window.innerHeight);
  renderer.setSize(w, h, false);
  rig.resize(w, h);
  director?.setAspect(w / h);
  hud.relayout();
}

function rebuild(seed: number): void {
  boot.classList.remove('hidden');
  bootStart.hidden = true;
  bootBar.style.width = '20%';
  // Let the browser paint the overlay before the (synchronous) world build.
  window.setTimeout(() => {
    director?.dispose();
    scene = new THREE.Scene();
    director = new Director({ seed, quality, audio, hud, scene, rig, renderer });
    director.onToggleMotion(gentleMotion);
    director.onToggleLights(gentleLights);
    director.setAspect(window.innerWidth / Math.max(1, window.innerHeight));
    if (autoplay) director.startAutoplay();
    bootBar.style.width = '100%';
    window.setTimeout(() => boot.classList.add('hidden'), 220);
  }, 60);
}

// ------------------------------------------------------------- main loop --
let last = performance.now();
let running = true;
let steps = Math.max(1, Math.min(12, Number.parseInt(params.get('turbo') ?? '1', 10) || 1));

function frame(now: number): void {
  requestAnimationFrame(frame);
  // Clamp so returning to the tab never teleports the physics.
  const dt = Math.min(0.05, Math.max(0.0005, (now - last) / 1000));
  last = now;
  if (!running || !director) return;
  // `steps` is 1 in play; verification runs raise it so a full installation
  // can be driven through a software renderer in reasonable wall time.
  for (let i = 0; i < steps; i++) director.update(dt);
  renderer.toneMappingExposure = director.toneExposure;
  renderer.render(scene, rig.camera);
}

window.addEventListener('resize', sizeRenderer);
window.addEventListener('orientationchange', () => window.setTimeout(sizeRenderer, 120));
if (window.visualViewport) window.visualViewport.addEventListener('resize', sizeRenderer);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    running = false;
    audio.suspend();
  } else {
    running = true;
    last = performance.now();
    if (soundOn) audio.resume();
  }
});

// Block iOS double-tap zoom and rubber-banding over the canvas.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener(
  'touchmove',
  (e) => {
    if (e.cancelable) e.preventDefault();
  },
  { passive: false },
);

renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  running = false;
});
renderer.domElement.addEventListener('webglcontextrestored', () => {
  running = true;
  last = performance.now();
});

// ----------------------------------------------------------------- boot --
sizeRenderer();
bootBar.style.width = '35%';

const initialSeed = seedParam ? Number.parseInt(seedParam, 10) >>> 0 : (Math.random() * 0xffffffff) >>> 0;

window.setTimeout(() => {
  director = new Director({ seed: initialSeed, quality, audio, hud, scene, rig, renderer });
  director.onToggleMotion(gentleMotion);
  director.onToggleLights(gentleLights);
  director.setAspect(window.innerWidth / Math.max(1, window.innerHeight));
  bootBar.style.width = '100%';
  bootStart.hidden = false;
  requestAnimationFrame(frame);

  const start = () => {
    void audio.unlock();
    boot.classList.add('hidden');
    if (autoplay) director?.startAutoplay();
  };
  bootStart.addEventListener('click', start, { once: true });
  if (autoplay) window.setTimeout(start, 400);
}, 50);

// Expose a tiny hook so an automated pass can drive a full run headlessly.
declare global {
  interface Window {
    __game?: {
      stage(): string;
      auto(): void;
      seed(): number;
      turbo(n: number): void;
      state(): Record<string, number | string>;
    };
  }
}
window.__game = {
  stage: () => director?.stage ?? 'boot',
  auto: () => director?.startAutoplay(),
  seed: () => director?.seed ?? 0,
  turbo: (n: number) => {
    steps = Math.max(1, Math.min(12, Math.round(n)));
  },
  state: () => director?.snapshot() ?? { stage: 'boot' },
};
