// 披露宴のゲスト群。48人を少数の InstancedMesh へまとめ、成人家具と同じ縮尺で
// 「入場→着席→乾杯→拍手→歓談」を表現する。顔は写実化せず、既存の丸い造形を保つ。

import * as THREE from 'three';

const MAX_GUESTS = 48;
const MAX_ENTRANTS = 12;
const DEFAULT_REVEALED = 36;
const TAU = Math.PI * 2;

const SKIN = [0xffdfc4, 0xf2c89d, 0xdca879, 0x9b6547, 0x6f4635];
const HAIR = [0x34251e, 0x5a3826, 0x8a5a33, 0xc49a66, 0x77736f, 0xd6d0c5];
const OUTFITS = [
  0x17375e, 0x31594d, 0x69445d, 0x8a3f4d, 0xb68845, 0x577095,
  0x856c9f, 0xc77d86, 0x446a70, 0x594a73, 0x9d7657, 0x455368,
];
const SHOES = [0x211c1b, 0x3b2923, 0x4a3b35, 0x202634];

const UP = new THREE.Vector3(0, 1, 0);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const _root = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _world = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _midpoint = new THREE.Vector3();
const _direction = new THREE.Vector3();
const _color = new THREE.Color();

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const smooth = (value) => {
  const k = clamp(value, 0, 1);
  return k * k * (3 - 2 * k);
};
// Math.random に依存すると比較画像や衝突検証が揺れるため、人物差は添字から決める。
const unit = (index, salt = 0) => {
  const value = Math.sin((index + 1) * 91.733 + salt * 37.719) * 43758.5453;
  return value - Math.floor(value);
};

function standardMaterial(roughness = 0.72, metalness = 0) {
  return new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness,
    metalness,
    vertexColors: true,
  });
}

function normalizeSeat(seat, index) {
  const position = seat?.position;
  return Object.freeze({
    x: Number.isFinite(seat?.x) ? seat.x : (Number.isFinite(position?.x) ? position.x : 0),
    y: Number.isFinite(seat?.y) ? seat.y : (Number.isFinite(position?.y) ? position.y : 0),
    z: Number.isFinite(seat?.z) ? seat.z : (Number.isFinite(position?.z) ? position.z : -index),
    faceY: Number.isFinite(seat?.faceY) ? seat.faceY : 0,
    accessible: seat?.accessible === true || seat?.wheelchair === true,
  });
}

export class Guests {
  constructor(scene, flowers) {
    this.scene = scene;
    this.flowers = flowers;
    this.guests = [];
    this.time = 0;
    this.timeline = [];
    this.hairFlowers = [];
    this._lastUpdateWasAbsolute = false;
    this.pools = this._makePools();
  }

  _makePool(name, geometry, material, capacity) {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = `wedding-guests-${name}`;
    mesh.count = 0;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(mesh);
    return mesh;
  }

  _makePools() {
    // 腕と脚は同じ丸いカプセル形状を共有する。合計8 poolなので、影パスなしで
    // 48人と車椅子を描いてもゲスト由来の draw call は最大8回に固定される。
    return Object.freeze({
      torso: this._makePool(
        'torsos', new THREE.CapsuleGeometry(0.18, 0.42, 4, 8), standardMaterial(0.68), MAX_GUESTS,
      ),
      head: this._makePool(
        'heads', new THREE.SphereGeometry(0.15, 12, 8), standardMaterial(0.62), MAX_GUESTS,
      ),
      hair: this._makePool(
        'hair', new THREE.SphereGeometry(0.154, 12, 8, 0, TAU, 0, Math.PI * 0.62),
        standardMaterial(0.78), MAX_GUESTS,
      ),
      limb: this._makePool(
        'limbs', new THREE.CapsuleGeometry(0.045, 0.34, 3, 6), standardMaterial(0.72),
        MAX_GUESTS * 4,
      ),
      shoe: this._makePool(
        'shoes', new THREE.SphereGeometry(0.073, 8, 6), standardMaterial(0.58), MAX_GUESTS * 2,
      ),
      cane: this._makePool(
        'canes', new THREE.CylinderGeometry(0.018, 0.018, 1, 6),
        standardMaterial(0.48, 0.15), MAX_GUESTS,
      ),
      wheel: this._makePool(
        'wheelchair-wheels', new THREE.TorusGeometry(0.29, 0.025, 6, 14),
        standardMaterial(0.38, 0.45), MAX_GUESTS * 2,
      ),
      chair: this._makePool(
        'wheelchair-frames', new THREE.BoxGeometry(1, 1, 1),
        standardMaterial(0.44, 0.32), MAX_GUESTS * 6,
      ),
    });
  }

