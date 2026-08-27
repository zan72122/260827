// Lightweight procedural clean-room crew.
//
// Eight adult technicians are built from a small number of InstancedMesh pools.
// They stay at validated perimeter work stations while their gaze and gestures
// change with the game's phase.  This keeps the central crane, cart and satellite
// envelopes clear, and avoids loading character models or textures.

import * as THREE from 'three';

export const TECHNICIAN_ROLES = Object.freeze({
  CRANE: 'crane',
  MECHANICAL: 'mechanical',
  ELECTRICAL: 'electrical',
  TEST: 'test',
  CONTROL: 'control',
});

const PHASES = Object.freeze([
  'chooseMission',
  'airlock',
  'airShower',
  'crane',
  'payload',
  'harness',
  'blanket',
  'arrays',
  'test',
  'orbit',
  'mission',
  'complete',
]);

const ORBIT_PHASES = new Set(['orbit', 'mission', 'complete']);
const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;
const ARM_GEOMETRY_LENGTH = 0.38;
const LEG_GEOMETRY_LENGTH = 0.62;
const TRANSITION_SECONDS = 0.42;

// The central floor is deliberately empty.  Stations are placed beyond the
// satellite integration envelope and away from the cart/airlock centre line.
const DEFAULT_STATIONS = Object.freeze([
  { id: 'crane-1', role: TECHNICIAN_ROLES.CRANE, position: [-4.55, 0, 0.05] },
  { id: 'mechanical-1', role: TECHNICIAN_ROLES.MECHANICAL, position: [-2.78, 0, -1.55] },
  { id: 'mechanical-2', role: TECHNICIAN_ROLES.MECHANICAL, position: [2.78, 0, -1.55] },
  { id: 'electrical-1', role: TECHNICIAN_ROLES.ELECTRICAL, position: [-2.78, 0, 1.35] },
  { id: 'electrical-2', role: TECHNICIAN_ROLES.ELECTRICAL, position: [2.78, 0, 1.35] },
  { id: 'test-1', role: TECHNICIAN_ROLES.TEST, position: [-4.5, 0, -3.45] },
  { id: 'control-1', role: TECHNICIAN_ROLES.CONTROL, position: [-4.45, 0, 3.65] },
  { id: 'control-2', role: TECHNICIAN_ROLES.CONTROL, position: [4.45, 0, 3.65] },
]);

// Axis-aligned floor envelopes used by the built-in spatial check.  Call
// validateCollisions(customZones) when the host layout supplies tighter data.
export const DEFAULT_EQUIPMENT_ZONES = Object.freeze([
  { name: 'integration-stand', minX: -2.05, maxX: 2.05, minZ: -1.9, maxZ: 1.8 },
  { name: 'crane-sweep', minX: -1.65, maxX: 1.65, minZ: -3.3, maxZ: 2.05 },
  { name: 'cart-corridor', minX: -1.35, maxX: 1.35, minZ: 1.8, maxZ: 6.0 },
  { name: 'test-platform', minX: 1.45, maxX: 4.15, minZ: -5.0, maxZ: -2.5 },
  { name: 'airlock', minX: -1.9, maxX: 1.9, minZ: 5.2, maxZ: 7.5 },
]);

const ROLE_COLORS = Object.freeze({
  [TECHNICIAN_ROLES.CRANE]: 0xf1b441,
  [TECHNICIAN_ROLES.MECHANICAL]: 0x55a7d9,
  [TECHNICIAN_ROLES.ELECTRICAL]: 0x5dc6b0,
  [TECHNICIAN_ROLES.TEST]: 0xb78bd5,
  [TECHNICIAN_ROLES.CONTROL]: 0x6f8fc8,
});

