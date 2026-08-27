import * as THREE from 'three';
import { HydroAudio } from './audio.js';
import { SnapInteractionController } from './interaction.js';
import {
  PLANT_LAYOUT,
  getPlantLayoutStats,
  validateMeasuredPlantLayout,
  validatePlantLayout,
} from './plant-layout.js';
import { RadialAssemblySystem } from './radial-assembly.js';
import { buildHydroWorld } from './world.js';

const TAU = Math.PI * 2;
const app = document.getElementById('app');
const audioToggle = document.getElementById('audio-toggle');
const replayButton = document.getElementById('replay');
const loader = document.getElementById('loader');

const canvas = document.createElement('canvas');
const webgl2 = canvas.getContext('webgl2', {
  alpha: false,
  antialias: false,
  depth: true,
  stencil: false,
  powerPreference: 'high-performance',
});
const rendererInfoExtension = webgl2?.getExtension('WEBGL_debug_renderer_info');
const rendererLabel = webgl2
  ? String(webgl2.getParameter(
    rendererInfoExtension?.UNMASKED_RENDERER_WEBGL ?? webgl2.RENDERER,
  ) || '')
  : '';
const softwareRenderer = /swiftshader|llvmpipe|software/i.test(rendererLabel);
const preferredPixelRatio = () => (softwareRenderer
  ? Math.min(window.devicePixelRatio || 1, .25)
  : Math.min(window.devicePixelRatio || 1, window.innerWidth <= 600 ? 1.25 : 1.5));