  _setCounts(count) {
    this.pools.torso.count = count;
    this.pools.head.count = count;
    this.pools.hair.count = count;
    this.pools.limb.count = count * 4;
    this.pools.shoe.count = count * 2;
    this.pools.cane.count = count;
    this.pools.wheel.count = count * 2;
    this.pools.chair.count = count * 6;
  }

  _wheelchairIndices(seats, count, options) {
    const requested = clamp(
      Number.isFinite(options.wheelchairCount) ? Math.floor(options.wheelchairCount) : (count >= 12 ? 2 : 0),
      0, Math.min(2, count),
    );
    const result = [];
    for (let index = 0; index < count && result.length < requested; index += 1) {
      if (seats[index].accessible) result.push(index);
    }
    const preferred = [Math.floor(count * 0.21), Math.floor(count * 0.71)];
    for (const index of preferred) {
      if (result.length >= requested) break;
      if (!result.includes(index)) result.push(index);
    }
    for (let index = 0; result.length < requested && index < count; index += 1) {
      if (!result.includes(index)) result.push(index);
    }
    return new Set(result);
  }

  // 48席なら36人を最初から着席させ、残る12人だけが中央通路から入場する。
  // options.enteringCount / initiallySeated / wheelchairCount / hairFlowers で検証時に調整できる。
  spawnParty(seats, flowerType, colorHex, startDelay = 0, options = {}) {
    if (!Array.isArray(seats)) throw new TypeError('Guests.spawnParty requires an array of seats');
    const normalized = seats.slice(0, MAX_GUESTS).map(normalizeSeat);
    const count = normalized.length;
    const defaultEntering = Math.min(MAX_ENTRANTS, Math.max(0, count - DEFAULT_REVEALED));
    let enteringCount = Number.isFinite(options.enteringCount)
      ? Math.floor(options.enteringCount)
      : defaultEntering;
    if (Number.isFinite(options.initiallySeated)) enteringCount = count - Math.floor(options.initiallySeated);
    enteringCount = clamp(enteringCount, 0, Math.min(MAX_ENTRANTS, count));
    // 36席以上ある場合は、最低36人が最初から会場にいるというP0契約を優先する。
    if (count >= DEFAULT_REVEALED) enteringCount = Math.min(enteringCount, count - DEFAULT_REVEALED);
    const firstEntrant = count - enteringCount;
    const wheelchair = this._wheelchairIndices(normalized, count, options);

    this._hideOldHairFlowers();
    this.timeline.length = 0;
    this.time = 0;
    this.guests = normalized.map((seat, index) => {
      const child = !wheelchair.has(index) && (index % 11 === 8 || index % 17 === 13);
      const elderly = !child && (index % 13 === 5 || index % 19 === 9);
      const height = child
        ? 1.10 + unit(index, 2) * 0.24
        : 1.52 + unit(index, 2) * 0.27;
      const entering = index >= firstEntrant;
      const lane = (index - firstEntrant) % 2 === 0 ? -0.72 : 0.72;
      const queue = Math.floor((index - firstEntrant) / 2);
      return {
        index,
        seat,
        child,
        elderly,
        wheelchair: wheelchair.has(index),
        height,
        scale: height / 1.68,
        skin: SKIN[(index * 3 + 1) % SKIN.length],
        hair: elderly ? HAIR[4 + (index % 2)] : HAIR[(index * 5 + 1) % (HAIR.length - 2)],
        outfit: OUTFITS[(index * 7 + 2) % OUTFITS.length],
        shoe: SHOES[index % SHOES.length],
        phase: unit(index, 4) * TAU,
        // travelState は移動の物理状態、state は検証から読める現在の物語状態。
        // 乾杯等の最中も移動状態を壊さないよう分離する。
        travelState: entering ? 'arrival' : 'seated',
        state: entering ? 'arrival' : 'seated',
        visible: !entering,
        delay: Math.max(0, startDelay) + queue * 0.28 + (index % 2) * 0.10,
        walkSpeed: (child ? 1.48 : 1.35) + unit(index, 5) * 0.22,
        lane,
        position: entering
          ? new THREE.Vector3(lane, seat.y, 10.35 + queue * 0.34)
          : new THREE.Vector3(seat.x, seat.y, seat.z),
        rotationY: entering ? Math.PI : seat.faceY,
        sitProgress: entering ? 0 : 1,
      };
    });

    this._setCounts(count);
    this._setInstanceColors();
    this._addHairFlowers(flowerType, colorHex, options);
    this._writeInstances();
    return this.stats;
  }