const ROLE_STATES = Object.freeze({
  chooseMission: Object.freeze({
    crane: 'ready', mechanical: 'ready', electrical: 'ready', test: 'observe', control: 'console',
  }),
  airlock: Object.freeze({
    crane: 'guide', mechanical: 'guide', electrical: 'observe', test: 'inspect', control: 'console',
  }),
  airShower: Object.freeze({
    crane: 'airflow', mechanical: 'airflow', electrical: 'airflow', test: 'airflow', control: 'monitor',
  }),
  crane: Object.freeze({
    crane: 'operate', mechanical: 'signal', electrical: 'observe', test: 'inspect', control: 'console',
  }),
  payload: Object.freeze({
    crane: 'hold', mechanical: 'install', electrical: 'assist', test: 'inspect', control: 'monitor',
  }),
  harness: Object.freeze({
    crane: 'ready', mechanical: 'assist', electrical: 'connect', test: 'inspect', control: 'monitor',
  }),
  blanket: Object.freeze({
    crane: 'ready', mechanical: 'smooth', electrical: 'assist', test: 'inspect', control: 'monitor',
  }),
  arrays: Object.freeze({
    crane: 'hold', mechanical: 'install', electrical: 'inspect', test: 'observe', control: 'monitor',
  }),
  test: Object.freeze({
    crane: 'ready', mechanical: 'inspect', electrical: 'monitor', test: 'operate', control: 'console',
  }),
  orbit: Object.freeze({
    crane: 'observe', mechanical: 'observe', electrical: 'monitor', test: 'monitor', control: 'console',
  }),
  mission: Object.freeze({
    crane: 'celebrate', mechanical: 'celebrate', electrical: 'celebrate', test: 'signal', control: 'signal',
  }),
  complete: Object.freeze({
    crane: 'celebrate', mechanical: 'celebrate', electrical: 'celebrate', test: 'celebrate', control: 'celebrate',
  }),
});

const PHASE_FOCUS = Object.freeze({
  chooseMission: [0, 1.25, 0.8],
  airlock: [0, 1.25, 6.0],
  airShower: [0, 1.25, 4.45],
  crane: [0, 1.55, -0.4],
  payload: [0, 1.3, -0.4],
  harness: [0, 1.2, -0.35],
  blanket: [0, 1.25, -0.35],
  arrays: [0, 1.35, -0.35],
  test: [2.7, 1.15, -3.6],
  orbit: [0, 1.45, 0],
  mission: [0, 1.45, 0],
  complete: [0, 1.45, 0],
});

const _matrix = new THREE.Matrix4();
const _quaternion = new THREE.Quaternion();
const _yawQuaternion = new THREE.Quaternion();
const _leanQuaternion = new THREE.Quaternion();
const _position = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _start = new THREE.Vector3();
const _end = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _direction = new THREE.Vector3();
const _local = new THREE.Vector3();
const _color = new THREE.Color();

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const smoothstep = (value) => {
  const k = clamp01(value);
  return k * k * (3 - 2 * k);
};

function shortestAngle(from, to) {
  let difference = (to - from + Math.PI) % TAU;
  if (difference < 0) difference += TAU;
  return difference - Math.PI;
}

function seededUnit(index, salt = 0) {
  const value = Math.sin((index + 1) * 73.137 + salt * 29.417) * 43758.5453;
  return value - Math.floor(value);
}

function makeMaterial({ roughness = 0.72, metalness = 0, transparent = false, opacity = 1, emissive = 0xb9cbd1, emissiveIntensity = 0.52 } = {}) {
  return new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness,
    metalness,
    transparent,
    opacity,
    emissive,
    emissiveIntensity,
    vertexColors: true,
  });
}

function normalizeZone(zone, index) {
  if (Array.isArray(zone?.center) && Array.isArray(zone?.halfSize)) {
    const [x, z] = zone.center;
    const [halfX, halfZ] = zone.halfSize;
    return {
      name: zone.name || `equipment-${index + 1}`,
      minX: x - halfX,
      maxX: x + halfX,
      minZ: z - halfZ,
      maxZ: z + halfZ,
    };
  }
  return {
    name: zone?.name || `equipment-${index + 1}`,
    minX: Number(zone?.minX),
    maxX: Number(zone?.maxX),
    minZ: Number(zone?.minZ),
    maxZ: Number(zone?.maxZ),
  };
}

