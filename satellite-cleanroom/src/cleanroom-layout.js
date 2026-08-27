// Fixed cleanroom spatial contract and pure validation helpers.
// Coordinates are metres: +Y is up, the airlock is at +Z, and the transport door is at -Z.
// This module intentionally has no Three.js or DOM dependency.

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const CLEANROOM_DIMENSIONS = deepFreeze({
  width: 18,
  depth: 24,
  height: 8,
  bounds: { min: [-9, 0, -12], max: [9, 8, 12] },
  wallClearance: 0.30,
});

export const CLEANROOM_CAPACITY = deepFreeze({
  reserveRatio: 0.20,
  limits: {
    technicians: 10,
    equipment: 14,
    workZones: 10,
    cameras: 16,
    doors: 4,
    deploymentVolumes: 4,
  },
});

export const TECHNICIAN_ROLES = Object.freeze([
  'crane-operator',
  'mechanical-port',
  'mechanical-starboard',
  'electrical',
  'thermal-blanket',
  'test-operator',
  'cleanliness-monitor',
  'mission-controller',
]);

export const CAMERA_IDS = Object.freeze([
  'airlockWide',
  'airShowerSide',
  'cleanroomWide',
  'craneIntegration',
  'payloadClose',
  'harnessFront',
  'blanketMacro',
  'arraysSide',
  'testStand',
  'orbitWide',
  'hingeClose',
  'earthFinal',
]);

const camera = (space, landscape, portrait) => ({ space, landscape, portrait });
const shot = (position, target, fov) => ({ position, target, fov });

const WORK_ZONES = [
  { id: 'crane-control', capacity: 1, bounds: { minX: -8.55, maxX: -7.15, minZ: -0.75, maxZ: 0.75 } },
  { id: 'mechanical-port', capacity: 1, bounds: { minX: -8.55, maxX: -7.35, minZ: -4.55, maxZ: -2.85 } },
  { id: 'mechanical-starboard', capacity: 1, bounds: { minX: 7.35, maxX: 8.55, minZ: -4.55, maxZ: -2.85 } },
  { id: 'electrical-front', capacity: 1, bounds: { minX: -4.25, maxX: -2.45, minZ: 1.55, maxZ: 3.45 } },
  { id: 'blanket-station', capacity: 1, bounds: { minX: 5.20, maxX: 7.40, minZ: 1.65, maxZ: 3.60 } },
  { id: 'test-control', capacity: 1, bounds: { minX: 6.55, maxX: 8.25, minZ: -5.05, maxZ: -3.55 } },
  { id: 'cleanliness-station', capacity: 1, bounds: { minX: -5.25, maxX: -3.35, minZ: 6.05, maxZ: 7.85 } },
  { id: 'mission-control', capacity: 1, bounds: { minX: -8.20, maxX: -6.00, minZ: -10.85, maxZ: -9.00 } },
];

const TECHNICIANS = [
  { id: 'tech-crane', role: 'crane-operator', workZone: 'crane-control', position: [-7.85, 0, 0], radius: 0.34, height: 1.72 },
  { id: 'tech-mech-port', role: 'mechanical-port', workZone: 'mechanical-port', position: [-7.95, 0, -3.70], radius: 0.34, height: 1.68 },
  { id: 'tech-mech-starboard', role: 'mechanical-starboard', workZone: 'mechanical-starboard', position: [7.95, 0, -3.70], radius: 0.34, height: 1.76 },
  { id: 'tech-electrical', role: 'electrical', workZone: 'electrical-front', position: [-3.35, 0, 2.50], radius: 0.33, height: 1.64 },
  { id: 'tech-thermal', role: 'thermal-blanket', workZone: 'blanket-station', position: [6.30, 0, 2.60], radius: 0.34, height: 1.70 },
  { id: 'tech-test', role: 'test-operator', workZone: 'test-control', position: [7.35, 0, -4.55], radius: 0.34, height: 1.74 },
  { id: 'tech-clean', role: 'cleanliness-monitor', workZone: 'cleanliness-station', position: [-4.30, 0, 6.95], radius: 0.33, height: 1.62 },
  { id: 'tech-control', role: 'mission-controller', workZone: 'mission-control', position: [-7.10, 0, -9.90], radius: 0.34, height: 1.69 },
];