  _setInstanceColors() {
    for (const guest of this.guests) {
      const index = guest.index;
      this.pools.torso.setColorAt(index, _color.setHex(guest.outfit));
      this.pools.head.setColorAt(index, _color.setHex(guest.skin));
      this.pools.hair.setColorAt(index, _color.setHex(guest.hair));
      for (let part = 0; part < 4; part += 1) {
        const color = part < 2 ? guest.skin : guest.outfit;
        this.pools.limb.setColorAt(index * 4 + part, _color.setHex(color));
      }
      for (let side = 0; side < 2; side += 1) {
        this.pools.shoe.setColorAt(index * 2 + side, _color.setHex(guest.shoe));
        this.pools.wheel.setColorAt(index * 2 + side, _color.setHex(0x30343a));
      }
      this.pools.cane.setColorAt(index, _color.setHex(0x8b673d));
      for (let part = 0; part < 6; part += 1) {
        this.pools.chair.setColorAt(index * 6 + part, _color.setHex(part < 2 ? 0x31475f : 0xb7a979));
      }
    }
    for (const pool of Object.values(this.pools)) {
      if (pool.instanceColor) pool.instanceColor.needsUpdate = true;
    }
  }

  _hideOldHairFlowers() {
    for (const entry of this.hairFlowers) {
      entry.flower.visible = false;
      this.scene.remove(entry.anchor);
    }
    this.hairFlowers.length = 0;
  }

  _addHairFlowers(flowerType, colorHex, options) {
    if (!options.hairFlowers || !this.flowers?.add || !flowerType) return;
    const capacity = this.flowers.capacityUsage?.heads?.remaining;
    const safeRemaining = Number.isFinite(capacity) ? capacity : 0;
    const requested = clamp(Math.floor(options.hairFlowerCount ?? 8), 0, 12);
    const count = Math.min(requested, safeRemaining, this.guests.length);
    for (let index = 0; index < count; index += 1) {
      const guest = this.guests[index];
      const anchor = new THREE.Object3D();
      anchor.name = `guest-${index + 1}-hair-flower-anchor`;
      this.scene.add(anchor);
      try {
        const flower = this.flowers.add(flowerType, colorHex, {
          parent: anchor,
          position: new THREE.Vector3(0.09 * guest.scale, 0.04 * guest.scale, 0),
          scale: 0.58 * guest.scale,
          bloom: 1,
          dynamic: true,
        });
        this.hairFlowers.push({ guest, anchor, flower });
      } catch (error) {
        // FlowerSystem自身も容量を検証する。容量競合時は装飾だけを諦め、人物は維持する。
        this.scene.remove(anchor);
        break;
      }
    }
  }

  _eventTime(time) {
    if (!Number.isFinite(time)) return this.time;
    // 過去時刻を渡された場合は「今すぐ」と解釈し、絶対時刻と経過時刻の両方を扱う。
    return Math.max(this.time, time);
  }

  _scheduleAction(type, time, duration) {
    const start = this._eventTime(time);
    this.timeline = this.timeline.filter((event) => event.type !== type);
    this.timeline.push({ type, start, end: Number.isFinite(duration) ? start + duration : Infinity });
    this.timeline.sort((a, b) => a.start - b.start);
    return this;
  }

  beginToast(time = this.time) {
    return this._scheduleAction('toast', time, 4.2);
  }

  beginApplause(time = this.time) {
    return this._scheduleAction('applause', time, 4.5);
  }

  beginChat(time = this.time) {
    return this._scheduleAction('chat', time, Infinity);
  }

  _currentAction() {
    let active = null;
    for (const event of this.timeline) {
      if (event.start <= this.time && this.time < event.end) active = event;
    }
    return active;
  }

