// ぺったん ふうけいいん — 好きな印を選んで、はがきに押して、集める。
import * as THREE from './three.js';
import { L, cardTopY, pressWorld, buildRoom, buildRack, buildPads, buildCollectShelf, buildLights, buildEnvironment } from './world.js';
import { buildStamp, refreshDieFace, setSquish } from './stamp.js';
import { createCard, applyImpression, activeCardPose } from './card.js';
import { CameraRig, v3 } from './camera.js';
import { Sparkles, Ripple, LandingMarker } from './fx.js';
import { after, track, killTag, updateAnim, Ease } from './anim.js';
import * as SFX from './audio.js';

const canvas = document.getElementById('gl');
const loaderEl = document.getElementById('loader');
const soundBtn = document.getElementById('sound');

// ---------------- レンダラ ----------------
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, powerPreference: 'high-performance', alpha: false,
  stencil: false,
});
let pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(pixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.00;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xc3b39c);
scene.fog = new THREE.Fog(0xbfae96, 85, 190);

const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 280);
const rig = new CameraRig(camera);

// ---------------- 世界 ----------------
const envTex = buildEnvironment(renderer);
scene.environment = envTex;

buildRoom(scene);
buildRack(scene);
buildCollectShelf(scene);
buildLights(scene);
const pads = buildPads(scene);

const stamps = [0, 1, 2, 3].map(i => buildStamp(i, scene));
const pickers = stamps.map(s => s.picker);

const sparkles = new Sparkles(scene);
const ripple = new Ripple(scene);
const marker = new LandingMarker(scene);

let activeCard = createCard(scene);
activeCardPose(activeCard);
const collected = [];

// ---------------- 画角 ----------------
const VIEWS = {
  table: () => ({ look: v3(0, 2.0, -2.0), pitch: 42, yaw: 5, fitW: 26, fitD: 41 }),
  carry: (x = 0) => ({ look: v3(x * 0.18, 1.4, 1.2), pitch: 41, yaw: 4, fitW: 24, fitD: 34 }),
  select: (x) => ({ look: v3(x * 0.6, 3.6, -4.4), pitch: 27, yaw: 4, fitW: 15, fitD: 17 }),
  aim: () => ({ look: v3(pressWorld.x + 0.3, 1.6, pressWorld.z + 0.8), pitch: 33, yaw: -8, fitW: 16, fitD: 19 }),
  press: () => ({ look: v3(pressWorld.x + 0.5, 1.0, pressWorld.z + 0.2), pitch: 19, yaw: -16, fitW: 10.5, fitD: 12 }),
  reveal: () => ({ look: v3(-0.8, 0.9, L.cardZ - 2.2), pitch: 42, yaw: -7, fitW: 15, fitD: 21 }),
  collect: () => ({ look: v3(0, 5.6, -19.5), pitch: 25, yaw: 4, fitW: 29, fitD: 24 }),
};

// ---------------- 状態 ----------------
const S = { INTRO: 'intro', IDLE: 'idle', CARRY: 'carry', PRESS: 'press', REVEAL: 'reveal', COLLECT: 'collect' };
let state = S.INTRO;
let held = null;              // 手に持っている印
let dragging = false;
let pointerDownAt = 0;
let pointerMoved = 0;
let idleTimer = 0;
let hintIndex = 0;
let pressCount = 0;
let overPad = -1;
let aiming = false;    // 押す場所の上にいる間だけ、そっと寄る

const landing = new THREE.Vector3(pressWorld.x, L.matTop, pressWorld.z);
const carryTarget = new THREE.Vector3();
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -L.matTop);
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

const HOVER = 4.6;            // ドラッグ中に印を浮かせる高さ
const FINGER_OFFSET = 2.7;    // 指より奥に印影の中心を出す

// ---------------- 入力 ----------------
function setNDC(e) {
  const r = canvas.getBoundingClientRect();
  ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
}

