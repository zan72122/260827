// こおりのふね — a one-stroke icebreaker game for small children.
// Draw one line from the icebreaker toward the far harbour; the ship follows
// it with real inertia, breaks a lane through the ice, and the little supply
// ship uses YOUR lane to deliver its cargo.

import * as THREE from 'three';
import {
  START, START_HEADING, WATER_Y, IB_BASE_SPEED, SUPPLY_SPEED, IB_LENGTH,
  SUPPLY_LENGTH, mulberry32, clamp,
} from './game/const';
import { buildRoute, resample, Route, StrokeSample } from './game/path';
import { IceField } from './game/ice';
import { Floes } from './game/floes';
import { buildIcebreaker, buildSupplyShip } from './game/ships';
import { Port } from './game/port';
import { ShipController } from './game/shipctl';
import { CameraRig } from './game/camera';
import { Sky } from './game/sky';
import { StrokeInput } from './game/input';

type GameState = 'intro' | 'input' | 'breaking' | 'convoy' | 'dock' | 'done';

const app = document.getElementById('app')!;
const btnReplay = document.getElementById('btn-replay')!;
const btnNewIce = document.getElementById('btn-newice')!;

// --- renderer ----------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
app.appendChild(renderer.domElement);

function applySize(): void {
  const w = app.clientWidth, h = app.clientHeight;
  // internal-resolution cap for high-DPI phones/tablets
  let pr = Math.min(window.devicePixelRatio || 1, 2);
  const MAX_PIXELS = 2_400_000;
  if (w * h * pr * pr > MAX_PIXELS) pr = Math.sqrt(MAX_PIXELS / (w * h));
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h);
}

// --- scene -------------------------------------------------------------------
const scene = new THREE.Scene();
let seed = 1;
const ice = new IceField(scene, seed);
const floes = new Floes(scene, seed);
const sky = new Sky(scene, ice.sunDir.clone().negate());
const port = new Port(scene);

const ib = buildIcebreaker();
scene.add(ib.group);
const supply = buildSupplyShip();
scene.add(supply.group);

const SUPPLY_WAIT = { x: START.x - 7, z: START.z - 38 };

/** Open water the world starts with: the kept-open harbour basin (so the
 *  supply ship can always berth once your lane connects to it) and the
 *  pocket the two ships float in at the start. */
function stampInitialOpenWater(): void {
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    ice.carveCircle(14 + t * 4, 160 + t * 58, 30);
  }
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    ice.carveCircle(SUPPLY_WAIT.x + t * (START.x - SUPPLY_WAIT.x), (START.z - 42) + t * 52, 15);
  }
}

function placeShipsAtStart(): void {
  ib.group.position.set(START.x, WATER_Y, START.z);
  ib.group.rotation.set(0, START_HEADING, 0);
  supply.group.position.set(SUPPLY_WAIT.x, WATER_Y, SUPPLY_WAIT.z);
  supply.group.rotation.set(0, START_HEADING + 0.12, 0);
}
placeShipsAtStart();
stampInitialOpenWater();

// soft contact shadows under the hulls
function makeBlobShadow(len: number, beam: number): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 32, 4, 64, 32, 30);
  g.addColorStop(0, 'rgba(0,0,0,0.34)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.save(); ctx.translate(64, 32); ctx.scale(2, 1); ctx.translate(-64, -32);
  ctx.fillRect(0, 0, 128, 64);
  ctx.restore();
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(len * 1.25, beam * 2.1),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.rotation.z = Math.PI / 2;
  m.renderOrder = 1;
  return m;
}
const ibShadow = makeBlobShadow(IB_LENGTH, ib.beam);
const supShadow = makeBlobShadow(SUPPLY_LENGTH, supply.beam);
scene.add(ibShadow, supShadow);

// --- camera ------------------------------------------------------------------
const rig = new CameraRig(app.clientWidth / Math.max(1, app.clientHeight));

// --- preview line (thin chart-pencil line, no neon) --------------------------
const previewGeo = new THREE.BufferGeometry();
const previewMat = new THREE.LineBasicMaterial({
  color: 0xf4f7f9, transparent: true, opacity: 0.65, depthWrite: false,
});
const previewLine = new THREE.Line(previewGeo, previewMat);
previewLine.frustumCulled = false;
previewLine.visible = false;
scene.add(previewLine);

function setPreview(samples: StrokeSample[]): void {
  if (samples.length < 2) { previewLine.visible = false; return; }
  const pts = resample([{ x: START.x, z: START.z }, ...samples.map((s) => ({ x: s.x, z: s.z }))], 4);
  const arr = new Float32Array(pts.length * 3);
  for (let i = 0; i < pts.length; i++) {
    arr[i * 3] = pts[i].x; arr[i * 3 + 1] = 0.55; arr[i * 3 + 2] = pts[i].z;
  }
  previewGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  previewGeo.computeBoundingSphere();
  previewLine.visible = true;
  previewMat.opacity = 0.65;
}