const EQUIPMENT = [
  { id: 'integration-stand', kind: 'integration-stand', center: [0, 1.20, -2.00], halfSize: [1.55, 1.20, 1.25] },
  { id: 'test-stand', kind: 'test-stand', center: [5.90, 1.00, -7.00], halfSize: [1.50, 1.00, 1.50] },
  { id: 'parts-rack-port', kind: 'parts-rack', center: [-8.00, 1.25, -7.00], halfSize: [0.50, 1.25, 1.50] },
  { id: 'parts-rack-starboard', kind: 'parts-rack', center: [8.00, 1.25, 5.00], halfSize: [0.50, 1.25, 1.50] },
  { id: 'blanket-bench', kind: 'work-bench', center: [5.80, 0.55, 5.50], halfSize: [1.30, 0.55, 0.65] },
  { id: 'mission-console', kind: 'control-console', center: [-7.00, 0.65, -8.20], halfSize: [1.00, 0.65, 0.45] },
  { id: 'crane-console', kind: 'control-console', center: [-7.80, 0.65, 2.00], halfSize: [0.60, 0.65, 0.40] },
  { id: 'air-shower-port', kind: 'air-shower-blower', center: [-3.10, 1.50, 10.00], halfSize: [0.30, 1.50, 1.50] },
  { id: 'air-shower-starboard', kind: 'air-shower-blower', center: [3.10, 1.50, 10.00], halfSize: [0.30, 1.50, 1.50] },
  { id: 'tool-station', kind: 'tool-station', center: [8.00, 0.80, 0.00], halfSize: [0.55, 0.80, 1.10] },
];

const DOORS = [
  {
    id: 'airlock-outer-door', kind: 'sliding', openingWidth: 4.60, openingHeight: 3.40,
    motionVolume: { min: [-3.25, 0, 11.62], max: [3.25, 3.55, 11.96] },
  },
  {
    id: 'airlock-inner-door', kind: 'sliding', openingWidth: 4.60, openingHeight: 3.40,
    motionVolume: { min: [-3.25, 0, 8.04], max: [3.25, 3.55, 8.38] },
  },
  {
    id: 'transport-door', kind: 'vertical', openingWidth: 8.50, openingHeight: 6.20,
    motionVolume: { min: [-4.50, 0, -11.96], max: [4.50, 6.60, -11.58] },
  },
];

const CAMERAS = {
  airlockWide: camera('staging',
    shot([6.80, 5.10, 19.30], [0, 1.45, 12.45], 52),
    shot([4.35, 5.80, 20.00], [0, 1.55, 12.55], 57)),
  airShowerSide: camera('cleanroom',
    shot([2.30, 3.40, 8.90], [2.20, 1.40, 10.65], 58),
    shot([2.30, 3.80, 8.90], [2.20, 1.40, 10.65], 60)),
  cleanroomWide: camera('cleanroom',
    shot([6.30, 5.55, 7.50], [0, 2.15, -1.10], 50),
    shot([0.25, 5.75, 7.60], [0, 2.20, -1.00], 56)),
  craneIntegration: camera('cleanroom',
    shot([6.00, 4.80, 5.50], [0, 2.45, -1.00], 48),
    shot([4.80, 6.20, 5.80], [0, 2.45, -1.00], 53)),
  payloadClose: camera('cleanroom',
    shot([0, 3.50, 6.50], [0, 2.35, -1.00], 46),
    shot([3.80, 4.50, 5.80], [0, 2.35, -1.00], 50)),
  harnessFront: camera('cleanroom',
    shot([0, 2.90, 5.80], [0, 2.35, -1.00], 38),
    shot([0, 4.05, 6.20], [0, 2.35, -1.00], 44)),
  blanketMacro: camera('cleanroom',
    shot([4.80, 3.30, 3.30], [0.65, 2.35, -1.00], 35),
    shot([3.80, 4.20, 4.00], [0.60, 2.35, -1.00], 41)),
  arraysSide: camera('cleanroom',
    shot([0, 3.90, 7.20], [-0.40, 2.25, -1.00], 56),
    shot([6.25, 4.65, 2.30], [0, 2.40, -1.00], 57)),
  testStand: camera('cleanroom',
    shot([1.50, 4.00, -0.50], [4.45, 2.00, -5.25], 46),
    shot([2.00, 5.50, 0], [4.45, 2.00, -5.25], 51)),
  orbitWide: camera('orbit',
    shot([6.80, 3.80, 9.80], [0, 0.30, 0], 43),
    shot([5.00, 7.20, 12.50], [0, -0.20, 0], 48)),
  hingeClose: camera('orbit',
    shot([-3.8, 1.8, 4.5], [-1.15, 0.25, 0], 32),
    shot([-2.8, 3.7, 5.1], [-1.15, 0.25, 0], 38)),
  earthFinal: camera('orbit',
    shot([8.80, 5.20, 13.00], [0, -0.60, 0], 45),
    shot([5.80, 8.80, 15.00], [0, -1.00, 0], 49)),
};

