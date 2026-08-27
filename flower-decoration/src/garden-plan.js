// フィナーレ用の会場装花施工プランを作る純ロジック。
// Three.js / DOM に依存せず、花首だけでなく茎・葉・花器・フォームまで
// 同じ seed から再現可能な「施工単位」として返す。

import { PARTY_LAYOUT } from './party-layout.js';

const FLORAL_KINDS = Object.freeze(['hero', 'hydrangea', 'baby', 'leaf']);
const BLOOM_KINDS = Object.freeze(['hero', 'hydrangea', 'baby']);
const INSTALL_KINDS = Object.freeze([...FLORAL_KINDS, 'stem', 'support', 'foam']);
const ANCHORS = Object.freeze(['world', 'arch', 'table', 'head-table']);
const PALETTE_ROLES = Object.freeze(['primary', 'neutral', 'accent', 'foliage', 'structure', 'mechanics']);

const FOOTPRINTS = Object.freeze({
  hero: 0.052, hydrangea: 0.056, baby: 0.032, leaf: 0.038,
  stem: 0.014, support: 0.23, foam: 0.17,
});

const AISLE_CLUSTER_TYPES = Object.freeze([
  Object.freeze({ id: 'low-bowl', xSpread: 0.24, zSpread: 0.46, height: 0.44, supportScale: 0.88 }),
  Object.freeze({ id: 'crescent', xSpread: 0.29, zSpread: 0.52, height: 0.58, supportScale: 1.00 }),
  Object.freeze({ id: 'meadow', xSpread: 0.25, zSpread: 0.58, height: 0.50, supportScale: 0.92 }),
  Object.freeze({ id: 'footed-urn', xSpread: 0.22, zSpread: 0.40, height: 0.64, supportScale: 1.08 }),
]);

export const GARDEN_LAYOUT = Object.freeze({
  aisle: Object.freeze({
    safeHalfWidth: PARTY_LAYOUT.aisle.halfWidth,
    innerX: PARTY_LAYOUT.aisle.flowerInnerX,
    outerX: PARTY_LAYOUT.aisle.flowerOuterX,
    backZ: PARTY_LAYOUT.aisle.minZ,
    frontZ: PARTY_LAYOUT.aisle.maxZ,
    minHeight: 0.04,
    maxHeight: 0.66,
    clusterCentersZ: Object.freeze([-7.95, -5.45, -2.95, -0.45, 2.05, 4.55, 7.05]),
    clusterTypes: AISLE_CLUSTER_TYPES,
    floralEntriesPerCluster: 16,
    leavesPerCluster: 4,
    stemsPerCluster: 5,
    minimumVisibleGap: 0.72,
  }),
  arch: Object.freeze({
    layers: 2,
    entriesPerLayer: 50,
    weightedRanges: Object.freeze([
      Object.freeze([0.04, 0.22, 1]), Object.freeze([0.22, 0.50, 8]),
      Object.freeze([0.50, 0.76, 1]), Object.freeze([0.76, 0.98, 8]),
    ]),
  }),
  table: Object.freeze({
    count: PARTY_LAYOUT.counts.guestTables,
    entriesPerTable: 8,
    maxRadius: PARTY_LAYOUT.tableGeometry.floralRadius,
    generatedRadius: 0.225,
    maxHeight: 0.25,
  }),
  headTable: Object.freeze({ runnerEntries: 22, sideEntries: 14 }),
  stage: Object.freeze({
    clustersPerSide: 2,
    floralEntriesPerCluster: 6,
    stemsPerCluster: 3,
    backZ: -9.82,
    frontZ: -9.38,
  }),
  palette: Object.freeze({ primary: 0.70, neutral: 0.20, accent: 0.10 }),
  timing: Object.freeze({ duration: 3, arch: 0, table: 0.65, aisle: 1.15 }),
  capacity: Object.freeze({
    // P0後の旧プランは691花材。432花材へ減らし、施工部材は別勘定にする。
    baselineFloralEntries: 691,
    targetReductionMin: 0.30,
    targetReductionMax: 0.40,
    baseFlowerHeadsMax: 500,
    flowerHeadLimit: 1000,
    fillerLimit: 600,
    reserveRatio: 0.20,
  }),
});

