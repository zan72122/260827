import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildWorkshop } from './workshop.js';
import { CameraDirector } from './cameradirector.js';
import { AudioEngine } from './audio.js';
import { Game } from './game.js';
import { GLASS_PALETTE } from './materials.js';
import { setSeed } from './textures.js';

const appEl = document.getElementById('app');
const uiEl = document.getElementById('ui');

const params = new URLSearchParams(location.search);
if (params.has('seed')) setSeed(parseInt(params.get('seed'), 10) || 1);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
appEl.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x272220);

const camera = new THREE.PerspectiveCamera(50, 1, 0.02, 30);
camera.position.set(1.2, 1.9, 1.5);

// environment reflections: neutral interior probe (no external HDRI assets)
const pmrem = new THREE.PMREMGenerator(renderer);
const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = null; // applied only on glass materials to keep control

const workshop = buildWorkshop(scene, renderer, envMap);
const director = new CameraDirector(camera);
const audio = new AudioEngine();
const game = new Game({ scene, director, audio, workshop, renderer, envMap });

// ------------------------------------------------------------------ sizing --
function applySize() {
  const w = appEl.clientWidth || window.innerWidth;
  const h = appEl.clientHeight || window.innerHeight;
  // manage internal resolution on high-DPI phones/tablets: cap DPR and the
  // total pixel budget so transparent overdraw stays affordable
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  const budget = 3.4e6;
  const px = w * h * dpr * dpr;
  if (px > budget) dpr *= Math.sqrt(budget / px);
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
applySize();
window.addEventListener('resize', () => {
  const prevPortrait = director.isPortrait();
  applySize();
  game.refreshFraming();
  void prevPortrait;
});

// ------------------------------------------------------------------- input --
// The child's finger maps to the artisan's hand. The wheel contact point is
// offset above the finger so the finger never hides the score being made.
function fingerOffsetPx() {
  return Math.min(64, renderer.domElement.clientHeight * 0.085);
}

function toSheet(clientX, clientY, withOffset) {
  const r = renderer.domElement.getBoundingClientRect();
  const y = withOffset ? clientY - fingerOffsetPx() : clientY;
  const ndcX = ((clientX - r.left) / r.width) * 2 - 1;
  const ndcY = -(((y - r.top) / r.height) * 2 - 1);
  return game.screenToSheet(ndcX, ndcY, camera);
}

let activePointer = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (activePointer !== null) return; // one finger, one stroke
  activePointer = e.pointerId;
  renderer.domElement.setPointerCapture?.(e.pointerId);
  const needsOffset = game.phase === 'ready';
  game.pointerDown(toSheet(e.clientX, e.clientY, needsOffset));
}, { passive: false });

renderer.domElement.addEventListener('pointermove', (e) => {
  if (e.pointerId !== activePointer) return;
  e.preventDefault();
  game.pointerMove(toSheet(e.clientX, e.clientY, true));
}, { passive: false });

function endPointer(e) {
  if (e.pointerId !== activePointer) return;
  activePointer = null;
  game.pointerUp();
}
renderer.domElement.addEventListener('pointerup', endPointer);
renderer.domElement.addEventListener('pointercancel', endPointer);

// --------------------------------------------------------------------- UI --
// Wordless色choice: small glass squares; tapping one starts the next pane.
function buildChoiceUI() {
  uiEl.innerHTML = '';
  const picks = [];
  while (picks.length < 3) {
    const i = Math.floor(Math.random() * GLASS_PALETTE.length);
    if (!picks.includes(i)) picks.push(i);
  }
  for (const idx of picks) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.style.background = GLASS_PALETTE[idx].css;
    b.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      uiEl.classList.remove('show');
      game.newRound(idx);
    });
    uiEl.appendChild(b);
  }
}

game.onPhaseChange = (p) => {
  if (p === 'choice') {
    buildChoiceUI();
    uiEl.classList.add('show');
  } else {
    uiEl.classList.remove('show');
  }
};

// -------------------------------------------------------------------- loop --
const clock = new THREE.Clock();
function tick() {
  const dt = clock.getDelta();
  game.update(dt, camera);
  director.update(dt * game.timeScale);
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

game.newRound(1);
tick();

// --------------------------------------------------------------- test API --
// Deterministic driving + diagnostics for automated visual verification.
window.__gc = {
  get phase() { return game.phase; },
  game,
  renderer,
  setTimeScale(s) { game.timeScale = s; },
  newRound(i) { game.newRound(i); },
  fingerOffsetPx,
  diagnostics() { return game.diagnostics(); },
  // world/sheet-space point -> client pixel coords (for planning real touches)
  sheetToScreen(x, yv) {
    const v = new THREE.Vector3(x, 0.92 + 0.005, yv).project(camera);
    const r = renderer.domElement.getBoundingClientRect();
    return {
      x: r.left + (v.x + 1) / 2 * r.width,
      y: r.top + (1 - (v.y + 1) / 2) * r.height
    };
  },
  pressScreen() {
    const p = game.pliers.group.position.clone().project(camera);
    const r = renderer.domElement.getBoundingClientRect();
    return {
      x: r.left + (p.x + 1) / 2 * r.width,
      y: r.top + (1 - (p.y + 1) / 2) * r.height
    };
  },
  sheetRect() { return { hw: game.rect.hw, hh: game.rect.hh }; }
};