const SOLAR_DEPLOYMENT_VOLUMES = [
  {
    id: 'solar-port-sweep', side: 'port', hingeOrigin: [-1.25, 1.75, -2.00], axis: [0, 0, 1],
    foldedBounds: { min: [-1.62, 0.80, -2.75], max: [-1.20, 3.80, -1.25] },
    sweepBounds: { min: [-7.20, 0.70, -3.00], max: [-1.25, 4.00, -1.00] },
    allowedEquipment: ['integration-stand'],
  },
  {
    id: 'solar-starboard-sweep', side: 'starboard', hingeOrigin: [1.25, 1.75, -2.00], axis: [0, 0, 1],
    foldedBounds: { min: [1.20, 0.80, -2.75], max: [1.62, 3.80, -1.25] },
    sweepBounds: { min: [1.25, 0.70, -3.00], max: [7.20, 4.00, -1.00] },
    allowedEquipment: ['integration-stand'],
  },
];

export const CLEANROOM_LAYOUT = deepFreeze({
  schemaVersion: 1,
  seed: 'satellite-cleanroom-layout-v1',
  room: CLEANROOM_DIMENSIONS,
  capacity: CLEANROOM_CAPACITY,
  equipment: EQUIPMENT,
  workZones: WORK_ZONES,
  technicians: TECHNICIANS,
  airlock: {
    bounds: { min: [-3.40, 0, 8.00], max: [3.40, 4.50, 12.00] },
    clearWidth: 5.60,
    capacity: { people: 2, carts: 1 },
    showerZone: { minX: -2.75, maxX: 2.75, minZ: 8.60, maxZ: 11.35 },
    innerDoorId: 'airlock-inner-door',
    outerDoorId: 'airlock-outer-door',
  },
  crane: {
    railVolume: { min: [-6.50, 6.20, -2.70], max: [6.50, 7.25, 1.70] },
    loadTravelVolume: { min: [-2.20, 1.00, -2.85], max: [2.20, 6.20, 1.10] },
    pickup: [0, 3.25, 0.30],
    setDown: [0, 2.70, -2.00],
    maxLoadKg: 1800,
    plannedLoadKg: 620,
  },
  cart: {
    id: 'payload-cart', width: 1.35, length: 2.05, capacity: 1,
    path: [[0, 10.80], [0, 8.70], [0, 5.50], [0, 2.00], [0, 0.30]],
  },
  testStand: { equipmentId: 'test-stand', rotationClearanceRadius: 1.85, gentleAmplitude: 0.035 },
  doors: DOORS,
  cameras: CAMERAS,
  solarDeploymentVolumes: SOLAR_DEPLOYMENT_VOLUMES,
});

const finiteTriple = value => Array.isArray(value)
  && value.length === 3
  && value.every(Number.isFinite);