function hashSeed(value) {
  const text = String(value ?? 'flower-garden');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
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

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function round(value) { return Math.round(value * 10000) / 10000; }

function unit(x, y, z) {
  const length = Math.hypot(x, y, z) || 1;
  return [round(x / length), round(y / length), round(z / length)];
}

function pickBloomKind(random, heroWeight = 0.44) {
  const value = random();
  if (value < heroWeight) return 'hero';
  if (value < 0.78) return 'hydrangea';
  return 'baby';
}

function pickFloralKind(random, heroWeight = 0.44, leafWeight = 0.18) {
  if (random() < leafWeight) return 'leaf';
  return pickBloomKind(random, heroWeight);
}

function tone(random, kind) {
  const ranges = {
    hero: [-0.13, 0.16], hydrangea: [-0.08, 0.20], baby: [0.04, 0.20],
    leaf: [-0.20, 0.05], stem: [-0.15, 0.02], support: [-0.08, 0.08], foam: [-0.10, 0.02],
  };
  const [min, max] = ranges[kind];
  return round(lerp(min, max, random()));
}

function roleForKind(kind) {
  if (BLOOM_KINDS.includes(kind)) return 'bloom';
  if (kind === 'leaf') return 'foliage';
  if (kind === 'stem') return 'stem';
  if (kind === 'support') return 'vessel';
  return 'mechanics';
}

function paletteForKind(kind) {
  if (kind === 'leaf' || kind === 'stem') return 'foliage';
  if (kind === 'support') return 'structure';
  if (kind === 'foam') return 'mechanics';
  return 'primary';
}

function add(entries, random, entry) {
  const kind = entry.kind ?? pickFloralKind(random);
  entries.push({
    ...entry,
    position: entry.position.map(round),
    normal: entry.normal.map(round),
    scale: round(Number(entry.scale)),
    kind,
    role: entry.role ?? roleForKind(kind),
    paletteRole: entry.paletteRole ?? paletteForKind(kind),
    tone: tone(random, kind),
    delay: round(entry.delay),
  });
}

function addFloorSupport(entries, random, options) {
  const { zone, clusterId, clusterType, side, centerX, centerZ, supportScale, stems, delay } = options;
  const metadata = { zone, anchor: 'world', clusterId, clusterType, clusterSide: side };
  add(entries, random, {
    ...metadata, position: [side * centerX, 0.09, centerZ], normal: [0, 1, 0],
    scale: supportScale, kind: 'support', delay,
  });
  add(entries, random, {
    ...metadata, position: [side * centerX, 0.20, centerZ], normal: [0, 1, 0],
    scale: supportScale * 0.90, kind: 'foam', delay: delay + 0.025,
  });
  for (let index = 0; index < stems; index++) {
    const xMagnitude = centerX + lerp(-0.12, 0.12, random());
    add(entries, random, {
      ...metadata,
      position: [side * xMagnitude, 0.19, centerZ + lerp(-0.18, 0.18, random())],
      normal: unit(side * lerp(-0.20, 0.20, random()), 1, lerp(-0.22, 0.22, random())),
      scale: lerp(0.78, 1.30, random()), kind: 'stem', delay: delay + 0.04 + index * 0.012,
    });
  }
}

function aisleOffset(type, random, index) {
  if (type.id === 'crescent') {
    const angle = lerp(-1.10, 1.10, index / 15) + lerp(-0.12, 0.12, random());
    return { x: Math.cos(angle) * type.xSpread * lerp(0.55, 1, random()), z: Math.sin(angle) * type.zSpread };
  }
  if (type.id === 'meadow') {
    return {
      x: lerp(-type.xSpread, type.xSpread, random()),
      z: lerp(-type.zSpread, type.zSpread, (index + random() * 0.7) / 15.7),
    };
  }
  const radius = Math.sqrt(random());
  const angle = random() * Math.PI * 2;
  return { x: Math.cos(angle) * type.xSpread * radius, z: Math.sin(angle) * type.zSpread * radius };
}

function addAisle(entries, random) {
  const cfg = GARDEN_LAYOUT.aisle;
  for (const side of [-1, 1]) {
    cfg.clusterCentersZ.forEach((baseZ, stationIndex) => {
      const type = cfg.clusterTypes[(stationIndex + (side > 0 ? 1 : 0)) % cfg.clusterTypes.length];
      const centerZ = baseZ + side * 0.16;
      const centerX = 1.77 + (stationIndex % 2) * 0.04;
      const clusterId = `aisle-${side < 0 ? 'left' : 'right'}-${stationIndex + 1}`;
      const baseDelay = GARDEN_LAYOUT.timing.aisle + stationIndex * 0.18 + (side > 0 ? 0.05 : 0);
      addFloorSupport(entries, random, {
        zone: 'aisle', clusterId, clusterType: type.id, side, centerX, centerZ,
        supportScale: type.supportScale, stems: cfg.stemsPerCluster, delay: baseDelay,
      });

      for (let index = 0; index < cfg.floralEntriesPerCluster; index++) {
        const kind = index < cfg.leavesPerCluster ? 'leaf' : pickBloomKind(random, type.id === 'footed-urn' ? 0.50 : 0.43);
        const offset = aisleOffset(type, random, index);
        const xMagnitude = clamp(centerX + offset.x, 1.49, 2.06);
        const mound = 1 - Math.min(1, Math.hypot(offset.x / type.xSpread, offset.z / type.zSpread));
        const baseHeight = kind === 'leaf' ? lerp(0.19, 0.38, random()) : lerp(0.27, type.height, random());
        add(entries, random, {
          zone: 'aisle', anchor: 'world', clusterId, clusterType: type.id, clusterSide: side,
          position: [side * xMagnitude, Math.min(0.65, baseHeight + mound * 0.07), centerZ + offset.z],
          normal: unit(-side * lerp(0.04, 0.18, random()), 1, lerp(-0.14, 0.14, random())),
          scale: kind === 'leaf' ? lerp(0.82, 1.34, random()) : lerp(0.84, 1.38, random()),
          kind, delay: baseDelay + 0.08 + random() * 0.18,
        });
      }
    });
  }
}

function weightedArchT(random) {
  const ranges = GARDEN_LAYOUT.arch.weightedRanges;
  const total = ranges.reduce((sum, range) => sum + range[2], 0);
  let cursor = random() * total;
  for (const [min, max, weight] of ranges) {
    cursor -= weight;
    if (cursor <= 0) return lerp(min, max, random());
  }
  return ranges.at(-1)[1];
}

function addArch(entries, random) {
  const cfg = GARDEN_LAYOUT.arch;
  for (let layer = 0; layer < cfg.layers; layer++) {
    for (let i = 0; i < cfg.entriesPerLayer; i++) {
      const t = weightedArchT(random);
      const isHeavy = (t >= 0.22 && t <= 0.50) || t >= 0.76;
      const kind = pickFloralKind(random, isHeavy ? 0.49 : 0.34, 0.18);
      add(entries, random, {
        zone: 'arch', anchor: 'arch',
        position: [t, lerp(0.03, 0.15, random()), lerp(-0.15, 0.20, random())],
        normal: unit(lerp(-0.16, 0.16, random()), 0.78, 0.62),
        scale: lerp(isHeavy ? 1.18 : 0.76, isHeavy ? 1.86 : 1.16, random()), kind,
        delay: random() * 0.55,
      });
    }
  }
}

function addTables(entries, random) {
  const cfg = GARDEN_LAYOUT.table;
  for (let anchorIndex = 0; anchorIndex < cfg.count; anchorIndex++) {
    for (let i = 0; i < cfg.entriesPerTable; i++) {
      const angle = random() * Math.PI * 2;
      const radius = cfg.generatedRadius * Math.pow(random(), 1.65);
      const mound = 1 - radius / cfg.generatedRadius;
      const kind = i < 2 ? 'leaf' : pickBloomKind(random, 0.43);
      const height = kind === 'leaf'
        ? lerp(0.035, 0.075 + mound * 0.025, random())
        : lerp(0.055, 0.105 + mound * 0.035, random());
      add(entries, random, {
        zone: 'guest-table', anchor: 'table', anchorIndex,
        position: [Math.cos(angle) * radius, height, Math.sin(angle) * radius],
        normal: unit(Math.cos(angle) * 0.08, 1, Math.sin(angle) * 0.08),
        scale: kind === 'leaf' ? lerp(0.52, 0.76, random()) : lerp(0.52, 0.82, random()),
        kind, delay: GARDEN_LAYOUT.timing.table + anchorIndex * 0.08 + random() * 0.42,
      });
    }
  }
}

function addHeadTable(entries, random) {
  const cfg = GARDEN_LAYOUT.headTable;
  for (let i = 0; i < cfg.runnerEntries; i++) {
    const t = i / (cfg.runnerEntries - 1);
    const kind = i % 5 === 0 ? 'leaf' : pickBloomKind(random, 0.48);
    add(entries, random, {
      zone: 'head-table', anchor: 'head-table',
      position: [lerp(-1.68, 1.68, t) + lerp(-0.05, 0.05, random()), lerp(0.78, 0.96, random()), lerp(0.34, 0.46, random())],
      normal: unit(lerp(-0.10, 0.10, random()), 0.72, 0.70),
      scale: lerp(0.82, 1.28, random()), kind, delay: 0.08 + t * 0.42 + random() * 0.08,
    });
  }
  for (let i = 0; i < cfg.sideEntries; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const kind = i % 4 === 0 ? 'leaf' : pickBloomKind(random, 0.42);
    add(entries, random, {
      zone: 'head-floor', anchor: 'head-table',
      position: [side * lerp(1.72, 2.48, random()), lerp(0.08, 0.32, random()), lerp(0.38, 1.10, random())],
      normal: unit(-side * 0.10, 1, 0.14),
      scale: lerp(0.82, 1.42, random()), kind, delay: 0.18 + random() * 0.52,
    });
  }
}

function addStage(entries, random) {
  const cfg = GARDEN_LAYOUT.stage;
  for (const side of [-1, 1]) {
    for (let index = 0; index < cfg.clustersPerSide; index++) {
      const centerX = 3.05 + index * 1.18;
      const centerZ = lerp(cfg.backZ, cfg.frontZ, index / Math.max(1, cfg.clustersPerSide - 1));
      const clusterId = `stage-${side < 0 ? 'left' : 'right'}-${index + 1}`;
      const delay = 0.20 + index * 0.16 + (side > 0 ? 0.05 : 0);
      addFloorSupport(entries, random, {
        zone: 'stage', clusterId, clusterType: index === 0 ? 'low-bowl' : 'footed-urn', side,
        centerX, centerZ, supportScale: index === 0 ? 0.92 : 1.04, stems: cfg.stemsPerCluster, delay,
      });
      for (let floralIndex = 0; floralIndex < cfg.floralEntriesPerCluster; floralIndex++) {
        const kind = floralIndex < 2 ? 'leaf' : pickBloomKind(random, 0.44);
        add(entries, random, {
          zone: 'stage', anchor: 'world', clusterId,
          clusterType: index === 0 ? 'low-bowl' : 'footed-urn', clusterSide: side,
          position: [side * (centerX + lerp(-0.20, 0.20, random())), lerp(0.20, 0.58, random()), centerZ + lerp(-0.25, 0.25, random())],
          normal: unit(-side * 0.08, 0.88, lerp(-0.08, 0.12, random())),
          scale: kind === 'leaf' ? lerp(0.80, 1.18, random()) : lerp(0.82, 1.34, random()),
          kind, delay: delay + 0.08 + random() * 0.16,
        });
      }
    }
  }
}

function shuffle(values, random) {
  for (let index = values.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1));
    [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
  }
  return values;
}

