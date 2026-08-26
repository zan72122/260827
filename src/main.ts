import * as THREE from 'three';
import {
  P_ASCENT_END, P_BREAK_END, clamp01, drillCenterY, exitGlow, lerp,
  revealT, smooth, surfaceness,
} from './journey';
import { Drill } from './drill';
import { IceWorld } from './ice';
import { SurfaceRig } from './surface';
import { SwipeInput } from './input';
import { GameAudio } from './audio';

const app = document.getElementById('app')!;
const replayBtn = document.getElementById('replay') as HTMLButtonElement;
const dbgPanel = document.getElementById('debug')!;
const dbgInfo = document.getElementById('dbg-info')!;
const dbgSlider = document.getElementById('dbg-slider') as HTMLInputElement;
const DEBUG = new URLSearchParams(location.search).has('debug');

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ------------------------------------------------------------------ renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 1200);

// lights: hemisphere for ambience, sun lives in SurfaceRig, lamp follows drill
const hemi = new THREE.HemisphereLight(0xbfd8ec, 0x35516b, 0.5);
scene.add(hemi);
const lamp = new THREE.PointLight(0x9fc8e8, 6, 9, 1.6);
scene.add(lamp);
// sky fill so surface metals don't fall to black against the bright snow
const fill = new THREE.DirectionalLight(0xcfe2f5, 0);
fill.position.set(-18, 26, 30);
scene.add(fill);

const drill = new Drill(scene);
const ice = new IceWorld(scene);
const surface = new SurfaceRig(scene);

// sparkle burst when the core first appears
const sparkGeo = new THREE.BufferGeometry();
{
  const p = new Float32Array(60 * 3);
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2 * 7.3;
    p[i * 3] = 1.1 + (i / 60) * 1.5;
    p[i * 3 + 1] = 0.6 + Math.sin(a) * 0.16;
    p[i * 3 + 2] = Math.cos(a) * 0.16;
  }
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(p, 3));
}
const sparkMat = new THREE.PointsMaterial({
  color: 0xffffff, size: 0.03, transparent: true, opacity: 0,
  blending: THREE.AdditiveBlending, depthWrite: false,
});
scene.add(new THREE.Points(sparkGeo, sparkMat));

// ------------------------------------------------------------------- journey
let pCur = 0; // rendered progress
let pTgt = 0; // finger-driven target
let glidingTo: number | null = null; // assisted glide after release
let completed = false;
let lastPointerTs = performance.now();
let hintT = -1;
let crackDone = false;
let breakthroughDone = false;
let placeDone = false;
let velEst = 0;

const audio = new GameAudio();

function setProgress(p: number, instant = true): void {
  pTgt = clamp01(p);
  if (instant) pCur = pTgt;
  glidingTo = null;
  completed = pTgt >= 0.999;
  replayBtn.classList.toggle('show', completed);
  crackDone = pTgt > 0.09;
  breakthroughDone = pTgt > 0.93;
  placeDone = pTgt > 0.995;
}

const input = new SwipeInput(app, {
  onDown() {
    audio.start();
    lastPointerTs = performance.now();
    hintT = -1;
    glidingTo = null;
  },
  onDelta(dy) {
    lastPointerTs = performance.now();
    if (completed) return;
    // full journey ≈ one bottom-to-top swipe; wandering sideways is ignored
    let gain = 1 / (0.82 * window.innerHeight);
    if (pTgt < P_BREAK_END) gain *= 0.6; // heavy: tensioning the cable
    if (pTgt > P_ASCENT_END) gain *= 0.65; // savour the surface + reveal
    pTgt = clamp01(pTgt + dy * gain);
  },
  onUp() {
    if (completed) return;
    // assist to the nearest stable state — never a failure
    if (pTgt >= 0.86) glidingTo = 1;
    else if (pTgt < 0.045) glidingTo = 0;
    else pTgt = Math.max(0, pTgt - 0.006); // tiny settling sag
  },
});

replayBtn.addEventListener('click', () => {
  fadeReset();
});
let fading = 0;
function fadeReset(): void {
  fading = 1;
  replayBtn.classList.remove('show');
}

// ---------------------------------------------------------- adaptive quality
let qLevel = 0;
const Q_SCALES = [1, 0.85, 0.7, 0.55];
let frameAcc = 0, frameN = 0;
function applyQuality(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr * Q_SCALES[qLevel]);
  renderer.shadowMap.enabled = qLevel < 2;
  surface.sun.castShadow = qLevel < 2;
  ice.bubbleBudget = qLevel < 2 ? 1 : 0.5;
}
function tickQuality(dt: number): void {
  frameAcc += dt; frameN++;
  if (frameN >= 90) {
    const fps = frameN / frameAcc;
    if (fps < 42 && qLevel < Q_SCALES.length - 1) { qLevel++; applyQuality(); }
    else if (fps > 56 && qLevel > 0) { qLevel--; applyQuality(); }
    frameAcc = 0; frameN = 0;
  }
}