function volumeFromEquipment(item) {
  return {
    min: item.center.map((value, index) => value - item.halfSize[index]),
    max: item.center.map((value, index) => value + item.halfSize[index]),
  };
}

function volumeInsideRoom(volume, room, margin = 0) {
  if (!finiteTriple(volume?.min) || !finiteTriple(volume?.max)
    || !finiteTriple(room?.bounds?.min) || !finiteTriple(room?.bounds?.max)) return false;
  return [0, 1, 2].every(index => (
    volume.min[index] >= room.bounds.min[index] + (index === 1 ? 0 : margin)
    && volume.max[index] <= room.bounds.max[index] - (index === 1 ? 0 : margin)
  ));
}

function pointInsideRoom(point, room, margin = 0) {
  return finiteTriple(point) && [0, 1, 2].every(index => (
    point[index] >= room.bounds.min[index] + margin
    && point[index] <= room.bounds.max[index] - margin
  ));
}

function pointInVolume(point, volume, padding = 0) {
  if (!finiteTriple(point) || !finiteTriple(volume?.min) || !finiteTriple(volume?.max)) return false;
  return [0, 1, 2].every(index => (
    point[index] >= volume.min[index] - padding
    && point[index] <= volume.max[index] + padding
  ));
}

function volumesOverlap(a, b, margin = 0) {
  if (!finiteTriple(a?.min) || !finiteTriple(a?.max)
    || !finiteTriple(b?.min) || !finiteTriple(b?.max)) return false;
  return [0, 1, 2].every(index => (
    a.min[index] < b.max[index] + margin
    && a.max[index] > b.min[index] - margin
  ));
}

function pointRectDistance(point, rect) {
  const dx = Math.max(rect.minX - point[0], 0, point[0] - rect.maxX);
  const dz = Math.max(rect.minZ - point[1], 0, point[1] - rect.maxZ);
  return Math.hypot(dx, dz);
}

function orientation(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a, b, point) {
  return point[0] >= Math.min(a[0], b[0]) - 1e-9
    && point[0] <= Math.max(a[0], b[0]) + 1e-9
    && point[1] >= Math.min(a[1], b[1]) - 1e-9
    && point[1] <= Math.max(a[1], b[1]) + 1e-9;
}

function segmentsIntersect(a, b, c, d) {
  const abC = orientation(a, b, c), abD = orientation(a, b, d);
  const cdA = orientation(c, d, a), cdB = orientation(c, d, b);
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0))
    && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
  return (Math.abs(abC) < 1e-9 && onSegment(a, b, c))
    || (Math.abs(abD) < 1e-9 && onSegment(a, b, d))
    || (Math.abs(cdA) < 1e-9 && onSegment(c, d, a))
    || (Math.abs(cdB) < 1e-9 && onSegment(c, d, b));
}

function pointSegmentDistance(point, start, end) {
  const dx = end[0] - start[0], dz = end[1] - start[1];
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSquared));
  return Math.hypot(point[0] - (start[0] + dx * t), point[1] - (start[1] + dz * t));
}

function segmentRectDistance(start, end, rect) {
  if (pointRectDistance(start, rect) === 0 || pointRectDistance(end, rect) === 0) return 0;
  const corners = [
    [rect.minX, rect.minZ], [rect.maxX, rect.minZ],
    [rect.maxX, rect.maxZ], [rect.minX, rect.maxZ],
  ];
  for (let index = 0; index < 4; index += 1) {
    if (segmentsIntersect(start, end, corners[index], corners[(index + 1) % 4])) return 0;
  }
  return Math.min(
    pointRectDistance(start, rect), pointRectDistance(end, rect),
    ...corners.map(corner => pointSegmentDistance(corner, start, end)),
  );
}

function equipmentRect(item) {
  return {
    minX: item.center[0] - item.halfSize[0], maxX: item.center[0] + item.halfSize[0],
    minZ: item.center[2] - item.halfSize[2], maxZ: item.center[2] + item.halfSize[2],
  };
}