function paletteTargets(total) {
  const neutral = Math.round(total * GARDEN_LAYOUT.palette.neutral);
  const accent = Math.round(total * GARDEN_LAYOUT.palette.accent);
  return { primary: total - neutral - accent, neutral, accent };
}

function assignPaletteRoles(entries, random) {
  const blooms = entries.filter(entry => BLOOM_KINDS.includes(entry.kind));
  const targets = paletteTargets(blooms.length);
  const hero = blooms.filter(entry => entry.kind === 'hero');
  const fillers = shuffle(blooms.filter(entry => entry.kind !== 'hero'), random);
  if (hero.length > targets.primary || fillers.length < targets.neutral + targets.accent) {
    throw new Error('garden palette cannot preserve primary hero flowers at the requested ratio');
  }
  hero.forEach(entry => { entry.paletteRole = 'primary'; });
  fillers.forEach((entry, index) => {
    if (index < targets.neutral) entry.paletteRole = 'neutral';
    else if (index < targets.neutral + targets.accent) entry.paletteRole = 'accent';
    else entry.paletteRole = 'primary';
  });
  return targets;
}

function summarise(entries) {
  const zoneCounts = Object.create(null);
  const kindCounts = Object.create(null);
  const paletteCounts = Object.create(null);
  const roleCounts = Object.create(null);
  const clusters = new Map();
  for (const entry of entries) {
    zoneCounts[entry.zone] = (zoneCounts[entry.zone] ?? 0) + 1;
    kindCounts[entry.kind] = (kindCounts[entry.kind] ?? 0) + 1;
    paletteCounts[entry.paletteRole] = (paletteCounts[entry.paletteRole] ?? 0) + 1;
    roleCounts[entry.role] = (roleCounts[entry.role] ?? 0) + 1;
    if (entry.clusterId && !clusters.has(entry.clusterId)) {
      clusters.set(entry.clusterId, { id: entry.clusterId, type: entry.clusterType, side: entry.clusterSide, zone: entry.zone });
    }
  }
  const floralEntries = entries.filter(entry => FLORAL_KINDS.includes(entry.kind)).length;
  return {
    zoneCounts: { ...zoneCounts }, kindCounts: { ...kindCounts },
    paletteCounts: { ...paletteCounts }, roleCounts: { ...roleCounts },
    clusters: [...clusters.values()], floralEntries,
    reductionRatio: round(1 - floralEntries / GARDEN_LAYOUT.capacity.baselineFloralEntries),
  };
}