function pickStamp() {
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(pickers, false);
  if (hit.length) return stamps[pickers.indexOf(hit[0].object)];
  // はがきを触ったときは、印を横取りしない
  if (raycaster.intersectObject(activeCard.mesh, false).length) return null;
  // 当たらなくても、画面上でいちばん近い印を拾う（広めの当たり判定）
  let best = null, bestD = 0.30;   // NDC 距離
  for (const s of stamps) {
    if (s === held) continue;
    tmp.copy(s.group.position);
    tmp.y += 2.0;
    tmp.project(camera);
    const d = Math.hypot(tmp.x - ndc.x, (tmp.y - ndc.y) * 0.75);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

function planePoint(out) {
  raycaster.setFromCamera(ndc, camera);
  const p = raycaster.ray.intersectPlane(dragPlane, out);
  return p || null;
}

function updateLanding() {
  if (!planePoint(tmp2)) return;
  landing.set(
    THREE.MathUtils.clamp(tmp2.x, -13.5, 13.5),
    L.matTop,
    THREE.MathUtils.clamp(tmp2.z - FINGER_OFFSET, -8.5, 15.0)
  );
}

function onDown(e) {
  SFX.unlock();
  if (state === S.PRESS || state === S.REVEAL || state === S.COLLECT) return;
  canvas.setPointerCapture?.(e.pointerId);
  setNDC(e);
  pointerDownAt = performance.now();
  pointerMoved = 0;
  idleTimer = 0;

  const s = pickStamp();
  if (s && s !== held) {
    if (held) returnStamp(held);
    take(s);
    dragging = true;
    updateLanding();
    return;
  }
  if (held) {
    dragging = true;
    updateLanding();
    rig.set(VIEWS.carry(held.group.position.x), 2.2);
  }
}

function onMove(e) {
  if (!dragging || !held) return;
  const px = ndc.x, py = ndc.y;
  setNDC(e);
  pointerMoved += Math.hypot(ndc.x - px, ndc.y - py);
  updateLanding();
  idleTimer = 0;
}

function onUp() {
  const quick = performance.now() - pointerDownAt < 280 && pointerMoved < 0.04;
  dragging = false;
  if (!held || state !== S.CARRY) return;
  if (nearPress()) { doPress(); return; }
  if (quick) {
    // タップで選んだだけ：その印にゆるく寄って、じっくり見せる
    rig.set(VIEWS.select(held.group.position.x), 1.7);
    after(1.5, () => { if (state === S.CARRY && !dragging) rig.set(VIEWS.carry(held ? held.group.position.x : 0), 1.5); });
    return;
  }
  returnStamp(held);
}

function nearPress() {
  const dx = landing.x - pressWorld.x, dz = landing.z - pressWorld.z;
  return Math.hypot(dx, dz) < 7.6;
}

canvas.addEventListener('pointerdown', onDown, { passive: true });
canvas.addEventListener('pointermove', onMove, { passive: true });
canvas.addEventListener('pointerup', onUp, { passive: true });
canvas.addEventListener('pointercancel', () => { dragging = false; }, { passive: true });
window.addEventListener('contextmenu', e => e.preventDefault());

soundBtn.addEventListener('click', () => {
  SFX.unlock();
  const m = !SFX.isMuted();
  SFX.setMuted(m);
  soundBtn.classList.toggle('muted', m);
});

// ---------------- 動き ----------------
function take(s) {
  held = s;
  state = S.CARRY;
  aiming = false;
  killTag('home' + s.index);
  SFX.sfxPick();
  navigator.vibrate?.(8);
  rig.set(VIEWS.carry(s.group.position.x), 2.1);
  activeCard.guide.material.opacity = 0.0;
  const r0x = s.group.rotation.x, r0y = s.group.rotation.y;
  track(0.42, k => {
    s.group.rotation.x = THREE.MathUtils.lerp(r0x, 0, k);
    s.group.rotation.y = THREE.MathUtils.lerp(r0y, 0, k);
  }, { ease: Ease.outCubic, tag: 'lift' + s.index });
  landing.set(s.group.position.x * 0.4, L.matTop, -2.0);
}

function returnStamp(s) {
  aiming = false;
  if (held === s) held = null;
  if (state === S.CARRY) state = S.IDLE;
  const from = s.group.position.clone();
  const fx = s.group.rotation.x, fy = s.group.rotation.y;
  SFX.sfxPlace();
  track(0.55, k => {
    s.group.position.lerpVectors(from, s.home, k);
    s.group.position.y += Math.sin(k * Math.PI) * 2.2;
    s.group.rotation.x = THREE.MathUtils.lerp(fx, s.homeRot.x, k);
    s.group.rotation.y = THREE.MathUtils.lerp(fy, s.homeRot.y, k);
  }, { ease: Ease.inOutCubic, tag: 'home' + s.index });
  marker.hide();
  if (state === S.IDLE) rig.set(VIEWS.table(), 1.5);
}

function inkFromPad(padIndex) {
  const pad = pads[padIndex];
  held.inkRgb = pad.ink.rgb.slice();
  held.inkHex = pad.ink.hex;
  held.inkLevel = 1;
  refreshDieFace(held);
  SFX.sfxInk();
  navigator.vibrate?.(6);
  tmp.set(pad.group.position.x, L.padTop, pad.group.position.z);
  ripple.play(tmp, new THREE.Color(pad.ink.hex).getHex(), 1.4, 5.4, 0.5);
  sparkles.burst(tmp, 8, 1.2, 3.0, 0xffffff);
  track(0.34, k => {
    const sc = 1 - Math.sin(k * Math.PI) * 0.32;
    pad.surface.scale.y = sc;
    pad.surface.position.y = 0.24 + 0.17 * sc;   // 底は缶の中に置いたまま沈む
  }, { ease: Ease.inOutQuad, tag: 'pad' + padIndex });
}

function doPress() {
  state = S.PRESS;
  dragging = false;
  aiming = false;
  const s = held;
  const seed = Math.random();

  // 着地点：しっかり吸い付かせつつ、ほんの少しだけ手のゆらぎを残す
  const dx = THREE.MathUtils.clamp(landing.x - pressWorld.x, -1, 1) * 0.34;
  const dz = THREE.MathUtils.clamp(landing.z - pressWorld.z, -1, 1) * 0.34;
  const target = new THREE.Vector3(pressWorld.x + dx, cardTopY, pressWorld.z + dz);

  const decal = applyImpression(activeCard, s, seed);
  decal.position.x = L.pressLocal[0] + dx;
  decal.position.z = L.pressLocal[1] + dz;
  decal.scale.set(0.88, 1, 0.88);

  marker.hide();
  activeCard.guide.material.opacity = 0;
  rig.set(VIEWS.press(), 3.2);

  const from = s.group.position.clone();
  const fromRotX = s.group.rotation.x;
  const fromRotZ = s.group.rotation.z;
  const contactY = cardTopY - 0.02;

  track(0.30, k => {
    s.group.position.x = THREE.MathUtils.lerp(from.x, target.x, k);
    s.group.position.z = THREE.MathUtils.lerp(from.z, target.z, k);
    s.group.position.y = THREE.MathUtils.lerp(from.y, contactY, k);
    s.group.rotation.x = THREE.MathUtils.lerp(fromRotX, 0, k);
    s.group.rotation.z = THREE.MathUtils.lerp(fromRotZ, 0, k);
  }, { ease: Ease.inQuad, tag: 'press', onDone: () => contact(s, target, decal) });
}

function contact(s, target, decal) {
  SFX.sfxPress();
  navigator.vibrate?.([12, 20, 8]);
  const inkColor = new THREE.Color(s.inkHex).getHex();
  ripple.play(new THREE.Vector3(target.x, cardTopY, target.z), inkColor, 2.4, 8.5, 0.55);

  // ゴムが潰れる → 紙がすこし沈む
  track(0.12, k => {
    setSquish(s, 1 - 0.24 * k);
    s.group.position.y = (cardTopY - 0.02) - 0.05 * k;
    activeCard.group.position.y = (cardTopY - L.cardH / 2) - 0.022 * k;
  }, { ease: Ease.outQuad, tag: 'squish' });

  // 印影がにじみながら現れる
  track(0.46, k => {
    decal.material.opacity = Math.min(1, k * 1.15);
    const sc = 0.88 + 0.12 * Ease.outCubic(k);
    decal.scale.set(sc, 1, sc);
  }, { ease: Ease.outQuad, delay: 0.04, tag: 'bleed' });

  s.inkLevel = Math.max(0, s.inkLevel - 0.28);
  after(0.20, () => refreshDieFace(s));
  after(0.82, () => lift(s, decal));
}

function lift(s, decal) {
  state = S.REVEAL;
  rig.set(VIEWS.reveal(), 2.0);
  const y0 = s.group.position.y;
  track(0.22, k => {
    setSquish(s, 0.76 + 0.24 * k);
    activeCard.group.position.y = (cardTopY - L.cardH / 2) - 0.022 * (1 - k);
  }, { ease: Ease.outQuad });
  track(0.55, k => {
    s.group.position.y = y0 + (7.0 - y0) * Ease.outCubic(k);
    s.group.rotation.z = Math.sin(k * Math.PI * 2) * 0.05 * (1 - k);
    s.group.rotation.x = Math.sin(k * Math.PI * 1.4) * 0.06 * (1 - k);
  }, { ease: Ease.linear, tag: 'lift' });

  const glow = new THREE.Vector3();
  decal.getWorldPosition(glow);
  glow.y = cardTopY;
  after(0.34, () => {
    SFX.sfxReveal(pressCount % 5);
    sparkles.burst(glow, 22, 2.4, 5.6, 0xfff0cc);
  });
  after(0.72, () => {
    sparkles.burst(glow, 12, 3.4, 4.4,
      new THREE.Color(s.inkHex).lerp(new THREE.Color(0xffffff), 0.55).getHex());
  });
  pressCount++;
  after(2.05, () => finishCycle(s));
}

function finishCycle(s) {
  state = S.COLLECT;
  held = null;
  returnStampQuiet(s);
  collectCard(activeCard);
  rig.set(VIEWS.collect(), 1.7);

  after(0.30, () => {
    activeCard = createCard(scene);
    const c = activeCard;
    c.group.position.set(15.5, cardTopY - L.cardH / 2, L.cardZ + 8.5);
    c.group.rotation.set(0, -0.35, 0);
    c.guide.material.opacity = 0;
    SFX.sfxSlide();
    track(0.75, k => {
      c.group.position.x = THREE.MathUtils.lerp(15.5, 0, k);
      c.group.position.z = THREE.MathUtils.lerp(L.cardZ + 8.5, L.cardZ, k);
      c.group.rotation.y = THREE.MathUtils.lerp(-0.35, 0, k);
      c.group.position.y = (cardTopY - L.cardH / 2) + Math.sin(k * Math.PI) * 0.55;
    }, { ease: Ease.outCubic, delay: 0.45 });
  });

  after(1.55, () => {
    state = S.IDLE;
    idleTimer = 0;
    rig.set(VIEWS.table(), 1.5);
  });
}

function returnStampQuiet(s) {
  const from = s.group.position.clone();
  const fx = s.group.rotation.x, fy = s.group.rotation.y, fz = s.group.rotation.z;
  track(0.7, k => {
    s.group.position.lerpVectors(from, s.home, k);
    s.group.position.y += Math.sin(k * Math.PI) * 2.6;
    s.group.rotation.x = THREE.MathUtils.lerp(fx, s.homeRot.x, k);
    s.group.rotation.y = THREE.MathUtils.lerp(fy, s.homeRot.y, k);
    s.group.rotation.z = THREE.MathUtils.lerp(fz, 0, k);
  }, { ease: Ease.inOutCubic, delay: 0.1, tag: 'home' + s.index });
}

// ---------------- 集めたカード ----------------
const COLLECT_MAX = 9;
const TILT = 1.0;

function collectCard(card) {
  card.done = true;
  card.guide.visible = false;
  collected.push(card);
  SFX.sfxCollect();
  if (collected.length > COLLECT_MAX) {
    const old = collected.shift();
    const p0 = old.group.position.clone();
    track(0.5, k => {
      old.group.position.y = p0.y + k * 3;
      old.group.scale.setScalar(1 - k);
    }, { ease: Ease.inQuad, onDone: () => { scene.remove(old.group); } });
  }
  layoutCollection(card);
}

function layoutCollection(justAdded) {
  const n = collected.length;
  const spread = Math.min(3.5, 26 / Math.max(1, n));
  collected.forEach((c, i) => {
    const off = i - (n - 1) / 2;
    const tx = off * spread;
    const ty = L.matTop + 0.42 + 7.4 * Math.sin(TILT) + i * 0.035;
    const tz = L.collectZ - 7.4 * Math.cos(TILT) + i * 0.14;
    const ry = -off * 0.045;
    if (c === justAdded) {
      const p0 = c.group.position.clone();
      const r0 = c.group.rotation.clone();
      track(0.95, k => {
        const e = Ease.inOutCubic(k);
        c.group.position.x = THREE.MathUtils.lerp(p0.x, tx, e);
        c.group.position.z = THREE.MathUtils.lerp(p0.z, tz, e);
        c.group.position.y = THREE.MathUtils.lerp(p0.y, ty, e) + Math.sin(k * Math.PI) * 4.2;
        c.group.rotation.x = THREE.MathUtils.lerp(r0.x, TILT, e);
        c.group.rotation.y = THREE.MathUtils.lerp(r0.y, ry, e);
      }, { ease: Ease.linear, delay: 0.12, tag: 'col' + c.id });
      after(1.05, () => {
        tmp.set(tx, ty + 4, tz);
        sparkles.burst(tmp, 10, 2.4, 3.4, 0xfff4d6);
      });
    } else {
      const p0 = c.group.position.clone();
      const r0 = c.group.rotation.clone();
      track(0.6, k => {
        c.group.position.set(
          THREE.MathUtils.lerp(p0.x, tx, k),
          THREE.MathUtils.lerp(p0.y, ty, k),
          THREE.MathUtils.lerp(p0.z, tz, k));
        c.group.rotation.x = THREE.MathUtils.lerp(r0.x, TILT, k);
        c.group.rotation.y = THREE.MathUtils.lerp(r0.y, ry, k);
      }, { ease: Ease.inOutCubic, tag: 'col' + c.id });
    }
  });
}

// ---------------- 毎フレーム ----------------
function updateCarry(dt, t) {
  if (!held || state !== S.CARRY) return;

  // インクパッドの上に来たら、色を吸う
  let near = -1;
  for (let i = 0; i < pads.length; i++) {
    const p = pads[i].group.position;
    if (Math.hypot(landing.x - p.x, landing.z - p.z) < L.padR + 1.6) { near = i; break; }
  }
  if (near !== overPad) {
    overPad = near;
    if (near >= 0) inkFromPad(near);
  }

  const overPadNow = overPad >= 0;
  const hover = overPadNow ? (L.padTop - L.matTop) + 0.10 : HOVER;
  carryTarget.set(landing.x, L.matTop + hover + Math.sin(t * 5.2) * 0.10, landing.z);
  if (overPadNow) {
    carryTarget.x = pads[overPad].group.position.x;
    carryTarget.z = pads[overPad].group.position.z;
  }
  const k = 1 - Math.exp(-16 * dt);
  held.group.position.lerp(carryTarget, k);
  held.group.rotation.z += (Math.sin(t * 2.1) * 0.035 - held.group.rotation.z) * k;
  const tilt = overPadNow ? 0 : -0.17;   // 印面がすこしこちらを向く
  held.group.rotation.x += (tilt + Math.sin(t * 1.7) * 0.025 - held.group.rotation.x) * k;

  // インクが減ったら、合う色のパッドがそっと呼吸して知らせる
  const lowInk = held.inkLevel < 0.5;
  for (const p of pads) {
    const want = (lowInk && p.ink.hex === held.inkHex) ? 0.30 + Math.sin(t * 5.0) * 0.22 : 0;
    p.group.position.y += (p.baseY + want - p.group.position.y) * Math.min(1, dt * 8);
  }

  // 押す場所に近づいたら、接触が見えるところまで先に寄っておく
  const aimNow = !overPadNow && nearPress();
  if (aimNow !== aiming) {
    aiming = aimNow;
    rig.set(aimNow ? VIEWS.aim() : VIEWS.carry(held.group.position.x), 1.9);
  }

  // 降りる場所の光
  if (!overPadNow && nearPress()) {
    tmp.set(pressWorld.x, cardTopY, pressWorld.z);
    marker.show(tmp, new THREE.Color(held.inkHex).getHex(), 0.85, 6.4);
    activeCard.guide.material.opacity += (0.85 - activeCard.guide.material.opacity) * Math.min(1, dt * 6);
  } else if (!overPadNow) {
    tmp.set(landing.x, L.matTop, landing.z);
    marker.show(tmp, 0xffe9b8, 0.30, 4.6);
    activeCard.guide.material.opacity += (0.40 - activeCard.guide.material.opacity) * Math.min(1, dt * 5);
  } else {
    marker.hide();
  }
}

function updateIdle(dt, t) {
  // だれも触っていないとき、印がひとつずつ「ここだよ」と跳ねる
  if (state !== S.IDLE && state !== S.INTRO) return;
  idleTimer += dt;
  const g = activeCard.guide.material;
  // まだ一度も押していない子には、あたりを強めに見せる
  const lead = pressCount === 0 ? 0.78 : 0.46;
  const want = state === S.IDLE ? lead + Math.sin(t * 2.4) * 0.20 : 0;
  g.opacity += (want - g.opacity) * Math.min(1, dt * 3);

  if (state === S.IDLE && idleTimer > 2.6) {
    idleTimer = 0;
    const s = stamps[hintIndex % stamps.length];
    hintIndex++;
    if (s === held) return;
    const base = s.home.clone();
    track(0.7, k => {
      const b = Math.sin(k * Math.PI) * 1.5;
      s.group.position.set(base.x, base.y + b, base.z - b * 0.25);
    }, { ease: Ease.linear, tag: 'home' + s.index });
  }
}

function updateStampsIdle(t) {
  if (state !== S.IDLE && state !== S.INTRO) return;
  for (const s of stamps) {
    if (s === held) continue;
    // 立てかけてある印は、ほんのわずかに揺れる（生きている感じ）
    s.group.rotation.z = Math.sin(t * 0.9 + s.bobPhase) * 0.012;
  }
}

// ---------------- リサイズ・ループ ----------------
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  rig.recompute();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));
resize();