function capacityStats(layout) {
  const counts = {
    technicians: layout.technicians?.length || 0,
    equipment: layout.equipment?.length || 0,
    workZones: layout.workZones?.length || 0,
    cameras: Object.keys(layout.cameras || {}).length,
    doors: layout.doors?.length || 0,
    deploymentVolumes: layout.solarDeploymentVolumes?.length || 0,
  };
  const byKind = {};
  let withinLimits = true;
  for (const [kind, limit] of Object.entries(CLEANROOM_CAPACITY.limits)) {
    const used = counts[kind] || 0;
    const reserved = Math.ceil(used * (1 + CLEANROOM_CAPACITY.reserveRatio));
    const headroom = limit - reserved;
    if (headroom < 0) withinLimits = false;
    byKind[kind] = { used, reserved, limit, headroom };
  }
  return { reserveRatio: CLEANROOM_CAPACITY.reserveRatio, withinLimits, byKind };
}

function collisionStats(layout) {
  const equipment = Array.isArray(layout.equipment) ? layout.equipment : [];
  const technicians = Array.isArray(layout.technicians) ? layout.technicians : [];
  const deployments = Array.isArray(layout.solarDeploymentVolumes) ? layout.solarDeploymentVolumes : [];
  const doors = Array.isArray(layout.doors) ? layout.doors : [];
  const cameraEntries = Object.entries(layout.cameras || {});
  const result = {
    technicianEquipment: [], technicianDeployment: [], deploymentEquipment: [],
    cartEquipment: [], doorEquipment: [], cameraEquipment: [],
  };

  for (const tech of technicians) {
    for (const item of equipment) {
      const gap = pointRectDistance([tech.position[0], tech.position[2]], equipmentRect(item)) - tech.radius;
      if (gap < 0) result.technicianEquipment.push(`${tech.id}:${item.id}`);
    }
    for (const deployment of deployments) {
      if (pointInVolume([tech.position[0], Math.min(tech.height, 1.7), tech.position[2]], deployment.sweepBounds, tech.radius)) {
        result.technicianDeployment.push(`${tech.id}:${deployment.id}`);
      }
    }
  }

  for (const deployment of deployments) {
    for (const item of equipment) {
      if (deployment.allowedEquipment?.includes(item.id)) continue;
      if (volumesOverlap(deployment.sweepBounds, volumeFromEquipment(item), 0.05)) {
        result.deploymentEquipment.push(`${deployment.id}:${item.id}`);
      }
    }
  }

  const path = layout.cart?.path || [];
  for (let index = 1; index < path.length; index += 1) {
    for (const item of equipment) {
      const gap = segmentRectDistance(path[index - 1], path[index], equipmentRect(item)) - (layout.cart.width || 0) / 2;
      if (gap < 0) result.cartEquipment.push(`segment-${index}:${item.id}`);
    }
  }

  for (const door of doors) {
    for (const item of equipment) {
      if (volumesOverlap(door.motionVolume, volumeFromEquipment(item), 0.02)) {
        result.doorEquipment.push(`${door.id}:${item.id}`);
      }
    }
  }

  for (const [cameraId, cameraPlan] of cameraEntries) {
    if (cameraPlan.space !== 'cleanroom') continue;
    for (const orientationName of ['landscape', 'portrait']) {
      const position = cameraPlan[orientationName]?.position;
      if (!finiteTriple(position)) continue;
      for (const item of equipment) {
        if (pointInVolume(position, volumeFromEquipment(item), 0.08)) {
          result.cameraEquipment.push(`${cameraId}.${orientationName}:${item.id}`);
        }
      }
    }
  }
  result.total = Object.values(result).reduce((sum, values) => sum + (Array.isArray(values) ? values.length : 0), 0);
  return result;
}

