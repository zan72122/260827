/**
 * main.ts — ちいさな点の、その中へ
 *
 * One continuous upward swipe carries a four-year-old from a glass slide sitting on a
 * mechanical stage down to the nuclei ringing a single hair follicle. There is no
 * timer, no score, nothing to get wrong, and no cutscene: the finger drives every
 * millimetre of it, forwards and backwards, as slowly as they like.
 */

import * as THREE from 'three';
import './styles.css';

import { detectQuality, prefersReducedMotion, qualitySettings, QualityTier } from './core/quality';
import { InputController } from './core/input';
import { AudioEngine } from './core/audio';
import { CAPTURE_POINTS, evaluateJourney, JourneyState } from './core/journey';
import { MultiresolutionTissuePyramid } from './micro/tissuePyramid';
import { HERO_TISSUE, TISSUE_ROT_RAD } from './micro/specimen';
import { OBJECTIVES, resolutionMM } from './micro/optics';
import { PhysicalSlideScene } from './scene/physicalSlideScene';
import { LandmarkTracker, OrientationCamera } from './scene/orientationCamera';
import { CircularMicroscopeView } from './optics/microscopeView';
import { FocusController, ObjectiveTransitionController } from './optics/focusController';
import { installDebugApi } from './debug/debugApi';

const canvas = document.getElementById('stage-canvas') as HTMLCanvasElement;
const gestureLayer = document.getElementById('gesture-layer') as HTMLDivElement;
const bootEl = document.getElementById('boot') as HTMLDivElement;
const fallbackEl = document.getElementById('fallback') as HTMLDivElement;
const soundBtn = document.getElementById('sound-toggle') as HTMLButtonElement;

function fail(): void {
  bootEl.classList.add('hidden');
  fallbackEl.hidden = false;
}

const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
if (!gl) {
  fail();
  throw new Error('WebGL 2 is required');
}

let tier: QualityTier = detectQuality();
let settings = qualitySettings(tier);
const reducedMotion = prefersReducedMotion();
const devFlags = new URLSearchParams(location.search);

const renderer = new THREE.WebGLRenderer({
  canvas,
  context: gl,
  antialias: false,
  alpha: false,
  powerPreference: 'high-performance',
});
renderer.autoClear = false;
renderer.setClearColor(0x0b0d10, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene3d = new THREE.Scene();
const slideScene = new PhysicalSlideScene(settings.richMicroscope);
scene3d.add(slideScene.root);

const orientationCamera = new OrientationCamera();
const landmark = new LandmarkTracker();

const microView = new CircularMicroscopeView();
const microScene = new THREE.Scene();
microScene.add(microView.mesh);
const microCamera = new THREE.Camera();

let pyramid = new MultiresolutionTissuePyramid(renderer, {
  texels: settings.levelTexels,
  samples: settings.levelSamples,
  maxResident: settings.maxResidentLevels,
  strips: settings.generationStrips,
});

const audio = new AudioEngine();
const focus = new FocusController(reducedMotion);
const transitions = new ObjectiveTransitionController((i) => audio.objectiveClick(i), focus);

let journey: JourneyState = evaluateJourney(0);
let lastProgress = 0;
let progressRate = 0;
let stageNudgeX = 0;
let stageNudgeZ = 0;
let booted = false;

const input = new InputController({
  onProgress: () => {
    /* the render loop reads the smoothed value each frame */
  },
  onIdle: () => {
    // No arrows and no words: the stage itself walks the specimen a little way
    // toward the lens and back, which is what a person hunting for a field does.
    if (!booted) return;
    focus.nudge();
    audio.focusTick();
    stageNudgeX = journey.progress < 0.16 ? -1.6 : -0.06;
    stageNudgeZ = journey.progress < 0.16 ? 0.9 : 0.03;
  },
  onFirstTouch: () => {
    if (!audio.isEnabled) setSound(true);
  },
  onDragState: (dragging) => gestureLayer.classList.toggle('dragging', dragging),
});
input.attach(gestureLayer);

function setSound(on: boolean): void {
  audio.setEnabled(on);
  soundBtn.setAttribute('aria-pressed', String(on));
}
soundBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  setSound(!audio.isEnabled);
});
soundBtn.addEventListener('pointerdown', (e) => e.stopPropagation());