function validZone(zone) {
  return [zone.minX, zone.maxX, zone.minZ, zone.maxZ].every(Number.isFinite)
    && zone.minX <= zone.maxX && zone.minZ <= zone.maxZ;
}

function normalizedStation(station, index) {
  const fallback = DEFAULT_STATIONS[index];
  const position = station?.position;
  const x = Number.isFinite(position?.x) ? position.x : Number(position?.[0]);
  const y = Number.isFinite(position?.y) ? position.y : Number(position?.[1]);
  const z = Number.isFinite(position?.z) ? position.z : Number(position?.[2]);
  return {
    id: station?.id || fallback.id,
    role: Object.values(TECHNICIAN_ROLES).includes(station?.role) ? station.role : fallback.role,
    position: new THREE.Vector3(
      Number.isFinite(x) ? x : fallback.position[0],
      Number.isFinite(y) ? y : fallback.position[1],
      Number.isFinite(z) ? z : fallback.position[2],
    ),
  };
}

function copyPose(pose) {
  return {
    leftElbow: [...pose.leftElbow],
    leftHand: [...pose.leftHand],
    rightElbow: [...pose.rightElbow],
    rightHand: [...pose.rightHand],
    lean: pose.lean,
    headYaw: pose.headYaw,
    headNod: pose.headNod,
    sway: pose.sway,
    bob: pose.bob,
  };
}

function lerpPose(from, to, alpha) {
  const result = copyPose(to);
  for (const key of ['leftElbow', 'leftHand', 'rightElbow', 'rightHand']) {
    for (let axis = 0; axis < 3; axis += 1) {
      result[key][axis] = THREE.MathUtils.lerp(from[key][axis], to[key][axis], alpha);
    }
  }
  for (const key of ['lean', 'headYaw', 'headNod', 'sway', 'bob']) {
    result[key] = THREE.MathUtils.lerp(from[key], to[key], alpha);
  }
  return result;
}