const renderer = new THREE.WebGLRenderer({
  canvas,
  context: webgl2 || undefined,
  antialias: false,
  alpha: false,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(preferredPixelRatio());
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = !softwareRenderer;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = softwareRenderer ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.03;
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, .08, 90);
const cameraLook = new THREE.Vector3();
const world = buildHydroWorld(scene, renderer, PLANT_LAYOUT);
const assembly = new RadialAssemblySystem({
  runnerGroup: world.runnerMount,
  statorGroup: world.statorMount,
  seed: 'hydro-powerhouse-v1',
});

// SwiftShader is useful for deterministic CI screenshots but physically based
// lighting is disproportionately expensive there. Preserve the authored PBR
// materials on GPU devices; in software WebGL2, mirror their live colour,
// opacity and emissive state into inexpensive unlit materials.
const softwareMaterialPairs = [];
if (softwareRenderer) {
  const replacements = new Map();
  const replaceMaterial = (source) => {
    if (!source?.isMeshStandardMaterial && !source?.isMeshPhysicalMaterial) return source;
    if (replacements.has(source)) return replacements.get(source);
    const material = new THREE.MeshBasicMaterial({
      color: source.color,
      map: source.map,
      transparent: source.transparent,
      opacity: source.opacity,
      alphaTest: source.alphaTest,
      depthTest: source.depthTest,
      depthWrite: source.depthWrite,
      side: source.side,
      blending: source.blending,
      wireframe: source.wireframe,
      vertexColors: source.vertexColors,
      toneMapped: false,
    });
    material.name = `${source.name || source.type}-software`;
    replacements.set(source, material);
    softwareMaterialPairs.push({ source, material });
    return material;
  };
  scene.traverse((object) => {
    if (!object.isMesh) return;
    object.material = Array.isArray(object.material)
      ? object.material.map(replaceMaterial)
      : replaceMaterial(object.material);
  });
}

function syncSoftwareMaterials() {
  for (const { source, material } of softwareMaterialPairs) {
    const intensity = Math.max(0, Number(source.emissiveIntensity) || 0);
    const lift = Math.min(.82, intensity * .24);
    material.color.copy(source.color);
    if (source.emissive && lift > 0) material.color.lerp(source.emissive, lift);
    material.opacity = source.opacity;
    material.transparent = source.transparent;
    material.wireframe = source.wireframe;
  }
}
const audio = new HydroAudio();
const interactions = new SnapInteractionController({ scene, camera, glowTexture: world.glowTexture });

const LANDSCAPE_SHOTS = Object.freeze({
  chooseDestination: { pos: [0, 3.3, 12.7], look: [0, 1.55, 3.15], up: [0, 1, 0], fov: 42 },
  runner: { pos: [0, 2.8, 9.4], look: [.35, 2.4, 1.12], up: [0, 1, 0], fov: 39 },
  stator: { pos: [5.6, 4.25, 8.3], look: [.15, 2.55, -.5], up: [0, 1, 0], fov: 43 },
  fluids: { pos: [5.9, 2.9, 7.5], look: [0, 1.7, 1.35], up: [0, 1, 0], fov: 43 },
  fluidsMacro: { pos: [-5.1, 2.4, 6.1], look: [-1.65, 1.45, 1.6], up: [0, 1, 0], fov: 39 },
  casing: { pos: [7.8, 5.6, 11.8], look: [.2, 3.75, .85], up: [0, 1, 0], fov: 49 },
  gate: { pos: [1.0, 5.2, 17.3], look: [.15, 3.0, -.6], up: [0, 1, 0], fov: 50 },
  generation: { pos: [5.4, 4.55, 13.6], look: [4.35, 2.45, -1.15], up: [0, 1, 0], fov: 46 },
  complete: { pos: [1.2, 4.9, 15.4], look: [.6, 2.7, -.4], up: [0, 1, 0], fov: 46 },
});

// Authored independently: portrait moves closer for assembly and much farther for
// the vertical reservoir -> turbine -> destination causality shot. It never widens
// a landscape camera as an aspect-ratio fallback.
const PORTRAIT_SHOTS = Object.freeze({
  chooseDestination: { pos: [0, 2.75, 20.0], look: [0, 1.7, 3.15], up: [0, 1, 0], fov: 47 },
  runner: { pos: [0, 3.0, 12.2], look: [0, 2.05, 1.15], up: [0, 1, 0], fov: 45 },
  stator: { pos: [4.35, 4.15, 10.8], look: [0, 2.15, -.52], up: [0, 1, 0], fov: 47 },
  fluids: { pos: [0, 3.2, 18.5], look: [0, 1.6, 1.35], up: [0, 1, 0], fov: 50 },
  fluidsMacro: { pos: [-4.0, 2.5, 8.2], look: [-1.85, 1.45, 1.65], up: [0, 1, 0], fov: 43 },
  casing: { pos: [2.0, 5.5, 22.5], look: [1.1, 3.8, .8], up: [0, 1, 0], fov: 50 },
  gate: { pos: [19.4, 14.0, 9.0], look: [.4, 3.0, .2], up: [-.06, .96, .29], fov: 45 },
  generation: { pos: [3.2, 4.8, 13.5], look: [4.6, 2.7, -1.55], up: [0, .94, .34], fov: 44 },
  complete: { pos: [24.34, 15.64, 6.73], look: [.78, 1.98, -.99], up: [.129, .899, .418], fov: 43 },
});

const state = {
  phase: 'loading',
  selectedDestination: null,
  inputEnabled: false,
  cameraBusy: 0,
  clock: 0,
  runnerPreviewSpeed: 0,
  phaseStartedAt: 0,
  lastInteractionAt: 0,
  fluidStep: 'oil',
  oilConnected: false,
  coolantConnected: false,
  oilLevel: 0,
  coolantFlow: 0,
  coolantStartedAt: 0,
  casingInstalled: false,
  casingAlignment: 0,
  casingLowering: 0,
  casingAttempts: 0,
  gateOpening: 0,
  gateHeld: false,
  gateDirection: 1,
  turbineSpeed: 0,
  power: 0,
  generationActive: false,
  transmissionProgress: 0,
  transmissionReached: false,
  finalSceneComplete: false,
  currentShot: 'chooseDestination',
  orientation: window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait',
  suspended: false,
};

const tweens = [];
const smooth = (value) => value * value * (3 - 2 * value);
const easeOut = (value) => 1 - Math.pow(1 - value, 3);

function tween(duration, update, { delay = 0, done = null, ease = smooth, tag = '' } = {}) {
  const item = { time: -delay, duration: Math.max(.001, duration), update, done, ease, tag };
  tweens.push(item);
  return item;
}

function schedule(delay, callback, tag = '') {
  return tween(.001, () => {}, { delay, done: callback, tag });
}

function updateTweens(dt) {
  for (let index = tweens.length - 1; index >= 0; index -= 1) {
    const item = tweens[index];
    item.time += dt;
    if (item.time < 0) continue;
    const raw = Math.min(1, item.time / item.duration);
    item.update(item.ease(raw), raw);
    if (raw >= 1) {
      tweens.splice(index, 1);
      item.done?.();
    }
  }
}

function removeTweens(tag) {
  let removed = 0;
  for (let index = tweens.length - 1; index >= 0; index -= 1) {
    if (tweens[index].tag === tag) {
      tweens.splice(index, 1);
      removed++;
    }
  }
  return removed;
}

function shotDefinition(name) {
  const dictionary = state.orientation === 'landscape' ? LANDSCAPE_SHOTS : PORTRAIT_SHOTS;
  return dictionary[name] || dictionary[state.phase] || dictionary.chooseDestination;
}

function applyShot(name, duration = .9, done = null) {
  state.currentShot = name;
  const target = shotDefinition(name);
  const toPosition = new THREE.Vector3(...target.pos);
  const toLook = new THREE.Vector3(...target.look);
  const toUp = new THREE.Vector3(...target.up).normalize();
  if (duration <= .01) {
    camera.position.copy(toPosition);
    cameraLook.copy(toLook);
    camera.up.copy(toUp);
    camera.fov = target.fov;
    camera.updateProjectionMatrix();
    camera.lookAt(cameraLook);
    done?.();
    return;
  }
  removeTweens('camera');
  // A superseded camera tween must never leave the input lock counter behind.
  state.cameraBusy = 0;
  const fromPosition = camera.position.clone();
  const fromLook = cameraLook.clone();
  const fromUp = camera.up.clone();
  const fromFov = camera.fov;
  state.cameraBusy += 1;
  tween(duration, (amount) => {
    camera.position.lerpVectors(fromPosition, toPosition, amount);
    cameraLook.lerpVectors(fromLook, toLook, amount);
    camera.up.lerpVectors(fromUp, toUp, amount).normalize();
    camera.fov = fromFov + (target.fov - fromFov) * amount;
    camera.updateProjectionMatrix();
  }, {
    tag: 'camera',
    ease: smooth,
    done: () => {
      state.cameraBusy = 0;
      done?.();
    },
  });
}

function setPhase(name, shotName, afterCamera = null, cameraDuration = .85) {
  state.phase = name;
  state.phaseStartedAt = state.clock;
  state.inputEnabled = false;
  interactions.clear();
  world.setPhase(name);
  audio.setMode(name === 'chooseDestination' ? 'choose' : name);
  applyShot(shotName || name, cameraDuration, () => {
    state.inputEnabled = true;
    state.lastInteractionAt = state.clock;
    afterCamera?.();
  });
}

function makeLoosePart(pools, centerY) {
  const group = new THREE.Group();
  for (const pool of Object.values(pools)) {
    const mesh = new THREE.Mesh(pool.geometry, pool.material);
    mesh.castShadow = false;
    mesh.position.y = -centerY;
    group.add(mesh);
  }
  group.scale.setScalar(.78);
  scene.add(group);
  return group;
}

const runnerLooseParts = Array.from({ length: 3 }, () => makeLoosePart(assembly.runnerPools, 1.05));
const statorLooseParts = Array.from({ length: 3 }, () => makeLoosePart(assembly.statorPools, 2.12));
runnerLooseParts.forEach((group) => { group.visible = false; group.rotation.z = -1.15; });
statorLooseParts.forEach((group) => { group.visible = false; group.rotation.z = -.55; group.scale.setScalar(.72); });

function layoutLooseParts() {
  if (state.orientation === 'landscape') {
    runnerLooseParts.forEach((part, index) => part.position.set(2.0 + index * .6, 1.3 + (index % 2) * .25, 2.15));
    statorLooseParts.forEach((part, index) => part.position.set(1.6 + index * .6, 1.4 + (index % 2) * .25, 2.0));
  } else {
    runnerLooseParts.forEach((part, index) => part.position.set(-1.1 + index * 1.1, .68, 2.1));
    statorLooseParts.forEach((part, index) => part.position.set(-1.0 + index, .65, 2.0));
  }
}
layoutLooseParts();
world.setOrientation(state.orientation);

function getSlotWorld(kind, slotIndex) {
  const total = kind === 'runner' ? 9 : 12;
  const radius = kind === 'runner' ? 1.22 : 2.12;
  const angle = -Math.PI / 2 + slotIndex / total * TAU;
  const local = new THREE.Vector3(-Math.sin(angle) * radius, Math.cos(angle) * radius, .12);
  const mount = kind === 'runner' ? world.runnerMount : world.statorMount;
  mount.updateWorldMatrix(true, false);
  return local.applyMatrix4(mount.matrixWorld);
}

function makeDragCallbacks(group, onSuccess) {
  let original = new THREE.Vector3();
  let grabbedScale = 1;
  return {
    onGrab(event) {
      original = group.position.clone();
      grabbedScale = group.scale.x;
      group.scale.multiplyScalar(1.08);
      group.userData.grabX = event.clientX;
      group.userData.grabY = event.clientY;
    },
    onDrag(event) {
      const distance = camera.position.distanceTo(group.position);
      const unit = Math.max(.0025, distance * .0011);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
      group.position.copy(original)
        .addScaledVector(right, event.dx * unit)
        .addScaledVector(up, -event.dy * unit);
    },
    onDrop() {
      group.scale.setScalar(grabbedScale);
      onSuccess();
    },
    onCancel() {
      group.scale.setScalar(grabbedScale);
      group.position.copy(original);
    },
  };
}

function targetWorldPosition(object, target = new THREE.Vector3()) {
  object.updateWorldMatrix(true, false);
  return object.getWorldPosition(target);
}

function enterDestinationChoice() {
  state.phase = 'chooseDestination';
  state.inputEnabled = false;
  world.setPhase('chooseDestination');
  audio.setMode('choose');
  applyShot('chooseDestination', .01);
  schedule(.25, () => {
    state.inputEnabled = true;
    const specs = Object.entries(world.destinationPickGroups).map(([kind, item]) => ({
      id: `destination:${kind}`,
      phase: 'chooseDestination',
      action: 'tap',
      position: targetWorldPosition(item.root),
      radius: 1.15,
      destination: kind,
      onTap: () => chooseDestination(kind),
    }));
    interactions.setTargets(specs);
  });
}

function chooseDestination(kind) {
  if (state.selectedDestination) return;
  state.selectedDestination = kind;
  state.inputEnabled = false;
  interactions.clear();
  world.setDestination(kind);
  audio.selectDestination(kind);
  const item = world.destinationPickGroups[kind].root;
  const startScale = item.scale.x;
  tween(.7, (amount) => item.scale.setScalar(startScale * (1 + Math.sin(amount * Math.PI) * .18)));
  schedule(1.0, enterRunner);
}

function enterRunner() {
  runnerLooseParts.forEach((part) => { part.visible = true; });
  statorLooseParts.forEach((part) => { part.visible = false; });
  setPhase('runner', 'runner', setRunnerTarget);
}

function setRunnerTarget() {
  const manualIndex = assembly.stats.runner.manualPlaced;
  if (manualIndex >= 3) return;
  const part = runnerLooseParts[manualIndex];
  const slot = assembly.nextRunnerSlot();
  const dropPosition = getSlotWorld('runner', slot);
  const callbacks = makeDragCallbacks(part, () => installManualRunner(part, slot));
  interactions.setTargets([{
    id: `runner:place:${manualIndex}`,
    phase: 'runner',
    action: 'drag',
    position: part.position,
    radius: .58,
    dropPosition,
    direction: 'toward-runner',
    ...callbacks,
  }]);
}

function installManualRunner(part, slot) {
  if (!part.visible || !state.inputEnabled) return;
  state.inputEnabled = false;
  interactions.clear();
  const sourceOffset = part.position.clone();
  world.runnerMount.worldToLocal(sourceOffset);
  assembly.placeRunnerBlade(slot, { sourceOffset, duration: .5 });
  audio.bladeSnap(slot, false);
  part.visible = false;
  schedule(.62, () => {
    if (assembly.stats.runner.manualPlaced < 3) {
      state.inputEnabled = true;
      setRunnerTarget();
    } else {
      assistRunner();
    }
  });
}

function assistRunner() {
  const sourceOffset = targetWorldPosition(world.robot);
  world.runnerMount.worldToLocal(sourceOffset);
  const assisted = assembly.assistRunnerCompletion({ stagger: .14, duration: .52, sourceOffset });
  assisted.forEach((slot, index) => schedule(index * .14 + .13, () => audio.bladeSnap(slot, true)));
  schedule(1.7, () => {
    state.runnerPreviewSpeed = 1.45;
    assembly.setRotationSpeed(1.45);
    world.setShaftSpeed?.(1.45);
    audio.bladeSnap(9, false);
  });
  schedule(2.65, () => {
    state.runnerPreviewSpeed = 0;
    assembly.setRotationSpeed(0);
    world.setShaftSpeed?.(0);
  });
  schedule(3.0, enterStator);
}

function enterStator() {
  world.setShaftSpeed?.(0);
  runnerLooseParts.forEach((part) => { part.visible = false; });
  statorLooseParts.forEach((part) => { part.visible = true; });
  setPhase('stator', 'stator', setStatorTarget);
}

function setStatorTarget() {
  const manualIndex = assembly.stats.stator.manualPlaced;
  if (manualIndex >= 3) return;
  const part = statorLooseParts[manualIndex];
  const slot = assembly.nextStatorSlot();
  const dropPosition = getSlotWorld('stator', slot);
  const callbacks = makeDragCallbacks(part, () => installManualStator(part, slot));
  interactions.setTargets([{
    id: `stator:place:${manualIndex}`,
    phase: 'stator',
    action: 'drag',
    position: part.position,
    radius: .66,
    dropPosition,
    direction: 'toward-stator',
    ...callbacks,
  }]);
}

function installManualStator(part, slot) {
  if (!part.visible || !state.inputEnabled) return;
  state.inputEnabled = false;
  interactions.clear();
  const sourceOffset = part.position.clone();
  world.statorMount.worldToLocal(sourceOffset);
  assembly.placeStatorCoil(slot, { sourceOffset, duration: .54 });
  audio.coilSnap(slot, false);
  part.visible = false;
  schedule(.68, () => {
    if (assembly.stats.stator.manualPlaced < 3) {
      state.inputEnabled = true;
      setStatorTarget();
    } else {
      assistStator();
    }
  });
}

function assistStator() {
  const sourceOffset = targetWorldPosition(world.technician);
  world.statorMount.worldToLocal(sourceOffset);
  const assisted = assembly.assistStatorCompletion({ stagger: .11, duration: .5, sourceOffset });
  assisted.forEach((slot, index) => schedule(index * .11 + .12, () => audio.coilSnap(slot, true)));
  schedule(1.9, () => {
    world.materials.copper.emissiveIntensity = .35;
    enterFluids();
  });
}

function enterFluids() {
  statorLooseParts.forEach((part) => { part.visible = false; });
  state.fluidStep = state.oilConnected ? 'coolant' : 'oil';
  setPhase('fluids', 'fluids', setFluidTarget);
}

function hoseTargetPosition(kind) {
  return kind === 'oil' ? world.oilHose.end : world.coolantHose.end;
}

function hoseDropPosition(kind) {
  return kind === 'oil' ? world.oilPort : world.coolantPort;
}

function setFluidTarget() {
  const kind = state.fluidStep;
  const hose = kind === 'oil' ? world.oilHose : world.coolantHose;
  let original = hose.end.clone();
  interactions.setTargets([{
    id: `fluid:${kind}`,
    phase: 'fluids',
    action: 'drag',
    position: hoseTargetPosition(kind),
    radius: .48,
    dropPosition: hoseDropPosition(kind),
    direction: 'connect',
    onGrab: () => { original = hose.end.clone(); },
    onDrag: (event) => {
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
      const end = original.clone().addScaledVector(right, event.dx * .007).addScaledVector(up, -event.dy * .007);
      world.moveHose(kind, end);
    },
    onDrop: () => connectFluid(kind),
    onCancel: () => world.moveHose(kind, original),
  }]);
}

function connectFluid(kind) {
  state.inputEnabled = false;
  interactions.clear();
  world.connectHose(kind);
  audio.hoseConnect(kind);
  audio.fluidFlow(kind);
  if (kind === 'oil') {
    state.oilConnected = true;
    tween(1.8, (amount) => { state.oilLevel = easeOut(amount); });
    applyShot('fluidsMacro', .65);
    schedule(2.1, () => applyShot('fluids', .65, () => {
      state.fluidStep = 'coolant';
      state.inputEnabled = true;
      setFluidTarget();
    }));
  } else {
    state.coolantConnected = true;
    state.coolantStartedAt = state.clock;
    tween(1.55, (amount) => { state.coolantFlow = easeOut(amount); });
    schedule(2.15, enterCasing);
  }
}

function enterCasing() {
  world.setCasingPosition(4.3, 6.45, .8);
  state.casingAlignment = .07;
  state.casingLowering = 0;
  state.casingAttempts = 0;
  setPhase('casing', 'casing', setCasingTarget, 1.0);
}

function setCasingTarget() {
  const casingPosition = world.hangingCasing.position;
  const dropPosition = new THREE.Vector3(0, 2.55, 1.5);
  let originalX = casingPosition.x;
  interactions.setTargets([{
    id: 'casing:align',
    phase: 'casing',
    action: 'drag',
    position: casingPosition,
    radius: 1.3,
    dropPosition,
    direction: 'horizontal-then-down',
    onGrab: () => { originalX = casingPosition.x; audio.casingMove(); },
    onDrag: (event) => {
      let x = THREE.MathUtils.clamp(originalX + event.dx * .014, -3.1, 3.1);
      if (Math.abs(x) < 1.35) x *= .16;
      world.setCasingPosition(x, 6.45, .8);
      state.casingAlignment = 1 - Math.min(1, Math.abs(x) / 3.1);
    },
    onDrop: () => {
      if (Math.abs(world.hangingCasing.position.x) <= 2.1 || state.casingAttempts >= 2) {
        installCasing();
        return;
      }
      state.casingAttempts++;
      state.inputEnabled = false;
      interactions.clear();
      const startX = world.hangingCasing.position.x;
      const guidedX = Math.sign(startX || 1) * Math.min(1.25, Math.abs(startX) * .52);
      tween(.42, (amount) => {
        const x = THREE.MathUtils.lerp(startX, guidedX, amount);
        world.setCasingPosition(x, 6.45, .8);
        state.casingAlignment = 1 - Math.min(1, Math.abs(x) / 3.1);
      }, { done: () => { state.inputEnabled = true; setCasingTarget(); } });
    },
    onCancel: () => world.setCasingPosition(originalX, 6.45, .8),
  }]);
}

function installCasing() {
  state.inputEnabled = false;
  interactions.clear();
  const fromX = world.hangingCasing.position.x;
  const fromY = world.hangingCasing.position.y;
  const fromZ = world.hangingCasing.position.z;
  tween(1.55, (amount) => {
    // Centre the suspended shell first, then lower it around the runner. This
    // keeps the actual swept load clear until it enters the allowed install envelope.
    const align = smooth(Math.min(1, amount / .38));
    const lower = amount <= .38 ? 0 : easeOut((amount - .38) / .62);
    const x = THREE.MathUtils.lerp(fromX, 0, align);
    const y = THREE.MathUtils.lerp(fromY, 2.55, lower);
    const z = THREE.MathUtils.lerp(fromZ, 1.5, lower);
    world.setCasingPosition(x, y, z);
    state.casingAlignment = 1 - Math.min(1, Math.abs(x) / 3.1);
    state.casingLowering = amount;
  }, {
    done: () => {
      world.installCasing();
      state.casingInstalled = true;
      state.casingAlignment = 1;
      state.casingLowering = 1;
      audio.casingLock();
      schedule(.9, enterGate);
    },
  });
}

const gateTargetPosition = new THREE.Vector3();
const gateUpPosition = new THREE.Vector3();
const gateDownPosition = new THREE.Vector3();

function updateGateTargetPositions() {
  targetWorldPosition(world.gateHandle, gateTargetPosition);
  gateUpPosition.copy(gateTargetPosition).add(new THREE.Vector3(0, 1.4, 0));
  gateDownPosition.copy(gateTargetPosition).add(new THREE.Vector3(0, -1.4, 0));
}

function enterGate() {
  state.generationActive = false;
  setPhase('gate', 'gate', setGateOpeningTarget, 1.05);
}

function beginGateHold(direction = 1) {
  state.gateHeld = true;
  state.gateDirection = direction;
  audio.gateTouch();
}

function endGateHold() {
  state.gateHeld = false;
}

function setGateOpeningTarget() {
  updateGateTargetPositions();
  interactions.setTargets([{
    id: 'gate:open',
    phase: state.phase,
    action: 'hold',
    position: gateTargetPosition,
    radius: .68,
    holdMs: 5600,
    direction: 'press-and-hold',
    onHold: () => beginGateHold(1),
    onRelease: endGateHold,
  }]);
}

function enterGeneration() {
  if (state.phase !== 'gate') return;
  state.phase = 'generation';
  state.phaseStartedAt = state.clock;
  state.generationActive = true;
  world.setPhase('generation');
  audio.setMode('generation');
  audio.transmission();
  setGateOpeningTarget();
  schedule(.65, () => {
    if (state.phase === 'generation') {
      interactions.clear();
      applyShot('generation', 1.25);
    }
  });
}

function enterComplete() {
  if (state.finalSceneComplete) return;
  state.phase = 'complete';
  state.phaseStartedAt = state.clock;
  state.finalSceneComplete = true;
  state.generationActive = true;
  state.gateHeld = false;
  state.inputEnabled = false;
  interactions.clear();
  world.setPhase('complete');
  audio.setMode('complete');
  audio.destinationOn(state.selectedDestination);
  applyShot('complete', 1.0, () => {
    state.inputEnabled = true;
    replayButton.classList.add('show');
    replayButton.setAttribute('aria-hidden', 'false');
    setFinalGateTargets();
  });
}

function setFinalGateTargets() {
  updateGateTargetPositions();
  interactions.setTargets([
    {
      id: 'gate:decrease', phase: 'complete', action: 'hold', position: gateDownPosition,
      radius: .52, holdMs: 2400, direction: 'down',
      onHold: () => beginGateHold(-1), onRelease: endGateHold,
    },
    {
      id: 'gate:increase', phase: 'complete', action: 'hold', position: gateUpPosition,
      radius: .52, holdMs: 2400, direction: 'up',
      onHold: () => beginGateHold(1), onRelease: endGateHold,
    },
  ]);
}

function replayRectTarget() {
  if (!state.finalSceneComplete) return null;
  const rect = replayButton.getBoundingClientRect();
  return {
    id: 'replay', phase: 'complete', action: 'tap', drag: false,
    x: rect.left + rect.width / 2, y: rect.top + rect.height / 2,
    rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    dropX: null, dropY: null, dropRect: null, holdMs: 0, direction: null, destination: null,
  };
}

let activePointer = null;
let activeSpec = null;
let pointerStartX = 0;
let pointerStartY = 0;
const pointerNdc = new THREE.Vector2();

function eventToNdc(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNdc.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  return pointerNdc;
}

renderer.domElement.addEventListener('pointerdown', (event) => {
  if (activePointer !== null || !state.inputEnabled || state.cameraBusy > 0) return;
  activePointer = event.pointerId;
  renderer.domElement.setPointerCapture?.(event.pointerId);
  audio.unlock();
  state.lastInteractionAt = state.clock;
  pointerStartX = event.clientX;
  pointerStartY = event.clientY;
  activeSpec = interactions.pick(eventToNdc(event));
  if (!activeSpec) {
    audio.tap();
    return;
  }
  const payload = { clientX: event.clientX, clientY: event.clientY, dx: 0, dy: 0, originalEvent: event };
  if (activeSpec.action === 'tap') activeSpec.onTap?.(payload);
  else if (activeSpec.action === 'drag') activeSpec.onGrab?.(payload);
  else if (activeSpec.action === 'hold') activeSpec.onHold?.(payload);
});

renderer.domElement.addEventListener('pointermove', (event) => {
  if (event.pointerId !== activePointer || !activeSpec || activeSpec.action !== 'drag') return;
  activeSpec.onDrag?.({
    clientX: event.clientX,
    clientY: event.clientY,
    dx: event.clientX - pointerStartX,
    dy: event.clientY - pointerStartY,
    originalEvent: event,
  });
});

function finishPointer(event, cancelled = false) {
  if (event.pointerId !== activePointer) return;
  const spec = activeSpec;
  if (spec?.action === 'drag') {
    if (cancelled) spec.onCancel?.({ originalEvent: event });
    else spec.onDrop?.({ originalEvent: event });
  }
  if (spec?.action === 'hold') spec.onRelease?.({ originalEvent: event });
  renderer.domElement.releasePointerCapture?.(event.pointerId);
  activePointer = null;
  activeSpec = null;
  state.lastInteractionAt = state.clock;
}

renderer.domElement.addEventListener('pointerup', finishPointer);
renderer.domElement.addEventListener('pointercancel', (event) => finishPointer(event, true));

audioToggle.addEventListener('click', (event) => {
  event.stopPropagation();
  audio.unlock();
  const muted = audio.toggleMuted();
  audioToggle.classList.toggle('muted', muted);
  audioToggle.setAttribute('aria-pressed', String(muted));
  audioToggle.setAttribute('aria-label', muted ? 'おとを だす' : 'おとを けす');
});

replayButton.addEventListener('click', (event) => {
  event.stopPropagation();
  window.location.reload();
});

function smoothstep(edge0, edge1, value) {
  const amount = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function updateGeneration(dt) {
  if (state.gateHeld && ['gate', 'generation', 'complete'].includes(state.phase)) {
    const rate = state.phase === 'complete' ? .28 : .18;
    state.gateOpening = THREE.MathUtils.clamp(state.gateOpening + state.gateDirection * rate * dt, .08, 1);
  }
  const targetSpeed = smoothstep(.1, .9, state.gateOpening);
  state.turbineSpeed += (targetSpeed - state.turbineSpeed) * (1 - Math.exp(-dt * 1.72));
  state.power = smoothstep(.25, .92, state.turbineSpeed);
  if (['gate', 'generation', 'complete'].includes(state.phase)) {
    assembly.setNormalizedSpeed(state.turbineSpeed, 8.1);
    world.setShaftSpeed?.(state.turbineSpeed * 8.1);
    assembly.setPowerGlow(state.power);
  }
  audio.updateGeneration({ gate: state.gateOpening, speed: state.turbineSpeed, power: state.power });

  if (state.phase === 'gate' && state.gateOpening >= .82 && state.turbineSpeed >= .7) enterGeneration();
  if (state.phase === 'generation') {
    state.transmissionProgress = Math.min(1, state.transmissionProgress + dt * (.18 + state.power * .24));
    if (state.transmissionProgress >= 1 && !state.transmissionReached) {
      state.transmissionReached = true;
      schedule(.7, enterComplete);
    }
  }
}

function projectWorld(position) {
  const projected = position.clone().project(camera);
  const x = (projected.x * .5 + .5) * window.innerWidth;
  const y = (-projected.y * .5 + .5) * window.innerHeight;
  const visible = projected.z >= -1 && projected.z <= 1;
  return {
    x: +x.toFixed(2),
    y: +y.toFixed(2),
    visible,
    inFrame: visible && x >= 8 && y >= 8
      && x <= window.innerWidth - 8 && y <= window.innerHeight - 8,
  };
}

function projectObjectCenter(object) {
  object.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(object, true);
  if (bounds.isEmpty()) return projectWorld(targetWorldPosition(object));
  return projectWorld(bounds.getCenter(new THREE.Vector3()));
}

function compositionSnapshot() {
  const reservoir = targetWorldPosition(world.reservoir);
  const turbine = targetWorldPosition(world.machine);
  const generator = targetWorldPosition(world.generatorShell);
  const grid = targetWorldPosition(world.destinationStage);
  return {
    orientation: state.orientation,
    landmarks: {
      reservoir: projectWorld(reservoir),
      turbine: projectWorld(turbine),
      generator: projectWorld(generator),
      grid: projectWorld(grid),
    },
    actionLandmarks: {
      oilGlass: projectObjectCenter(world.oilGlass),
      coolingTube: projectObjectCenter(world.coolingTube),
      craneBridge: projectObjectCenter(world.craneBridge),
      casingLoad: projectObjectCenter(world.hangingCasing),
      casingTarget: projectObjectCenter(world.casingTarget),
      gateHandle: projectObjectCenter(world.gateHandle),
    },
  };
}

function rendererSnapshot() {
  const info = renderer.info;
  return {
    calls: info.render.calls,
    triangles: info.render.triangles,
    points: info.render.points,
    lines: info.render.lines,
    pixelRatio: renderer.getPixelRatio(),
    webgl2: Boolean(renderer.capabilities.isWebGL2),
    geometries: info.memory.geometries,
    textures: info.memory.textures,
    drawingBufferWidth: renderer.domElement.width,
    drawingBufferHeight: renderer.domElement.height,
    canvasClientWidth: renderer.domElement.clientWidth,
    canvasClientHeight: renderer.domElement.clientHeight,
    backend: softwareRenderer ? 'software-webgl2' : 'hardware-webgl2',
    rendererLabel,
    memory: { geometries: info.memory.geometries, textures: info.memory.textures },
    scene: world.stats(),
  };
}

const layoutStats = getPlantLayoutStats(PLANT_LAYOUT);
const layoutIssues = validatePlantLayout(PLANT_LAYOUT);

const debugApi = {};
Object.defineProperties(debugApi, {
  phase: { enumerable: true, get: () => state.phase },
  busy: { enumerable: true, get: () => state.cameraBusy > 0 || !state.inputEnabled },
  selectedDestination: { enumerable: true, get: () => state.selectedDestination },
  destination: { enumerable: true, get: () => state.selectedDestination },
  runner: { enumerable: true, get: () => Object.freeze({
    ...assembly.stats.runner,
    previewAngularSpeed: +state.runnerPreviewSpeed.toFixed(3),
    rotationAngle: +assembly.runnerRotor.rotation.z.toFixed(4),
  }) },
  stator: { enumerable: true, get: () => Object.freeze({ ...assembly.stats.stator }) },
  fluids: { enumerable: true, get: () => Object.freeze({
    step: state.fluidStep,
    oilConnected: state.oilConnected,
    coolantConnected: state.coolantConnected,
    oilLevel: +state.oilLevel.toFixed(3),
    coolantFlow: +state.coolantFlow.toFixed(3),
    bubbles: state.coolantConnected ? Math.max(0, Math.ceil(10 - (state.clock - state.coolantStartedAt) * 2.2)) : 0,
    bubblesRemaining: state.coolantConnected ? Math.max(0, Math.ceil(10 - (state.clock - state.coolantStartedAt) * 2.2)) : 0,
  }) },
  casing: { enumerable: true, get: () => Object.freeze({
    installed: state.casingInstalled,
    alignment: +state.casingAlignment.toFixed(3),
    loweringProgress: +state.casingLowering.toFixed(3),
  }) },
  gate: { enumerable: true, get: () => Object.freeze({ opening: +state.gateOpening.toFixed(4), held: state.gateHeld }) },
  turbine: { enumerable: true, get: () => Object.freeze({
    normalizedSpeed: +state.turbineSpeed.toFixed(4), speed: +state.turbineSpeed.toFixed(4),
  }) },
  generation: { enumerable: true, get: () => Object.freeze({
    active: state.generationActive && state.power > .03,
    commissioned: state.generationActive,
    normalizedPower: +state.power.toFixed(4),
    power: +state.power.toFixed(4),
    transmissionProgress: +state.transmissionProgress.toFixed(4),
    transmissionReached: state.transmissionReached,
    pulseReached: state.transmissionReached,
    arrivedDestination: state.transmissionReached ? state.selectedDestination : null,
    destinationEffects: world.destinationStats(),
  }) },
  destinationEffects: { enumerable: true, get: () => world.destinationStats() },
  transmissionReached: { enumerable: true, get: () => state.transmissionReached },
  finalSceneComplete: { enumerable: true, get: () => state.finalSceneComplete },
  complete: { enumerable: true, get: () => state.finalSceneComplete },
  replayVisible: { enumerable: true, get: () => replayButton.classList.contains('show') },
  audio: { enumerable: true, get: () => Object.freeze(audio.stats) },
  renderer: { enumerable: true, get: () => Object.freeze(rendererSnapshot()) },
  camera: { enumerable: true, get: () => Object.freeze({
    shot: state.currentShot,
    fov: +camera.fov.toFixed(2),
    orientation: state.orientation,
    position: camera.position.toArray().map((value) => +value.toFixed(2)),
    look: cameraLook.toArray().map((value) => +value.toFixed(2)),
  }) },
  composition: { enumerable: true, get: () => Object.freeze(compositionSnapshot()) },
  layout: { enumerable: true, get: () => Object.freeze({ ...layoutStats, validationIssues: [...layoutIssues] }) },
  validation: { enumerable: true, get: () => {
    const measured = validateMeasuredPlantLayout(world.spatialSnapshot(), PLANT_LAYOUT);
    return Object.freeze({
      layoutIssues: [...layoutIssues],
      assemblyIssues: [...assembly.stats.validationIssues],
      worldIssues: measured.issues,
      worldMeasurements: measured.measurements,
    });
  } },
  diagnostics: { enumerable: true, get: () => Object.freeze({
    inputEnabled: state.inputEnabled,
    cameraBusy: state.cameraBusy,
    activePointer: activePointer !== null,
    tweenTags: tweens.map((item) => item.tag || 'untagged'),
  }) },
  suspended: { enumerable: true, get: () => state.suspended },
});
debugApi.targets = () => {
  if (state.cameraBusy > 0 || !state.inputEnabled) return [];
  const targets = interactions.screenTargets();
  const replay = replayRectTarget();
  if (replay) targets.push(replay);
  return targets;
};
Object.freeze(debugApi);
Object.defineProperty(window, '__hydro', {
  value: debugApi,
  configurable: false,
  enumerable: false,
  writable: false,
});

function handleResize() {
  const nextOrientation = window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait';
  state.orientation = nextOrientation;
  world.setOrientation(nextOrientation);
  camera.aspect = window.innerWidth / window.innerHeight;
  renderer.setPixelRatio(preferredPixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  layoutLooseParts();
  const interruptedPhaseTransition = state.cameraBusy > 0 && !state.inputEnabled;
  removeTweens('camera');
  state.cameraBusy = 0;
  applyShot(state.currentShot, .01);
  // A rotation is an immediate reframe. If it interrupts phase entry, rebuild
  // that phase's target instead of waiting for a discarded camera callback.
  if (interruptedPhaseTransition) {
    state.inputEnabled = true;
    if (state.phase === 'runner' && assembly.stats.runner.manualPlaced < 3) setRunnerTarget();
    else if (state.phase === 'stator' && assembly.stats.stator.manualPlaced < 3) setStatorTarget();
    else if (state.phase === 'fluids') {
      state.fluidStep = state.oilConnected ? 'coolant' : 'oil';
      if (!state.coolantConnected) setFluidTarget();
    }
    else if (state.phase === 'casing') setCasingTarget();
    else if (state.phase === 'gate') setGateOpeningTarget();
    else if (state.phase === 'complete') {
      replayButton.classList.add('show');
      replayButton.setAttribute('aria-hidden', 'false');
      setFinalGateTargets();
    }
  }
  updateGateTargetPositions();
}
window.addEventListener('resize', handleResize);

document.addEventListener('visibilitychange', () => {
  state.suspended = document.hidden;
  if (document.hidden) {
    state.gateHeld = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    audio.suspend();
    return;
  }
  audio.resume();
  clock.getDelta();
  requestNextFrame();
});

const clock = new THREE.Clock();
let rafId = 0;

function requestNextFrame() {
  if (!rafId && !state.suspended) rafId = requestAnimationFrame(animate);
}

function animate() {
  rafId = 0;
  if (state.suspended) return;
  // Keep the story clock responsive on low-end/SwiftShader paths while still
  // bounding resume spikes. Individual machinery systems clamp again.
  const dt = Math.min(.1, clock.getDelta());
  state.clock += dt;
  updateTweens(dt);
  updateGeneration(dt);
  assembly.update(dt);
  updateGateTargetPositions();
  interactions.update(state.clock, state.clock - state.lastInteractionAt);
  world.update(dt, state.clock, {
    phase: state.phase,
    selectedDestination: state.selectedDestination,
    gate: state.gateOpening,
    speed: state.turbineSpeed,
    power: state.power,
    oilLevel: state.oilLevel,
    coolantFlow: state.coolantFlow,
    bubblesRemaining: state.coolantConnected
      ? Math.max(0, Math.ceil(10 - (state.clock - state.coolantStartedAt) * 2.2))
      : 0,
    transmission: state.transmissionProgress,
    complete: state.finalSceneComplete,
    casingInstalled: state.casingInstalled,
  });
  if (softwareMaterialPairs.length) syncSoftwareMaterials();
  camera.lookAt(cameraLook);
  renderer.render(scene, camera);
  requestNextFrame();
}

schedule(.18, () => {
  loader.classList.add('gone');
  schedule(.7, () => loader.remove());
  enterDestinationChoice();
});
requestNextFrame();