// --- game state --------------------------------------------------------------
let state: GameState = 'intro';
let route: Route | null = null;
let ibCtl: ShipController | null = null;
let supCtl: ShipController | null = null;
let breakT = 0;      // time since breaking started (drives the camera chain)
let closeUsed = false;
let simTime = 0;

const input = new StrokeInput(app, rig.camera);

input.onAnyTap = () => {
  if (state === 'intro') rig.skipIntro();
};

input.onProgress = (samples) => {
  if (state === 'input') setPreview(samples);
};

let lastStroke: StrokeSample[] = [];
input.onComplete = ({ samples, screenSpeed }) => {
  if (state !== 'input') return;
  lastStroke = samples;
  launch(buildRoute(samples, screenSpeed));
};

function launch(r: Route): void {
  route = r;
  setPreviewFromRoute(r);
  ibCtl = new ShipController(
    ib.group, r.pts, r.headings, r.step, r.totalLen,
    IB_BASE_SPEED, IB_LENGTH, r.headings[0], true, ice, floes, scene, r.drawnLen,
  );
  supCtl = null;
  input.enabled = false;
  state = 'breaking';
  breakT = 0;
  closeUsed = false;
  // one-time close shot swings to the side of the child's first turn
  let side = 1;
  for (let i = 2; i < r.headings.length; i++) {
    const d = r.headings[i] - r.headings[0];
    if (Math.abs(d) > 0.12) { side = Math.sign(d); break; }
  }
  rig.setCloseSide(side);
  rig.setMode('follow');
}

/** after launch the drawn line stays as the actual target spline, fading out */
function setPreviewFromRoute(r: Route): void {
  const arr = new Float32Array(r.pts.length * 3);
  for (let i = 0; i < r.pts.length; i++) {
    arr[i * 3] = r.pts[i].x; arr[i * 3 + 1] = 0.55; arr[i * 3 + 2] = r.pts[i].z;
  }
  previewGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  previewGeo.computeBoundingSphere();
  previewLine.visible = true;
}

function resetGame(newSeed: boolean): void {
  if (newSeed) seed += 1;
  ice.reset(seed);
  stampInitialOpenWater();
  floes.reset(seed);
  port.reset();
  route = null;
  ibCtl = null;
  supCtl = null;
  placeShipsAtStart();
  previewLine.visible = false;
  btnReplay.classList.remove('show');
  btnNewIce.classList.remove('show');
  state = 'input';
  input.enabled = true;
  rig.setMode('input');
}

btnReplay.addEventListener('click', () => { if (state === 'done') resetGame(false); });
btnNewIce.addEventListener('click', () => { if (state === 'done') resetGame(true); });

// --- update ------------------------------------------------------------------
const idleRng = mulberry32(2);
function update(dt: number): void {
  simTime += dt;
  const t = simTime;

  if (ib.radar) ib.radar.rotation.y += dt * 1.4;
  ice.update(t);
  floes.update(dt, t);
  port.update(dt, t);
  sky.update(dt, rig.camera.position);

  // idle bob for any ship not being driven
  if (!ibCtl) {
    ib.group.position.y = WATER_Y + Math.sin(t * 0.8) * 0.04;
    ib.group.rotation.z = Math.sin(t * 0.6) * 0.006;
  }
  if (!supCtl) {
    supply.group.position.y = WATER_Y + Math.sin(t * 0.9 + 1.7) * 0.05;
    supply.group.rotation.z = Math.sin(t * 0.7 + 0.5) * 0.008;
  }

  switch (state) {
    case 'intro': {
      if (rig.introFinished) {
        state = 'input';
        input.enabled = true;
        rig.setMode('input');
      }
      break;
    }
    case 'breaking': {
      if (!route || !ibCtl) break;
      breakT += dt;
      ibCtl.update(dt, t, route.speedFactor);
      previewMat.opacity = Math.max(0, 0.65 - breakT * 0.09);
      if (previewMat.opacity <= 0.01) previewLine.visible = false;
      // camera chain: follow -> one close side shot at the first thick ice -> mid
      if (!closeUsed && breakT > 2.4 && ibCtl.breaking) {
        closeUsed = true;
        rig.setMode('close');
      }
      if (closeUsed && rig.mode === 'close' && breakT > 6.2) rig.setMode('mid');
      if (rig.mode === 'follow' && breakT > 7) rig.setMode('mid');
      if (ibCtl.finished) {
        state = 'convoy';
        rig.setMode('finale');
        supCtl = new ShipController(
          supply.group, route.supplyPts, route.supplyHeadings, route.step,
          route.supplyTotalLen, SUPPLY_SPEED, SUPPLY_LENGTH,
          route.supplyHeadings[0], false, null, null, scene,
        );
      }
      break;
    }
    case 'convoy': {
      if (!route || !supCtl) break;
      if (ibCtl) ibCtl.update(dt, t, 1);
      supCtl.update(dt, t, 1);
      // once the supply ship nears the berth, move in for the crane
      if (supCtl.s > route.supplyTotalLen - 60) rig.setMode('dock');
      if (supCtl.finished) {
        state = 'dock';
        const deck = supply.group.position.clone();
        deck.y += 2.2;
        port.startUnload(deck);
      }
      break;
    }
    case 'dock': {
      if (supCtl) supCtl.update(dt, t, 1);
      if (port.unloadDone) {
        state = 'done';
        btnReplay.classList.add('show');
        btnNewIce.classList.add('show');
      }
      break;
    }
    case 'done':
      break;
  }

  // blob shadows track the hulls
  ibShadow.position.set(ib.group.position.x, 0.06, ib.group.position.z);
  ibShadow.rotation.z = Math.PI / 2 - ib.group.rotation.y;
  supShadow.position.set(supply.group.position.x, 0.06, supply.group.position.z);
  supShadow.rotation.z = Math.PI / 2 - supply.group.rotation.y;

  const active = (state === 'convoy' || state === 'dock' || state === 'done') && supCtl
    ? supply.group.position : ib.group.position;
  rig.update(dt, {
    shipPos: ib.group.position,
    shipHeading: ib.group.rotation.y,
    aspect: app.clientWidth / Math.max(1, app.clientHeight),
    time: t,
  });
  void active;
}

