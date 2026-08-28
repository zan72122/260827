import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { AdaptiveQuality } from './core/AdaptiveQuality';
import { AudioKit } from './core/AudioKit';
import { PointerInput } from './core/PointerInput';
import { CameraDirector } from './camera/CameraDirector';
import { ChildGuidance } from './game/ChildGuidance';
import { GameFlow } from './game/GameFlow';
import { MaterialLibrary } from './scene/materials';
import { PostOfficeRoom } from './scene/PostOfficeRoom';
import { Hud } from './ui/Hud';

const app = document.getElementById('app');
if (!app) throw new Error('missing #app');

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
  alpha: false,
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14100d);
scene.fog = new THREE.Fog(0x1b2438, 16, 46);

const audio = new AudioKit();
const guidance = new ChildGuidance();

const quality = new AdaptiveQuality(renderer, (b) => {
  flow.setBudget(b);
  renderer.shadowMap.enabled = b.shadows;
});

const mats = new MaterialLibrary();
const pmrem = new THREE.PMREMGenerator(renderer);
const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
mats.setEnvironment(envRT.texture);

const room = new PostOfficeRoom(mats, quality.budget.snowCount);
scene.add(room.group);

const director = new CameraDirector(window.innerWidth / window.innerHeight);

const hud = new Hud({
  onToggleMode: (one) => flow.setOneCondition(one),
  onReplay: () => flow.replay(),
});

const flow = new GameFlow(scene, mats, room, director, guidance, audio, quality.budget, {
  onPips: (total, done) => hud.setPips(total, done),
  onChildLine: (show) => hud.setChildLine(show),
  onLoading: (p) => hud.setLoading(p),
});

// ---------------------------------------------------------------- layout

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  quality.onResize();
  director.resize(w / h);
  // portrait sorts top to bottom, landscape spreads the chutes across
  director.setPortrait(h > w);
  flow.setViewport(w, h);
  flow.setOrientation(h > w);
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => window.setTimeout(resize, 120));
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- input

new PointerInput(renderer.domElement, {
  onDown: (p) => flow.onPointerDown(p, director.camera),
  onMove: (p) => flow.onPointerMove(p, director.camera),
  onUp: () => flow.onPointerUp(),
});

// ---------------------------------------------------------------- start

const tapstart = document.getElementById('tapstart');
let started = false;

function start(): void {
  if (started) return;
  started = true;
  audio.unlock();
  tapstart?.classList.add('hidden');
  void flow.startRound(1);
}

tapstart?.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  start();
});
tapstart?.addEventListener('click', start);

// ---------------------------------------------------------------- loop

const clock = new THREE.Clock();
let elapsed = 0;

function frame(): void {
  // queued first: one bad frame must never stop the hall
  requestAnimationFrame(frame);

  // a slow frame still advances the hall; only a tab switch is clamped hard
  const dt = Math.min(0.25, clock.getDelta());
  elapsed += dt;
  quality.sample(dt, elapsed);

  if (started) flow.update(dt, elapsed);
  room.update(dt, elapsed);
  director.update(dt);

  renderer.render(scene, director.camera);
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------- test hooks
// Read-only inspection plus screen coordinates, so the automated sorting run can
// drive the same pointer events a child would. Nothing here leaves the device.

declare global {
  interface Window {
    __santa?: {
      started: () => boolean;
      start: () => void;
      state: () => Record<string, unknown>;
      point: (id: string) => { x: number; y: number } | null;
      targetBay: () => string | null;
      wrongBay: () => string | null;
      setOneCondition: (v: boolean) => void;
      replay: () => void;
      startRound: (n: number) => void;
      portrait: () => boolean;
    };
  }
}

window.__santa = {
  started: () => started,
  start,
  state: () => flow.testState(),
  point: (id) => flow.testPoint(id),
  targetBay: () => flow.testTargetBayId(),
  wrongBay: () => flow.testWrongBayId(),
  setOneCondition: (v) => flow.setOneCondition(v),
  replay: () => flow.replay(),
  startRound: (n) => flow.jumpToRound(n),
  portrait: () => director.isPortrait,
};
