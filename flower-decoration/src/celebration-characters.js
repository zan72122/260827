// フィナーレを彩る4人の祝宴キャラクター。
// 全パーツを形状・材質別のInstancedMeshへ集約し、少ないdraw callで穏やかに動かす。

import * as THREE from 'three';
import { PALACE_LAYOUT } from './palace-config.js';

const STATION_INTRO_DURATION = 0.9;
const COUPLE_ENTRANCE_DURATION = 9;
const TOAST_RAISE_DURATION = 0.65;
const APPLAUSE_BOW_DURATION = 1.4;
const SERVICE_TRAVEL_DURATION = 1.3;
const SERVICE_HOLD_DURATION = 1;
const SERVICE_TOTAL_DURATION = SERVICE_TRAVEL_DURATION * 2 + SERVICE_HOLD_DURATION;
const SERVICE_TARGET = Object.freeze([6.45, 0, -7]);
const SERVICE_WAYPOINT = Object.freeze([6.58, 0, -8.4]);
const SERVICE_BODY_RADIUS = 0.3;
const TABLE_CHAIR_ENVELOPE = 1.63;
const HEAD_TABLE_CLEARANCE = 0.1;
const COUPLE_FOOTPRINT = Object.freeze({ halfWidth: 0.3, halfDepth: 0.22 });
const ROLE_ORDER = Object.freeze(['bride', 'groom', 'pianist', 'bartender']);
const ROLE_DELAYS = Object.freeze([0, 0.22, 0.62, 0.9]);
const ROLE_YAWS = Object.freeze({ bride: 0, groom: 0, pianist: -Math.PI / 2, bartender: 0 });
const COLORS = Object.freeze({
  skin: 0xf2c8a6,
  hair: 0x382820,
  warmHair: 0x765036,
  eye: 0x2a211e,
  ivory: 0xfff9ed,
  suit: 0x282a35,
  burgundy: 0x673849,
  gold: 0xcda95d,
  glass: 0xf4dfbc,
});

const GEOMETRIES = Object.freeze({
  sphere: new THREE.SphereGeometry(1, 10, 7),
  cylinder: new THREE.CylinderGeometry(1, 0.82, 1, 8),
  box: new THREE.BoxGeometry(1, 1, 1),
  cone: new THREE.ConeGeometry(1, 1, 14),
  plane: new THREE.PlaneGeometry(1, 1, 2, 4),
  glass: new THREE.CylinderGeometry(1, 0.5, 1, 8),
});

const clamp01 = value => Math.max(0, Math.min(1, value));
const smoothstep = value => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

function part(pool, role, bone, position, scale, color, options = {}) {
  return {
    pool, role, bone,
    position: new THREE.Vector3(...position),
    scale: new THREE.Vector3(...scale),
    rotation: new THREE.Euler(...(options.rotation || [0, 0, 0])),
    accent: Boolean(options.accent),
    followBreath: Boolean(options.followBreath),
    spinGlass: Boolean(options.spinGlass),
    serviceOnly: Boolean(options.serviceOnly),
    color,
  };
}

function addFace(parts, role, hairColor, { bun = false } = {}) {
  parts.push(
    part('sphere', role, 'head', [0, 0, 0], [0.15, 0.15, 0.15], COLORS.skin),
    part('sphere', role, 'head', [0, 0.035, -0.055], [0.158, 0.118, 0.145], hairColor),
    part('sphere', role, 'head', [-0.05, 0.018, 0.14], [0.018, 0.018, 0.012], COLORS.eye),
    part('sphere', role, 'head', [0.05, 0.018, 0.14], [0.018, 0.018, 0.012], COLORS.eye),
    part('sphere', role, 'head', [0, -0.018, 0.15], [0.017, 0.02, 0.014], COLORS.skin),
  );
  if (bun) parts.push(part('sphere', role, 'head', [0, 0.07, -0.13], [0.09, 0.09, 0.09], hairColor));
}