// --- loop --------------------------------------------------------------------
applySize();
let last = performance.now();
function frame(now: number): void {
  const dt = clamp((now - last) / 1000, 0.0001, 1 / 20);
  last = now;
  update(dt);
  renderer.render(scene, rig.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('resize', () => {
  applySize();
  rig.onResize(app.clientWidth / Math.max(1, app.clientHeight));
});
window.addEventListener('orientationchange', () => {
  setTimeout(() => {
    applySize();
    rig.onResize(app.clientWidth / Math.max(1, app.clientHeight));
  }, 250);
});

// --- verification hooks (used by the automated playtests) --------------------
declare global {
  interface Window { __ib: Record<string, unknown> }
}
window.__ib = {
  getState: () => state,
  skipIntro: () => rig.skipIntro(),
  injectStroke: (pts: { x: number; z: number }[], screenSpeed = 600) => {
    if (state === 'intro') { rig.skipIntro(); state = 'input'; input.enabled = true; rig.setMode('input'); }
    if (state !== 'input') return false;
    const t0 = performance.now() / 1000;
    const samples: StrokeSample[] = pts.map((p, i) => ({ x: p.x, z: p.z, t: t0 + i * 0.02 }));
    launch(buildRoute(samples, screenSpeed));
    return true;
  },
  fastForward: (seconds: number) => {
    const step = 1 / 60;
    for (let e = 0; e < seconds; e += step) update(step);
  },
  maskAt: (x: number, z: number) => ice.maskValueAt(x, z),
  shipPose: () => ({
    x: ib.group.position.x, y: ib.group.position.y, z: ib.group.position.z,
    heading: ib.group.rotation.y,
  }),
  supplyPose: () => ({
    x: supply.group.position.x, y: supply.group.position.y, z: supply.group.position.z,
  }),
  routeInfo: () => route ? {
    totalLen: route.totalLen, drawnLen: route.drawnLen, branchLen: route.branchLen,
    speedFactor: route.speedFactor,
    pts: route.pts.filter((_, i) => i % 5 === 0),
  } : null,
  lastStroke: () => lastStroke.map((s) => ({ x: s.x, z: s.z })),
  debugHide: (what: string) => {
    if (what === 'inst') scene.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) o.visible = false; });
    else if (what === 'sprites') scene.traverse((o) => { if ((o as THREE.Sprite).isSprite) o.visible = false; });
    else if (what === 'lines') { previewLine.visible = false; }
    else if (what === 'points') scene.traverse((o) => { if ((o as THREE.Points).isPoints) o.visible = false; });
    else if (what === 'ice') ice.mesh.visible = false;
    else if (what === 'apron') ice.apron.visible = false;
    else if (what === 'skydome') { sky.dome.visible = false; sky.farIce.visible = false; }
    else if (what === 'portg') port.group.visible = false;
    else if (what === 'ships') { ib.group.visible = false; supply.group.visible = false; }
    else if (what === 'shadows') { ibShadow.visible = false; supShadow.visible = false; }
    else port.debugHide(what);
  },
  reset: (newSeed = false) => resetGame(newSeed as boolean),
  idleRngProbe: () => idleRng(),
};
