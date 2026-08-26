import * as THREE from 'three';
import { journey, type PathSample } from './journey';
import { initMaterials, M } from './materials';
import { Bag } from './bag';
import { CameraRig } from './camera';
import { Lighting } from './lighting';
import { AudioEngine } from './audio';
import { InputController } from './input';
import type { Segment, FrameState } from './world/types';
import { buildTerminal } from './world/terminal';
import { buildUnderground } from './world/underground';
import { buildScreening } from './world/screening';
import { buildSorter } from './world/sorter';
import { buildMakeup } from './world/makeup';
import { buildAirside } from './world/airside';
import { buildLoader } from './world/loader';
import { buildHold } from './world/hold';

// ---------- renderer ----------
const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
app.appendChild(renderer.domElement);
renderer.domElement.style.touchAction = 'none';

const scene = new THREE.Scene();
initMaterials();

// ---------- world ----------
const segments: Segment[] = [
  buildTerminal(),
  buildUnderground(),
  buildScreening(),
  buildSorter(),
  buildMakeup(),
  buildAirside(),
  buildLoader(),
  buildHold(),
];
for (const seg of segments) scene.add(seg.group);

const bag = new Bag();
scene.add(bag.group);

const lighting = new Lighting(scene);
const rig = new CameraRig();
const audio = new AudioEngine();
const input = new InputController(renderer.domElement, () => audio.ensure());

// ---------- state ----------
let progress = 0; // displayed progress (chases input.target)
let snapNext = true;
const sample: PathSample = { pos: new THREE.Vector3(), tangent: new THREE.Vector3(1, 0, 0) };
let prevS = 0;
let speedSm = 0;
const clock = new THREE.Clock();

// event thresholds → audio triggers (fire on crossing in either direction)
const crossings: { p: number; fire: (dir: number) => void }[] = [
  { p: 0.155, fire: (d) => audio.trigger('rustle', Math.min(1, 0.4 + Math.abs(speedSm) * 2) * (d ? 1 : 1)) },
  { p: 0.408, fire: () => audio.trigger('flap') },
  { p: 0.378, fire: () => audio.trigger('beep') },
  { p: 0.532, fire: () => audio.trigger('flap') },
  { p: 0.591, fire: () => audio.trigger('clunk') },
  { p: 0.699, fire: () => audio.trigger('shutter') },
  { p: 0.779, fire: () => audio.trigger('rustle', 0.8) },
  { p: 0.9, fire: () => audio.trigger('thud', 0.7) },
  { p: 0.984, fire: () => audio.trigger('holdRoll') },
  { p: 0.996, fire: () => audio.trigger('thud') },
];

function isPortrait(): boolean {
  return window.innerHeight > window.innerWidth;
}

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  rig.resize(w, h);
  snapNext = true;
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
resize();

// ---------- swipe hint (non-verbal, disappears after the first real swipe) ----------
const hintEl = document.getElementById('hint') as HTMLDivElement;
let hintPhase = 0;

function updateHint(dt: number): void {
  const wantHint =
    !input.dragging && progress < 0.985 && (!input.everDragged || input.idleTime > 8);
  if (!wantHint) {
    hintEl.style.opacity = '0';
    hintPhase = 0;
    return;
  }
  hintPhase += dt / 1.6; // 1.6s loop
  const t = hintPhase % 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  let x: number;
  let y: number;
  if (isPortrait()) {
    x = w * 0.5 + t * w * 0.06;
    y = h * 0.72 - t * h * 0.4;
  } else {
    x = w * 0.32 + t * w * 0.4;
    y = h * 0.68 - t * h * 0.06;
  }
  const fade = Math.sin(Math.min(1, t / 0.18) * Math.PI * 0.5) * (1 - smooth((t - 0.75) / 0.25));
  hintEl.style.opacity = String(0.8 * fade);
  hintEl.style.transform = `translate(${x}px, ${y}px)`;
}
function smooth(t: number): number {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
}

// ---------- per-frame ----------
const frameState: FrameState = {
  p: 0,
  s: 0,
  speed: 0,
  dt: 0,
  time: 0,
  bagPos: new THREE.Vector3(),
  hint: 0,
};

const EULER = new THREE.Euler(0, 0, 0, 'YZX');

