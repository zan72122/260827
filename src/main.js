import * as THREE from 'three';
import { detectQuality } from './quality.js';
import { buildEnvironment, sparkTexture } from './env.js';
import { buildWorkshop, buildHands, ANCHOR } from './workshop.js';
import { GlassPiece } from './glass.js';
import { Flame } from './flame.js';
import { Glitter, Snow } from './particles.js';
import { CameraRig } from './camera.js';
import { Input } from './input.js';
import { Hints } from './hints.js';
import { Sfx } from './audio.js';
import { Director } from './director.js';

const canvas = document.getElementById('view');
const quality = detectQuality();

const renderer = new THREE.WebGLRenderer({
  canvas, antialias: quality.tier !== 'low', alpha: false, stencil: false,
  powerPreference: 'high-performance',
});
// ?res=<n> scales the render resolution (harness / low-end rescue)
const resParam = parseFloat(new URLSearchParams(location.search).get('res'));
renderer.setPixelRatio(
  (resParam > 0 ? resParam : 1) * Math.min(window.devicePixelRatio || 1, quality.maxPixelRatio));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.04;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = quality.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
if ('transmissionResolutionScale' in renderer) {
  renderer.transmissionResolutionScale = quality.transmissionScale;
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14161b);
const camera = new THREE.PerspectiveCamera(40, 1, 0.008, 40);

const env = buildEnvironment(renderer);
scene.environment = env;

const ws = buildWorkshop(scene, env, quality);
const hands = buildHands(env, quality);
scene.add(hands.group);

const piece = new GlassPiece(env, quality);
scene.add(piece.group);

const sparkTex = sparkTexture(true);
const flame = new Flame(quality, sparkTexture(false));
scene.add(flame.group);

const glitter = new Glitter(quality.glitter, sparkTex);
scene.add(glitter.points);

const snow = new Snow(quality.snow, sparkTexture(false), { x: -0.86, y: 1.02, z: -2.165, w: 0.92, h: 1.14, d: 0.03 });
scene.add(snow.points);

const rig = new CameraRig(camera);
const input = new Input(canvas);
const hints = new Hints(document.getElementById('hint'));
const sfx = new Sfx();
input.onFirstTouch = () => sfx.unlock();
document.addEventListener('visibilitychange', () => {
  if (document.hidden && sfx.ctx) sfx.ctx.suspend();
  else if (sfx.ctx) sfx.ctx.resume();
});

const director = new Director({ scene, piece, flame, hands, ws, glitter, rig, input, hints, sfx, quality });

// ------------------------------------------------------------------ resize
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  rig.aspect = camera.aspect;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 250));
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
resize();

// -------------------------------------------------------------------- loop
const clock = new THREE.Clock();
// ?fixeddt=1 advances the show by a fixed step per frame instead of by wall
// clock: only used by the automated screenshot/playthrough harness.
const fixedDt = new URLSearchParams(location.search).has('fixeddt') ? 1 / 30 : 0;
let acc = 0, frames = 0, downgraded = false, booted = false;

function frame() {
  requestAnimationFrame(frame);
  if (document.hidden) return;

  const dt = fixedDt || Math.min(0.05, clock.getDelta());
  const time = clock.elapsedTime;

  director.update(dt, time);
  piece.update(dt, time);
  flame.update(dt, time);
  glitter.update(dt);
  snow.update(dt, time);
  rig.update(dt, time);

  renderer.render(scene, camera);

  if (!booted) {
    booted = true;
    const boot = document.getElementById('boot');
    boot.classList.add('gone');
    setTimeout(() => boot.remove(), 900);
  }

  // one safety valve: if the device cannot hold up, drop resolution once
  acc += dt; frames++;
  if (!downgraded && acc > 3) {
    if (frames / acc < 34) {
      downgraded = true;
      renderer.setPixelRatio(Math.max(1, renderer.getPixelRatio() * 0.72));
      if ('transmissionResolutionScale' in renderer) renderer.transmissionResolutionScale = 0.35;
      renderer.shadowMap.enabled = false;
    }
    acc = 0; frames = 0;
  }
}
frame();

// expose a little state for debugging / automated screenshots
window.__game = { renderer, scene, camera, piece, director, rig, quality, flame, ws, input, hints, sfx, glitter, THREE };