// ---------------------------------------------------------------- sizing

let viewW = 1;
let viewH = 1;

function resize(): void {
  const w = Math.max(1, window.innerWidth);
  const h = Math.max(1, window.innerHeight);
  viewW = w;
  viewH = h;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, settings.maxPixelRatio));
  renderer.setSize(w, h, false);
  orientationCamera.resize(w, h);
}
resize();
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));
window.visualViewport?.addEventListener('resize', resize);

// ---------------------------------------------------------------- frame

const scratch = new THREE.Vector3();
let last = performance.now();
let fps = 60;
let slowFrames = 0;

/**
 * The field stop, once open, spans very nearly the short side of the screen, so the
 * circle IS the objective's true field of view: 5.50 mm across at 4x, 0.55 at 40x.
 */
const CIRCLE_R_FINAL = 0.485;

/** Radius of the circular field as a fraction of the short screen side. */
function fieldRadius(state: JourneyState): number {
  // It grows from the projected rim of the objective's front lens out to the eyepiece
  // field stop, so the circle is born from the hardware rather than pasted on.
  const born = 0.1;
  const t = Math.max(0, Math.min(1, (state.progress - 0.155) / (0.29 - 0.155)));
  const e = t * t * (3 - 2 * t);
  return born + (CIRCLE_R_FINAL - born) * e;
}