  _advanceGuest(guest, dt) {
    if (guest.travelState === 'arrival') {
      guest.delay -= dt;
      if (guest.delay <= 0) {
        guest.visible = true;
        guest.travelState = 'walking';
        guest.state = 'walking';
      }
      return;
    }
    if (guest.travelState !== 'walking' && guest.travelState !== 'seating') return;
    if (guest.travelState === 'seating') {
      guest.sitProgress = Math.min(1, guest.sitProgress + dt / 0.72);
      if (guest.sitProgress >= 1) {
        guest.travelState = 'seated';
        guest.state = 'seated';
      }
      return;
    }

    const branchZ = guest.seat.z + 1.30;
    if (guest.position.z > branchZ) {
      guest.position.z = Math.max(branchZ, guest.position.z - guest.walkSpeed * dt);
      guest.position.x += (guest.lane - guest.position.x) * Math.min(1, dt * 4);
      guest.rotationY = Math.PI;
      return;
    }
    _direction.set(guest.seat.x - guest.position.x, 0, guest.seat.z - guest.position.z);
    const distance = _direction.length();
    if (distance <= 0.055) {
      guest.position.set(guest.seat.x, guest.seat.y, guest.seat.z);
      guest.rotationY = guest.seat.faceY;
      guest.sitProgress = 0;
      guest.travelState = 'seating';
      guest.state = 'seating';
      return;
    }
    _direction.multiplyScalar(1 / distance);
    guest.position.addScaledVector(_direction, Math.min(distance, guest.walkSpeed * dt));
    guest.rotationY = Math.atan2(_direction.x, _direction.z);
  }

  _hideGuest(index) {
    this.pools.torso.setMatrixAt(index, HIDDEN);
    this.pools.head.setMatrixAt(index, HIDDEN);
    this.pools.hair.setMatrixAt(index, HIDDEN);
    this.pools.cane.setMatrixAt(index, HIDDEN);
    for (let part = 0; part < 4; part += 1) this.pools.limb.setMatrixAt(index * 4 + part, HIDDEN);
    for (let part = 0; part < 2; part += 1) {
      this.pools.shoe.setMatrixAt(index * 2 + part, HIDDEN);
      this.pools.wheel.setMatrixAt(index * 2 + part, HIDDEN);
    }
    for (let part = 0; part < 6; part += 1) this.pools.chair.setMatrixAt(index * 6 + part, HIDDEN);
  }

  _part(pool, index, rootMatrix, position, rotation, scale) {
    _position.set(position[0], position[1], position[2]);
    _euler.set(rotation[0], rotation[1], rotation[2]);
    _quaternion.setFromEuler(_euler);
    _scale.set(scale[0], scale[1], scale[2]);
    _local.compose(_position, _quaternion, _scale);
    _world.multiplyMatrices(rootMatrix, _local);
    pool.setMatrixAt(index, _world);
  }