// ------------------------------------------------------------------- resize
function resize(): void {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  applyQuality();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 250));
resize();

// -------------------------------------------------------------- camera rail
const camPos = new THREE.Vector3(0, drillCenterY(0) + 0.5, 3.6);
const camFocus = new THREE.Vector3(0, drillCenterY(0) + 0.5, 0);
function updateCamera(p: number, time: number, dt: number): void {
  const landscape = window.innerWidth > window.innerHeight;
  const dy = drillCenterY(p);
  const t = revealT(p);
  const exitPhase = smooth((p - 0.78) / 0.12);

  // portrait: straight vertical rail. landscape: rolled diagonal rail so the
  // ascent reads lower-left -> upper-right across the ice sheet section;
  // the roll levels out as the drill reaches the surface world.
  const roll = landscape ? 0.3 * (1 - smooth((p - 0.86) / 0.06)) : 0;
  camera.up.set(Math.sin(roll), Math.cos(roll), 0);
  const dist = (landscape ? 4.3 : 3.6) + smooth((p - 0.88) / 0.08) * 1.3;

  let fx = 0, fy = dy + 0.45, fz = 0;
  let cx = landscape ? -0.35 : 0, cy = dy + 0.55, cz = dist;
  // the break-off beat happens at the drill head: frame it low
  const breakK = 1 - smooth((p - 0.1) / 0.05);
  fy -= breakK * 0.85;
  cy -= breakK * 0.7;
  fy += exitPhase * (1 - smooth((p - 0.88) / 0.04)) * 1.1; // look up at the light
  // ride up the last metres of the hole with the drill, then pull back out
  const crossK = smooth((p - 0.868) / 0.03) * (1 - smooth((p - 0.918) / 0.03));
  cz -= crossK * 2.2;
  cx = cx * (1 - crossK) + crossK * 0.55; // step aside from the mast plane
  fy = fy * (1 - crossK) + crossK * 0.3; // hole rim mid-frame while emerging
  cy = cy * (1 - crossK) + crossK * 0.6;
  if (t > 0) {
    const k = smooth(Math.min(t / 0.55, 1));
    fx = lerp(0, landscape ? 0.85 : 0.62, k); fy = lerp(fy, 0.5, k); fz = 0;
    cx = lerp(cx, landscape ? 0.7 : 0.68, k);
    cy = lerp(cy, landscape ? 1.3 : 1.1, k);
    cz = lerp(cz, landscape ? 4.7 : 3.7, k);
  }

  // breakthrough pop: slight fov widen, then keep the openness
  camera.fov = 55 + smooth((p - 0.895) / 0.05) * 7 - (landscape ? 6 : 0);
  camera.updateProjectionMatrix();

  // small shake at the core break, unless reduced motion
  let shX = 0, shY = 0;
  if (!reducedMotion) {
    if (p > 0.055 && p < 0.1) {
      const k = smooth((p - 0.055) / 0.02) * (1 - smooth((p - 0.082) / 0.018));
      shX = Math.sin(time * 47) * 0.012 * k; shY = Math.cos(time * 53) * 0.01 * k;
    }
    if (breakthroughDone && p < 0.94) {
      shY += Math.sin(time * 30) * 0.006 * (1 - smooth((p - 0.905) / 0.03));
    }
  }

  const k = 1 - Math.exp(-dt * 7);
  camPos.x += (cx + shX - camPos.x) * k;
  camPos.y += (cy + shY - camPos.y) * k;
  camPos.z += (cz - camPos.z) * k;
  camFocus.x += (fx - camFocus.x) * k;
  camFocus.y += (fy - camFocus.y) * k;
  camFocus.z += (fz - camFocus.z) * k;
  camera.position.copy(camPos);
  camera.lookAt(camFocus);
}

// ------------------------------------------------------------------ ambience
const bgColor = new THREE.Color();
const deepBg = new THREE.Color(0x04121d);
const shallowBg = new THREE.Color(0x9fc4dc);
const surfBg = new THREE.Color(0xdfecf6);
const fog = new THREE.Fog(0x04121d, 4, 42);
scene.fog = fog;
function updateAmbience(p: number): void {
  const camY = camera.position.y;
  const s = surfaceness(p);
  const t = clamp01(1 + camY / 55);
  bgColor.copy(deepBg).lerp(shallowBg, smooth(t * t) * 0.85);
  // graded hand-over to daylight across the last metre instead of a hard cut
  const dayK = smooth((camY + 1.2) / 1.6);
  bgColor.lerp(surfBg, dayK);
  fog.near = lerp(4, 40, dayK); fog.far = lerp(42, 600, dayK);
  fog.color.copy(bgColor);
  scene.background = bgColor;

  const deepness = clamp01(-camY / 30);
  hemi.intensity = lerp(1.25, 0.35, deepness);
  hemi.color.setRGB(lerp(0.85, 0.4, deepness), lerp(0.9, 0.62, deepness), lerp(0.95, 0.85, deepness));
  surface.sun.intensity = lerp(3.2, 0.0, clamp01(deepness * 2));
  fill.intensity = lerp(1.0, 0, clamp01(deepness * 2));
  drill.setLightMood(deepness);

  // lamp: cool working light that keeps the sonde readable in the depths
  lamp.position.set(0.7, drillCenterY(p) + 0.6, 1.1);
  lamp.intensity = lerp(16, 0, s) * (0.5 + exitGlow(p) * 0.3);
}

