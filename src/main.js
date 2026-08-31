/**
 * main.js — 「とおくへいくおてがみに、2つのはんこをじゅんばんに押す」
 *
 * 看板動作:
 *   スタンプを選ぶ → 切手の近くに合わせる → 押し下げる → 持ち上げる → 次のスタンプへ
 *
 * 文字を使わず、視線誘導と自動カメラだけで因果を伝える。
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import {
  createEnvelope, createStamp, createStampRest, createInkPad, createCounter,
  createPaperPlane, createImpression, deformEnvelope,
  ENV_T, SLOTS, POSTAGE_POS,
} from './objects.js';
import { impressionTexture, glowTexture } from './textures.js';

/* =========================================================
   基本セットアップ
   ========================================================= */

const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, alpha: false, powerPreference: 'high-performance',
});
renderer.setClearColor(0x2b3138);
let quality = 1;
const basePR = () => Math.min(window.devicePixelRatio || 1, quality > 0.5 ? 2 : 1.25);
renderer.setPixelRatio(basePR());
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x30373d);
// フォグはカメラ空間の距離で効く (見た目のごまかしではなく本物の奥行き情報)
scene.fog = new THREE.Fog(0x39424a, 9.5, 26);

const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 60);
camera.position.set(0.2, 3.6, 5.4);

// 環境光 (PBR のための IBL)
const pmrem = new THREE.PMREMGenerator(renderer);
pmrem.compileEquirectangularShader();
const envRT = pmrem.fromScene(new RoomEnvironment(), 0.03);
scene.environment = envRT.texture;
scene.environmentIntensity = 0.55;

/* ---------- 照明 ---------- */

const hemi = new THREE.HemisphereLight(0xdfeaf5, 0x4a4038, 0.45);
scene.add(hemi);

// 窓からの主光源 (影を落とす唯一のライト = モバイルに優しい)
const key = new THREE.DirectionalLight(0xfff1d8, 2.6);
key.position.set(4.2, 6.6, 4.4);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.near = 1;
key.shadow.camera.far = 20;
key.shadow.camera.left = -5;
key.shadow.camera.right = 5;
key.shadow.camera.top = 5;
key.shadow.camera.bottom = -5;
key.shadow.bias = -0.0009;
key.shadow.normalBias = 0.012;
scene.add(key);
scene.add(key.target);
key.target.position.set(0, 0, 0.1);

// 手元の作業灯 (影なし)
const deskLamp = new THREE.PointLight(0xffe0b0, 12, 9, 2);
deskLamp.position.set(-2.2, 2.6, 2.0);
scene.add(deskLamp);

const fill = new THREE.DirectionalLight(0xbcd4ea, 0.55);
fill.position.set(-4, 3.2, -2.5);
scene.add(fill);

/* =========================================================
   ワールド
   ========================================================= */

const world = new THREE.Group();
scene.add(world);
world.add(createCounter());

const ENV_BASE_Y = 0.045;                       // マットの上
const envHome = new THREE.Vector3(0, ENV_BASE_Y, 0.05);
let envelope = createEnvelope();
envelope.position.copy(envHome);
envelope.rotation.y = -0.035;
world.add(envelope);

// 印章と置き台
const restPos = [new THREE.Vector3(-1.28, 0, 1.72), new THREE.Vector3(1.28, 0, 1.72)];
const rests = [];
const stamps = [];
const padColors = [0x8e2620, 0x1b2233];
for (let i = 0; i < 2; i++) {
  const rest = createStampRest(i);
  rest.position.copy(restPos[i]);
  rest.rotation.y = i ? -0.25 : 0.25;
  world.add(rest);
  rests.push(rest);

  const s = createStamp(i === 0 ? 'special' : 'normal');
  s.position.set(restPos[i].x, 0.075, restPos[i].z);
  s.userData.home = s.position.clone();
  world.add(s);
  stamps.push(s);

  const pad = createInkPad(padColors[i]);
  pad.position.set(restPos[i].x + (i ? 1.32 : -1.32), 0, 0.55);
  pad.rotation.y = i ? -0.4 : 0.4;
  world.add(pad);
}

/* ---------- 視線誘導 (文字なし) ---------- */

const cue = new THREE.Group();
world.add(cue);

const cueMat = new THREE.MeshStandardMaterial({
  color: 0xffa62e, emissive: 0xff6a12, emissiveIntensity: 1.6, roughness: 0.35,
});
const cueArrow = new THREE.Group();
{
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.30, 18), cueMat);
  cone.rotation.x = Math.PI;
  cone.position.y = 0.15;
  cueArrow.add(cone);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.26, 14), cueMat);
  shaft.position.y = 0.43;
  cueArrow.add(shaft);
}
cue.add(cueArrow);

// 置き台のまわりで脈動するリング
const cueRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.47, 0.040, 8, 44),
  new THREE.MeshBasicMaterial({ color: 0xffa838, transparent: true, opacity: 0.9 })
);
cueRing.rotation.x = -Math.PI / 2;
cue.add(cueRing);

// 押す場所のリング (ドラッグ中に出る)
const targetRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.44, 0.026, 8, 48),
  new THREE.MeshBasicMaterial({ color: 0xffd36e, transparent: true, opacity: 0 })
);
targetRing.rotation.x = -Math.PI / 2;
targetRing.renderOrder = 5;
world.add(targetRing);