function addBody(parts, role, clothing, hairColor, options = {}) {
  const legColor = options.legColor || COLORS.suit;
  parts.push(part('cylinder', role, 'static', [0, 0.76, 0], [0.18, 0.48, 0.18], clothing, { followBreath: true }));
  for (const side of [-1, 1]) {
    const bone = side < 0 ? 'leftArm' : 'rightArm';
    parts.push(
      part('cylinder', role, bone, [0, -0.205, 0], [0.045, 0.43, 0.045], clothing),
      part('sphere', role, bone, [0, -0.44, 0], [0.055, 0.055, 0.055], COLORS.skin),
      part('cylinder', role, 'static', [side * 0.085, 0.3, 0], [0.065, 0.52, 0.065], legColor),
      part('box', role, 'static', [side * 0.085, 0.06, 0.045], [0.13, 0.08, 0.22], COLORS.suit),
    );
  }
  addFace(parts, role, hairColor, options);
}

function createParts(accentColor) {
  const parts = [];

  // 花嫁：大きなアイボリーの裾、細身のベール、選択色のサッシュ。
  addBody(parts, 'bride', COLORS.ivory, COLORS.warmHair, { bun: true });
  parts.push(
    // 奥行きを抑え、高砂テーブルと背面幕の間に立てるドレス形状にする。
    part('cone', 'bride', 'static', [0, 0.42, 0], [0.3, 0.76, 0.2], COLORS.ivory),
    part('plane', 'bride', 'static', [0, 0.83, -0.145], [0.58, 0.82, 1], COLORS.ivory),
    part('box', 'bride', 'static', [0, 0.73, 0.18], [0.275, 0.04, 0.025], accentColor,
      { accent: true, followBreath: true }),
    part('glass', 'bride', 'rightArm', [0, -0.53, 0.045], [0.045, 0.09, 0.045], COLORS.glass,
      { spinGlass: true }),
  );

  // 花婿：暗色の燕尾服、白い胸元、選択色の蝶ネクタイとブートニア。
  addBody(parts, 'groom', COLORS.suit, COLORS.hair);
  parts.push(
    part('box', 'groom', 'static', [0, 0.8, 0.185], [0.11, 0.22, 0.025], COLORS.ivory,
      { followBreath: true }),
    part('box', 'groom', 'static', [-0.055, 0.94, 0.195], [0.075, 0.055, 0.035], accentColor,
      { accent: true, rotation: [0, 0, 0.35], followBreath: true }),
    part('box', 'groom', 'static', [0.055, 0.94, 0.195], [0.075, 0.055, 0.035], accentColor,
      { accent: true, rotation: [0, 0, -0.35], followBreath: true }),
    part('sphere', 'groom', 'static', [-0.14, 0.91, 0.185], [0.035, 0.035, 0.024], accentColor,
      { accent: true, followBreath: true }),
    part('glass', 'groom', 'leftArm', [0, -0.53, 0.045], [0.045, 0.09, 0.045], COLORS.glass,
      { spinGlass: true }),
  );

  // ピアニスト：バーガンディの上着と金の小さな蝶ネクタイ。
  addBody(parts, 'pianist', COLORS.burgundy, COLORS.hair);
  parts.push(part('box', 'pianist', 'static', [0, 0.94, 0.19], [0.13, 0.05, 0.03], COLORS.gold,
    { followBreath: true }));

  // バーテンダー：白シャツ、濃色ベスト、選択色の蝶ネクタイ。両手に布とグラス。
  addBody(parts, 'bartender', COLORS.ivory, COLORS.warmHair);
  parts.push(
    part('box', 'bartender', 'static', [0, 0.77, 0.19], [0.275, 0.44, 0.025], COLORS.suit,
      { followBreath: true }),
    part('box', 'bartender', 'static', [0, 0.94, 0.205], [0.14, 0.055, 0.035], accentColor,
      { accent: true, followBreath: true }),
    part('box', 'bartender', 'leftArm', [0, -0.5, 0.04], [0.16, 0.1, 0.035], COLORS.ivory,
      { rotation: [0, 0, 0.22] }),
    part('glass', 'bartender', 'rightArm', [0, -0.53, 0.045], [0.045, 0.09, 0.045], COLORS.glass,
      { spinGlass: true }),
    // 給仕中だけ既存box/glassプール内で表示するトレイとグラス。
    part('box', 'bartender', 'static', [0, 1.02, 0.29], [0.34, 0.025, 0.23], COLORS.gold,
      { serviceOnly: true }),
    part('glass', 'bartender', 'static', [-0.11, 1.12, 0.29], [0.035, 0.09, 0.035], COLORS.glass,
      { serviceOnly: true }),
    part('glass', 'bartender', 'static', [0.11, 1.12, 0.29], [0.035, 0.09, 0.035], COLORS.glass,
      { serviceOnly: true }),
  );
  return parts;
}