function poseFor(state, worker, time) {
  const phase = worker.motionPhase;
  const pulse = Math.sin(time * 2.2 + phase);
  const slow = Math.sin(time * 1.15 + phase * 0.7);
  const working = Math.sin(time * 4.4 + phase);
  const pose = {
    leftElbow: [-0.34, 1.15, 0.025],
    leftHand: [-0.28, 0.91, 0.045],
    rightElbow: [0.34, 1.15, 0.025],
    rightHand: [0.28, 0.91, 0.045],
    lean: 0,
    headYaw: slow * 0.025,
    headNod: pulse * 0.012,
    sway: 0,
    bob: Math.max(0, pulse) * 0.0025,
  };

  switch (state) {
    case 'observe':
      pose.leftHand = [-0.17, 1.12, 0.18];
      pose.leftElbow = [-0.33, 1.2, 0.08];
      pose.headYaw += slow * 0.07;
      break;
    case 'guide':
      pose.rightElbow = [0.46, 1.38, 0.12];
      pose.rightHand = [0.58, 1.57, 0.16];
      pose.leftHand = [-0.18, 1.12, 0.16];
      pose.leftElbow = [-0.34, 1.2, 0.08];
      pose.rightHand[0] += working * 0.025;
      break;
    case 'signal':
      pose.rightElbow = [0.45, 1.51, 0.04];
      pose.rightHand = [0.32 + working * 0.035, 1.85, 0.04];
      pose.leftHand = [-0.18, 1.1, 0.16];
      pose.leftElbow = [-0.34, 1.19, 0.08];
      break;
    case 'operate':
      pose.leftElbow = [-0.34, 1.25, 0.14];
      pose.rightElbow = [0.34, 1.25, 0.14];
      pose.leftHand = [-0.19, 1.12 + working * 0.016, 0.34];
      pose.rightHand = [0.19, 1.1 - working * 0.016, 0.34];
      pose.lean = -0.045;
      break;
    case 'console':
      pose.leftElbow = [-0.32, 1.2, 0.12];
      pose.rightElbow = [0.32, 1.2, 0.12];
      pose.leftHand = [-0.19, 1.03 + working * 0.018, 0.32];
      pose.rightHand = [0.19, 1.03 - working * 0.018, 0.32];
      pose.headNod -= 0.09;
      pose.lean = -0.035;
      break;
    case 'hold':
      pose.leftElbow = [-0.4, 1.3, 0.16];
      pose.rightElbow = [0.4, 1.3, 0.16];
      pose.leftHand = [-0.3, 1.25, 0.39];
      pose.rightHand = [0.3, 1.25, 0.39];
      break;
    case 'install':
      pose.leftElbow = [-0.38, 1.25, 0.14];
      pose.leftHand = [-0.23, 1.19, 0.36];
      pose.rightElbow = [0.38, 1.3, 0.14];
      pose.rightHand = [0.22 + working * 0.025, 1.33 + working * 0.035, 0.39];
      pose.lean = -0.055;
      break;
    case 'assist':
      pose.leftElbow = [-0.38, 1.28, 0.12];
      pose.leftHand = [-0.25, 1.22, 0.34];
      pose.rightElbow = [0.37, 1.2, 0.08];
      pose.rightHand = [0.2, 1.08, 0.24];
      break;
    case 'connect':
      pose.leftElbow = [-0.36, 1.27, 0.14];
      pose.leftHand = [-0.16, 1.18, 0.38];
      pose.rightElbow = [0.36, 1.27, 0.14];
      pose.rightHand = [0.17 + working * 0.038, 1.19, 0.39];
      pose.lean = -0.07;
      pose.headNod -= 0.08;
      break;
    case 'smooth':
      pose.leftElbow = [-0.45, 1.32, 0.13];
      pose.rightElbow = [0.45, 1.32, 0.13];
      pose.leftHand = [-0.46 + slow * 0.045, 1.28, 0.36];
      pose.rightHand = [0.46 + slow * 0.045, 1.28, 0.36];
      pose.lean = -0.045;
      break;
    case 'inspect':
      pose.leftElbow = [-0.34, 1.19, 0.1];
      pose.leftHand = [-0.16, 1.16, 0.25];
      pose.rightElbow = [0.34, 1.27, 0.1];
      pose.rightHand = [0.16, 1.34, 0.24];
      pose.headNod -= 0.065 + Math.max(0, slow) * 0.025;
      break;
    case 'monitor':
      pose.leftElbow = [-0.34, 1.19, 0.07];
      pose.leftHand = [-0.16, 1.17, 0.2];
      pose.rightElbow = [0.34, 1.16, 0.05];
      pose.rightHand = [0.22, 1.0, 0.12];
      break;
    case 'airflow':
      pose.leftElbow = [-0.43, 1.18, 0.02];
      pose.leftHand = [-0.47, 0.96, 0.05];
      pose.rightElbow = [0.43, 1.18, 0.02];
      pose.rightHand = [0.47, 0.96, 0.05];
      pose.sway = slow * 0.018;
      pose.lean = slow * 0.018;
      pose.headYaw += slow * 0.035;
      break;
    case 'celebrate':
      pose.leftElbow = [-0.44, 1.52, 0.02];
      pose.leftHand = [-0.31 + working * 0.025, 1.83, 0.035];
      pose.rightElbow = [0.44, 1.52, 0.02];
      pose.rightHand = [0.31 - working * 0.025, 1.83, 0.035];
      pose.bob += Math.max(0, pulse) * 0.012;
      break;
    default:
      break;
  }
  return pose;
}