function frame(): void {
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;
  input.tick(dt);

  // progress chases the finger target quickly (still continuous both ways)
  const prevP = progress;
  const k = snapNext ? 1 : 1 - Math.exp(-11 * dt);
  progress += (input.target - progress) * k;
  if (Math.abs(input.target - progress) < 0.00004) progress = input.target;

  const s = journey.progressToS(progress);
  const rawSpeed = dt > 0 ? (s - prevS) / dt : 0;
  speedSm += (rawSpeed - speedSm) * Math.min(1, dt * 10);
  prevS = s;
  journey.sampleS(s, sample);

  // audio crossings
  for (const c of crossings) {
    if ((prevP < c.p && progress >= c.p) || (prevP > c.p && progress <= c.p)) {
      c.fire(progress > prevP ? 1 : -1);
    }
  }

  // ---- bag transform: THE one bag, path-driven ----
  bag.group.position.copy(sample.pos);
  const yaw = Math.atan2(-sample.tangent.z, sample.tangent.x);
  const hLen = Math.hypot(sample.tangent.x, sample.tangent.z);
  const pitch = Math.atan2(sample.tangent.y, hLen);
  EULER.set(0, yaw, pitch);
  bag.group.quaternion.setFromEuler(EULER);
  // settle beside the other bags at the very end (pure function of progress)
  const settle = THREE.MathUtils.smoothstep(progress, 0.985, 1.0);
  if (settle > 0) {
    bag.group.rotation.y += settle * 0.55;
    bag.group.position.y += Math.sin(settle * Math.PI) * 0.05;
  }

  const wind = THREE.MathUtils.smoothstep(progress, 0.78, 0.82) * (1 - THREE.MathUtils.smoothstep(progress, 0.975, 0.99));
  const hintStrength = !input.dragging && input.idleTime > 3 && progress < 0.98 ? Math.min(1, (input.idleTime - 3) / 2) : 0;
  const onRollers =
    (progress > 0.395 && progress < 0.545) || (progress > 0.6 && progress < 0.665) || progress > 0.982;
  bag.update(dt, speedSm, wind, hintStrength, onRollers, time);

  // ---- world updates + coarse culling by progress range ----
  frameState.p = progress;
  frameState.s = s;
  frameState.speed = speedSm;
  frameState.dt = dt;
  frameState.time = time;
  frameState.bagPos.copy(sample.pos);
  frameState.hint = hintStrength;
  for (const seg of segments) {
    const vis = progress > seg.range[0] - 0.04 && progress < seg.range[1] + 0.04;
    if (seg.group.visible !== vis) seg.group.visible = vis;
    if (vis && seg.update) seg.update(frameState);
  }

  // every belt surface answers the finger: shared rubber texture scroll
  (M.beltRubber.map as THREE.Texture).offset.x -= (speedSm * dt) / 1.4;

  lighting.update(progress, sample.pos);
  rig.update(dt, progress, sample, isPortrait(), snapNext);
  snapNext = false;

  audio.update(progress, speedSm, dt);
  updateHint(dt);

  renderer.render(scene, rig.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- external test API ----------
declare global {
  interface Window {
    __BAGGAGE_GAME__: {
      version: string;
      ready: boolean;
      setProgress(v: number): void;
      getProgress(): number;
      getTarget(): number;
      bagScreenPosition(): { x: number; y: number };
      rendererInfo(): { geometries: number; textures: number; calls: number; triangles: number };
    };
  }
}

const _proj = new THREE.Vector3();
window.__BAGGAGE_GAME__ = {
  version: '1.0.0',
  ready: true,
  setProgress(v: number) {
    const c = THREE.MathUtils.clamp(v, 0, 1);
    input.target = c;
    progress = c;
    prevS = journey.progressToS(c);
    speedSm = 0;
    snapNext = true;
    // external control counts as interaction: keep the hint out of shots
    input.everDragged = true;
    input.idleTime = 0;
  },
  getProgress: () => progress,
  getTarget: () => input.target,
  bagScreenPosition() {
    _proj.copy(bag.group.position).project(rig.camera);
    return {
      x: ((_proj.x + 1) / 2) * window.innerWidth,
      y: ((1 - _proj.y) / 2) * window.innerHeight,
    };
  },
  rendererInfo() {
    return {
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
    };
  },
};