function makePoolMaterial(pool) {
  if (pool === 'plane') {
    return new THREE.MeshStandardMaterial({
      color: 0xffffff, transparent: true, opacity: 0.42, depthWrite: false,
      roughness: 0.42, side: THREE.DoubleSide,
    });
  }
  if (pool === 'glass') {
    return new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0x39200c, emissiveIntensity: 0.12,
      transparent: true, opacity: 0.58, depthWrite: false, metalness: 0.08, roughness: 0.18,
    });
  }
  return new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0.02 });
}

function setPartColor(pool, item, colorHex) {
  pool.mesh.setColorAt(item.index, new THREE.Color(item.accent ? colorHex : item.color));
}

function headTableLayout() {
  const configured = PALACE_LAYOUT.headTable || {};
  const center = Array.isArray(configured.center) ? configured.center : [0, 0.35, -10.7];
  const centerZ = center.length >= 3 ? center[2] : center[1];
  return Object.freeze({
    centerX: Number.isFinite(center[0]) ? center[0] : 0,
    centerZ: Number.isFinite(centerZ) ? centerZ : -10.7,
    halfWidth: Number.isFinite(configured.halfWidth) ? configured.halfWidth : 1.8,
    halfDepth: Number.isFinite(configured.halfDepth) ? configured.halfDepth : 0.45,
    backdropZ: Number.isFinite(configured.backdropZ) ? configured.backdropZ : PALACE_LAYOUT.hall.backZ,
  });
}

function collisionReport(position, table = headTableLayout()) {
  const frontEdge = table.centerZ + table.halfDepth;
  const backEdge = table.centerZ - table.halfDepth;
  const behindTable = position.z < table.centerZ;
  const tableGap = behindTable
    ? backEdge - (position.z + COUPLE_FOOTPRINT.halfDepth)
    : (position.z - COUPLE_FOOTPRINT.halfDepth) - frontEdge;
  const backdropGap = position.z - COUPLE_FOOTPRINT.halfDepth - table.backdropZ;
  const overlapsTableX = Math.abs(position.x - table.centerX)
    < table.halfWidth + COUPLE_FOOTPRINT.halfWidth;
  const tableSafe = !overlapsTableX || tableGap >= HEAD_TABLE_CLEARANCE;
  const backdropSafe = !behindTable || backdropGap >= HEAD_TABLE_CLEARANCE;
  return Object.freeze({
    tableSafe,
    backdropSafe,
    safe: tableSafe && backdropSafe,
    behindTable,
    tableGap: +tableGap.toFixed(3),
    backdropGap: +backdropGap.toFixed(3),
  });
}

function pointBetween(from, to, progress, target = new THREE.Vector3()) {
  return target.lerpVectors(from, to, smoothstep(progress));
}

function serviceRoutePoint(start, waypoint, target, progress, output) {
  const p = clamp01(progress);
  const corner = 0.42;
  if (p <= corner) return pointBetween(start, waypoint, p / corner, output);
  return pointBetween(waypoint, target, (p - corner) / (1 - corner), output);
}