export class Technicians {
  constructor(parent, options = {}) {
    if (!parent?.add) throw new TypeError('Technicians requires a THREE.Scene or THREE.Object3D parent');

    this.parent = parent;
    this.options = options;
    this.phase = 'chooseMission';
    this.time = 0;
    this.root = new THREE.Group();
    this.root.name = 'cleanroom-technicians';
    this.root.renderOrder = 1;
    parent.add(this.root);

    const requestedStations = Array.isArray(options.stations) && options.stations.length === 8
      ? options.stations
      : DEFAULT_STATIONS;
    this.technicians = requestedStations.map((station, index) => {
      const normalized = normalizedStation(station, index);
      const height = 1.68 + seededUnit(index, 3) * 0.12;
      const focus = PHASE_FOCUS[this.phase];
      const yaw = Math.atan2(focus[0] - normalized.position.x, focus[2] - normalized.position.z);
      return {
        index,
        id: normalized.id,
        role: normalized.role,
        roleIndex: requestedStations.slice(0, index).filter((item) => item.role === normalized.role).length,
        position: normalized.position,
        collisionRadius: 0.34,
        height,
        scale: height / 1.78,
        state: ROLE_STATES[this.phase][normalized.role],
        previousState: ROLE_STATES[this.phase][normalized.role],
        transition: 1,
        yaw,
        targetYaw: yaw,
        motionPhase: seededUnit(index, 8) * TAU,
      };
    });

    this.equipmentZones = (options.equipmentZones || DEFAULT_EQUIPMENT_ZONES)
      .map(normalizeZone)
      .filter(validZone);
    this.pools = this._createPools(options.castShadow === true);
    this._setColors();
    this._writeInstances();
    this._collisionResult = this.validateCollisions();
  }

  _makePool(name, geometry, material, count, castShadow) {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = `cleanroom-technicians-${name}`;
    mesh.count = count;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.root.add(mesh);
    return mesh;
  }

  _createPools(castShadow) {
    const count = this.technicians.length;
    return Object.freeze({
      torso: this._makePool(
        'torsos', new THREE.CapsuleGeometry(0.225, 0.48, 4, 10),
        makeMaterial({ roughness: 0.78 }), count, castShadow,
      ),
      hood: this._makePool(
        'hoods', new THREE.SphereGeometry(0.222, 12, 9),
        makeMaterial({ roughness: 0.82 }), count, castShadow,
      ),
      visor: this._makePool(
        'visors', new THREE.SphereGeometry(0.5, 12, 8),
        makeMaterial({ roughness: 0.2, metalness: 0.08, emissive: 0x17394f, emissiveIntensity: 0.18 }), count, false,
      ),
      mask: this._makePool(
        'masks', new THREE.BoxGeometry(1, 1, 1),
        makeMaterial({ roughness: 0.74 }), count, false,
      ),
      arm: this._makePool(
        'arms', new THREE.CapsuleGeometry(0.052, 0.276, 3, 7),
        makeMaterial({ roughness: 0.8 }), count * 4, castShadow,
      ),
      glove: this._makePool(
        'gloves', new THREE.SphereGeometry(0.073, 8, 6),
        makeMaterial({ roughness: 0.7 }), count * 2, false,
      ),
      leg: this._makePool(
        'legs', new THREE.CapsuleGeometry(0.07, 0.48, 3, 7),
        makeMaterial({ roughness: 0.82 }), count * 2, castShadow,
      ),
      boot: this._makePool(
        'boots', new THREE.BoxGeometry(1, 1, 1),
        makeMaterial({ roughness: 0.67 }), count * 2, castShadow,
      ),
      badge: this._makePool(
        'role-badges', new THREE.BoxGeometry(1, 1, 1),
        makeMaterial({ roughness: 0.56, emissive: 0x101820, emissiveIntensity: 0.08 }), count, false,
      ),
    });
  }