export function getCleanroomLayoutStats(layout = CLEANROOM_LAYOUT) {
  const zones = Array.isArray(layout.workZones) ? layout.workZones : [];
  const technicians = Array.isArray(layout.technicians) ? layout.technicians : [];
  const occupancy = Object.fromEntries(zones.map(zone => [zone.id, {
    used: technicians.filter(tech => tech.workZone === zone.id).length,
    capacity: zone.capacity,
  }]));
  let minimumTechnicianGap = Infinity;
  for (let left = 0; left < technicians.length; left += 1) {
    for (let right = left + 1; right < technicians.length; right += 1) {
      const a = technicians[left], b = technicians[right];
      minimumTechnicianGap = Math.min(minimumTechnicianGap,
        Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2]) - a.radius - b.radius);
    }
  }
  const collisions = collisionStats(layout);
  return deepFreeze({
    room: { width: layout.room?.width || 0, depth: layout.room?.depth || 0, height: layout.room?.height || 0 },
    counts: {
      technicians: technicians.length,
      roles: new Set(technicians.map(item => item.role)).size,
      equipment: layout.equipment?.length || 0,
      workZones: zones.length,
      cameras: Object.keys(layout.cameras || {}).length,
      doors: layout.doors?.length || 0,
      deploymentVolumes: layout.solarDeploymentVolumes?.length || 0,
    },
    workZoneOccupancy: occupancy,
    minimumTechnicianGap: Number.isFinite(minimumTechnicianGap) ? +minimumTechnicianGap.toFixed(3) : 0,
    collisions,
    solarDeploymentClear: collisions.technicianDeployment.length === 0 && collisions.deploymentEquipment.length === 0,
    capacity: capacityStats(layout),
  });
}