// --------------------------------------------------------------------- loop
const clock = new THREE.Clock();
let prevP = 0;
function frame(): void {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.1);
  const time = clock.elapsedTime;

  // assisted glide + finger tracking
  if (glidingTo !== null) {
    const dir = Math.sign(glidingTo - pTgt);
    pTgt += dir * dt * (glidingTo === 1 ? 0.05 : 0.25);
    if ((dir > 0 && pTgt >= glidingTo) || (dir < 0 && pTgt <= glidingTo)) {
      pTgt = glidingTo;
      glidingTo = null;
    }
  }
  const track = 1 - Math.exp(-dt * 10);
  pCur += (pTgt - pCur) * track;
  velEst = lerp(velEst, Math.abs(pCur - prevP) / Math.max(dt, 1e-3), 0.2);
  prevP = pCur;

  // one-shot events
  if (!crackDone && pCur > 0.075) { crackDone = true; audio.crack(); }
  if (crackDone && pCur < 0.02) crackDone = false;
  if (!breakthroughDone && pCur > 0.905) { breakthroughDone = true; audio.breakthrough(); }
  if (breakthroughDone && pCur < 0.85) breakthroughDone = false;
  const rt = revealT(pCur);
  if (!placeDone && rt > 0.92) {
    placeDone = true;
    audio.corePlace();
    completed = true;
    pTgt = 1;
    replayBtn.classList.add('show');
  }
  if (placeDone && rt < 0.5) placeDone = false;

  // idle hint: the cable tightens, the drill lifts a few cm, the light above
  // brightens — "pull up" without a single written word
  let hintLift = 0, hintGlow = 0;
  if (!input.active && !completed && pCur < 0.6) {
    const idle = (performance.now() - lastPointerTs) / 1000;
    if (idle > 3) {
      if (hintT < 0) { hintT = time; audio.hintTick(); }
      const ht = (time - hintT) % 2.4;
      const k = smooth(ht / 0.5) * (1 - smooth((ht - 0.9) / 0.7));
      hintLift = k * (reducedMotion ? 0.02 : 0.055);
      hintGlow = k * 0.35;
      if (ht > 2.35) hintT = time; // loop
    } else hintT = -1;
  } else hintT = -1;

  const pDraw = clamp01(pCur + hintLift * 0.01);
  drill.update(pDraw, time, reducedMotion);
  drill.group.position.y += hintLift;

  updateCamera(pDraw, time, dt);
  updateAmbience(pDraw);

  const glow = clamp01(exitGlow(pDraw) + hintGlow * clamp01(1 - pDraw * 6));
  ice.update(camera.position.y, time, glow, drillCenterY(pDraw), reducedMotion);
  const wind = surfaceness(pDraw) * 0.85 + smooth((pDraw - 0.9) / 0.03) * 0.15;
  surface.update(pDraw, time, wind, reducedMotion);

  sparkMat.opacity = rt > 0.55 ? smooth((rt - 0.55) / 0.2) * (1 - smooth((rt - 0.9) / 0.1)) * 0.9 : 0;
  sparkMat.size = 0.02 + Math.sin(time * 6) * 0.008;

  audio.update(velEst, clamp01(-camera.position.y / 20), wind, dt);

  // replay fade
  if (fading > 0) {
    fading -= dt * 1.6;
    renderer.domElement.style.filter = `brightness(${1 + smooth(Math.min(1, 1 - fading)) * 0})`;
    renderer.domElement.style.opacity = String(Math.max(0.05, Math.abs(fading - 0.5) * 2));
    if (fading <= 0.5 && pTgt !== 0) setProgress(0);
    if (fading <= 0) {
      fading = 0;
      renderer.domElement.style.opacity = '1';
    }
  }

  tickQuality(dt);
  renderer.render(scene, camera);

  if (DEBUG && frameN % 15 === 0) {
    dbgInfo.textContent = `p=${pCur.toFixed(3)} y=${drillCenterY(pCur).toFixed(1)}m q=${qLevel} fps=${(1 / Math.max(dt, 1e-3)).toFixed(0)}`;
  }
}

// ------------------------------------------------------------ debug surface
if (DEBUG) {
  dbgPanel.classList.add('show');
  dbgSlider.addEventListener('input', () => setProgress(Number(dbgSlider.value) / 1000));
}
(window as any).icecore = {
  setProgress,
  getProgress: () => pCur,
  setQuality: (q: number) => { qLevel = Math.max(0, Math.min(3, q)); applyQuality(); },
  version: '0.1.0',
  _scene: scene,
  _ice: ice,
  _camera: camera,
  _info: () => renderer.info,
};

frame();