  _between(pool, index, rootMatrix, from, to, radiusScale = 1) {
    _direction.set(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    const length = Math.max(0.001, _direction.length());
    _midpoint.set(
      (from[0] + to[0]) * 0.5,
      (from[1] + to[1]) * 0.5,
      (from[2] + to[2]) * 0.5,
    );
    _quaternion.setFromUnitVectors(UP, _direction.multiplyScalar(1 / length));
    _scale.set(radiusScale, length / 0.43, radiusScale);
    _local.compose(_midpoint, _quaternion, _scale);
    _world.multiplyMatrices(rootMatrix, _local);
    pool.setMatrixAt(index, _world);
  }

  _poseGuest(guest, action) {
    if (!guest.visible) {
      this._hideGuest(guest.index);
      return;
    }
    const index = guest.index;
    const walking = guest.travelState === 'walking';
    const seated = guest.travelState === 'seated' || guest.travelState === 'seating';
    const sit = seated ? smooth(guest.sitProgress) : 0;
    const s = guest.scale;
    const actionType = seated ? action?.type : null;
    const actionT = action ? this.time - action.start : 0;
    const walkCycle = Math.sin(this.time * 7 + guest.phase);
    const socialSway = Math.sin(this.time * 1.35 + guest.phase) * 0.018;

    _position.copy(guest.position);
    if (walking) _position.y += Math.abs(walkCycle) * 0.028;
    _quaternion.setFromAxisAngle(UP, guest.rotationY);
    _scale.set(1, 1, 1);
    _root.compose(_position, _quaternion, _scale);

    const standingHead = guest.height - 0.15 * s;
    const seatedHead = 0.48 + guest.height * 0.52;
    const headY = THREE.MathUtils.lerp(standingHead, seatedHead, sit) + (actionType === 'chat' ? socialSway : 0);
    const standingTorso = guest.height * 0.59;
    const seatedTorso = 0.48 + guest.height * 0.255;
    const torsoY = THREE.MathUtils.lerp(standingTorso, seatedTorso, sit);
    const torsoLean = actionType === 'chat' ? Math.sin(this.time * 0.9 + guest.phase) * 0.045 : 0;

    this._part(this.pools.torso, index, _root,
      [0, torsoY, 0], [torsoLean, 0, walking ? walkCycle * 0.035 : 0],
      [s * (guest.child ? 0.82 : 1), s * 0.82, s * 0.84]);
    this._part(this.pools.head, index, _root,
      [0, headY, 0.01], [0, actionType === 'chat' ? Math.sin(this.time * 0.8 + guest.phase) * 0.16 : 0, 0],
      [s, s, s]);
    this._part(this.pools.hair, index, _root,
      [0, headY + 0.012 * s, 0], [0, 0, 0], [s * 1.04, s * 1.03, s * 1.04]);

    const shoulderY = THREE.MathUtils.lerp(guest.height * 0.69, 0.48 + guest.height * 0.35, sit);
    const hipY = THREE.MathUtils.lerp(guest.height * 0.39, 0.50 + guest.height * 0.055, sit);
    const footY = 0.08;
    const armSwing = walking ? walkCycle * 0.20 : 0;
    let leftHand = [-0.21 * s, shoulderY - 0.42 * s, armSwing];
    let rightHand = [0.21 * s, shoulderY - 0.42 * s, -armSwing];

    if (sit > 0.5) {
      leftHand = [-0.17 * s, 0.68 + guest.height * 0.06, 0.16];
      rightHand = [0.17 * s, 0.68 + guest.height * 0.06, 0.16];
    }
    if (actionType === 'toast') {
      const lift = smooth(Math.min(1, actionT / 0.9));
      rightHand = [0.22 * s, THREE.MathUtils.lerp(0.78, headY + 0.16 * s, lift), 0.13];
    } else if (actionType === 'applause') {
      const gap = 0.025 + Math.abs(Math.sin(actionT * 7.5 + guest.phase)) * 0.09;
      leftHand = [-gap, shoulderY - 0.08 * s, 0.23];
      rightHand = [gap, shoulderY - 0.08 * s, 0.23];
    } else if (actionType === 'chat') {
      const gesture = (index % 3 === 0) ? Math.sin(actionT * 1.8 + guest.phase) * 0.10 : 0;
      rightHand = [0.19 * s + gesture, shoulderY - 0.23 * s, 0.20];
    }

    this._between(this.pools.limb, index * 4,
      _root, [-0.20 * s, shoulderY, 0], leftHand, s * 0.88);
    this._between(this.pools.limb, index * 4 + 1,
      _root, [0.20 * s, shoulderY, 0], rightHand, s * 0.88);

    const leftFootZ = walking ? walkCycle * 0.18 : (sit > 0.5 ? 0.14 : 0);
    const rightFootZ = walking ? -walkCycle * 0.18 : (sit > 0.5 ? 0.14 : 0);
    this._between(this.pools.limb, index * 4 + 2,
      _root, [-0.095 * s, hipY, 0], [-0.095 * s, footY, leftFootZ], s);
    this._between(this.pools.limb, index * 4 + 3,
      _root, [0.095 * s, hipY, 0], [0.095 * s, footY, rightFootZ], s);
    this._part(this.pools.shoe, index * 2, _root,
      [-0.095 * s, footY, leftFootZ + 0.045], [0, 0, 0], [s, s * 0.62, s * 1.32]);
    this._part(this.pools.shoe, index * 2 + 1, _root,
      [0.095 * s, footY, rightFootZ + 0.045], [0, 0, 0], [s, s * 0.62, s * 1.32]);

    if (guest.elderly && !guest.wheelchair) {
      this._between(this.pools.cane, index, _root,
        [0.30 * s, 0.04, 0.12], [0.28 * s, 0.84, 0.06], 1);
    } else {
      this.pools.cane.setMatrixAt(index, HIDDEN);
    }
    this._poseWheelchair(guest, _root);

    const flower = this.hairFlowers.find((entry) => entry.guest === guest);
    if (flower) {
      flower.anchor.position.set(guest.position.x, guest.position.y, guest.position.z);
      flower.anchor.quaternion.setFromAxisAngle(UP, guest.rotationY);
      flower.anchor.translateY(headY);
      flower.anchor.updateMatrixWorld(true);
    }
  }

  _poseWheelchair(guest, rootMatrix) {
    const index = guest.index;
    if (!guest.wheelchair || !guest.visible) {
      for (let side = 0; side < 2; side += 1) this.pools.wheel.setMatrixAt(index * 2 + side, HIDDEN);
      for (let part = 0; part < 6; part += 1) this.pools.chair.setMatrixAt(index * 6 + part, HIDDEN);
      return;
    }
    for (let side = 0; side < 2; side += 1) {
      this._part(this.pools.wheel, index * 2 + side, rootMatrix,
        [side === 0 ? -0.31 : 0.31, 0.32, 0.02], [0, Math.PI / 2, 0], [1, 1, 1]);
    }
    const parts = [
      [[0, 0.48, 0.02], [0.56, 0.06, 0.52]],
      [[0, 0.73, -0.215], [0.53, 0.48, 0.055]],
      [[0, 0.31, 0.02], [0.64, 0.035, 0.035]],
      [[-0.27, 0.61, -0.01], [0.035, 0.27, 0.42]],
      [[0.27, 0.61, -0.01], [0.035, 0.27, 0.42]],
      [[0, 0.18, 0.31], [0.42, 0.035, 0.18]],
    ];
    parts.forEach(([position, scale], part) => {
      this._part(this.pools.chair, index * 6 + part, rootMatrix, position, [0, 0, 0], scale);
    });
  }

  _writeInstances() {
    const action = this._currentAction();
    for (const guest of this.guests) {
      guest.state = guest.travelState === 'seated' && action ? action.type : guest.travelState;
      this._poseGuest(guest, action);
    }
    for (const pool of Object.values(this.pools)) pool.instanceMatrix.needsUpdate = true;
  }

  // update(dt) は従来どおり。第二引数に会場の絶対経過秒を渡すこともできる。
  update(dt, elapsedTime = null) {
    const delta = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.12);
    if (Number.isFinite(elapsedTime)) {
      this.time = Math.max(0, elapsedTime);
      this._lastUpdateWasAbsolute = true;
    } else {
      this.time += delta;
      this._lastUpdateWasAbsolute = false;
    }
    for (const guest of this.guests) this._advanceGuest(guest, delta);
    this._writeInstances();
    return this.stats;
  }