export function validateCleanroomLayout(layout = CLEANROOM_LAYOUT) {
  const issues = [];
  if (!layout || typeof layout !== 'object') return ['layout must be an object'];
  if (layout.schemaVersion !== 1) issues.push('schemaVersion must be 1');
  const room = layout.room;
  if (!room || room.width !== 18 || room.depth !== 24 || room.height !== 8) issues.push('cleanroom must be 18 x 24 x 8 metres');
  if (!finiteTriple(room?.bounds?.min) || !finiteTriple(room?.bounds?.max)) issues.push('room bounds are invalid');

  const equipment = Array.isArray(layout.equipment) ? layout.equipment : [];
  const equipmentIds = new Set();
  for (const item of equipment) {
    if (!item?.id || equipmentIds.has(item.id)) issues.push('equipment ids must be unique');
    else equipmentIds.add(item.id);
    if (!finiteTriple(item?.center) || !finiteTriple(item?.halfSize) || item.halfSize.some(value => value <= 0)) {
      issues.push(`${item?.id || 'equipment'} has an invalid volume`);
      continue;
    }
    if (!volumeInsideRoom(volumeFromEquipment(item), room, room.wallClearance)) issues.push(`${item.id} is outside the cleanroom clearance`);
  }

  const zones = Array.isArray(layout.workZones) ? layout.workZones : [];
  const zoneMap = new Map();
  for (const zone of zones) {
    if (!zone?.id || zoneMap.has(zone.id)) issues.push('work-zone ids must be unique');
    else zoneMap.set(zone.id, zone);
    const bounds = zone?.bounds;
    if (!bounds || ![bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ].every(Number.isFinite)
      || bounds.minX >= bounds.maxX || bounds.minZ >= bounds.maxZ) issues.push(`${zone?.id || 'work-zone'} bounds are invalid`);
    else if (bounds.minX < room.bounds.min[0] + room.wallClearance || bounds.maxX > room.bounds.max[0] - room.wallClearance
      || bounds.minZ < room.bounds.min[2] + room.wallClearance || bounds.maxZ > room.bounds.max[2] - room.wallClearance) {
      issues.push(`${zone.id} is outside the cleanroom clearance`);
    }
    if (!Number.isInteger(zone?.capacity) || zone.capacity < 1) issues.push(`${zone?.id || 'work-zone'} capacity is invalid`);
  }

  const technicians = Array.isArray(layout.technicians) ? layout.technicians : [];
  if (technicians.length !== 8) issues.push('exactly eight technicians are required');
  const technicianIds = new Set(), roles = new Set();
  for (const tech of technicians) {
    if (!tech?.id || technicianIds.has(tech.id)) issues.push('technician ids must be unique');
    else technicianIds.add(tech.id);
    if (!TECHNICIAN_ROLES.includes(tech?.role) || roles.has(tech.role)) issues.push(`${tech?.id || 'technician'} has an invalid or duplicated role`);
    else roles.add(tech.role);
    if (!finiteTriple(tech?.position) || !Number.isFinite(tech?.radius) || tech.radius <= 0 || !Number.isFinite(tech?.height)) {
      issues.push(`${tech?.id || 'technician'} dimensions are invalid`);
      continue;
    }
    if (!pointInsideRoom([tech.position[0], tech.height, tech.position[2]], room, room.wallClearance)) issues.push(`${tech.id} is outside the room`);
    const zone = zoneMap.get(tech.workZone);
    if (!zone) issues.push(`${tech.id} has no valid work zone`);
    else if (pointRectDistance([tech.position[0], tech.position[2]], zone.bounds) > 1e-6) issues.push(`${tech.id} is outside ${zone.id}`);
  }
  for (const zone of zones) {
    const used = technicians.filter(tech => tech.workZone === zone.id).length;
    if (used > zone.capacity) issues.push(`${zone.id} exceeds technician capacity`);
  }
  for (let left = 0; left < technicians.length; left += 1) {
    for (let right = left + 1; right < technicians.length; right += 1) {
      const a = technicians[left], b = technicians[right];
      const gap = Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2]) - a.radius - b.radius;
      if (gap < 0.15) issues.push(`${a.id} and ${b.id} overlap`);
    }
  }

  const airlock = layout.airlock;
  if (!airlock || !volumeInsideRoom(airlock.bounds, room)) issues.push('airlock bounds are invalid');
  if (!Number.isFinite(airlock?.clearWidth) || airlock.clearWidth < (layout.cart?.width || Infinity) + 0.8) issues.push('airlock is too narrow for the cart');
  if (!Number.isInteger(airlock?.capacity?.people) || airlock.capacity.people < 1
    || !Number.isInteger(airlock?.capacity?.carts) || airlock.capacity.carts < 1) issues.push('airlock capacity is invalid');

  const crane = layout.crane;
  if (!crane || !volumeInsideRoom(crane.railVolume, room) || !volumeInsideRoom(crane.loadTravelVolume, room)) issues.push('crane travel volumes are invalid');
  if (!finiteTriple(crane?.pickup) || !finiteTriple(crane?.setDown)) issues.push('crane endpoints are invalid');
  if (!Number.isFinite(crane?.plannedLoadKg) || crane.plannedLoadKg <= 0 || crane.plannedLoadKg > crane.maxLoadKg) issues.push('crane load exceeds capacity');
  for (const tech of technicians) {
    const chest = [tech.position[0], Math.min(tech.height, 1.4), tech.position[2]];
    if (pointInVolume(chest, crane?.loadTravelVolume || { min: [0, 0, 0], max: [0, 0, 0] }, tech.radius)) issues.push(`${tech.id} enters the crane load travel volume`);
  }

  const cart = layout.cart;
  if (!cart || !Array.isArray(cart.path) || cart.path.length < 2 || cart.path.some(point => !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite))) {
    issues.push('cart path is invalid');
  } else {
    for (const point of cart.path) {
      if (point[0] < room.bounds.min[0] + cart.width / 2 || point[0] > room.bounds.max[0] - cart.width / 2
        || point[1] < room.bounds.min[2] + cart.width / 2 || point[1] > room.bounds.max[2] - cart.width / 2) issues.push('cart path leaves the cleanroom');
    }
  }
  if (!Number.isInteger(cart?.capacity) || cart.capacity < 1 || cart.capacity > airlock?.capacity?.carts) issues.push('cart capacity is invalid');

  const testStand = equipment.find(item => item.id === layout.testStand?.equipmentId);
  if (!testStand || testStand.kind !== 'test-stand') issues.push('test stand equipment is missing');
  if (!Number.isFinite(layout.testStand?.rotationClearanceRadius) || layout.testStand.rotationClearanceRadius < 1.7) issues.push('test stand rotation clearance is insufficient');

  const doors = Array.isArray(layout.doors) ? layout.doors : [];
  const doorIds = new Set();
  for (const door of doors) {
    if (!door?.id || doorIds.has(door.id)) issues.push('door ids must be unique');
    else doorIds.add(door.id);
    if (!volumeInsideRoom(door?.motionVolume || {}, room)) issues.push(`${door?.id || 'door'} motion volume is invalid`);
    if (!Number.isFinite(door?.openingWidth) || !Number.isFinite(door?.openingHeight) || door.openingWidth <= 0 || door.openingHeight <= 0) issues.push(`${door?.id || 'door'} opening is invalid`);
  }
  if (!doorIds.has(airlock?.innerDoorId) || !doorIds.has(airlock?.outerDoorId)) issues.push('airlock doors are missing');
  const narrowAirlockDoor = doors.filter(door => door.id === airlock?.innerDoorId || door.id === airlock?.outerDoorId)
    .some(door => door.openingWidth < (cart?.width || Infinity) + 0.8);
  if (narrowAirlockDoor) issues.push('an airlock door is too narrow for the cart');

  const cameras = layout.cameras || {};
  for (const cameraId of CAMERA_IDS) {
    const plan = cameras[cameraId];
    if (!plan) { issues.push(`${cameraId} camera is missing`); continue; }
    if (!['cleanroom', 'staging', 'orbit'].includes(plan.space)) issues.push(`${cameraId} camera space is invalid`);
    for (const orientationName of ['landscape', 'portrait']) {
      const view = plan[orientationName];
      if (!finiteTriple(view?.position) || !finiteTriple(view?.target) || !Number.isFinite(view?.fov) || view.fov < 25 || view.fov > 75) {
        issues.push(`${cameraId}.${orientationName} is invalid`);
      } else if (plan.space === 'cleanroom'
        && (!pointInsideRoom(view.position, room) || !pointInsideRoom(view.target, room))) {
        issues.push(`${cameraId}.${orientationName} leaves the cleanroom`);
      }
    }
  }
  if (Object.keys(cameras).some(cameraId => !CAMERA_IDS.includes(cameraId))) issues.push('an unknown camera is present');

  const deployments = Array.isArray(layout.solarDeploymentVolumes) ? layout.solarDeploymentVolumes : [];
  if (deployments.length !== 2) issues.push('two solar deployment volumes are required');
  const deploymentIds = new Set();
  for (const deployment of deployments) {
    if (!deployment?.id || deploymentIds.has(deployment.id)) issues.push('deployment ids must be unique');
    else deploymentIds.add(deployment.id);
    if (!finiteTriple(deployment?.hingeOrigin) || !finiteTriple(deployment?.axis)) issues.push(`${deployment?.id || 'deployment'} hinge is invalid`);
    if (!volumeInsideRoom(deployment?.sweepBounds || {}, room) || !volumeInsideRoom(deployment?.foldedBounds || {}, room)) issues.push(`${deployment?.id || 'deployment'} volume leaves the cleanroom`);
  }
  if (deployments.length === 2 && volumesOverlap(deployments[0].sweepBounds, deployments[1].sweepBounds)) issues.push('solar deployment volumes overlap each other');

  const stats = getCleanroomLayoutStats(layout);
  for (const [kind, collisions] of Object.entries(stats.collisions)) {
    if (kind !== 'total' && collisions.length) issues.push(`${kind} collisions: ${collisions.join(', ')}`);
  }
  if (!stats.capacity.withinLimits) issues.push('layout exceeds a reserved render capacity');
  return issues;
}

export const CLEANROOM_LAYOUT_STATS = getCleanroomLayoutStats(CLEANROOM_LAYOUT);
export const CLEANROOM_LAYOUT_ISSUES = Object.freeze(validateCleanroomLayout(CLEANROOM_LAYOUT));