  _setColors() {
    for (const worker of this.technicians) {
      const index = worker.index;
      const suitTone = index % 3 === 0 ? 0xf7fbff : (index % 3 === 1 ? 0xecf3f7 : 0xf3f6f8);
      this.pools.torso.setColorAt(index, _color.setHex(suitTone));
      this.pools.hood.setColorAt(index, _color.setHex(suitTone));
      this.pools.visor.setColorAt(index, _color.setHex(index % 2 ? 0x28567a : 0x34769e));
      this.pools.mask.setColorAt(index, _color.setHex(0xcfe6ed));
      this.pools.badge.setColorAt(index, _color.setHex(ROLE_COLORS[worker.role]));
      for (let part = 0; part < 4; part += 1) {
        this.pools.arm.setColorAt(index * 4 + part, _color.setHex(suitTone));
      }
      for (let side = 0; side < 2; side += 1) {
        this.pools.glove.setColorAt(index * 2 + side, _color.setHex(0xddeff4));
        this.pools.leg.setColorAt(index * 2 + side, _color.setHex(suitTone));
        this.pools.boot.setColorAt(index * 2 + side, _color.setHex(0xd6e0e5));
      }
    }
    for (const pool of Object.values(this.pools)) {
      if (pool.instanceColor) pool.instanceColor.needsUpdate = true;
    }
  }

  setPhase(phase) {
    const normalized = PHASES.includes(phase) ? phase : 'chooseMission';
    this.phase = normalized;
    const focus = PHASE_FOCUS[normalized] || PHASE_FOCUS.chooseMission;
    for (const worker of this.technicians) {
      const nextState = ROLE_STATES[normalized]?.[worker.role] || 'observe';
      if (nextState !== worker.state) {
        worker.previousState = worker.state;
        worker.state = nextState;
        worker.transition = 0;
      }
      worker.targetYaw = Math.atan2(
        focus[0] - worker.position.x,
        focus[2] - worker.position.z,
      );
    }
    // By default the clean-room crew is not drawn over the orbital scene.  The
    // state machine keeps running so a host control-room shot can opt in.
    this.root.visible = !(this.options.hideInOrbit !== false && ORBIT_PHASES.has(normalized));
    return this.stats;
  }

  setVisible(visible) {
    this.root.visible = Boolean(visible);
  }

  update(dt = 0, time) {
    const safeDt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
    this.time = Number.isFinite(time) ? time : this.time + safeDt;
    for (const worker of this.technicians) {
      worker.transition = Math.min(1, worker.transition + safeDt / TRANSITION_SECONDS);
      const angleDelta = shortestAngle(worker.yaw, worker.targetYaw);
      worker.yaw += angleDelta * (1 - Math.exp(-safeDt * 7));
    }
    this._writeInstances();
  }

  _worldPoint(worker, values, bob = 0, sway = 0) {
    _local.set(values[0] * worker.scale, values[1] * worker.scale + bob, values[2] * worker.scale);
    _local.x += sway;
    _local.applyAxisAngle(UP, worker.yaw);
    return _local.add(worker.position).clone();
  }

  _setPart(pool, index, position, quaternion, scale) {
    _matrix.compose(position, quaternion, scale);
    pool.setMatrixAt(index, _matrix);
  }

  _setLimb(pool, index, start, end, baseLength, thicknessScale) {
    _start.copy(start);
    _end.copy(end);
    _direction.subVectors(_end, _start);
    const length = Math.max(0.001, _direction.length());
    _direction.multiplyScalar(1 / length);
    _mid.addVectors(_start, _end).multiplyScalar(0.5);
    _quaternion.setFromUnitVectors(UP, _direction);
    _scale.set(thicknessScale, length / baseLength, thicknessScale);
    this._setPart(pool, index, _mid, _quaternion, _scale);
  }