function serviceRouteReport(start) {
  const lane = PALACE_LAYOUT.serviceLanes?.find((entry) => entry.id === 'service-right');
  const tableCenters = PALACE_LAYOUT.tableCenters || [];
  const points = [];
  for (let index = 0; index <= 36; index++) {
    const p = index / 36;
    const corner = 0.42;
    const from = p <= corner ? start : SERVICE_WAYPOINT;
    const to = p <= corner ? SERVICE_WAYPOINT : SERVICE_TARGET;
    const local = p <= corner ? p / corner : (p - corner) / (1 - corner);
    points.push([
      from[0] + (to[0] - from[0]) * smoothstep(local),
      from[2] + (to[2] - from[2]) * smoothstep(local),
    ]);
  }
  const insideHall = points.every(([x, z]) => (
    Math.abs(x) + SERVICE_BODY_RADIUS <= PALACE_LAYOUT.hall.halfWidth
    && z - SERVICE_BODY_RADIUS >= PALACE_LAYOUT.hall.backZ
    && z + SERVICE_BODY_RADIUS <= PALACE_LAYOUT.hall.frontZ
  ));
  const avoidsTables = points.every(([x, z]) => tableCenters.every(([tx, tz]) => (
    Math.hypot(x - tx, z - tz) >= TABLE_CHAIR_ENVELOPE + SERVICE_BODY_RADIUS + HEAD_TABLE_CLEARANCE
  )));
  const targetInLane = Boolean(lane
    && SERVICE_TARGET[0] >= lane.minX && SERVICE_TARGET[0] <= lane.maxX
    && SERVICE_TARGET[2] >= lane.minZ && SERVICE_TARGET[2] <= lane.maxZ);
  return Object.freeze({
    safe: insideHall && avoidsTables && targetInLane,
    insideHall,
    avoidsTables,
    targetInLane,
    samples: points.length,
  });
}

