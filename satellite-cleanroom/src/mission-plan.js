// Deterministic, render-independent satellite installation plans.
// This module intentionally has no Three.js or DOM dependency.

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const RAW_MISSIONS = {
  weather: {
    id: 'weather',
    mainInstrumentId: 'cloud-imager',
    payload: {
      geometryKey: 'cloud-imager-barrel',
      mountSlot: 'nadir-front',
      scale: [0.9, 0.9, 1.08],
    },
    busAccent: 0x4b9ed1,
    accessories: [
      { id: 'storm-scanner', geometryKey: 'storm-scanner-slit', mountSlot: 'zenith-left', scale: [1.05, 0.38, 0.58] },
      { id: 'weather-radiometer', geometryKey: 'weather-radiometer-dome', mountSlot: 'nadir-right', scale: [0.58, 0.58, 0.58] },
    ],
    antenna: { geometryKey: 'weather-low-gain-mast', deploymentKind: 'hinged-mast' },
    resultKind: 'weather-clouds',
    interactionKind: 'scan-clouds',
  },
  ocean: {
    id: 'ocean',
    mainInstrumentId: 'ocean-scanner',
    payload: {
      geometryKey: 'ocean-color-prism',
      mountSlot: 'nadir-front',
      scale: [1.02, 0.72, 0.84],
    },
    busAccent: 0x2aa9a3,
    accessories: [
      { id: 'surface-radar', geometryKey: 'sea-surface-radar-panel', mountSlot: 'zenith-left', scale: [0.94, 0.3, 0.72] },
      { id: 'ice-sensor', geometryKey: 'ice-sensor-pod', mountSlot: 'nadir-right', scale: [0.66, 0.48, 0.72] },
    ],
    antenna: { geometryKey: 'ocean-folding-patch', deploymentKind: 'folding-patch' },
    resultKind: 'ocean-currents',
    interactionKind: 'trace-currents',
  },
  communication: {
    id: 'communication',
    mainInstrumentId: 'communications-relay',
    payload: {
      geometryKey: 'communication-feed-horn',
      mountSlot: 'nadir-front',
      scale: [0.76, 0.76, 1.12],
    },
    busAccent: 0xd87943,
    accessories: [
      { id: 'island-transponder', geometryKey: 'island-link-transponder', mountSlot: 'zenith-left', scale: [0.78, 0.54, 0.68] },
      { id: 'ship-beacon', geometryKey: 'ship-link-beacon', mountSlot: 'nadir-right', scale: [0.54, 0.78, 0.54] },
    ],
    antenna: { geometryKey: 'communication-parabolic-dish', deploymentKind: 'hinged-dish' },
    resultKind: 'communication-links',
    interactionKind: 'send-link-pulses',
  },
};

export const MISSION_DEFINITIONS = deepFreeze(RAW_MISSIONS);
export const MISSION_IDS = Object.freeze(Object.keys(MISSION_DEFINITIONS));

export const MISSION_PLAN_COUNTS = deepFreeze({
  'auxiliary-box': 6,
  support: 10,
  'radiator-fin': 12,
  clamp: 16,
  fastener: 24,
});

export const MISSION_PLAN_CAPACITY = deepFreeze({
  reserveRatio: 0.20,
  limits: {
    'manual-module': 4,
    'auxiliary-box': 10,
    support: 16,
    'radiator-fin': 20,
    clamp: 28,
    fastener: 40,
  },
});

const AUTO_GEOMETRY = deepFreeze({
  'auxiliary-box': 'auxiliary-electronics-box',
  support: 'equipment-support-bracket',
  'radiator-fin': 'small-radiator-fin',
  clamp: 'cable-harness-clamp',
  fastener: 'blanket-fastener-cap',
});

const MOUNT_POSITIONS = deepFreeze({
  'nadir-front': [0, 0.06, 1.12],
  'zenith-left': [-0.56, 1.08, -0.18],
  'nadir-right': [1.08, -0.34, 0.12],
});