const targetGlow = new THREE.Mesh(
  new THREE.CircleGeometry(0.52, 32),
  new THREE.MeshBasicMaterial({
    map: glowTexture('rgba(255,226,150,0.85)', 'rgba(255,180,80,0)'),
    transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
  })
);
targetGlow.rotation.x = -Math.PI / 2;
targetGlow.renderOrder = 4;
world.add(targetGlow);

/* ---------- 完成演出 ---------- */

const plane = createPaperPlane();
plane.visible = false;
world.add(plane);

const TRAIL = 90;
const trailGeo = new THREE.BufferGeometry();
const trailPos = new Float32Array(TRAIL * 3);
const trailAlpha = new Float32Array(TRAIL);
trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
trailGeo.setAttribute('aAlpha', new THREE.BufferAttribute(trailAlpha, 1));
const trailMat = new THREE.PointsMaterial({
  size: 0.20, map: glowTexture(), transparent: true, depthWrite: false,
  blending: THREE.AdditiveBlending, opacity: 0.9, sizeAttenuation: true,
});
const trail = new THREE.Points(trailGeo, trailMat);
trail.visible = false;
trail.frustumCulled = false;
world.add(trail);

/* =========================================================
   音 (小さく、短く)
   ========================================================= */

let audio = null;
function initAudio() {
  if (audio) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  audio = new AC();
}
function tone(freq, dur, type = 'sine', gain = 0.15, slide = 0) {
  if (!audio) return;
  const t = audio.currentTime;
  const o = audio.createOscillator(), g = audio.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(audio.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, gain = 0.08, freq = 1200, q = 0.7) {
  if (!audio) return;
  const t = audio.currentTime;
  const len = Math.ceil(audio.sampleRate * dur);
  const buf = audio.createBuffer(1, len, audio.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = audio.createBufferSource(); src.buffer = buf;
  const bp = audio.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
  const g = audio.createGain(); g.gain.value = gain;
  src.connect(bp).connect(g).connect(audio.destination);
  src.start(t);
}
const sfx = {
  pick() { tone(520, 0.09, 'triangle', 0.08); },
  thunk() { tone(96, 0.20, 'sine', 0.26, 0.55); noise(0.11, 0.10, 900, 1.1); },
  lift() { noise(0.16, 0.05, 2400, 0.6); },
  done() { tone(660, 0.16, 'triangle', 0.10); setTimeout(() => tone(880, 0.22, 'triangle', 0.10), 110); setTimeout(() => tone(1320, 0.30, 'sine', 0.07), 230); },
  whoosh() { noise(0.5, 0.05, 700, 0.35); },
  nope() { tone(300, 0.10, 'sine', 0.05, 0.8); },
};

/* =========================================================
   カメラ演出 (自由操作なし / 自動制御)
   ========================================================= */

function slotWorld(i) {
  envelope.updateMatrixWorld();
  return envelope.localToWorld(new THREE.Vector3(SLOTS[i].x, ENV_T, SLOTS[i].y));
}

function pointsAround(v, r) {
  return [
    v.clone().add(new THREE.Vector3(r, 0, 0)), v.clone().add(new THREE.Vector3(-r, 0, 0)),
    v.clone().add(new THREE.Vector3(0, 0, r)), v.clone().add(new THREE.Vector3(0, 0, -r)),
  ];
}
function envelopeCorners() {
  const out = [];
  for (const x of [-1.12, 1.12]) for (const z of [-0.62, 0.62]) {
    out.push(envelope.localToWorld(new THREE.Vector3(x, ENV_T, z)));
  }
  return out;
}
function stampPoints(i) {
  const p = stamps[i].position;
  return pointsAround(p, 0.45).concat([p.clone().add(new THREE.Vector3(0, 1.35, 0))]);
}

const shots = {
  establish: () => ({
    look: new THREE.Vector3(0, 0.16, 0.46), pos: new THREE.Vector3(0.10, 3.05, 4.55), fov: 42, orbit: 0.18,
    fit: envelopeCorners().concat(stampPoints(0), stampPoints(1)),
  }),
  align: (i) => {
    const s = slotWorld(i);
    const look = new THREE.Vector3((s.x + restPos[i].x) * 0.5, 0.34, (s.z + restPos[i].z) * 0.5 + 0.10);
    return {
      look, pos: look.clone().add(new THREE.Vector3(0.22, 2.85, 3.95)), fov: 40, orbit: 0.05,
      fit: pointsAround(s, 0.52).concat(stampPoints(i)),
    };
  },
  action: (i) => {
    const s = slotWorld(i);
    const look = s.clone().add(new THREE.Vector3(-0.10, 0.10, 0.28));
    return {
      look, pos: look.clone().add(new THREE.Vector3(0.42, 1.55, 2.15)), fov: 36, orbit: 0.03,
      fit: pointsAround(s, 0.62).concat([s.clone().add(new THREE.Vector3(0, 1.25, 0))]),
    };
  },
  macro: (i) => {
    const s = slotWorld(i);
    const look = s.clone().add(new THREE.Vector3(-0.04, 0.04, 0.12));
    return {
      look, pos: look.clone().add(new THREE.Vector3(0.40, 0.98, 1.42)), fov: 32, orbit: 0.02,
      fit: pointsAround(s, 0.34),
    };
  },
  reveal: () => {
    const a = slotWorld(0), b = slotWorld(1);
    const look = a.clone().add(b).multiplyScalar(0.5).add(new THREE.Vector3(0, 0.06, 0.10));
    return {
      look, pos: look.clone().add(new THREE.Vector3(0.05, 2.30, 3.10)), fov: 36, orbit: 0.10,
      fit: pointsAround(a, 0.62).concat(pointsAround(b, 0.62), [
        look.clone().add(new THREE.Vector3(0.9, 1.25, -0.5)),   // 手紙が飛び立つ空
      ]),
    };
  },
};

/**
 * 画面の形に関係なく、見せたい点がすべて入るまでカメラを引く。
 * (縦持ちの iPhone でも主役が切れない)
 */
const _fitCam = new THREE.PerspectiveCamera();
function fitShot(shot) {
  shot.scale = 1;
  if (!shot.fit || !shot.fit.length) return shot;
  _fitCam.aspect = camera.aspect;
  _fitCam.fov = shot.fov;
  _fitCam.near = camera.near; _fitCam.far = camera.far;
  const off = shot.pos.clone().sub(shot.look);
  let scale = 1;
  for (let iter = 0; iter < 30; iter++) {
    let ok = true;
    for (const sign of [-1, 1]) {
      const a = sign * shot.orbit;
      const ca = Math.cos(a), sa = Math.sin(a);
      const dx = off.x * scale, dz = off.z * scale;
      _fitCam.position.set(
        shot.look.x + dx * ca - dz * sa,
        shot.look.y + off.y * scale,
        shot.look.z + dx * sa + dz * ca
      );
      _fitCam.lookAt(shot.look);
      _fitCam.updateMatrixWorld();
      _fitCam.updateProjectionMatrix();
      for (const p of shot.fit) {
        const v = p.clone().project(_fitCam);
        if (Math.abs(v.x) > 0.86 || Math.abs(v.y) > 0.88) { ok = false; break; }
      }
      if (!ok) break;
    }
    if (ok) break;
    scale *= 1.05;
  }
  shot.scale = scale;
  return shot;
}

const cam = {
  from: null, to: null, t: 1, dur: 1, orbitT: 0,
  go(shot, dur = 0.9) {
    fitShot(shot);
    this.from = {
      look: current.look.clone(), pos: current.pos.clone(),
      fov: current.fov, orbit: current.orbit, scale: current.scale,
    };
    this.to = shot;
    this.t = 0; this.dur = dur;
  },
};

const first = fitShot(shots.establish());
const current = {
  look: first.look.clone(), pos: first.pos.clone(),
  fov: first.fov, orbit: first.orbit, scale: first.scale,
};
cam.from = { ...current, look: current.look.clone(), pos: current.pos.clone() };
cam.to = first;

function easeInOut(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }

function updateCamera(dt) {
  cam.t = Math.min(1, cam.t + dt / cam.dur);
  const e = easeInOut(cam.t);
  current.pos.lerpVectors(cam.from.pos, cam.to.pos, e);
  current.look.lerpVectors(cam.from.look, cam.to.look, e);
  current.fov = cam.from.fov + (cam.to.fov - cam.from.fov) * e;
  current.orbit = cam.from.orbit + (cam.to.orbit - cam.from.orbit) * e;
  current.scale = cam.from.scale + (cam.to.scale - cam.from.scale) * e;

  // ゆっくりした回り込み: 平面的な絵ではないことを常に示す
  cam.orbitT += dt;
  const a = Math.sin(cam.orbitT * 0.24) * current.orbit;
  const z = current.scale;
  const dx = (current.pos.x - current.look.x) * z, dz = (current.pos.z - current.look.z) * z;
  const ca = Math.cos(a), sa = Math.sin(a);
  camera.position.set(
    current.look.x + dx * ca - dz * sa,
    current.look.y + (current.pos.y - current.look.y) * z + Math.sin(cam.orbitT * 0.31) * current.orbit * 0.35,
    current.look.z + dx * sa + dz * ca
  );
  camera.lookAt(current.look);
  if (Math.abs(camera.fov - current.fov) > 0.001) {
    camera.fov = current.fov;
    camera.updateProjectionMatrix();
  }
}

/* =========================================================
   入力 (1本指)
   ========================================================= */

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
// 指の位置は「紙の高さの平面」で拾う。高い位置の平面で拾うと、
// 見えている場所と押される場所がずれてしまう。
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const HOVER_Y = 0.62;      // ドラッグ中の印面の高さ (紙面から)
const FINGER_PUSH = 0.24;  // 指の少し奥に出す (指で印影が隠れないように)
const _camFwd = new THREE.Vector3();

let pointerActive = false;
let dragged = null;
let dragTarget = new THREE.Vector3();
let holdTimer = 0;
let lastDragPos = new THREE.Vector3();

function setPointer(e) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
}

function planeHit() {
  dragPlane.constant = -(envelope.position.y + ENV_T);
  raycaster.setFromCamera(pointer, camera);
  const p = new THREE.Vector3();
  return raycaster.ray.intersectPlane(dragPlane, p) ? p : null;
}

// 光線と印章の軸線分との最短距離 (指がずれていてもつかめるように)
const _segA = new THREE.Vector3(), _segB = new THREE.Vector3();
function nearStamp(s) {
  _segA.copy(s.position);
  _segB.copy(s.position).add(new THREE.Vector3(0, 1.1, 0));
  return Math.sqrt(raycaster.ray.distanceSqToSegment(_segA, _segB));
}

function onDown(e) {
  initAudio();
  if (audio && audio.state === 'suspended') audio.resume();
  if (state !== 'IDLE') return;
  setPointer(e);
  raycaster.setFromCamera(pointer, camera);

  const active = stamps[step];
  const other = stamps[1 - step];
  const hitActive = raycaster.intersectObject(active, true).length > 0;
  // 4歳児向けに判定を広く: 印章の軸のどこかに近ければつかめる
  const near = nearStamp(active) < 0.62;

  if (hitActive || near) {
    grab(active);
  } else if (raycaster.intersectObject(other, true).length > 0 || nearStamp(other) < 0.55) {
    other.userData.wiggle = 0.55;   // 「今はこっち」と伝えるやさしい反応
    sfx.nope();
  }
}

function onMove(e) {
  if (!pointerActive) return;
  setPointer(e);
}

function onUp() {
  if (!pointerActive) return;
  pointerActive = false;
  if (dragged) release();
}

canvas.addEventListener('pointerdown', (e) => {
  pointerActive = true;
  canvas.setPointerCapture?.(e.pointerId);
  onDown(e);
}, { passive: true });
canvas.addEventListener('pointermove', onMove, { passive: true });
canvas.addEventListener('pointerup', onUp, { passive: true });
canvas.addEventListener('pointercancel', onUp, { passive: true });
canvas.addEventListener('pointerleave', onUp, { passive: true });
window.addEventListener('contextmenu', e => e.preventDefault());

/* =========================================================
   ゲーム進行
   ========================================================= */

let state = 'IDLE';      // IDLE | DRAG | PRESS | FINALE
let step = 0;            // 0 = 特別日付印, 1 = 普通日付印
let press = null;
let finale = null;
let idleTime = 0;
const decals = [];

function grab(s) {
  dragged = s;
  s.scale.setScalar(1);
  state = 'DRAG';
  holdTimer = 0;
  s.userData.grabT = 0;
  lastDragPos.copy(s.position);
  cam.go(shots.align(step), 0.85);
  sfx.pick();
  cue.visible = false;
}

function acceptRadius() { return 1.05; }

function release() {
  const s = dragged;
  const target = slotWorld(step);
  const d = Math.hypot(s.position.x - target.x, s.position.z - target.z);
  if (d < acceptRadius()) {
    startPress(s, target);
  } else {
    // 外れたらそっと元の位置へ戻す (失敗として扱わない)
    state = 'IDLE';
    dragged = null;
    s.userData.returning = 0;
    s.userData.returnFrom = s.position.clone();
    cue.visible = true;
    cam.go(shots.establish(), 1.0);
  }
}

function startPress(s, target) {
  state = 'PRESS';
  // 位置は自動でスロットへ寄せる。ただし子どもの置き方が少し残る。
  const jitterX = THREE.MathUtils.clamp((s.position.x - target.x) * 0.35, -0.07, 0.07);
  const jitterZ = THREE.MathUtils.clamp((s.position.z - target.z) * 0.35, -0.07, 0.07);
  const at = new THREE.Vector3(target.x + jitterX, 0, target.z + jitterZ);
  press = {
    t: 0, stamp: s, at,
    startPos: s.position.clone(),
    startRot: s.rotation.clone(),
    roll: (Math.random() - 0.5) * 0.22,
    contacted: false, lifted: false, dent: null,
  };
  dragged = null;
  targetRing.material.opacity = 0;
  targetGlow.material.opacity = 0;
  cam.go(shots.action(step), 0.45);
}

/** 印影を「本物のデカール」として封筒(と切手)の表面に貼る */
function stampImpression(kind, at, roll) {
  const tex = impressionTexture(kind, Math.random() * 100);
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, reveal: { value: 0 }, opacity: { value: 1 } },
    vertexShader: revealVS, fragmentShader: revealFS,
    transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
  });

  const size = kind === 'special' ? 0.64 : 0.58;
  const proj = new THREE.Object3D();
  proj.up.set(0, 0, -1);
  const top = new THREE.Vector3(at.x, envelope.position.y + ENV_T + 0.004, at.z);
  proj.position.copy(top).add(new THREE.Vector3(0, 1, 0));
  proj.lookAt(top);
  proj.rotateZ(roll);
  proj.updateMatrixWorld();

  const made = [];
  const targets = [envelope.children[0]];
  if (envelope.userData.postage) targets.push(envelope.userData.postage);
  const inv = new THREE.Matrix4().copy(envelope.matrixWorld).invert();

  for (const t of targets) {
    let geo = null;
    try {
      geo = new DecalGeometry(t, top, proj.rotation, new THREE.Vector3(size, size, 0.16));
    } catch (err) { geo = null; }
    if (!geo || geo.attributes.position.count === 0) { geo?.dispose?.(); continue; }
    geo.applyMatrix4(inv);
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = 6;
    m.frustumCulled = false;
    envelope.add(m);
    made.push(m);
  }

  if (made.length === 0) {
    // 万一デカールが作れなくても印影は必ず出す (薄い実メッシュで代替)
    const m = createImpression(kind, Math.random() * 100);
    const l = envelope.worldToLocal(top.clone());
    m.position.set(l.x, ENV_T + 0.006, l.z);
    m.rotation.y = roll;
    envelope.add(m);
    made.push(m);
    return { meshes: made, mat: m.material };
  }
  return { meshes: made, mat };
}