rig.set(VIEWS.table(), 1.2);
rig.snap();

// 少しだけ引いた位置から始めて、机全体をゆっくり見せる
rig.pos.set(rig.targetPos.x * 1.18, rig.targetPos.y * 1.35, rig.targetPos.z * 1.22);

let last = performance.now();
let fpsAcc = 0, fpsN = 0, fpsTimer = 0;

function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = now / 1000;

  updateAnim(dt);
  updateCarry(dt, t);
  updateIdle(dt, t);
  updateStampsIdle(t);
  sparkles.update(dt);
  ripple.update(dt);
  marker.update(dt);
  rig.update(dt);

  renderer.render(scene, camera);

  // 端末が苦しいときは解像度を静かに落とす
  fpsAcc += dt; fpsN++; fpsTimer += dt;
  if (fpsTimer > 2.5) {
    const fps = fpsN / fpsAcc;
    if (fps < 44 && pixelRatio > 1.05) {
      pixelRatio = Math.max(1, pixelRatio - 0.35);
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(window.innerWidth, window.innerHeight, false);
    }
    fpsAcc = 0; fpsN = 0; fpsTimer = 0;
  }
}
renderer.setAnimationLoop(loop);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) renderer.setAnimationLoop(null);
  else { last = performance.now(); renderer.setAnimationLoop(loop); }
});

// ---------------- 起動 ----------------
renderer.compile(scene, camera);
renderer.render(scene, camera);
after(0.1, () => {
  loaderEl.classList.add('hide');
  soundBtn.classList.add('ready');
});
after(1.6, () => { if (state === S.INTRO) { state = S.IDLE; idleTimer = 2.0; } });
window.__game = { scene, camera, renderer, stamps, pads, get state() { return state; } };