  get stats() {
    let visible = 0;
    let walking = 0;
    let seated = 0;
    let toasting = 0;
    let applauding = 0;
    let chatting = 0;
    let children = 0;
    let elderly = 0;
    let wheelchairUsers = 0;
    const adultHeights = [];
    const action = this._currentAction()?.type;
    for (const guest of this.guests) {
      if (guest.child) children += 1;
      else adultHeights.push(guest.height);
      if (guest.elderly) elderly += 1;
      if (guest.wheelchair) wheelchairUsers += 1;
      if (guest.visible) visible += 1;
      if (guest.travelState === 'walking' || guest.travelState === 'seating') walking += 1;
      const isSeated = guest.travelState === 'seated';
      if (isSeated) seated += 1;
      if (isSeated && action === 'toast') toasting += 1;
      if (isSeated && action === 'applause') applauding += 1;
      if (isSeated && action === 'chat') chatting += 1;
    }
    const activePools = Object.values(this.pools).filter((pool) => pool.count > 0);
    return Object.freeze({
      planned: this.guests.length,
      visible,
      walking,
      seated,
      toasting,
      applauding,
      chatting,
      adults: this.guests.length - children,
      children,
      elderly,
      wheelchairUsers,
      adultHeightRange: adultHeights.length ? [
        +Math.min(...adultHeights).toFixed(3),
        +Math.max(...adultHeights).toFixed(3),
      ] : [0, 0],
      drawCalls: activePools.length,
      instances: activePools.reduce((sum, pool) => sum + pool.count, 0),
    });
  }
}