// objects.js と同じリビールシェーダ (デカール用に再利用)
const revealVS = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const revealFS = /* glsl */`
uniform sampler2D map; uniform float reveal; uniform float opacity;
varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float nz(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
void main(){
  vec4 t = texture2D(map, vUv);
  if (t.a < 0.01) discard;
  float d = length(vUv - 0.5) * 2.0;
  float n = nz(vUv*9.0)*0.30 + nz(vUv*26.0)*0.10;
  float mask = smoothstep(reveal + 0.10, reveal - 0.18, d + n - 0.20);
  float a = t.a * mask * opacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(t.rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/* ---------- 押印のタイムライン ---------- */

const T_CONTACT = 0.20;
const T_REVEAL = 0.34;
const T_LIFT = 0.42;
const T_LIFT_END = 0.78;
const T_HOME = 1.45;
const DENT_MAX = 0.038;
const DENT_KEEP = 0.013;

function updatePress(dt) {
  const p = press;
  p.t += dt;
  const s = p.stamp;
  const topY = envelope.position.y + ENV_T;

  if (p.t < T_CONTACT) {
    const k = p.t / T_CONTACT;
    const e = k * k;                                  // ease-in で落とす
    s.position.x = THREE.MathUtils.lerp(p.startPos.x, p.at.x, Math.min(1, k * 1.6));
    s.position.z = THREE.MathUtils.lerp(p.startPos.z, p.at.z, Math.min(1, k * 1.6));
    s.position.y = THREE.MathUtils.lerp(p.startPos.y, topY - 0.004, e);
    s.rotation.x = THREE.MathUtils.lerp(p.startRot.x, 0, e);
    s.rotation.z = THREE.MathUtils.lerp(p.startRot.z, 0, e);
    s.rotation.y = p.roll;
    if (!p.zoomed && p.t / T_CONTACT > 0.55) { p.zoomed = true; cam.go(shots.macro(step), 0.42); }
  } else if (!p.contacted) {
    p.contacted = true;
    sfx.thunk();
    envelope.updateMatrixWorld();
    // 押し込みの瞬間に紙がたわみ、印影(デカール)を作る
    const local = envelope.worldToLocal(p.at.clone());
    p.dent = { x: local.x, z: local.z, depth: DENT_KEEP, radius: 0.34 };
    envelope.userData.dents.push(p.dent);
    deformEnvelope(envelope);          // 最終的に残る形の上にデカールを貼る
    p.imp = stampImpression(step === 0 ? 'special' : 'normal', p.at, p.roll);
    decals.push(p.imp);
  }

  if (p.contacted) {
    // 沈み込み: 接触直後に深く、離すとほぼ戻る
    const k = (p.t - T_CONTACT);
    let dent;
    if (k < 0.14) dent = DENT_MAX * (k / 0.14);
    else if (p.t < T_LIFT) dent = DENT_MAX;
    else dent = THREE.MathUtils.lerp(DENT_MAX, DENT_KEEP,
      Math.min(1, (p.t - T_LIFT) / (T_LIFT_END - T_LIFT)));
    if (Math.abs(dent - p.dent.depth) > 0.0008) {
      p.dent.depth = dent;
      deformEnvelope(envelope);
    }

    // 押し下げ中の微小な沈み込みと傾き
    if (p.t < T_LIFT) {
      const w = Math.min(1, k / 0.14);
      s.position.y = topY - 0.004 - dent * 0.85;
      s.rotation.z = Math.sin(k * 26) * 0.012 * (1 - w);
    }
  }

  // インクが移る: 印章が持ち上がるのに合わせて印影が現れる
  if (p.t >= T_REVEAL && p.imp) {
    const r = Math.min(1.35, (p.t - T_REVEAL) / 0.42 * 1.35);
    p.imp.mat.uniforms.reveal.value = r;
  }

  // 持ち上げ
  if (p.t >= T_LIFT && p.t < T_HOME) {
    if (!p.lifted) { p.lifted = true; sfx.lift(); }
    const k = Math.min(1, (p.t - T_LIFT) / (T_LIFT_END - T_LIFT));
    const e = 1 - Math.pow(1 - k, 3);
    s.position.y = THREE.MathUtils.lerp(topY - 0.004 - DENT_MAX * 0.85, topY + 0.55, e);
    s.rotation.z = THREE.MathUtils.lerp(s.rotation.z, 0.06 * (1 - e), 0.25);
  }

  // 置き台へ戻す
  if (p.t >= T_LIFT_END) {
    const k = Math.min(1, (p.t - T_LIFT_END) / (T_HOME - T_LIFT_END));
    const e = easeInOut(k);
    const home = s.userData.home;
    s.position.x = THREE.MathUtils.lerp(p.at.x, home.x, e);
    s.position.z = THREE.MathUtils.lerp(p.at.z, home.z, e);
    s.position.y = THREE.MathUtils.lerp(envelope.position.y + ENV_T + 0.55, home.y, e)
      + Math.sin(k * Math.PI) * 0.35;
    s.rotation.y = THREE.MathUtils.lerp(p.roll, 0, e);
    s.rotation.z = THREE.MathUtils.lerp(s.rotation.z, 0, 0.15);
    if (k === 1) endPress();
  }
}

function endPress() {
  const wasStep = step;
  press = null;
  step++;
  if (step >= 2) {
    startFinale();
  } else {
    state = 'IDLE';
    idleTime = 0;
    cue.visible = true;
    cam.go(shots.align(step), 1.0);
  }
}

/* ---------- 完成 (最終ピーク) ---------- */

function startFinale() {
  state = 'FINALE';
  cue.visible = false;
  finale = { t: 0, spawned: false, done: false, hist: [] };
  cam.go(shots.reveal(), 0.70);
  sfx.done();
}

const planeCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0.30, 0.30, 0.30),
  new THREE.Vector3(1.30, 0.85, -0.35),
  new THREE.Vector3(2.70, 1.75, -1.60),
  new THREE.Vector3(4.10, 3.05, -3.20),
  new THREE.Vector3(5.40, 4.60, -5.00),
]);

function updateFinale(dt) {
  const f = finale;
  f.t += dt;

  // 紙飛行機 (実メッシュ) が遠くへ飛ぶ。短く、控えめに。
  const ft = (f.t - 0.34) / 1.45;
  if (ft >= 0 && ft <= 1.02) {
    plane.visible = true;
    trail.visible = true;
    const pt = planeCurve.getPointAt(Math.min(0.999, Math.max(0, ft)));
    const nx = planeCurve.getPointAt(Math.min(0.999, Math.max(0, ft + 0.02)));
    plane.position.copy(pt);
    plane.lookAt(nx);
    plane.rotateY(-Math.PI / 2);
    plane.rotation.z += Math.sin(f.t * 9) * 0.12;
    // 近くで大きく現れ、遠ざかりながら小さく淡くなる = 「とおくへ行く」
    const sc = 1.95 * Math.min(1, ft * 7) * (1 - ft * 0.45);
    plane.scale.setScalar(sc);
    plane.userData.mat.opacity = ft > 0.7 ? Math.max(0, 1 - (ft - 0.7) / 0.3) : 1;
    if (ft < 0.05) sfx.whoosh();

    f.hist.unshift(pt.clone());
    if (f.hist.length > TRAIL) f.hist.length = TRAIL;
    for (let i = 0; i < f.hist.length; i++) {
      const h = f.hist[i];
      trailPos[i * 3] = h.x + (Math.random() - 0.5) * 0.05;
      trailPos[i * 3 + 1] = h.y + (Math.random() - 0.5) * 0.05;
      trailPos[i * 3 + 2] = h.z + (Math.random() - 0.5) * 0.05;
    }
    trailGeo.setDrawRange(0, f.hist.length);   // 貯まった分だけ描く
    trailGeo.attributes.position.needsUpdate = true;
    trailMat.opacity = 0.9 * Math.min(1, (1 - ft) * 2.2);
    trailMat.size = 0.22 * (1 - ft * 0.45);
  } else if (ft > 1.02) {
    plane.visible = false;
    trail.visible = false;
  }

  // 封筒を送り出し、次の封筒が届く
  if (f.t > 1.85) {
    const k = Math.min(1, (f.t - 1.85) / 0.7);
    const e = easeInOut(k);
    envelope.position.y = ENV_BASE_Y + e * 0.55;
    envelope.position.x = envHome.x - e * 3.4;
    envelope.position.z = envHome.z - e * 0.7;
    envelope.rotation.z = e * 0.20;
    envelope.rotation.y = -0.035 - e * 0.35;
  }
  if (f.t > 2.15 && !f.spawned) {
    f.spawned = true;
    cam.go(shots.establish(), 1.1);
    spawnNewEnvelope();
  }
  if (f.spawned) {
    const k = Math.min(1, (f.t - 2.15) / 0.85);
    const e = easeInOut(k);
    envelope.position.set(
      THREE.MathUtils.lerp(-3.3, envHome.x, e),
      THREE.MathUtils.lerp(ENV_BASE_Y + 0.22, envHome.y, e),
      THREE.MathUtils.lerp(1.15, envHome.z, e)
    );
    envelope.rotation.y = THREE.MathUtils.lerp(0.35, -0.035, e);
    envelope.rotation.z = THREE.MathUtils.lerp(0.06, 0, e);
    if (k === 1 && !f.done) {
      f.done = true;
      state = 'IDLE';
      step = 0;
      idleTime = 0;
      cue.visible = true;
    }
  }
}

function spawnNewEnvelope() {
  // 使い終わった封筒を破棄
  const old = envelope;
  world.remove(old);
  old.traverse(o => { if (o.isMesh) { o.geometry.dispose?.(); } });
  for (const d of decals) {
    d.mat?.uniforms?.map?.value?.dispose?.();
    d.mat?.dispose?.();
  }
  decals.length = 0;

  envelope = createEnvelope();
  envelope.position.set(-3.3, ENV_BASE_Y + 0.22, 1.15);
  envelope.rotation.y = 0.35;
  world.add(envelope);
}

/* =========================================================
   毎フレーム
   ========================================================= */

function updateDrag(dt) {
  const s = dragged;
  const hit = planeHit();
  const topY = envelope.position.y + ENV_T;
  if (hit) {
    // カメラから見て「奥 = 画面の上」へ少しずらす (カメラが動いても破綻しない)
    camera.getWorldDirection(_camFwd);
    _camFwd.y = 0;
    if (_camFwd.lengthSq() > 1e-6) _camFwd.normalize();
    dragTarget.copy(hit).addScaledVector(_camFwd, FINGER_PUSH);
    dragTarget.y = topY + HOVER_Y;
    // 机の上からはみ出さない
    dragTarget.x = THREE.MathUtils.clamp(dragTarget.x, -4.2, 4.2);
    dragTarget.z = THREE.MathUtils.clamp(dragTarget.z, -2.4, 2.5);

    // 押す場所に近づいたら磁石のように吸い付く (1mm 精度を要求しない)
    const t = slotWorld(step);
    const d = Math.hypot(dragTarget.x - t.x, dragTarget.z - t.z);
    if (d < 1.15) {
      const pull = (1 - d / 1.15) * 0.42;
      dragTarget.x += (t.x - dragTarget.x) * pull;
      dragTarget.z += (t.z - dragTarget.z) * pull;
    }
  }
  const k = 1 - Math.pow(0.001, dt);   // なめらかな追従
  s.position.lerp(dragTarget, k);

  // 進行方向へわずかに傾ける
  const vx = s.position.x - lastDragPos.x, vz = s.position.z - lastDragPos.z;
  s.rotation.z = THREE.MathUtils.lerp(s.rotation.z, THREE.MathUtils.clamp(-vx * 3.2, -0.28, 0.28), 0.15);
  s.rotation.x = THREE.MathUtils.lerp(s.rotation.x, THREE.MathUtils.clamp(vz * 3.2, -0.28, 0.28), 0.15);
  lastDragPos.copy(s.position);

  // 目標リング
  const t = slotWorld(step);
  targetRing.position.set(t.x, envelope.position.y + ENV_T + 0.012, t.z);
  targetGlow.position.copy(targetRing.position).setY(targetRing.position.y - 0.002);
  const d = Math.hypot(s.position.x - t.x, s.position.z - t.z);
  const inZone = d < acceptRadius();
  const pulse = 1 + Math.sin(clock.elapsedTime * 6) * (inZone ? 0.10 : 0.04);
  targetRing.scale.setScalar(pulse * (inZone ? 1.05 : 1));
  targetRing.material.opacity = THREE.MathUtils.lerp(
    targetRing.material.opacity, inZone ? 0.95 : 0.45, 0.15);
  targetGlow.material.opacity = THREE.MathUtils.lerp(
    targetGlow.material.opacity, inZone ? 0.55 : 0.18, 0.15);
  targetRing.material.color.setHex(step === 0 ? 0xff9d5c : 0x8fc4ff);
  targetGlow.material.color.setHex(step === 0 ? 0xffc98a : 0xbcdcff);

  // ゾーンに置いたまま静止していたら自動で押す (指を離せない子のため)
  if (inZone && Math.hypot(vx, vz) < 0.012) {
    holdTimer += dt;
    if (holdTimer > 0.55) { pointerActive = false; release(); }
  } else holdTimer = 0;
}

function updateCue(dt, time) {
  if (!cue.visible) {
    cueRing.material.opacity = 0;
    return;
  }
  const s = stamps[step];
  const bob = Math.sin(time * 3.0) * 0.09;
  cueArrow.position.set(s.position.x, 1.30 + bob, s.position.z);
  cueArrow.scale.setScalar(0.78 + Math.sin(time * 3.0) * 0.06);
  cueRing.position.set(s.position.x, 0.09, s.position.z);
  const rp = 1 + (Math.sin(time * 2.4) * 0.5 + 0.5) * 0.22;
  cueRing.scale.setScalar(rp);
  cueRing.material.opacity = 0.92 - (rp - 1) * 1.8;

  // 主役自身がゆっくり呼吸する (最強の無文字ヒント)
  s.scale.setScalar(1 + Math.sin(time * 3.0) * 0.022);

  // 2 個目からは控えめに (1 度体験した子には十分)
  const strength = step === 0 ? 1 : 0.72;
  cueMat.emissiveIntensity = (1.1 + Math.sin(time * 3.0) * 0.5) * strength;
}

function updateIdleStamps(dt) {
  for (const s of stamps) {
    if (s === dragged || (press && press.stamp === s)) continue;
    if (s.userData.wiggle > 0) {
      s.userData.wiggle -= dt;
      s.rotation.z = Math.sin(s.userData.wiggle * 40) * 0.10 * Math.max(0, s.userData.wiggle);
    } else if (s !== stamps[step] || state !== 'IDLE') {
      s.rotation.z += (0 - s.rotation.z) * 0.2;
      s.scale.setScalar(THREE.MathUtils.lerp(s.scale.x, 1, 0.15));
    }
    if (s.userData.returning !== undefined) {
      s.userData.returning += dt;
      const k = Math.min(1, s.userData.returning / 0.55);
      const e = easeInOut(k);
      s.position.lerpVectors(s.userData.returnFrom, s.userData.home, e);
      s.position.y += Math.sin(k * Math.PI) * 0.22;
      s.rotation.x *= 0.86; s.rotation.y *= 0.86;
      if (k === 1) {
        s.position.copy(s.userData.home);
        s.rotation.set(0, 0, 0);
        delete s.userData.returning;
        delete s.userData.returnFrom;
      }
    }
  }
}

/* ---------- 性能の自動調整 ---------- */

let frameAcc = 0, frameCount = 0, degraded = false;
function adaptQuality(dt) {
  frameAcc += dt; frameCount++;
  if (frameCount < 90) return;
  const avg = frameAcc / frameCount;
  frameAcc = 0; frameCount = 0;
  if (!degraded && avg > 0.026) {
    degraded = true;
    quality = 0.5;
    renderer.setPixelRatio(basePR());
    key.shadow.mapSize.set(512, 512);
    key.shadow.map?.dispose();
    key.shadow.map = null;
  }
}

const clock = new THREE.Clock();

function tick() {
  const dt = Math.min(0.05, clock.getDelta());
  const time = clock.elapsedTime;

  if (state === 'DRAG' && dragged) updateDrag(dt);
  else if (state === 'PRESS' && press) updatePress(dt);
  else if (state === 'FINALE' && finale) updateFinale(dt);

  if (state !== 'DRAG') {
    targetRing.material.opacity *= 0.86;
    if (!(state === 'IDLE' && idleTime > 5)) targetGlow.material.opacity *= 0.86;
  }

  if (state === 'IDLE') {
    idleTime += dt;
    // 5 秒以上さわられなければ「押す場所」もそっと光らせる
    if (idleTime > 5) {
      const t = slotWorld(step);
      targetGlow.position.set(t.x, envelope.position.y + ENV_T + 0.010, t.z);
      targetGlow.material.color.setHex(step === 0 ? 0xffc98a : 0xbcdcff);
      targetGlow.material.opacity = (Math.sin(time * 2.2) * 0.5 + 0.5) * 0.30;
    }
    // しばらく触られなければ、ぐっと引いた画から改めて誘導する
    if (idleTime > 11 && cam.t === 1) {
      cam.go(step === 0 ? shots.establish() : shots.align(step), 1.4);
      idleTime = 0;
    }
  }

  updateCue(dt, time);
  updateIdleStamps(dt);
  updateCamera(dt);
  adaptQuality(dt);

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

/* ---------- リサイズ ---------- */

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(basePR());
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // 縦持ちのスマホでも机全体が入るように画角を補正
  const portrait = h > w;
  camera.filmGauge = 35;
  camera.updateProjectionMatrix();
  scene.userData.portrait = portrait;
  // 画面の形が変わったら、いまのショットの「引き」を計算し直す
  if (cam.to) { fitShot(cam.to); current.scale = cam.t >= 1 ? cam.to.scale : current.scale; }
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));
resize();

/* ---------- 起動 ---------- */

/* ---------- 自動テスト用の小さなフック (進行には影響しない) ---------- */
function toScreen(v) {
  const p = v.clone().project(camera);
  const r = renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height };
}
const ndc = (v) => { const p = v.clone().project(camera); return [+p.x.toFixed(2), +p.y.toFixed(2)]; };
window.__probe = (i) => ({
  stamp: toScreen(stamps[i].position.clone().add(new THREE.Vector3(0, 0.7, 0))),
  slot: toScreen(slotWorld(i)),
  ndcStamp: ndc(stamps[i].position.clone().add(new THREE.Vector3(0, 0.7, 0))),
  ndcSlot: ndc(slotWorld(i)),
  ndcEnvL: ndc(envelope.localToWorld(new THREE.Vector3(-1.1, ENV_T, 0))),
  ndcEnvR: ndc(envelope.localToWorld(new THREE.Vector3(1.1, ENV_T, 0))),
});
window.__info = () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles });
window.__state = () => {
  let dist = null;
  if (dragged) { const t = slotWorld(step); dist = +Math.hypot(dragged.position.x - t.x, dragged.position.z - t.z).toFixed(3); }
  return { state, step, impressions: decals.length, dist, hold: +holdTimer.toFixed(2), camIdle: cam.t >= 1 };
};
window.__planeVis = () => ({ v: plane.visible, s: +plane.scale.x.toFixed(2), p: plane.position.toArray().map(n=>+n.toFixed(1)) });
window.__drop = (i) => {                      // 押印までを一気に実行 (テスト用)
  if (state !== 'IDLE' || i !== step) return false;
  grab(stamps[i]);
  const t = slotWorld(step);
  stamps[i].position.set(t.x + 0.18, envelope.position.y + ENV_T + HOVER_Y, t.z + 0.12);
  release();
  return true;
};

// 最初のフレームでシェーダをまとめてコンパイルしてから表示する
renderer.compile(scene, camera);
requestAnimationFrame(() => {
  document.body.classList.add('ready');
  tick();
});