export function buildCelebrationCharacters(scene) {
  if (!scene || typeof scene.add !== 'function') {
    throw new TypeError('buildCelebrationCharacters requires a Three.js scene');
  }

  let accentColor = 0xd68aa4;
  const parts = createParts(accentColor);
  const root = new THREE.Group();
  root.name = 'celebration-characters';
  root.userData.celebrationRoles = [...ROLE_ORDER];
  scene.add(root);

  const pools = [];
  for (const poolName of Object.keys(GEOMETRIES)) {
    const members = parts.filter(item => item.pool === poolName);
    if (members.length === 0) continue;
    const mesh = new THREE.InstancedMesh(GEOMETRIES[poolName], makePoolMaterial(poolName), members.length);
    mesh.name = `celebration-${poolName}`;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const pool = { name: poolName, mesh, members };
    members.forEach((item, index) => {
      item.index = index;
      item.poolRef = pool;
      setPartColor(pool, item, accentColor);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    root.add(mesh);
    pools.push(pool);
  }

  const tableLayout = headTableLayout();
  const records = ROLE_ORDER.map((role, index) => {
    const destination = new THREE.Vector3(...PALACE_LAYOUT.characters[role]);
    const side = role === 'bride' ? -1 : 1;
    const isCouple = role === 'bride' || role === 'groom';
    const start = isCouple
      ? new THREE.Vector3(side * 0.28, 0, PALACE_LAYOUT.hall.frontZ - 1.1)
      : destination.clone();
    const frontOfTableZ = tableLayout.centerZ + tableLayout.halfDepth
      + COUPLE_FOOTPRINT.halfDepth + 0.34;
    const outsideTableX = tableLayout.halfWidth + COUPLE_FOOTPRINT.halfWidth + 0.16;
    const path = isCouple ? Object.freeze([
      start.clone(),
      new THREE.Vector3(side * 0.28, 0, frontOfTableZ),
      new THREE.Vector3(side * outsideTableX, destination.y, frontOfTableZ),
      new THREE.Vector3(side * outsideTableX, destination.y, destination.z),
      destination.clone(),
    ]) : Object.freeze([destination.clone()]);
    return {
      role,
      base: start.clone(),
      destination,
      path,
      isCouple,
      delay: ROLE_DELAYS[index],
      phase: index * 1.37,
      baseYaw: ROLE_YAWS[role],
      restBodyOffset: role === 'pianist' ? -0.08 : 0,
      bodyOffset: role === 'pianist' ? -0.08 : 0,
      // 水平方向の設置面積は保ち、縦だけ成人相当（約1.6〜1.7m）へ伸ばす。
      scaleXZ: role === 'pianist' ? 0.96 : 1,
      scaleY: role === 'pianist' ? 1.2 : 1.28,
      visible: false,
      entrance: 0,
      introYaw: 0,
      breath: 0,
      headTilt: 0,
      glassSpin: 0,
      arms: {
        left: { x: 0, z: 0 },
        right: { x: 0, z: 0 },
      },
      matrix: new THREE.Matrix4(),
    };
  });
  const recordByRole = Object.fromEntries(records.map(record => [record.role, record]));

  const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  const localMatrix = new THREE.Matrix4();
  const boneMatrix = new THREE.Matrix4();
  const resultMatrix = new THREE.Matrix4();
  const scratchPosition = new THREE.Vector3();
  const scratchScale = new THREE.Vector3();
  const scratchQuaternion = new THREE.Quaternion();
  const scratchEuler = new THREE.Euler();
  const serviceWaypoint = new THREE.Vector3(...SERVICE_WAYPOINT);
  const serviceTarget = new THREE.Vector3(...SERVICE_TARGET);
  const serviceNext = new THREE.Vector3();
  const serviceSafety = serviceRouteReport(PALACE_LAYOUT.characters.bartender);
  let serviceStartedAt = 0;
  let serviceActive = false;
  let serviceCompleted = false;
  let serviceStage = 'waiting';
  let serviceElapsed = 0;

  function compose(target, position, rotation, scale) {
    scratchQuaternion.setFromEuler(rotation);
    target.compose(position, scratchQuaternion, scale);
    return target;
  }

  function updateRecordMatrix(record) {
    scratchPosition.copy(record.base);
    scratchPosition.y -= (1 - record.entrance) * 0.1;
    scratchEuler.set(0, record.baseYaw + record.introYaw, 0);
    const entranceScale = 0.72 + record.entrance * 0.28;
    scratchScale.set(
      record.scaleXZ * entranceScale,
      record.scaleY * entranceScale,
      record.scaleXZ * entranceScale,
    );
    compose(record.matrix, scratchPosition, scratchEuler, scratchScale);
  }

  function partLocalMatrix(item, record) {
    if (item.bone === 'head') {
      scratchPosition.set(0, 1.17 + record.bodyOffset + record.breath, 0);
      scratchEuler.set(0, 0, record.headTilt);
      scratchScale.set(1, 1, 1);
      compose(boneMatrix, scratchPosition, scratchEuler, scratchScale);
    } else if (item.bone === 'leftArm' || item.bone === 'rightArm') {
      const side = item.bone === 'leftArm' ? -1 : 1;
      const pose = side < 0 ? record.arms.left : record.arms.right;
      scratchPosition.set(side * 0.205, 0.92 + record.bodyOffset + record.breath, 0);
      scratchEuler.set(pose.x, item.spinGlass ? record.glassSpin : 0, pose.z);
      scratchScale.set(1, 1, 1);
      compose(boneMatrix, scratchPosition, scratchEuler, scratchScale);
    } else {
      scratchPosition.copy(item.position);
      scratchPosition.y += record.bodyOffset + (item.followBreath ? record.breath : 0);
      return compose(localMatrix, scratchPosition, item.rotation, item.scale);
    }

    compose(localMatrix, item.position, item.rotation, item.scale);
    return localMatrix.premultiply(boneMatrix);
  }

  function syncInstances() {
    for (const pool of pools) {
      for (const item of pool.members) {
        const record = recordByRole[item.role];
        if (!record.visible || (item.serviceOnly && !serviceActive)) {
          pool.mesh.setMatrixAt(item.index, hiddenMatrix);
          continue;
        }
        updateRecordMatrix(record);
        const local = partLocalMatrix(item, record);
        resultMatrix.multiplyMatrices(record.matrix, local);
        pool.mesh.setMatrixAt(item.index, resultMatrix);
      }
      pool.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  function placeCoupleOnPath(record, progress) {
    const p = clamp01(progress);
    const stops = [0, 0.62, 0.76, 0.88, 1];
    let segment = stops.length - 2;
    for (let index = 0; index < stops.length - 1; index++) {
      if (p <= stops[index + 1]) { segment = index; break; }
    }
    const span = stops[segment + 1] - stops[segment];
    const local = span > 0 ? (p - stops[segment]) / span : 1;
    pointBetween(record.path[segment], record.path[segment + 1], local, record.base);

    const side = record.role === 'bride' ? -1 : 1;
    const segmentYaws = [Math.PI, side * Math.PI / 2, Math.PI, -side * Math.PI / 2];
    record.baseYaw = segmentYaws[segment];
    if (segment === 3 && local > 0.62) {
      record.baseYaw *= 1 - smoothstep((local - 0.62) / 0.38);
    }
  }

  function placeBartenderService(record, now) {
    const elapsed = Math.max(0, now - serviceStartedAt);
    serviceElapsed = Math.min(elapsed, SERVICE_TOTAL_DURATION);
    let routeProgress = 0;
    if (elapsed < SERVICE_TRAVEL_DURATION) {
      serviceStage = 'approaching';
      routeProgress = elapsed / SERVICE_TRAVEL_DURATION;
    } else if (elapsed < SERVICE_TRAVEL_DURATION + SERVICE_HOLD_DURATION) {
      serviceStage = 'presenting';
      routeProgress = 1;
    } else if (elapsed < SERVICE_TOTAL_DURATION) {
      serviceStage = 'returning';
      routeProgress = 1 - ((elapsed - SERVICE_TRAVEL_DURATION - SERVICE_HOLD_DURATION)
        / SERVICE_TRAVEL_DURATION);
    } else {
      serviceActive = false;
      serviceCompleted = true;
      serviceStage = 'complete';
      record.base.copy(record.destination);
      record.baseYaw = ROLE_YAWS.bartender;
      return;
    }

    serviceRoutePoint(record.destination, serviceWaypoint, serviceTarget, routeProgress, record.base);
    if (serviceStage === 'presenting') {
      record.baseYaw = -Math.PI / 2;
      return;
    }
    const direction = serviceStage === 'returning' ? -1 : 1;
    const nextProgress = clamp01(routeProgress + direction * 0.01);
    serviceRoutePoint(record.destination, serviceWaypoint, serviceTarget, nextProgress, serviceNext);
    const dx = serviceNext.x - record.base.x;
    const dz = serviceNext.z - record.base.z;
    record.baseYaw = Math.atan2(dx, dz);
  }

  function poseRecord(record, celebrationTime, stateElapsed) {
    const slow = celebrationTime + record.phase;
    record.bodyOffset = record.restBodyOffset;
    record.breath = Math.sin(slow * 1.35) * 0.008;
    record.headTilt = Math.sin(slow * 0.72) * 0.025;
    record.glassSpin = 0;
    record.arms.left.x = record.arms.left.z = 0;
    record.arms.right.x = record.arms.right.z = 0;

    if (record.isCouple) {
      const travel = clamp01(celebrationTime / COUPLE_ENTRANCE_DURATION);
      if (travel < 1) {
        const stride = Math.sin(travel * Math.PI * 30);
        record.bodyOffset += Math.abs(stride) * 0.018;
        record.arms.left.x = stride * 0.25;
        record.arms.right.x = -stride * 0.25;
        return;
      }

      if (phase === 'toast') {
        const toast = smoothstep(stateElapsed / TOAST_RAISE_DURATION);
        record.baseYaw = 0;
        if (record.role === 'bride') {
          record.arms.right.x = -0.82 * toast;
          record.arms.right.z = 1.02 * toast;
          record.arms.left.z = 0.08 * toast;
        } else {
          record.arms.left.x = -0.82 * toast;
          record.arms.left.z = -1.02 * toast;
          record.arms.right.z = -0.08 * toast;
        }
        record.glassSpin = slow * 0.08;
        return;
      }

      if (phase === 'applause') {
        const bow = Math.sin(Math.PI * clamp01(stateElapsed / APPLAUSE_BOW_DURATION));
        record.bodyOffset -= bow * 0.035;
        record.headTilt += (record.role === 'bride' ? 1 : -1) * bow * 0.09;
        record.arms.left.x = -0.35 * bow;
        record.arms.right.x = -0.35 * bow;
        record.arms.left.z = record.role === 'bride' ? -0.25 * bow : 0.18 * bow;
        record.arms.right.z = record.role === 'bride' ? -0.18 * bow : 0.25 * bow;
        return;
      }

      if (phase === 'chat') {
        const inward = record.role === 'bride' ? 0.24 : -0.24;
        record.baseYaw = inward + Math.sin(slow * 0.38) * 0.035;
        const gesture = 0.5 + 0.5 * Math.sin(slow * 0.72);
        if (record.role === 'bride') {
          record.arms.left.x = -0.22 * gesture;
          record.arms.left.z = 0.2 * gesture;
          record.arms.right.x = -0.12;
        } else {
          record.arms.right.x = -0.22 * gesture;
          record.arms.right.z = -0.2 * gesture;
          record.arms.left.x = -0.12;
        }
        return;
      }

      // 入場後、乾杯までの落ち着いた待機姿勢。
      record.baseYaw = Math.sin(slow * 0.22) * 0.025;
      if (record.role === 'bride') {
        record.arms.left.z = Math.sin(slow * 0.6) * 0.04;
      } else {
        record.arms.right.z = Math.sin(slow * 0.6) * 0.04;
      }
      return;
    }

    if (record.role === 'pianist') {
      record.arms.left.x = -1.13 + Math.sin(slow * 3.1) * 0.08;
      record.arms.right.x = -1.13 + Math.sin(slow * 3.1 + Math.PI) * 0.08;
      record.arms.left.z = -0.13 + Math.sin(slow * 1.2) * 0.025;
      record.arms.right.z = 0.13 - Math.sin(slow * 1.2) * 0.025;
      return;
    }

    if (record.role === 'bartender' && serviceActive) {
      const walking = serviceStage === 'approaching' || serviceStage === 'returning';
      const stride = walking ? Math.sin(serviceElapsed * 8.2) : 0;
      record.bodyOffset += walking ? Math.abs(stride) * 0.012 : 0;
      record.arms.left.x = -0.78 + stride * 0.035;
      record.arms.left.z = -0.22;
      record.arms.right.x = -0.78 - stride * 0.035;
      record.arms.right.z = 0.22;
      record.glassSpin = 0;
      return;
    }

    record.arms.left.x = -0.92 + Math.sin(slow * 1.5) * 0.08;
    record.arms.left.z = -0.42 + Math.sin(slow * 1.1) * 0.08;
    record.arms.right.x = -0.9 - Math.sin(slow * 1.5) * 0.08;
    record.arms.right.z = 0.42 - Math.sin(slow * 1.1) * 0.08;
    record.glassSpin = slow * 0.72;
  }

  let started = false;
  let startTime = 0;
  let phaseStartTime = 0;
  let phase = 'waiting';
  let animationState = 'waiting';
  let coupleStarted = false;
  let coupleStartedAt = 0;

  function setAccent(colorHex) {
    accentColor = colorHex;
    for (const pool of pools) {
      let changed = false;
      for (const item of pool.members) {
        if (!item.accent) continue;
        setPartColor(pool, item, accentColor);
        changed = true;
      }
      if (changed && pool.mesh.instanceColor) pool.mesh.instanceColor.needsUpdate = true;
    }
  }

  function beginFinale(time = 0) {
    startTime = Number.isFinite(time) ? time : 0;
    phaseStartTime = startTime;
    started = true;
    phase = 'entering';
    animationState = 'entering';
    coupleStarted = false;
    coupleStartedAt = 0;
    serviceActive = false;
    serviceCompleted = false;
    serviceStage = 'waiting';
    serviceElapsed = 0;
    for (const record of records) {
      record.visible = false;
      record.entrance = 0;
      record.base.copy(record.path[0]);
    }
    syncInstances();
  }

  function setPhase(nextPhase, time) {
    if (!started) beginFinale(time);
    phase = nextPhase;
    phaseStartTime = Number.isFinite(time) ? time : startTime;
  }

  function beginToast(time = 0) { setPhase('toast', time); }
  function beginApplause(time = 0) { setPhase('applause', time); }
  function beginChat(time = 0) { setPhase('chat', time); }
  function beginCoupleEntrance(time = 0) {
    if (!started) beginFinale(time);
    coupleStartedAt = Number.isFinite(time) ? time : startTime;
    coupleStarted = true;
    phase = 'couple-entrance';
    phaseStartTime = coupleStartedAt;
    for (const record of records.filter(entry => entry.isCouple)) {
      record.visible = false;
      record.entrance = 0;
      record.base.copy(record.path[0]);
    }
    syncInstances();
  }
  function beginService(time = 0) {
    if (!started) beginFinale(time);
    serviceStartedAt = Number.isFinite(time) ? time : startTime;
    serviceActive = true;
    serviceCompleted = false;
    serviceStage = 'approaching';
    serviceElapsed = 0;
    syncInstances();
  }

  function update(time = 0) {
    if (!started) return;
    const now = Number.isFinite(time) ? time : startTime;
    const elapsed = Math.max(0, now - startTime);
    const stateElapsed = Math.max(0, now - phaseStartTime);
    let settled = 0;
    for (const record of records) {
      const local = record.isCouple
        ? (coupleStarted ? now - coupleStartedAt : -1)
        : elapsed - record.delay;
      record.visible = local >= 0;
      if (!record.visible) continue;
      const duration = record.isCouple ? COUPLE_ENTRANCE_DURATION : STATION_INTRO_DURATION;
      const intro = clamp01(local / duration);
      record.entrance = record.isCouple
        ? smoothstep(clamp01(local / 0.45))
        : 1 - Math.pow(1 - intro, 3);
      record.introYaw = record.isCouple
        ? 0
        : (1 - record.entrance) * (record.role === 'pianist' ? -0.08 : 0.08);
      if (record.isCouple) placeCoupleOnPath(record, intro);
      else record.base.copy(record.destination);
      if (record.role === 'bartender' && serviceActive) placeBartenderService(record, now);
      if (intro >= 1) settled += 1;
      poseRecord(record, record.isCouple ? Math.max(0, local) : elapsed, stateElapsed);
    }
    const expectedSettled = coupleStarted ? records.length : records.filter(record => !record.isCouple).length;
    animationState = settled === expectedSettled
      ? (coupleStarted ? 'celebrating' : 'waiting-couple')
      : 'entering';
    if (phase === 'couple-entrance' && animationState === 'celebrating') {
      phase = 'arrived';
      phaseStartTime = now;
    }
    syncInstances();
  }

  syncInstances();
  return {
    beginFinale,
    beginCoupleEntrance,
    beginToast,
    beginApplause,
    beginChat,
    beginService,
    update,
    setAccent,
    get stats() {
      return Object.freeze({
        plannedRoles: records.length,
        visibleRoles: records.reduce((count, record) => count + Number(record.visible), 0),
        animationState,
        phase,
        coupleStarted,
        rolePositions: Object.freeze(Object.fromEntries(records.map(record => [
          record.role,
          Object.freeze(record.base.toArray().map(value => +value.toFixed(3))),
        ]))),
        coupleCollision: Object.freeze(Object.fromEntries(records
          .filter(record => record.isCouple)
          .map(record => [record.role, collisionReport(record.base, tableLayout)]))),
        collisionSafe: records
          .filter(record => record.isCouple)
          .every(record => collisionReport(record.base, tableLayout).safe),
        targetCollisionSafe: records
          .filter(record => record.isCouple)
          .every(record => collisionReport(record.destination, tableLayout).safe),
        serviceStage,
        serviceCompleted,
        serviceCollisionSafe: serviceSafety.safe,
        servicePosition: Object.freeze(recordByRole.bartender.base.toArray()
          .map(value => +value.toFixed(3))),
        serviceTarget: Object.freeze([...SERVICE_TARGET]),
        serviceValidation: serviceSafety,
        drawCalls: pools.length,
        instances: parts.length,
        // 既存の診断表示との互換性を保つ。現在はInstancedMeshの実数を指す。
        meshCount: pools.length,
        sharedMaterials: pools.length,
      });
    },
  };
}