function render(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  fps += (1 / Math.max(dt, 1e-4) - fps) * 0.08;

  const progress = input.step(dt);
  progressRate = Math.abs(progress - lastProgress) / Math.max(dt, 1e-4);
  lastProgress = progress;

  journey = evaluateJourney(progress);
  const transition = transitions.update(journey.objectiveIndex, dt);
  focus.update(dt);

  // Ease the idle nudge back to nothing once it has been noticed.
  stageNudgeX *= Math.exp(-dt / 0.45);
  stageNudgeZ *= Math.exp(-dt / 0.45);

  // --- hardware ---
  const travel = 1 - Math.min(1, progress / 0.15);
  slideScene.setStage(travel, stageNudgeX, stageNudgeZ, focus.nudgeLift() * 0.02);
  slideScene.setObjective(
    Math.max(journey.objectiveIndex, 0),
    transition.blend,
    transition.previousIndex,
  );
  slideScene.setFocusHeight(Math.max(journey.objectiveIndex, 0), journey.objectiveSeat);
  slideScene.setLamp(0.55 + 0.45 * Math.min(1, progress / 0.2));
  slideScene.setObjectiveVisible(journey.progress < 0.3);

  // The field width is defined at the CIRCLE, so the screen covers proportionally
  // more. Both halves of the dive use this same number, which is what makes the
  // hand-over at the edge of the objective invisible.
  const shortSide = Math.min(viewW, viewH);
  const mmPerShortSide = journey.fieldMM / (2 * CIRCLE_R_FINAL);
  const halfSpanX = 0.5 * mmPerShortSide * (viewW / shortSide);
  const halfSpanY = 0.5 * mmPerShortSide * (viewH / shortSide);

  // --- camera, locked to the landmark ---
  const heroWorld = landmark.worldTarget(orientationCamera, slideScene.slideGroup.position);
  scratch.copy(heroWorld);
  orientationCamera.update(progress, scratch, halfSpanX * 2);

  // The objective the camera is about to fly through opens out of the way.
  const lensY =
    slideScene.frontLensHeight(Math.max(journey.objectiveIndex, 0), journey.objectiveSeat);
  slideScene.setActiveObjectiveOpacity(
    Math.max(0, Math.min(1, (orientationCamera.camera.position.y - lensY) / 5)),
  );

  // The section is mounted off square AND the camera is still swinging round during
  // the approach. Measuring the landmark's bearing straight off the projection means
  // the microscope view inherits exactly the orientation the 3D view was showing, so
  // nothing rotates unexplained as the objective takes over.
  const tissueRot = measureTissueBearing(heroWorld);

  // --- pyramid ---
  const screenPx = viewW * renderer.getPixelRatio();
  // Spend more of the frame building levels while the finger is moving fast, because
  // that is exactly when the next level is about to be needed.
  const budget = progressRate > 0.35 ? 3 : progressRate > 0.08 ? 2 : 1;
  pyramid.update(journey.fieldMM, screenPx, budget);
  const level0 = pyramid.texture(0);
  if (level0 && devFlags.get('nospec') !== '1') slideScene.setSpecimenTexture(level0);

  const binding = pyramid.binding(journey.fieldMM, screenPx);
  if (binding) {
    microView.setLevels(binding.texA, binding.rectA, binding.texB, binding.rectB, binding.blend);
    // While the hardware is still on screen, show the same level on the glass.
    if (journey.macroWeight > 0.002 && devFlags.get('nopatch') !== '1') {
      const r = binding.rectB;
      slideScene.setDetailPatch(binding.texB, r.centreX, r.centreY, r.halfW);
    } else {
      slideScene.setDetailPatch(null, 0, 0, 0);
    }
  }

  const na = journey.objective?.na ?? OBJECTIVES[0].na;
  microView.apply({
    centre: HERO_TISSUE,
    halfSpanX,
    halfSpanY,
    anchorX: orientationCamera.anchor.x,
    anchorY: 1 - orientationCamera.anchor.y,
    circleR: fieldRadius(journey),
    fieldOpen: journey.fieldOpen,
    surround: smooth(0.235, 0.305, progress),
    focusBlurMM: focus.blurMM(na),
    na,
    lamp: 1,
    // The marker ring is 2.1 mm across on the underside of the glass, so it leaves
    // the field of its own accord once the objective is tighter than the circle the
    // pathologist drew. Nothing has to fade it out.
    ink: smooth(6.0, 8.5, journey.fieldMM) * journey.fieldOpen,
    // Dust reads at low power and is a blurred nothing by 20x, where the pyramid
    // needs the GPU time more.
    dust: journey.fieldOpen * 0.7 * smooth(1.0, 1.9, journey.fieldMM),
    grit: reducedMotion ? 0 : transition.grit,
    rot: tissueRot,
    width: viewW * renderer.getPixelRatio(),
    height: viewH * renderer.getPixelRatio(),
  });

  audio.update(journey.totalMag, progressRate, journey.fieldOpen);

  // --- draw ---
  renderer.setRenderTarget(null);
  renderer.setViewport(0, 0, viewW, viewH);
  renderer.setScissorTest(false);
  renderer.clear(true, true, true);
  if (journey.macroWeight > 0.002) renderer.render(scene3d, orientationCamera.camera);
  if (journey.fieldOpen > 0.001 || progress > 0.2) renderer.render(microScene, microCamera);

  debug?.frame({
    journey,
    fps,
    progressRate,
    binding,
    landmarkScreen:
      journey.macroWeight > 0.5
        ? landmark.screenPosition(orientationCamera, slideScene.slideGroup.position)
        : { x: orientationCamera.anchor.x, y: orientationCamera.anchor.y },
    pyramid,
    tier,
  });

  // Quality is allowed to step down if the device cannot hold a usable frame rate.
  if (fps < 26) slowFrames++;
  else slowFrames = Math.max(0, slowFrames - 1);
  if (slowFrames > 90 && tier !== 'low') {
    slowFrames = 0;
    setQuality(tier === 'high' ? 'medium' : 'low');
  }

  requestAnimationFrame(render);
}