export function hashSeed(value) {
  const text = String(value ?? 'satellite-cleanroom');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mulberry32(seed) {
  let state = Number(seed) >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const round = value => Math.round(value * 10000) / 10000;
const finiteTriple = value => Array.isArray(value)
  && value.length === 3
  && value.every(Number.isFinite);

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => (
    `${JSON.stringify(key)}:${stableStringify(value[key])}`
  )).join(',')}}`;
}

export function computeMissionPlanHash(plan) {
  if (!plan || typeof plan !== 'object') return '00000000';
  const { planHash: ignored, ...hashable } = plan;
  return hashSeed(stableStringify(hashable)).toString(16).padStart(8, '0');
}

function entry(kind, index, position, rotation, scale, random, extra = {}) {
  return {
    id: `${kind}-${String(index + 1).padStart(2, '0')}`,
    kind,
    geometryKey: AUTO_GEOMETRY[kind],
    auto: true,
    position: position.map(round),
    rotation: rotation.map(round),
    scale: scale.map(round),
    delay: round(index * 0.025 + random() * 0.018),
    ...extra,
  };
}

function makeAutoEntries(random, missionId) {
  const entries = [];

  for (let index = 0; index < MISSION_PLAN_COUNTS['auxiliary-box']; index += 1) {
    const side = index % 2 === 0 ? -1 : 1;
    const row = Math.floor(index / 2);
    entries.push(entry(
      'auxiliary-box', index,
      [side * 1.075, -0.54 + row * 0.52 + (random() - 0.5) * 0.05, -0.56 + row * 0.48],
      [0, side > 0 ? -Math.PI / 2 : Math.PI / 2, 0],
      [0.42 + random() * 0.08, 0.28 + random() * 0.06, 0.16 + random() * 0.04],
      random,
      { mountFace: side < 0 ? 'port' : 'starboard', mission: missionId },
    ));
  }

  for (let index = 0; index < MISSION_PLAN_COUNTS.support; index += 1) {
    const angle = (index / MISSION_PLAN_COUNTS.support) * Math.PI * 2;
    const sideFace = Math.abs(Math.cos(angle)) > Math.abs(Math.sin(angle));
    entries.push(entry(
      'support', index,
      [Math.cos(angle) * 1.03, -0.74 + (index % 3) * 0.7, Math.sin(angle) * 1.03],
      sideFace ? [0, angle + Math.PI / 2, 0] : [Math.PI / 2, 0, angle],
      [0.22, 0.14 + random() * 0.04, 0.22],
      random,
      { mountFace: sideFace ? 'side' : 'front-back', mission: missionId },
    ));
  }

  for (let index = 0; index < MISSION_PLAN_COUNTS['radiator-fin']; index += 1) {
    const column = index % 4;
    const row = Math.floor(index / 4);
    entries.push(entry(
      'radiator-fin', index,
      [-0.72 + column * 0.48, -0.54 + row * 0.54, -1.075],
      [0, Math.PI, 0],
      [0.34, 0.34, 0.035],
      random,
      { mountFace: 'anti-payload', mission: missionId },
    ));
  }

  for (let index = 0; index < MISSION_PLAN_COUNTS.clamp; index += 1) {
    const pathSide = index % 2 === 0 ? -1 : 1;
    const step = Math.floor(index / 2);
    entries.push(entry(
      'clamp', index,
      [pathSide * (0.74 + (step % 2) * 0.16), -0.82 + step * 0.23, 1.085],
      [Math.PI / 2, 0, 0],
      [0.13, 0.055, 0.08],
      random,
      { mountFace: 'harness-panel', harnessChannel: pathSide < 0 ? 'blue' : 'amber', mission: missionId },
    ));
  }

  for (let index = 0; index < MISSION_PLAN_COUNTS.fastener; index += 1) {
    const edge = index % 4;
    const step = Math.floor(index / 4);
    const along = -0.82 + step * 0.328;
    const positions = [
      [along, 1.09, 0.92],
      [1.09, along, 0.92],
      [-along, -1.09, 0.92],
      [-1.09, -along, 0.92],
    ];
    entries.push(entry(
      'fastener', index, positions[edge], [Math.PI / 2, 0, 0],
      [0.055, 0.028, 0.055], random,
      { mountFace: 'blanket-edge', sequence: index, mission: missionId },
    ));
  }

  return entries;
}

function makeManualModules(profile) {
  const payloadPosition = MOUNT_POSITIONS[profile.payload.mountSlot];
  const modules = [{
    id: 'primary-payload',
    role: 'primary-payload',
    geometryKey: profile.payload.geometryKey,
    mountSlot: profile.payload.mountSlot,
    position: [...payloadPosition],
    rotation: [0, 0, 0],
    scale: [...profile.payload.scale],
    playerPlaced: true,
  }];
  for (const accessory of profile.accessories) {
    modules.push({
      id: accessory.id,
      role: 'mission-accessory',
      geometryKey: accessory.geometryKey,
      mountSlot: accessory.mountSlot,
      position: [...MOUNT_POSITIONS[accessory.mountSlot]],
      rotation: [0, 0, 0],
      scale: [...accessory.scale],
      playerPlaced: true,
    });
  }
  return modules;
}

function capacityFor(manualModules, entries) {
  const counts = { 'manual-module': manualModules.length };
  for (const kind of Object.keys(MISSION_PLAN_COUNTS)) counts[kind] = 0;
  for (const item of entries) counts[item.kind] = (counts[item.kind] || 0) + 1;
  const byKind = {};
  let withinLimits = true;
  for (const [kind, limit] of Object.entries(MISSION_PLAN_CAPACITY.limits)) {
    const used = counts[kind] || 0;
    const reserved = Math.ceil(used * (1 + MISSION_PLAN_CAPACITY.reserveRatio));
    const headroom = limit - reserved;
    if (headroom < 0) withinLimits = false;
    byKind[kind] = { used, reserved, limit, headroom };
  }
  return { reserveRatio: MISSION_PLAN_CAPACITY.reserveRatio, withinLimits, byKind };
}

function parseCreateArguments(missionOrOptions, maybeOptions) {
  if (missionOrOptions && typeof missionOrOptions === 'object') {
    return {
      missionId: missionOrOptions.mission || missionOrOptions.missionId || 'weather',
      baseSeed: missionOrOptions.seed ?? 'satellite-installation-v1',
    };
  }
  return {
    missionId: missionOrOptions || 'weather',
    baseSeed: maybeOptions?.seed ?? 'satellite-installation-v1',
  };
}

export function createMissionPlan(missionOrOptions = 'weather', maybeOptions = {}) {
  const { missionId, baseSeed } = parseCreateArguments(missionOrOptions, maybeOptions);
  const profile = MISSION_DEFINITIONS[missionId];
  if (!profile) throw new RangeError(`Unknown satellite mission: ${missionId}`);
  const seed = `${String(baseSeed)}|${missionId}`;
  const random = mulberry32(hashSeed(seed));
  const manualModules = makeManualModules(profile);
  const entries = makeAutoEntries(random, missionId);
  const plan = {
    schemaVersion: 1,
    mission: missionId,
    baseSeed: String(baseSeed),
    seed,
    payloadGeometryKey: profile.payload.geometryKey,
    mainInstrumentId: profile.mainInstrumentId,
    busAccent: profile.busAccent,
    accessories: profile.accessories.map(accessory => ({ ...accessory })),
    antenna: { ...profile.antenna },
    resultKind: profile.resultKind,
    interactionKind: profile.interactionKind,
    manualModules,
    entries,
    capacity: capacityFor(manualModules, entries),
  };
  plan.planHash = computeMissionPlanHash(plan);
  const issues = validateMissionPlan(plan);
  if (issues.length) throw new Error(`Generated mission plan is invalid: ${issues.join('; ')}`);
  return deepFreeze(plan);
}

export function getMissionPlanStats(plan) {
  const entries = Array.isArray(plan?.entries) ? plan.entries : [];
  const manualModules = Array.isArray(plan?.manualModules) ? plan.manualModules : [];
  const byKind = Object.fromEntries(Object.keys(MISSION_PLAN_COUNTS).map(kind => [kind, 0]));
  for (const item of entries) byKind[item?.kind] = (byKind[item?.kind] || 0) + 1;
  const capacity = capacityFor(manualModules, entries);
  return deepFreeze({
    mission: plan?.mission ?? null,
    manualModules: manualModules.length,
    autoEntries: entries.length,
    totalPlannedElements: manualModules.length + entries.length,
    byKind,
    capacity,
    planHash: typeof plan?.planHash === 'string' ? plan.planHash : null,
    hashMatches: typeof plan?.planHash === 'string'
      && plan.planHash === computeMissionPlanHash(plan),
  });
}

export function validateMissionPlan(plan) {
  const issues = [];
  if (!plan || typeof plan !== 'object') return ['plan must be an object'];
  const profile = MISSION_DEFINITIONS[plan.mission];
  if (!profile) issues.push('mission is invalid');
  if (!Number.isInteger(plan.schemaVersion) || plan.schemaVersion !== 1) issues.push('schemaVersion must be 1');
  if (typeof plan.seed !== 'string' || !plan.seed) issues.push('seed must be a non-empty string');
  if (!Number.isInteger(plan.busAccent) || plan.busAccent < 0 || plan.busAccent > 0xffffff) issues.push('busAccent is invalid');
  if (profile) {
    if (plan.payloadGeometryKey !== profile.payload.geometryKey) issues.push('payload geometry does not match mission');
    if (plan.mainInstrumentId !== profile.mainInstrumentId) issues.push('main instrument does not match mission');
    if (plan.busAccent !== profile.busAccent) issues.push('bus accent does not match mission');
    if (plan.resultKind !== profile.resultKind) issues.push('result kind does not match mission');
    if (plan.interactionKind !== profile.interactionKind) issues.push('interaction kind does not match mission');
    if (plan.antenna?.geometryKey !== profile.antenna.geometryKey) issues.push('antenna does not match mission');
  }

  const manual = Array.isArray(plan.manualModules) ? plan.manualModules : [];
  if (!Array.isArray(plan.manualModules)) issues.push('manualModules must be an array');
  if (manual.length !== 3) issues.push('manualModules must contain exactly three modules');
  const expectedGeometry = profile
    ? [profile.payload.geometryKey, ...profile.accessories.map(item => item.geometryKey)]
    : [];
  manual.forEach((item, index) => {
    if (!item || typeof item !== 'object') { issues.push(`manualModules[${index}] is invalid`); return; }
    if (item.geometryKey !== expectedGeometry[index]) issues.push(`manualModules[${index}] geometry is invalid`);
    if (!finiteTriple(item.position) || !finiteTriple(item.rotation) || !finiteTriple(item.scale)) {
      issues.push(`manualModules[${index}] transform is invalid`);
    }
    if (item.playerPlaced !== true) issues.push(`manualModules[${index}] must be player placed`);
  });

  const entries = Array.isArray(plan.entries) ? plan.entries : [];
  if (!Array.isArray(plan.entries)) issues.push('entries must be an array');
  const ids = new Set();
  const counts = Object.fromEntries(Object.keys(MISSION_PLAN_COUNTS).map(kind => [kind, 0]));
  entries.forEach((item, index) => {
    const prefix = `entries[${index}]`;
    if (!item || typeof item !== 'object') { issues.push(`${prefix} is invalid`); return; }
    if (!Object.hasOwn(MISSION_PLAN_COUNTS, item.kind)) issues.push(`${prefix}.kind is invalid`);
    else counts[item.kind] += 1;
    if (typeof item.id !== 'string' || !item.id || ids.has(item.id)) issues.push(`${prefix}.id is missing or duplicated`);
    else ids.add(item.id);
    if (item.geometryKey !== AUTO_GEOMETRY[item.kind]) issues.push(`${prefix}.geometryKey is invalid`);
    if (item.auto !== true) issues.push(`${prefix} must be automatic`);
    if (!finiteTriple(item.position) || !finiteTriple(item.rotation) || !finiteTriple(item.scale)) issues.push(`${prefix} transform is invalid`);
    if (finiteTriple(item.scale) && item.scale.some(value => value <= 0)) issues.push(`${prefix}.scale must be positive`);
    if (!Number.isFinite(item.delay) || item.delay < 0) issues.push(`${prefix}.delay is invalid`);
    if (profile && item.mission !== profile.id) issues.push(`${prefix}.mission does not match plan`);
  });
  for (const [kind, expected] of Object.entries(MISSION_PLAN_COUNTS)) {
    if (counts[kind] !== expected) issues.push(`${kind} count must be ${expected}`);
  }

  const capacity = capacityFor(manual, entries);
  if (!capacity.withinLimits) issues.push('plan exceeds a reserved render capacity');
  if (stableStringify(plan.capacity) !== stableStringify(capacity)) issues.push('capacity snapshot is stale or invalid');
  if (typeof plan.planHash !== 'string' || !/^[0-9a-f]{8}$/.test(plan.planHash)) issues.push('planHash must be eight lowercase hex characters');
  else if (plan.planHash !== computeMissionPlanHash(plan)) issues.push('planHash does not match plan contents');
  return issues;
}