export function createWeddingGardenPlan({ seed = 'flower-garden', colorHex = 0xff86b3 } = {}) {
  if (!Number.isInteger(colorHex) || colorHex < 0 || colorHex > 0xffffff) {
    throw new TypeError('colorHex must be an integer between 0x000000 and 0xffffff');
  }
  const random = mulberry32(hashSeed(seed));
  const entries = [];
  addArch(entries, random);
  addHeadTable(entries, random);
  addTables(entries, random);
  addAisle(entries, random);
  addStage(entries, random);
  const paletteTargetsForPlan = assignPaletteRoles(entries, random);
  return { entries, ...summarise(entries), paletteTargets: paletteTargetsForPlan };
}

function pointSegmentDistance(point, start, end) {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = clamp(((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSquared, 0, 1);
  return Math.hypot(point[0] - (start[0] + dx * t), point[1] - (start[1] + dz * t));
}

function footprint(entry) { return (FOOTPRINTS[entry.kind] ?? 0.05) * entry.scale; }

function validateClusterConstruction(entries, issues) {
  const clusters = new Map();
  for (const entry of entries) {
    if (!entry.clusterId) continue;
    if (!clusters.has(entry.clusterId)) clusters.set(entry.clusterId, []);
    clusters.get(entry.clusterId).push(entry);
  }
  for (const [id, members] of clusters) {
    const prefix = `cluster ${id}`;
    if (members.filter(entry => entry.kind === 'support').length !== 1) issues.push(`${prefix} needs exactly one visible support`);
    if (members.filter(entry => entry.kind === 'foam').length !== 1) issues.push(`${prefix} needs exactly one floral foam`);
    const requiredStems = members[0]?.zone === 'aisle' ? GARDEN_LAYOUT.aisle.stemsPerCluster : GARDEN_LAYOUT.stage.stemsPerCluster;
    if (members.filter(entry => entry.kind === 'stem').length < requiredStems) issues.push(`${prefix} has insufficient visible stems`);
    if (members.filter(entry => entry.kind === 'leaf').length < 2) issues.push(`${prefix} has insufficient foliage mass`);
  }
  for (const side of [-1, 1]) {
    const ranges = [...clusters.values()]
      .filter(members => members[0]?.zone === 'aisle' && members[0]?.clusterSide === side)
      .map(members => ({
        id: members[0].clusterId,
        min: Math.min(...members.map(entry => entry.position[2] - footprint(entry))),
        max: Math.max(...members.map(entry => entry.position[2] + footprint(entry))),
      })).sort((a, b) => a.min - b.min);
    for (let index = 1; index < ranges.length; index++) {
      const gap = ranges[index].min - ranges[index - 1].max;
      if (gap < GARDEN_LAYOUT.aisle.minimumVisibleGap) {
        issues.push(`${ranges[index - 1].id} and ${ranges[index].id} leave only ${round(gap)}m between clusters`);
      }
    }
  }
  return clusters;
}

export function validateWeddingGardenPlan(plan) {
  const issues = [];
  const entries = Array.isArray(plan?.entries) ? plan.entries : [];
  if (!Array.isArray(plan?.entries)) issues.push('entries must be an array');

  entries.forEach((entry, index) => {
    const prefix = `entries[${index}]`;
    if (!ANCHORS.includes(entry.anchor)) issues.push(`${prefix}.anchor is invalid`);
    if (!INSTALL_KINDS.includes(entry.kind)) issues.push(`${prefix}.kind is invalid`);
    if (!PALETTE_ROLES.includes(entry.paletteRole)) issues.push(`${prefix}.paletteRole is invalid`);
    if (entry.role !== roleForKind(entry.kind)) issues.push(`${prefix}.role does not match kind`);
    if (!Array.isArray(entry.position) || entry.position.length !== 3 || !entry.position.every(Number.isFinite)) {
      issues.push(`${prefix}.position must contain three finite numbers`);
      return;
    }
    if (!Array.isArray(entry.normal) || entry.normal.length !== 3 || !entry.normal.every(Number.isFinite)) {
      issues.push(`${prefix}.normal must contain three finite numbers`);
    }
    if (!Number.isFinite(entry.scale) || entry.scale <= 0) issues.push(`${prefix}.scale must be positive`);
    if (!Number.isFinite(entry.tone) || entry.tone < -0.30 || entry.tone > 0.30) issues.push(`${prefix}.tone is out of range`);
    if (!Number.isFinite(entry.delay) || entry.delay < 0 || entry.delay > GARDEN_LAYOUT.timing.duration) issues.push(`${prefix}.delay is out of range`);

    if (entry.zone === 'aisle') {
      const [x, y, z] = entry.position;
      const radius = footprint(entry);
      const cfg = GARDEN_LAYOUT.aisle;
      if (Math.abs(x) - radius < cfg.safeHalfWidth) issues.push(`${prefix} enters the aisle safety lane`);
      if (Math.abs(x) + radius > cfg.outerX) issues.push(`${prefix} exceeds the aisle garden outer edge`);
      if (y < cfg.minHeight || y > cfg.maxHeight) issues.push(`${prefix} aisle height is out of range`);
      if (z - radius < cfg.backZ - 0.2 || z + radius > cfg.frontZ + 0.2) issues.push(`${prefix} aisle z is out of range`);
      for (const seat of PARTY_LAYOUT.seats) {
        const point = [x, z];
        const pullDistance = pointSegmentDistance(point, seat.chairPullArea.start, seat.chairPullArea.end)
          - PARTY_LAYOUT.tableGeometry.chairFootprintRadius - radius;
        if (pullDistance < PARTY_LAYOUT.requiredClearances.chairPullToFlowers) {
          issues.push(`${prefix} intersects ${seat.id} chair-pull area`);
          break;
        }
        const bodyDistance = Math.hypot(x - seat.body[0], z - seat.body[2])
          - PARTY_LAYOUT.tableGeometry.bodyRadius - radius;
        if (bodyDistance < PARTY_LAYOUT.requiredClearances.bodyToTable) {
          issues.push(`${prefix} intersects ${seat.id} guest body`);
          break;
        }
      }
    }
    if (entry.anchor === 'arch' && (entry.position[0] < 0 || entry.position[0] > 1)) issues.push(`${prefix} arch t is out of range`);
    if (entry.anchor === 'table') {
      if (!Number.isInteger(entry.anchorIndex) || entry.anchorIndex < 0 || entry.anchorIndex >= GARDEN_LAYOUT.table.count) {
        issues.push(`${prefix}.anchorIndex is invalid`);
      }
      const radius = footprint(entry);
      if (Math.hypot(entry.position[0], entry.position[2]) + radius > GARDEN_LAYOUT.table.maxRadius + 0.0001) {
        issues.push(`${prefix} exceeds the guest-table floral radius`);
      }
      if (entry.position[1] > GARDEN_LAYOUT.table.maxHeight) issues.push(`${prefix} exceeds the guest-table height`);
      const settings = PARTY_LAYOUT.seats.filter(seat => seat.tableIndex === entry.anchorIndex);
      for (const setting of settings) {
        const local = setting.placeSettingLocal;
        const gap = Math.hypot(entry.position[0] - local[0], entry.position[2] - local[2])
          - radius - PARTY_LAYOUT.tableGeometry.chargerRadius;
        if (gap < PARTY_LAYOUT.requiredClearances.chargerToFlowers) {
          issues.push(`${prefix} intersects ${setting.id} place setting`);
          break;
        }
      }
    }
  });

  const clusters = validateClusterConstruction(entries, issues);
  const clusterTypes = new Set([...clusters.values()].filter(group => group[0]?.zone === 'aisle').map(group => group[0].clusterType));
  if (clusterTypes.size < 3 || clusterTypes.size > 5) issues.push('aisle must use three to five distinct cluster types');

  const blooms = entries.filter(entry => BLOOM_KINDS.includes(entry.kind));
  const targetPalette = paletteTargets(blooms.length);
  const palette = Object.fromEntries(['primary', 'neutral', 'accent'].map(role => [role, blooms.filter(entry => entry.paletteRole === role).length]));
  for (const role of Object.keys(targetPalette)) {
    if (palette[role] !== targetPalette[role]) issues.push(`palette ${role} must be ${targetPalette[role]} but is ${palette[role]}`);
  }

  const floralEntries = entries.filter(entry => FLORAL_KINDS.includes(entry.kind)).length;
  const reductionRatio = 1 - floralEntries / GARDEN_LAYOUT.capacity.baselineFloralEntries;
  if (reductionRatio < GARDEN_LAYOUT.capacity.targetReductionMin || reductionRatio > GARDEN_LAYOUT.capacity.targetReductionMax) {
    issues.push(`floral entry reduction ${round(reductionRatio)} is outside the 30-40% target`);
  }

  const byKind = Object.fromEntries(INSTALL_KINDS.map(kind => [kind, entries.filter(entry => entry.kind === kind).length]));
  const heroRequired = GARDEN_LAYOUT.capacity.baseFlowerHeadsMax + byKind.hero;
  const fillerRequired = entries.length - byKind.hero;
  const heroWithReserve = Math.ceil(heroRequired * (1 + GARDEN_LAYOUT.capacity.reserveRatio));
  const fillerWithReserve = Math.ceil(fillerRequired * (1 + GARDEN_LAYOUT.capacity.reserveRatio));
  const capacity = {
    hero: { required: heroRequired, withReserve: heroWithReserve, limit: GARDEN_LAYOUT.capacity.flowerHeadLimit, headroom: GARDEN_LAYOUT.capacity.flowerHeadLimit - heroWithReserve },
    filler: { required: fillerRequired, withReserve: fillerWithReserve, limit: GARDEN_LAYOUT.capacity.fillerLimit, headroom: GARDEN_LAYOUT.capacity.fillerLimit - fillerWithReserve },
    byKind,
  };
  capacity.withinLimits = capacity.hero.headroom >= 0 && capacity.filler.headroom >= 0;
  if (!capacity.withinLimits) issues.push('plan exceeds a render capacity including the 20% reserve');
  return {
    issues, capacity,
    construction: {
      clusters: clusters.size, supports: byKind.support + byKind.foam,
      vessels: byKind.support, foam: byKind.foam, stems: byKind.stem,
      floralEntries, reductionRatio: round(reductionRatio), palette,
      clusterTypes: [...clusterTypes].sort(),
    },
  };
}
