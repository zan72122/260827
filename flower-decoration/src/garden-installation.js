// フィナーレ用の軽量な装花施工レンダラー。
// 花房だけでなく、茎・葉・低い花器・吸水フォームも種類別InstancedMeshへ集約し、
// 近景で「どこから生えているか」が読める状態を少ないdraw callで作る。

import * as THREE from 'three';

const DEFAULT_PLANNED_CAPACITY = 1800;
const HEADROOM_RATIO = 0.2;
const BLOOM_DURATION = 0.72;
const KINDS = ['hydrangea', 'baby', 'leaf', 'stem', 'support', 'foam'];
const PALETTE_ROLES = ['primary', 'neutral', 'accent', 'foliage', 'structure', 'mechanics'];

const _matrix = new THREE.Matrix4();
const _animatedScale = new THREE.Vector3();
const _zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// 低ポリゴンの八面体を複数まとめ、1インスタンス=1花房にする。
function makeOctahedronCluster(points, radius) {
  const positions = [];
  const indices = [];
  const localVertices = [
    [0, 1, 0], [1, 0, 0], [0, 0, 1],
    [-1, 0, 0], [0, 0, -1], [0, -1, 0],
  ];
  const localFaces = [
    [0, 2, 1], [0, 3, 2], [0, 4, 3], [0, 1, 4],
    [5, 1, 2], [5, 2, 3], [5, 3, 4], [5, 4, 1],
  ];

  for (const point of points) {
    const offset = positions.length / 3;
    for (const vertex of localVertices) {
      positions.push(
        point[0] + vertex[0] * radius,
        point[1] + vertex[1] * radius,
        point[2] + vertex[2] * radius,
      );
    }
    for (const face of localFaces) {
      indices.push(offset + face[0], offset + face[1], offset + face[2]);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function makeHydrangeaGeometry() {
  return makeOctahedronCluster([
    [0, 0.055, 0], [0.05, 0.05, 0], [-0.05, 0.05, 0],
    [0, 0.05, 0.05], [0, 0.05, -0.05],
    [0.037, 0.087, 0.032], [-0.037, 0.087, -0.032],
    [-0.034, 0.082, 0.035], [0.034, 0.082, -0.035],
    [0, 0.11, 0],
  ], 0.036);
}

function makeBabyBreathGeometry() {
  return makeOctahedronCluster([
    [0, 0.105, 0],
    [0.052, 0.076, 0.012], [-0.052, 0.078, -0.01],
    [0.014, 0.068, 0.046], [-0.012, 0.064, -0.046],
  ], 0.018);
}

function makeEucalyptusGeometry() {
  const geometry = new THREE.BufferGeometry();
  const positions = [];
  const indices = [];
  const leaves = [[-0.024, 0.045, -0.42], [0.026, 0.085, 0.45], [-0.022, 0.125, -0.38], [0.021, 0.162, 0.35]];
  for (const [cx, cy, tilt] of leaves) {
    const id = positions.length / 3;
    const dx = Math.cos(tilt) * 0.028, dy = Math.sin(tilt) * 0.018;
    positions.push(cx, cy - 0.034, 0, cx + dx, cy, 0.004, cx, cy + 0.034, 0, cx - dx, cy, -0.004);
    indices.push(id, id + 1, id + 2, id, id + 2, id + 3);
  }
  // 細い茎を平面2三角形で足す。
  const stem = positions.length / 3;
  positions.push(-0.003, 0, 0, 0.003, 0, 0, 0.003, 0.19, 0, -0.003, 0.19, 0);
  indices.push(stem, stem + 1, stem + 2, stem, stem + 2, stem + 3);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

// 花器の口元から花首まで届く、わずかに太さの違う五角柱の茎。
function makeStemGeometry() {
  const geometry = new THREE.CylinderGeometry(0.011, 0.016, 0.42, 5, 1, false);
  geometry.translate(0, 0.21, 0);
  geometry.computeBoundingSphere();
  return geometry;
}

// アンティーク真鍮／陶器に見える、床置き用の浅いコンポート。
function makeSupportGeometry() {
  const bowl = new THREE.CylinderGeometry(0.22, 0.16, 0.16, 12, 1, false);
  bowl.translate(0, 0.12, 0);
  const foot = new THREE.CylinderGeometry(0.10, 0.14, 0.08, 10, 1, false);
  foot.translate(0, 0.04, 0);

  // 依存追加を避け、2つの非index geometryを手作業で連結する。
  const geometries = [bowl.toNonIndexed(), foot.toNonIndexed()];
  const positions = [];
  const normals = [];
  for (const geometry of geometries) {
    positions.push(...geometry.getAttribute('position').array);
    normals.push(...geometry.getAttribute('normal').array);
    geometry.dispose();
  }
  bowl.dispose();
  foot.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

// 花首の隙間から少しだけ見える、低い吸水フォーム。
function makeFoamGeometry() {
  const geometry = new THREE.SphereGeometry(0.18, 8, 5);
  geometry.scale(1, 0.42, 1.18);
  geometry.computeBoundingSphere();
  return geometry;
}

function toneAmount(tone) {
  if (Number.isFinite(tone)) return clamp(tone, -1, 1);
  if (tone === 'light' || tone === 'pale') return 0.7;
  if (tone === 'dark' || tone === 'deep') return -0.7;
  return 0;
}

function flowerColor(selected, kind, tone, paletteRole = 'primary') {
  const selectedHsl = {};
  selected.getHSL(selectedHsl);
  const amount = toneAmount(tone);
  if (paletteRole === 'neutral') {
    // 真っ白ではなく、会場照明を受けるアイボリー〜クリーム。
    return new THREE.Color().setHSL(
      0.095 + amount * 0.015,
      0.38,
      clamp(0.88 + amount * 0.10 + (kind === 'baby' ? 0.025 : 0), 0.76, 0.96),
    );
  }
  if (paletteRole === 'accent') {
    // 選択色から約150度離した、面積の小さい低彩度の対比色。
    return new THREE.Color().setHSL(
      (selectedHsl.h + 0.42) % 1,
      clamp(selectedHsl.s * 0.72, 0.34, 0.68),
      clamp(0.48 + amount * 0.13 + (kind === 'baby' ? 0.08 : 0), 0.34, 0.72),
    );
  }
  const babyLift = kind === 'baby' ? 0.1 : 0;
  return new THREE.Color().setHSL(
    selectedHsl.h,
    clamp(selectedHsl.s * (amount > 0 ? 0.9 : 1), 0.24, 1),
    clamp(selectedHsl.l + amount * 0.2 + babyLift, 0.18, 0.92),
  );
}

function leafColor(tone) {
  const amount = toneAmount(tone);
  return new THREE.Color().setHSL(
    0.31 + amount * 0.012,
    0.38,
    clamp(0.34 + amount * 0.09, 0.22, 0.5),
  );
}

function structureColor(tone) {
  const amount = toneAmount(tone);
  return new THREE.Color().setHSL(0.105, 0.42, clamp(0.42 + amount * 0.08, 0.32, 0.52));
}

function foamColor(tone) {
  const amount = toneAmount(tone);
  return new THREE.Color().setHSL(0.29, 0.30, clamp(0.20 + amount * 0.05, 0.14, 0.26));
}

function colorForRecord(selected, record) {
  if (record.kind === 'leaf' || record.kind === 'stem') return leafColor(record.tone);
  if (record.kind === 'support') return structureColor(record.tone);
  if (record.kind === 'foam') return foamColor(record.tone);
  return flowerColor(selected, record.kind, record.tone, record.paletteRole);
}

function normaliseScale(scale) {
  if (scale && scale.isVector3) return scale.clone();
  if (Array.isArray(scale) && scale.length >= 3) {
    return new THREE.Vector3(scale[0], scale[1], scale[2]);
  }
  const scalar = Number.isFinite(scale) ? Math.max(0, scale) : 1;
  return new THREE.Vector3(scalar, scalar, scalar);
}

function normaliseEntry(entry, index) {
  if (!entry || !KINDS.includes(entry.kind)) {
    throw new TypeError(`GardenInstallation: entry ${index} has an invalid kind`);
  }
  if (!entry.position || !entry.position.isVector3) {
    throw new TypeError(`GardenInstallation: entry ${index} needs a THREE.Vector3 position`);
  }
  if (!entry.quaternion || !entry.quaternion.isQuaternion) {
    throw new TypeError(`GardenInstallation: entry ${index} needs a THREE.Quaternion quaternion`);
  }
  if (!PALETTE_ROLES.includes(entry.paletteRole)) {
    throw new TypeError(`GardenInstallation: entry ${index} has an invalid paletteRole`);
  }

  return {
    kind: entry.kind,
    position: entry.position.clone(),
    quaternion: entry.quaternion.clone(),
    scale: normaliseScale(entry.scale),
    tone: entry.tone,
    role: typeof entry.role === 'string' && entry.role ? entry.role : 'unknown',
    paletteRole: entry.paletteRole,
    clusterId: typeof entry.clusterId === 'string' && entry.clusterId ? entry.clusterId : null,
    clusterType: typeof entry.clusterType === 'string' && entry.clusterType ? entry.clusterType : null,
    delay: Number.isFinite(entry.delay) ? Math.max(0, entry.delay) : 0,
    zone: typeof entry.zone === 'string' && entry.zone ? entry.zone : 'unknown',
    progress: 0,
    instanceId: -1,
  };
}

function easeBloom(value) {
  const t = clamp(value, 0, 1);
  const smooth = t * t * (3 - 2 * t);
  // 中盤だけごく小さく膨らませ、花房が弾むように咲く。
  return smooth + Math.sin(smooth * Math.PI) * 0.055;
}

function makeMaterial(kind) {
  return new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: kind === 'support' ? 0.48 : kind === 'foam' ? 1 : (kind === 'leaf' || kind === 'stem') ? 0.82 : 0.74,
    metalness: kind === 'support' ? 0.16 : 0,
    flatShading: kind !== 'leaf' && kind !== 'stem',
    side: kind === 'leaf' || kind === 'stem' ? THREE.DoubleSide : THREE.FrontSide,
  });
}

export class GardenInstallation {
  constructor(scene, { capacity = DEFAULT_PLANNED_CAPACITY } = {}) {
    if (!scene || typeof scene.add !== 'function') {
      throw new TypeError('GardenInstallation: scene must be a THREE.Scene or Object3D');
    }
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError('GardenInstallation: capacity must be a positive integer');
    }

    this.scene = scene;
    this.plannedCapacity = capacity;
    this.capacity = Math.ceil(capacity * (1 + HEADROOM_RATIO));
    this.meshes = {};
    this._records = [];
    this._byKind = Object.fromEntries(KINDS.map(kind => [kind, 0]));
    this._byZone = {};
    this._byPalette = {};
    this._byRole = {};
    this._clusters = { count: 0, byType: {} };
    this._revealStart = null;
    this._revealing = false;
    this._complete = false;

    const geometries = {
      hydrangea: makeHydrangeaGeometry(),
      baby: makeBabyBreathGeometry(),
      leaf: makeEucalyptusGeometry(),
      stem: makeStemGeometry(),
      support: makeSupportGeometry(),
      foam: makeFoamGeometry(),
    };

    for (const kind of KINDS) {
      // 各種類が全容量を使えるようにしておき、種類配合の変更でも再生成を不要にする。
      const mesh = new THREE.InstancedMesh(
        geometries[kind],
        makeMaterial(kind),
        this.capacity,
      );
      mesh.name = `garden-installation-${kind}`;
      mesh.count = 0;
      mesh.castShadow = kind !== 'baby' && kind !== 'stem' && kind !== 'foam';
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(mesh);
      this.meshes[kind] = mesh;
    }
  }

  // entries はプランナーが確定したワールド座標。colorHex はプレイヤーの選択色。
  install(entries, colorHex) {
    if (!Array.isArray(entries)) {
      throw new TypeError('GardenInstallation: entries must be an array');
    }
    if (entries.length > this.capacity) {
      throw new RangeError(
        `GardenInstallation: ${entries.length} entries exceed capacity ${this.capacity}`,
      );
    }

    // 全件を先に検証し、入力不正時に表示中の装花を半端に壊さない。
    const records = entries.map(normaliseEntry);
    const selected = new THREE.Color(colorHex);
    const byKind = Object.fromEntries(KINDS.map(kind => [kind, 0]));
    const byZone = {};
    const byPalette = {};
    const byRole = {};
    const clusterIds = new Set();
    const clustersByType = {};

    for (const kind of KINDS) this.meshes[kind].count = 0;

    for (const record of records) {
      const mesh = this.meshes[record.kind];
      const instanceId = byKind[record.kind]++;
      record.instanceId = instanceId;
      mesh.setMatrixAt(instanceId, _zeroMatrix);
      mesh.setColorAt(instanceId, colorForRecord(selected, record));
      byZone[record.zone] = (byZone[record.zone] || 0) + 1;
      byPalette[record.paletteRole] = (byPalette[record.paletteRole] || 0) + 1;
      byRole[record.role] = (byRole[record.role] || 0) + 1;
      if (record.clusterId) {
        clusterIds.add(record.clusterId);
        const key = record.clusterType || 'unknown';
        if (!clustersByType[key]) clustersByType[key] = new Set();
        clustersByType[key].add(record.clusterId);
      }
    }

    for (const kind of KINDS) {
      const mesh = this.meshes[kind];
      mesh.count = byKind[kind];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    this._records = records;
    this._byKind = byKind;
    this._byZone = byZone;
    this._byPalette = byPalette;
    this._byRole = byRole;
    this._clusters = {
      count: clusterIds.size,
      byType: Object.fromEntries(Object.entries(clustersByType).map(([key, ids]) => [key, ids.size])),
    };
    this._revealStart = null;
    this._revealing = false;
    this._complete = records.length === 0;
    return this.stats;
  }

  // startTime と update(time) は同じ時計の「秒」単位で渡す。
  reveal(startTime) {
    if (!Number.isFinite(startTime)) {
      throw new TypeError('GardenInstallation: reveal startTime must be finite');
    }

    for (const record of this._records) record.progress = 0;
    for (const kind of KINDS) {
      const mesh = this.meshes[kind];
      for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, _zeroMatrix);
      mesh.instanceMatrix.needsUpdate = true;
    }
    this._revealStart = startTime;
    this._revealing = this._records.length > 0;
    this._complete = this._records.length === 0;
    return this._complete;
  }

  update(time) {
    if (!Number.isFinite(time)) return this._complete;
    if (!this._revealing || this._complete || this._revealStart == null) {
      return this._complete;
    }

    const elapsed = time - this._revealStart;
    const touched = new Set();
    let allComplete = true;

    for (const record of this._records) {
      if (record.progress >= 1) continue;
      const rawProgress = (elapsed - record.delay) / BLOOM_DURATION;
      if (rawProgress <= 0) {
        allComplete = false;
        continue;
      }

      const progress = clamp(rawProgress, 0, 1);
      const growth = easeBloom(progress);
      _animatedScale.copy(record.scale).multiplyScalar(growth);
      _matrix.compose(record.position, record.quaternion, _animatedScale);
      this.meshes[record.kind].setMatrixAt(record.instanceId, _matrix);
      touched.add(record.kind);
      record.progress = progress;
      if (progress < 1) allComplete = false;
    }

    for (const kind of touched) this.meshes[kind].instanceMatrix.needsUpdate = true;

    if (allComplete) {
      this._complete = true;
      this._revealing = false;
    }
    return this._complete;
  }

  get stats() {
    const supportDetail = Object.freeze({
      vessels: this._byKind.support || 0,
      foam: this._byKind.foam || 0,
    });
    return Object.freeze({
      used: this._records.length,
      plannedCapacity: this.plannedCapacity,
      capacity: this.capacity,
      remaining: this.capacity - this._records.length,
      byKind: Object.freeze({ ...this._byKind }),
      byZone: Object.freeze({ ...this._byZone }),
      byRole: Object.freeze({ ...this._byRole }),
      supports: supportDetail.vessels + supportDetail.foam,
      supportDetail,
      stems: this._byKind.stem || 0,
      palette: Object.freeze({ ...this._byPalette }),
      clusters: Object.freeze({
        count: this._clusters.count,
        byType: Object.freeze({ ...this._clusters.byType }),
      }),
      revealing: this._revealing,
      complete: this._complete,
    });
  }
}