const bearingA = new THREE.Vector3();
const bearingB = new THREE.Vector3();
/** Screen-space angle of the section's own x axis, in radians. */
function measureTissueBearing(heroWorld: THREE.Vector3): number {
  // TISSUE +x in world coordinates, given the section's mounting rotation.
  const dx = Math.cos(TISSUE_ROT_RAD);
  const dz = -Math.sin(TISSUE_ROT_RAD);
  bearingA.copy(heroWorld);
  bearingB.set(heroWorld.x + dx * 0.5, heroWorld.y, heroWorld.z + dz * 0.5);
  const a = orientationCamera.project(bearingA);
  const b = orientationCamera.project(bearingB);
  const vx = (b.x - a.x) * viewW;
  const vy = (b.y - a.y) * viewH;
  if (!Number.isFinite(vx) || !Number.isFinite(vy) || (vx === 0 && vy === 0)) {
    return TISSUE_ROT_RAD;
  }
  return -Math.atan2(vy, vx);
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function setQuality(next: QualityTier): void {
  if (next === tier) return;
  tier = next;
  settings = qualitySettings(tier);
  pyramid.dispose();
  pyramid = new MultiresolutionTissuePyramid(renderer, {
    texels: settings.levelTexels,
    samples: settings.levelSamples,
    maxResident: settings.maxResidentLevels,
    strips: settings.generationStrips,
  });
  pyramid.generateNow(0);
  resize();
}

// Development aid: dump a pyramid level as a PNG data URL for direct inspection.
(window as unknown as Record<string, unknown>).__zoomDumpLevel = (i: number) => {
  pyramid.generateNow(i);
  const r = pyramid.readLevel(i);
  if (!r) return null;
  const c = document.createElement('canvas');
  c.width = r.size;
  c.height = r.size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(r.size, r.size);
  // readRenderTargetPixels returns rows bottom-up; flip so the PNG reads like the view.
  for (let y = 0; y < r.size; y++) {
    const src = (r.size - 1 - y) * r.size * 4;
    img.data.set(r.data.subarray(src, src + r.size * 4), y * r.size * 4);
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
};

// A development probe for the compositor's actual uniform values.
(window as unknown as Record<string, unknown>).__zoomUniforms = () => {
  const u = microView.material.uniforms;
  return {
    centre: [u.uCentre.value.x, u.uCentre.value.y],
    halfSpan: [u.uHalfSpan.value.x, u.uHalfSpan.value.y],
    anchor: [u.uAnchor.value.x, u.uAnchor.value.y],
    resolution: [u.uResolution.value.x, u.uResolution.value.y],
    circleR: u.uCircleR.value,
    blend: u.uBlend.value,
    rectA: [u.uRectA.value.x, u.uRectA.value.y, u.uRectA.value.z, u.uRectA.value.w],
    rectB: [u.uRectB.value.x, u.uRectB.value.y, u.uRectB.value.z, u.uRectB.value.w],
    rot: u.uRot.value,
    focusBlurMM: u.uFocusBlurMM.value,
  };
};

// ---------------------------------------------------------------- boot

const debug = installDebugApi({
  setProgress: (p, snap) => input.setProgress(p, snap),
  getProgress: () => input.targetProgress,
  getJourney: () => journey,
  setQuality,
  getTier: () => tier,
  capturePoints: CAPTURE_POINTS,
  ensureLevelsFor: (fieldMM) => {
    const screenPx = viewW * renderer.getPixelRatio();
    const lod = pyramid.lodFor(fieldMM, screenPx);
    pyramid.generateNow(Math.floor(lod));
    pyramid.generateNow(Math.min(Math.floor(lod) + 1, pyramid.levelCount - 1));
  },
  residentBytes: () => pyramid.residentBytes(),
  building: () => pyramid.building,
  residentLevels: () => pyramid.residentLevels(),
  anchor: () => orientationCamera.anchor,
  resolutionMM: (na) => resolutionMM(na),
});

// Level 0 is needed before the first frame draws the slide; a couple more are warmed
// so the very first swipe never runs into an unbuilt level.
pyramid.generateNow(0);
pyramid.generateNow(3);
booted = true;
requestAnimationFrame((t) => {
  last = t;
  render(t);
  bootEl.classList.add('hidden');
  window.setTimeout(() => {
    bootEl.style.display = 'none';
  }, 700);
});
