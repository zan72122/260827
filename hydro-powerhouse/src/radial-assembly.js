import * as THREE from 'three';

const TAU = Math.PI * 2;
const RUNNER_TOTAL = 9;
const STATOR_TOTAL = 12;
const CAPACITY_HEADROOM = 0.25;
const RUNNER_CAPACITY = Math.ceil(RUNNER_TOTAL * (1 + CAPACITY_HEADROOM));
const STATOR_CAPACITY = Math.ceil(STATOR_TOTAL * (1 + CAPACITY_HEADROOM));
const RUNNER_RADIUS = 1.08;
const STATOR_RADIUS = 2.12;
const HIDDEN_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

const clamp01 = (value) => Math.max(0, Math.min(1, value));

function smoothBack(value) {
  const t = clamp01(value);
  const smooth = t * t * (3 - 2 * t);
  return smooth + Math.sin(smooth * Math.PI) * 0.055;
}

function hashSeed(value) {
  const text = String(value ?? 'hydro-radial-assembly');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function deterministicOrder(total, seed) {
  const random = mulberry32(hashSeed(seed));
  const order = Array.from({ length: total }, (_, index) => index);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [order[index], order[swap]] = [order[swap], order[index]];
  }
  return Object.freeze(order);
}

function mergeGeometries(geometries) {
  const positions = [];
  const normals = [];
  for (const source of geometries) {
    const geometry = source.index ? source.toNonIndexed() : source.clone();
    positions.push(...geometry.getAttribute('position').array);
    normals.push(...geometry.getAttribute('normal').array);
    geometry.dispose();
    source.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

function translatedBox(width, height, depth, x, y, z) {
  const geometry = new THREE.BoxGeometry(width, height, depth, 1, 1, 1);
  geometry.translate(x, y, z);
  return geometry;
}

// A thick, swept runner blade. The geometry starts at the hub and bends in the
// tangential direction toward its tip, so its silhouette reads as machinery,
// not as a flat radial ornament.
function makeSweptBladeGeometry() {
  const stations = [
    { y: 0.59, centerX: -0.02, halfWidth: 0.17, halfDepth: 0.13 },
    { y: 0.91, centerX: 0.07, halfWidth: 0.22, halfDepth: 0.105 },
    { y: 1.27, centerX: 0.19, halfWidth: 0.235, halfDepth: 0.082 },
    { y: 1.57, centerX: 0.31, halfWidth: 0.16, halfDepth: 0.062 },
  ];
  const positions = [];
  for (const station of stations) {
    positions.push(
      station.centerX - station.halfWidth, station.y, station.halfDepth,
      station.centerX + station.halfWidth, station.y, station.halfDepth,
      station.centerX + station.halfWidth, station.y, -station.halfDepth,
      station.centerX - station.halfWidth, station.y, -station.halfDepth,
    );
  }

  const indices = [];
  // Root and tip caps.
  indices.push(0, 2, 1, 0, 3, 2);
  const tip = (stations.length - 1) * 4;
  indices.push(tip, tip + 1, tip + 2, tip, tip + 2, tip + 3);
  // Four longitudinal faces between every pair of stations.
  for (let station = 0; station < stations.length - 1; station += 1) {
    const a = station * 4;
    const b = (station + 1) * 4;
    for (let side = 0; side < 4; side += 1) {
      const next = (side + 1) % 4;
      indices.push(a + side, b + side, a + next, a + next, b + side, b + next);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function makeCopperModuleGeometry() {
  const geometries = [];
  // Three visibly separate turns make each module read as wound copper.
  for (const z of [0.31, 0.42, 0.53]) {
    const turn = new THREE.TorusGeometry(0.30, 0.052, 7, 24);
    turn.scale(0.76, 1.18, 1);
    turn.translate(0, STATOR_RADIUS, z);
    geometries.push(turn);
  }
  // Short terminal leads emerge from the lower end of the winding.
  for (const x of [-0.135, 0.135]) {
    const lead = new THREE.CylinderGeometry(0.052, 0.052, 0.32, 8);
    lead.translate(x, STATOR_RADIUS - 0.39, 0.42);
    geometries.push(lead);
  }
  return mergeGeometries(geometries);
}

function makeCoilSupportGeometry() {
  return mergeGeometries([
    translatedBox(0.66, 0.80, 0.075, 0, STATOR_RADIUS, 0.16),
    translatedBox(0.075, 0.94, 0.18, -0.35, STATOR_RADIUS, 0.25),
    translatedBox(0.075, 0.94, 0.18, 0.35, STATOR_RADIUS, 0.25),
    translatedBox(0.78, 0.075, 0.18, 0, STATOR_RADIUS + 0.46, 0.25),
  ]);
}

function makeBrushedSteelMaterial(color = 0x58727c, roughness = 0.34) {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.93,
    roughness,
    clearcoat: 0.16,
    clearcoatRoughness: 0.38,
    anisotropy: 0.36,
    anisotropyRotation: Math.PI / 2,
    side: THREE.DoubleSide,
  });
}

function makePool(name, geometry, material, capacity, visibleCount, castShadow = false) {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.name = name;
  mesh.count = visibleCount;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return mesh;
}

function vectorFrom(value, fallback) {
  if (value?.isVector3) return value.clone();
  if (Array.isArray(value) && value.length >= 3 && value.every(Number.isFinite)) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return fallback.clone();
}

function makeSlotState(index, total) {
  const angle = -Math.PI / 2 + (index / total) * TAU;
  return {
    index,
    angle,
    claimed: false,
    installed: false,
    manual: false,
    animation: null,
  };
}

/**
 * Instanced radial machinery used by the runner and generator assembly scenes.
 *
 * All positions are local to `runnerRoot` / `statorRoot`; callers can attach
 * those roots to independently positioned scene groups. The local rotation
 * axis is +Z, matching a front-on view of the shaft.
 */
export class RadialAssemblySystem {
  constructor({ runnerGroup = null, statorGroup = null, seed = 'hydro-powerhouse-v1' } = {}) {
    this.seed = String(seed);
    this.runnerRoot = new THREE.Group();
    this.runnerRoot.name = 'runner-assembly-root';
    this.runnerRotor = new THREE.Group();
    this.runnerRotor.name = 'runner-rotor';
    this.runnerRoot.add(this.runnerRotor);
    this.statorRoot = new THREE.Group();
    this.statorRoot.name = 'stator-assembly-root';

    this.runnerSlotOrder = deterministicOrder(RUNNER_TOTAL, `${this.seed}:runner`);
    this.statorSlotOrder = deterministicOrder(STATOR_TOTAL, `${this.seed}:stator`);
    this._runnerSlots = Array.from({ length: RUNNER_TOTAL }, (_, index) => makeSlotState(index, RUNNER_TOTAL));
    this._statorSlots = Array.from({ length: STATOR_TOTAL }, (_, index) => makeSlotState(index, STATOR_TOTAL));
    this._rotationSpeed = 0;
    this._powerGlow = 0;
    this._statorCopperMaterial = null;
    this._disposed = false;
    this._runnerDirty = false;
    this._statorDirty = false;

    this._buildRunner();
    this._buildStator();
    this.validationIssues = this.preflight();
    this.reset();
    this.attach({ runnerGroup, statorGroup });
  }

  _buildRunner() {
    // The swept vanes use a darker hydraulic alloy than the surrounding
    // shrouds, so the wheel reads as machinery instead of pale petals.
    const steel = new THREE.MeshStandardMaterial({
      color: 0x244f5d,
      metalness: 0.58,
      roughness: 0.58,
      side: THREE.DoubleSide,
    });
    const rootSteel = makeBrushedSteelMaterial(0x314b55, 0.4);
    const tipSteel = makeBrushedSteelMaterial(0x42636e, 0.3);
    this.runnerPools = Object.freeze({
      blades: makePool('runner-blades', makeSweptBladeGeometry(), steel, RUNNER_CAPACITY, RUNNER_TOTAL, true),
      roots: makePool(
        'runner-blade-roots',
        translatedBox(0.38, 0.22, 0.28, 0, 0.62, 0),
        rootSteel,
        RUNNER_CAPACITY,
        RUNNER_TOTAL,
        true,
      ),
      tipBands: makePool(
        'runner-blade-tip-bands',
        translatedBox(0.36, 0.11, 0.17, 0.31, 1.59, 0),
        tipSteel,
        RUNNER_CAPACITY,
        RUNNER_TOTAL,
        true,
      ),
    });
    Object.values(this.runnerPools).forEach((mesh) => this.runnerRotor.add(mesh));

    // A rear shroud and tip band make the runner read as one heavy hydraulic
    // wheel instead of a ring of independent decorative petals.
    const shroudMaterial = makeBrushedSteelMaterial(0x263e48, 0.38);
    const rearShroud = new THREE.Mesh(
      new THREE.CylinderGeometry(1.62, 1.62, 0.13, 36),
      shroudMaterial,
    );
    rearShroud.name = 'runner-rear-shroud';
    rearShroud.rotation.x = Math.PI / 2;
    rearShroud.position.z = -0.15;
    const tipShroud = new THREE.Mesh(
      new THREE.TorusGeometry(1.58, 0.12, 10, 48),
      makeBrushedSteelMaterial(0x385762, 0.31),
    );
    tipShroud.name = 'runner-tip-shroud';
    tipShroud.position.z = 0.035;
    this.runnerRotor.add(rearShroud, tipShroud);

    const shaftMaterial = makeBrushedSteelMaterial(0x8d9ca5, 0.25);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 2.1, 20), shaftMaterial);
    shaft.name = 'runner-shaft';
    shaft.rotation.x = Math.PI / 2;
    shaft.castShadow = true;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.61, 0.61, 0.5, 24), steel);
    hub.name = 'runner-hub';
    hub.rotation.x = Math.PI / 2;
    hub.castShadow = true;
    this.runnerRotor.add(shaft, hub);
  }

  _buildStator() {
    const copper = new THREE.MeshPhysicalMaterial({
      color: 0xf08a34,
      emissive: 0x7a2508,
      emissiveIntensity: 0.18,
      metalness: 0.64,
      roughness: 0.31,
      clearcoat: 0.22,
      clearcoatRoughness: 0.32,
    });
    this._statorCopperMaterial = copper;
    const insulation = new THREE.MeshStandardMaterial({
      color: 0x172737,
      metalness: 0.06,
      roughness: 0.7,
    });
    const support = makeBrushedSteelMaterial(0x273b44, 0.5);
    const innerInsulator = translatedBox(0.43, 0.18, 0.30, 0, STATOR_RADIUS - 0.42, 0.34);
    const outerInsulator = translatedBox(0.43, 0.18, 0.30, 0, STATOR_RADIUS + 0.42, 0.34);
    this.statorPools = Object.freeze({
      coils: makePool('stator-copper-coils', makeCopperModuleGeometry(), copper, STATOR_CAPACITY, STATOR_TOTAL, true),
      innerInsulators: makePool(
        'stator-inner-insulators', innerInsulator, insulation, STATOR_CAPACITY, STATOR_TOTAL, false,
      ),
      outerInsulators: makePool(
        'stator-outer-insulators', outerInsulator, insulation, STATOR_CAPACITY, STATOR_TOTAL, false,
      ),
      supports: makePool(
        'stator-support-frames', makeCoilSupportGeometry(), support, STATOR_CAPACITY, STATOR_TOTAL, true,
      ),
    });
    Object.values(this.statorPools).forEach((mesh) => this.statorRoot.add(mesh));

    const backIron = new THREE.Mesh(
      new THREE.TorusGeometry(STATOR_RADIUS, 0.48, 10, 48),
      makeBrushedSteelMaterial(0x35434d, 0.46),
    );
    backIron.name = 'stator-back-iron';
    backIron.position.z = -0.27;
    backIron.castShadow = true;
    this.statorRoot.add(backIron);
  }

  attach({ runnerGroup = null, statorGroup = null } = {}) {
    this._assertAlive();
    if (runnerGroup) {
      if (typeof runnerGroup.add !== 'function') throw new TypeError('runnerGroup must be a Three.js Object3D');
      runnerGroup.add(this.runnerRoot);
    }
    if (statorGroup) {
      if (typeof statorGroup.add !== 'function') throw new TypeError('statorGroup must be a Three.js Object3D');
      statorGroup.add(this.statorRoot);
    }
    return this;
  }

  preflight() {
    const issues = [];
    const minimumRunner = Math.ceil(RUNNER_TOTAL * 1.2);
    const minimumStator = Math.ceil(STATOR_TOTAL * 1.2);
    if (RUNNER_CAPACITY < minimumRunner) issues.push('runner capacity has less than 20% headroom');
    if (STATOR_CAPACITY < minimumStator) issues.push('stator capacity has less than 20% headroom');
    for (const [name, mesh] of Object.entries(this.runnerPools || {})) {
      if (mesh.instanceMatrix.count < RUNNER_CAPACITY) issues.push(`${name} pool is smaller than runner capacity`);
    }
    for (const [name, mesh] of Object.entries(this.statorPools || {})) {
      if (mesh.instanceMatrix.count < STATOR_CAPACITY) issues.push(`${name} pool is smaller than stator capacity`);
    }
    if (new Set(this.runnerSlotOrder).size !== RUNNER_TOTAL) issues.push('runner slot order is not unique');
    if (new Set(this.statorSlotOrder).size !== STATOR_TOTAL) issues.push('stator slot order is not unique');
    return issues;
  }

  nextRunnerSlot() {
    return this.runnerSlotOrder.find((index) => !this._runnerSlots[index].claimed) ?? null;
  }

  nextStatorSlot() {
    return this.statorSlotOrder.find((index) => !this._statorSlots[index].claimed) ?? null;
  }

  placeRunnerBlade(slotIndex = null, options = {}) {
    if (slotIndex && typeof slotIndex === 'object') {
      options = slotIndex;
      slotIndex = null;
    }
    return this._place('runner', slotIndex, { ...options, manual: true });
  }

  placeStatorCoil(slotIndex = null, options = {}) {
    if (slotIndex && typeof slotIndex === 'object') {
      options = slotIndex;
      slotIndex = null;
    }
    return this._place('stator', slotIndex, { ...options, manual: true });
  }

  assistRunnerCompletion(options = {}) {
    return this._assist('runner', options);
  }

  assistStatorCompletion(options = {}) {
    return this._assist('stator', options);
  }

  assistAll(options = {}) {
    return {
      runner: this.assistRunnerCompletion(options.runner || options),
      stator: this.assistStatorCompletion(options.stator || options),
    };
  }

  _place(kind, requestedSlot, options) {
    this._assertReady();
    const slots = kind === 'runner' ? this._runnerSlots : this._statorSlots;
    const total = slots.length;
    const slotIndex = requestedSlot == null
      ? (kind === 'runner' ? this.nextRunnerSlot() : this.nextStatorSlot())
      : requestedSlot;
    if (slotIndex == null) return null;
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= total) {
      throw new RangeError(`${kind} slot ${slotIndex} is outside 0..${total - 1}`);
    }
    const slot = slots[slotIndex];
    if (slot.claimed) return null;

    const duration = Number.isFinite(options.duration) ? Math.max(0.01, options.duration) : 0.46;
    const delay = Number.isFinite(options.delay) ? Math.max(0, options.delay) : 0;
    const animate = options.animate !== false;
    const fallbackOffset = kind === 'runner'
      ? new THREE.Vector3(slotIndex % 2 ? -0.72 : 0.72, 0.28, 0.48)
      : new THREE.Vector3(slotIndex % 2 ? -0.48 : 0.48, 0.24, 0.62);
    const sourceOffset = vectorFrom(options.sourceOffset, fallbackOffset);

    slot.claimed = true;
    slot.manual = options.manual === true;
    slot.installed = !animate;
    slot.animation = animate ? this._makeAnimation(kind, slot, sourceOffset, delay, duration) : null;
    if (animate) this._writeSlot(kind, slot.index, slot.animation.startMatrix);
    else this._writeSlot(kind, slot.index, this._targetMatrix(slot.angle));
    this._flushDirty();
    return slot.index;
  }

  _assist(kind, { stagger = 0.13, duration = 0.5, sourceOffset = null } = {}) {
    this._assertReady();
    const order = kind === 'runner' ? this.runnerSlotOrder : this.statorSlotOrder;
    const claimed = [];
    for (const index of order) {
      const slots = kind === 'runner' ? this._runnerSlots : this._statorSlots;
      if (slots[index].claimed) continue;
      const placed = this._place(kind, index, {
        manual: false,
        animate: true,
        delay: claimed.length * Math.max(0, stagger),
        duration,
        sourceOffset,
      });
      if (placed != null) claimed.push(placed);
    }
    return claimed;
  }

  _targetMatrix(angle) {
    return new THREE.Matrix4().makeRotationZ(angle);
  }

  _makeAnimation(kind, slot, sourceOffset, delay, duration) {
    const targetQuaternion = new THREE.Quaternion().setFromAxisAngle(Z_AXIS, slot.angle);
    const twist = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      kind === 'runner' ? -0.32 : 0,
      kind === 'stator' ? 0.28 : 0,
      0,
    ));
    const startQuaternion = targetQuaternion.clone().multiply(twist);
    const startScale = new THREE.Vector3().setScalar(kind === 'runner' ? 0.76 : 0.72);
    const targetScale = new THREE.Vector3(1, 1, 1);
    const startPosition = sourceOffset.clone();
    const targetPosition = new THREE.Vector3();
    const startMatrix = new THREE.Matrix4().compose(startPosition, startQuaternion, startScale);
    return {
      elapsed: 0,
      delay,
      duration,
      startPosition,
      targetPosition,
      startQuaternion,
      targetQuaternion,
      startScale,
      targetScale,
      startMatrix,
    };
  }

  _writeSlot(kind, index, matrix) {
    const pools = kind === 'runner' ? this.runnerPools : this.statorPools;
    Object.values(pools).forEach((mesh) => mesh.setMatrixAt(index, matrix));
    if (kind === 'runner') this._runnerDirty = true;
    else this._statorDirty = true;
  }

  _flushDirty() {
    if (this._runnerDirty) {
      Object.values(this.runnerPools).forEach((mesh) => { mesh.instanceMatrix.needsUpdate = true; });
      this._runnerDirty = false;
    }
    if (this._statorDirty) {
      Object.values(this.statorPools).forEach((mesh) => { mesh.instanceMatrix.needsUpdate = true; });
      this._statorDirty = false;
    }
  }

  setRotationSpeed(radiansPerSecond) {
    this._assertAlive();
    if (!Number.isFinite(radiansPerSecond)) throw new TypeError('rotation speed must be finite');
    this._rotationSpeed = radiansPerSecond;
    return this;
  }

  setNormalizedSpeed(normalized, maximumRadiansPerSecond = 8.5) {
    if (!Number.isFinite(normalized) || !Number.isFinite(maximumRadiansPerSecond)) {
      throw new TypeError('normalized and maximum speed must be finite');
    }
    return this.setRotationSpeed(clamp01(normalized) * Math.max(0, maximumRadiansPerSecond));
  }

  setPowerGlow(power) {
    this._assertAlive();
    if (!Number.isFinite(power)) throw new TypeError('power glow must be finite');
    this._powerGlow = clamp01(power);
    if (this._statorCopperMaterial) {
      // Keep the copper itself readable under normal lighting; generation adds
      // a warm current-like lift without turning the coils into neon tubes.
      this._statorCopperMaterial.emissiveIntensity = 0.18 + this._powerGlow * 1.12;
    }
    return this;
  }

  update(deltaSeconds) {
    this._assertAlive();
    const delta = Math.max(0, Math.min(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0.12));
    if (this._rotationSpeed !== 0) {
      this.runnerRotor.rotation.z = (this.runnerRotor.rotation.z + this._rotationSpeed * delta) % TAU;
    }

    this._advanceSlots('runner', this._runnerSlots, delta);
    this._advanceSlots('stator', this._statorSlots, delta);
    this._flushDirty();
    return this.stats;
  }

  _advanceSlots(kind, slots, delta) {
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const matrix = new THREE.Matrix4();
    for (const slot of slots) {
      const animation = slot.animation;
      if (!animation) continue;
      animation.elapsed += delta;
      if (animation.elapsed < animation.delay) continue;
      const raw = (animation.elapsed - animation.delay) / animation.duration;
      const progress = clamp01(raw);
      const eased = smoothBack(progress);
      position.lerpVectors(animation.startPosition, animation.targetPosition, eased);
      quaternion.slerpQuaternions(animation.startQuaternion, animation.targetQuaternion, eased);
      scale.lerpVectors(animation.startScale, animation.targetScale, eased);
      matrix.compose(position, quaternion, scale);
      this._writeSlot(kind, slot.index, matrix);
      if (progress >= 1) {
        slot.installed = true;
        slot.animation = null;
        this._writeSlot(kind, slot.index, this._targetMatrix(slot.angle));
      }
    }
  }

  reset() {
    this._assertAlive();
    this._rotationSpeed = 0;
    this.setPowerGlow(0);
    this.runnerRotor.rotation.z = 0;
    for (const slot of [...this._runnerSlots, ...this._statorSlots]) {
      slot.claimed = false;
      slot.installed = false;
      slot.manual = false;
      slot.animation = null;
    }
    for (let index = 0; index < RUNNER_TOTAL; index += 1) this._writeSlot('runner', index, HIDDEN_MATRIX);
    for (let index = 0; index < STATOR_TOTAL; index += 1) this._writeSlot('stator', index, HIDDEN_MATRIX);
    this._flushDirty();
    return this;
  }

  get stats() {
    const summary = (slots, total, capacity) => {
      const installed = slots.reduce((count, slot) => count + Number(slot.installed), 0);
      // Expose completed manual placements rather than merely claimed slots so
      // the public state never reports a hand-installed part before its snap
      // animation has actually reached the machine.
      const manualPlaced = slots.reduce((count, slot) => count + Number(slot.installed && slot.manual), 0);
      return {
        manualPlaced,
        installed,
        total,
        capacity,
        complete: installed === total,
      };
    };
    return {
      runner: summary(this._runnerSlots, RUNNER_TOTAL, RUNNER_CAPACITY),
      stator: summary(this._statorSlots, STATOR_TOTAL, STATOR_CAPACITY),
      validationIssues: [...this.validationIssues],
    };
  }

  dispose() {
    if (this._disposed) return;
    this.runnerRoot.removeFromParent();
    this.statorRoot.removeFromParent();
    const geometries = new Set();
    const materials = new Set();
    for (const root of [this.runnerRoot, this.statorRoot]) {
      root.traverse((object) => {
        if (!object.isMesh) return;
        if (object.geometry) geometries.add(object.geometry);
        const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
        objectMaterials.filter(Boolean).forEach((material) => materials.add(material));
      });
    }
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    this._disposed = true;
  }

  _assertReady() {
    this._assertAlive();
    if (this.validationIssues.length) {
      throw new Error(`RadialAssemblySystem preflight failed: ${this.validationIssues.join('; ')}`);
    }
  }

  _assertAlive() {
    if (this._disposed) throw new Error('RadialAssemblySystem has been disposed');
  }
}