  _writeWorker(worker) {
    const targetPose = poseFor(worker.state, worker, this.time);
    const previousPose = poseFor(worker.previousState, worker, this.time);
    const pose = lerpPose(previousPose, targetPose, smoothstep(worker.transition));
    const scale = worker.scale;
    const bob = pose.bob * scale;
    const sway = pose.sway * scale;
    const breath = 1 + Math.sin(this.time * 1.7 + worker.motionPhase) * 0.006;

    _yawQuaternion.setFromAxisAngle(UP, worker.yaw);
    _leanQuaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), pose.lean);
    _quaternion.copy(_yawQuaternion).multiply(_leanQuaternion);

    const torsoPosition = this._worldPoint(worker, [0, 1.17, 0], bob, sway);
    this._setPart(
      this.pools.torso,
      worker.index,
      torsoPosition,
      _quaternion,
      _scale.set(scale * breath, scale, scale * 0.91),
    );

    // Head/visor rotate a little independently so idle crew visibly watch work.
    _yawQuaternion.setFromAxisAngle(UP, worker.yaw + pose.headYaw);
    _leanQuaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), pose.headNod);
    _quaternion.copy(_yawQuaternion).multiply(_leanQuaternion);
    const headPosition = this._worldPoint(worker, [0, 1.68, 0], bob, sway);
    this._setPart(
      this.pools.hood, worker.index, headPosition, _quaternion,
      _scale.setScalar(scale),
    );
    this._setPart(
      this.pools.visor,
      worker.index,
      this._worldPoint(worker, [0, 1.715, 0.205], bob, sway),
      _quaternion,
      _scale.set(0.255 * scale, 0.105 * scale, 0.034 * scale),
    );
    this._setPart(
      this.pools.mask,
      worker.index,
      this._worldPoint(worker, [0, 1.605, 0.205], bob, sway),
      _quaternion,
      _scale.set(0.225 * scale, 0.088 * scale, 0.032 * scale),
    );

    // Small colour tabs identify roles without text or changing the white suits.
    _yawQuaternion.setFromAxisAngle(UP, worker.yaw);
    this._setPart(
      this.pools.badge,
      worker.index,
      this._worldPoint(worker, [0.105, 1.35, 0.213], bob, sway),
      _yawQuaternion,
      _scale.set(0.085 * scale, 0.055 * scale, 0.018 * scale),
    );

    const leftShoulder = this._worldPoint(worker, [-0.255, 1.43, 0], bob, sway);
    const rightShoulder = this._worldPoint(worker, [0.255, 1.43, 0], bob, sway);
    const leftElbow = this._worldPoint(worker, pose.leftElbow, bob, sway);
    const rightElbow = this._worldPoint(worker, pose.rightElbow, bob, sway);
    const leftHand = this._worldPoint(worker, pose.leftHand, bob, sway);
    const rightHand = this._worldPoint(worker, pose.rightHand, bob, sway);
    const armBase = worker.index * 4;
    this._setLimb(this.pools.arm, armBase, leftShoulder, leftElbow, ARM_GEOMETRY_LENGTH, scale);
    this._setLimb(this.pools.arm, armBase + 1, leftElbow, leftHand, ARM_GEOMETRY_LENGTH, scale);
    this._setLimb(this.pools.arm, armBase + 2, rightShoulder, rightElbow, ARM_GEOMETRY_LENGTH, scale);
    this._setLimb(this.pools.arm, armBase + 3, rightElbow, rightHand, ARM_GEOMETRY_LENGTH, scale);
    this._setPart(
      this.pools.glove, worker.index * 2, leftHand,
      _yawQuaternion, _scale.setScalar(scale),
    );
    this._setPart(
      this.pools.glove, worker.index * 2 + 1, rightHand,
      _yawQuaternion, _scale.setScalar(scale),
    );

    const leftHip = this._worldPoint(worker, [-0.13, 0.88, 0], bob, sway);
    const rightHip = this._worldPoint(worker, [0.13, 0.88, 0], bob, sway);
    const leftAnkle = this._worldPoint(worker, [-0.14, 0.2, 0.005], 0, 0);
    const rightAnkle = this._worldPoint(worker, [0.14, 0.2, 0.005], 0, 0);
    this._setLimb(this.pools.leg, worker.index * 2, leftHip, leftAnkle, LEG_GEOMETRY_LENGTH, scale);
    this._setLimb(this.pools.leg, worker.index * 2 + 1, rightHip, rightAnkle, LEG_GEOMETRY_LENGTH, scale);
    this._setPart(
      this.pools.boot,
      worker.index * 2,
      this._worldPoint(worker, [-0.14, 0.075, 0.055], 0, 0),
      _yawQuaternion,
      _scale.set(0.17 * scale, 0.13 * scale, 0.29 * scale),
    );
    this._setPart(
      this.pools.boot,
      worker.index * 2 + 1,
      this._worldPoint(worker, [0.14, 0.075, 0.055], 0, 0),
      _yawQuaternion,
      _scale.set(0.17 * scale, 0.13 * scale, 0.29 * scale),
    );
  }

  _writeInstances() {
    for (const worker of this.technicians) this._writeWorker(worker);
    for (const pool of Object.values(this.pools)) pool.instanceMatrix.needsUpdate = true;
  }

  validateCollisions(zones = this.equipmentZones) {
    const normalizedZones = (zones || []).map(normalizeZone).filter(validZone);
    const workerPairs = [];
    const equipment = [];

    for (let a = 0; a < this.technicians.length; a += 1) {
      const first = this.technicians[a];
      for (let b = a + 1; b < this.technicians.length; b += 1) {
        const second = this.technicians[b];
        const distance = Math.hypot(
          first.position.x - second.position.x,
          first.position.z - second.position.z,
        );
        const clearance = distance - first.collisionRadius - second.collisionRadius;
        if (clearance < 0) {
          workerPairs.push({ a: first.id, b: second.id, penetration: -clearance });
        }
      }

      for (const zone of normalizedZones) {
        const closestX = Math.max(zone.minX, Math.min(first.position.x, zone.maxX));
        const closestZ = Math.max(zone.minZ, Math.min(first.position.z, zone.maxZ));
        const distance = Math.hypot(first.position.x - closestX, first.position.z - closestZ);
        if (distance < first.collisionRadius) {
          equipment.push({
            technician: first.id,
            equipment: zone.name,
            penetration: first.collisionRadius - distance,
          });
        }
      }
    }

    this._collisionResult = Object.freeze({
      count: workerPairs.length + equipment.length,
      workerPairs: Object.freeze(workerPairs),
      equipment: Object.freeze(equipment),
      clear: workerPairs.length === 0 && equipment.length === 0,
    });
    return this._collisionResult;
  }

  get stats() {
    const roleCounts = {};
    const stateCounts = {};
    for (const role of Object.values(TECHNICIAN_ROLES)) roleCounts[role] = 0;
    for (const worker of this.technicians) {
      roleCounts[worker.role] += 1;
      stateCounts[worker.state] = (stateCounts[worker.state] || 0) + 1;
    }
    const heights = this.technicians.map((worker) => worker.height);
    const collisionReport = this.validateCollisions();
    return {
      count: this.technicians.length,
      adultScale: heights.every((height) => height >= 1.6 && height <= 1.9),
      heightRange: {
        min: Math.min(...heights),
        max: Math.max(...heights),
        unit: 'metres',
      },
      phase: this.phase,
      visible: this.root.visible,
      roleCounts,
      stateCounts,
      states: this.technicians.map((worker) => ({
        id: worker.id,
        role: worker.role,
        state: worker.state,
        position: worker.position.toArray(),
        height: worker.height,
      })),
      collisions: collisionReport,
      collisionCount: collisionReport.count,
      drawCalls: Object.keys(this.pools).length,
    };
  }

  dispose() {
    this.parent.remove(this.root);
    for (const pool of Object.values(this.pools)) {
      pool.geometry.dispose();
      pool.material.dispose();
    }
  }
}

export default Technicians;
