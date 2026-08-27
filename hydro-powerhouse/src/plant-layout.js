// Pure, deterministic spatial contract for the hydro-powerhouse set.
// Coordinates are metres. X follows water -> turbine -> generator, Y is up,
// and +Z is the visitor/control side of the machine hall.

const freezeDeep = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeDeep(child);
  return value;
};

const clone = (value) => JSON.parse(JSON.stringify(value));
const round = (value, digits = 4) => Number(value.toFixed(digits));
const pairKey = (a, b) => [a, b].sort().join('|');

export const PLANT_SPEC = freezeDeep({
  version: 1,
  units: 'metres',
  facility: {
    id: 'machine-hall',
    min: [-12, -2.0, -9],
    max: [12, 8.5, 9],
  },
  clearances: {
    staticGap: 0.15,
    actorToEquipment: 0.45,
    actorToAisle: 0.25,
    equipmentToAisle: 0.30,
    hoseToObstacle: 0.12,
    hoseToAisle: 0.20,
    craneToPeople: 0.90,
    craneToForbiddenEquipment: 0.20,
  },
  scale: {
    adultHeight: 1.72,
    adultShoulderWidth: 0.62,
    robotHeight: 1.30,
    runnerDiameter: 3.40,
    casingOutsideDiameter: 4.46,
    generatorHeight: 5.70,
  },
  equipment: [
    {
      id: 'turbine', role: 'rotating-machine',
      center: [0, 2.55, 1.22], size: [3.40, 3.40, 2.10],
    },
    {
      id: 'casing', role: 'installed-volute',
      center: [-0.08, 2.55, 1.18], size: [4.30, 4.46, 0.75],
    },
    {
      id: 'generator', role: 'generator',
      center: [0, 2.55, -1.23], size: [5.70, 5.70, 2.39],
    },
    {
      id: 'shaft', role: 'coupling',
      center: [0, 2.48, -0.32], size: [0.76, 0.90, 5.07],
    },
  ],
  allowedStaticOverlaps: [
    ['casing', 'turbine'],
    ['casing', 'shaft'],
    ['generator', 'shaft'],
    ['shaft', 'turbine'],
  ],
  fluidStations: [
    {
      id: 'oil-station', kind: 'lubrication-oil',
      center: [-3.90, 1.08, 2.40], size: [1.36, 1.66, 1.36],
      connector: [-3.90, 1.20, 2.40], targetEquipmentId: 'generator',
      targetPort: [-1.10, 2.05, 1.65],
    },
    {
      id: 'coolant-station', kind: 'cooling-water',
      center: [3.90, 0.93, 2.40], size: [1.34, 1.35, 1.34],
      connector: [3.90, 1.10, 2.40], targetEquipmentId: 'generator',
      targetPort: [1.10, 2.05, 1.65],
    },
  ],
  hosePaths: [
    {
      id: 'oil-hose', kind: 'lubrication-oil', radius: 0.065,
      sourceStationId: 'oil-station', targetEquipmentId: 'generator',
      points: [
        [-3.90, 1.20, 2.40], [-2.50, 1.09, 2.03], [-1.10, 2.05, 1.65],
      ],
    },
    {
      id: 'coolant-hose', kind: 'cooling-water', radius: 0.075,
      sourceStationId: 'coolant-station', targetEquipmentId: 'generator',
      points: [
        [3.90, 1.10, 2.40], [2.50, 1.01, 2.03], [1.10, 2.05, 1.65],
      ],
    },
  ],
  workAisle: {
    id: 'front-operating-aisle',
    min: [-2.00, 0, 3.40], max: [2.80, 2.20, 4.60],
  },
  supportZones: [
    {
      id: 'gate-control', role: 'remote-gate-control',
      center: [-4.10, 4.94, 0.43], size: [2.20, 2.27, 0.77],
    },
  ],
  actors: [
    {
      id: 'adult-technician', role: 'supervising-technician',
      center: [3.78, 0.77, 4.18], size: [0.52, 1.73, 0.49],
    },
    {
      id: 'maintenance-robot', role: 'friendly-maintenance-robot',
      center: [-2.80, 0.73, 4.10], size: [0.66, 1.33, 0.65],
    },
  ],
  crane: {
    id: 'overhead-casing-crane',
    bridgeCenter: [0, 8.00, 0.80],
    bridgeSize: [11.00, 0.28, 0.35],
    loadSize: [4.00, 4.00, 0.53],
    path: [
      [4.30, 6.45, 0.80],
      [0, 6.45, 0.80],
      [0, 2.55, 1.50],
    ],
    loweringSegment: 1,
    installAllowedOverlaps: ['casing', 'shaft', 'turbine'],
  },
});

function boundsFromCenterSize(center, size) {
  return {
    min: center.map((value, index) => round(value - size[index] / 2)),
    max: center.map((value, index) => round(value + size[index] / 2)),
  };
}

function normaliseVolume(entry) {
  const copy = clone(entry);
  copy.bounds = boundsFromCenterSize(copy.center, copy.size);
  return copy;
}

export function createPlantLayout(spec = PLANT_SPEC) {
  const source = clone(spec);
  const equipment = source.equipment.map(normaliseVolume);
  const fluidStations = source.fluidStations.map(normaliseVolume);
  const supportZones = source.supportZones.map(normaliseVolume);
  const actors = source.actors.map(normaliseVolume);
  const bridge = normaliseVolume({
    id: `${source.crane.id}-bridge`, role: 'overhead-crane-bridge',
    center: source.crane.bridgeCenter, size: source.crane.bridgeSize,
  });
  const layout = {
    version: source.version,
    units: source.units,
    axes: { x: 'water-to-generator', y: 'up', z: 'control-side-positive' },
    facility: clone(source.facility),
    clearances: clone(source.clearances),
    scale: clone(source.scale),
    equipment,
    fluidStations,
    hosePaths: clone(source.hosePaths),
    workAisle: clone(source.workAisle),
    supportZones,
    actors,
    allowedStaticOverlaps: source.allowedStaticOverlaps.map((pair) => [...pair]),
    crane: {
      id: source.crane.id,
      bridge,
      loadSize: [...source.crane.loadSize],
      path: source.crane.path.map((point) => [...point]),
      loweringSegment: source.crane.loweringSegment,
      installAllowedOverlaps: [...source.crane.installAllowedOverlaps],
    },
  };
  return freezeDeep(layout);
}

function overlaps3d(a, b, gap = 0) {
  return [0, 1, 2].every((axis) => (
    a.min[axis] - gap < b.max[axis] && a.max[axis] + gap > b.min[axis]
  ));
}

function overlapsXZ(a, b, gap = 0) {
  return [0, 2].every((axis) => (
    a.min[axis] - gap < b.max[axis] && a.max[axis] + gap > b.min[axis]
  ));
}

function boxDistance3d(a, b) {
  let squared = 0;
  for (let axis = 0; axis < 3; axis++) {
    const delta = Math.max(a.min[axis] - b.max[axis], b.min[axis] - a.max[axis], 0);
    squared += delta * delta;
  }
  return Math.sqrt(squared);
}

function boxDistanceXZ(a, b) {
  const dx = Math.max(a.min[0] - b.max[0], b.min[0] - a.max[0], 0);
  const dz = Math.max(a.min[2] - b.max[2], b.min[2] - a.max[2], 0);
  return Math.hypot(dx, dz);
}

function containsBounds(outer, inner) {
  return [0, 1, 2].every((axis) => inner.min[axis] >= outer.min[axis] && inner.max[axis] <= outer.max[axis]);
}

function expandedXZ(bounds, amount) {
  return {
    min: [bounds.min[0] - amount, 0, bounds.min[2] - amount],
    max: [bounds.max[0] + amount, 0, bounds.max[2] + amount],
  };
}

// Liang-Barsky clipping in the XZ plane. Expansion turns a hose centreline into
// a conservative capsule-vs-box test without bringing geometry code into this module.
function segmentIntersectsRectXZ(start, end, bounds) {
  const x0 = start[0];
  const z0 = start[2];
  const dx = end[0] - x0;
  const dz = end[2] - z0;
  let low = 0;
  let high = 1;
  const checks = [
    [-dx, x0 - bounds.min[0]], [dx, bounds.max[0] - x0],
    [-dz, z0 - bounds.min[2]], [dz, bounds.max[2] - z0],
  ];
  for (const [p, q] of checks) {
    if (Math.abs(p) < 1e-10) {
      if (q < 0) return false;
      continue;
    }
    const ratio = q / p;
    if (p < 0) low = Math.max(low, ratio);
    else high = Math.min(high, ratio);
    if (low > high) return false;
  }
  return true;
}

function hoseIntersectsBounds(hose, bounds, clearance) {
  const expanded = expandedXZ(bounds, hose.radius + clearance);
  for (let index = 1; index < hose.points.length; index++) {
    if (segmentIntersectsRectXZ(hose.points[index - 1], hose.points[index], expanded)) return true;
  }
  return false;
}

function sampleCranePath(crane, stepsPerSegment = 24) {
  const samples = [];
  for (let segment = 0; segment < crane.path.length - 1; segment++) {
    const from = crane.path[segment];
    const to = crane.path[segment + 1];
    for (let step = segment === 0 ? 0 : 1; step <= stepsPerSegment; step++) {
      const t = step / stepsPerSegment;
      const center = from.map((value, axis) => value + (to[axis] - value) * t);
      samples.push({ segment, center, bounds: boundsFromCenterSize(center, crane.loadSize) });
    }
  }
  return samples;
}

function allStaticVolumes(layout) {
  return [...layout.equipment, ...layout.fluidStations, ...layout.supportZones];
}

function floorOccupancyVolumes(layout) {
  const ids = new Set(['casing', 'generator', 'oil-station', 'coolant-station', 'gate-control', 'casing-stand']);
  return allStaticVolumes(layout).filter((entry) => ids.has(entry.id));
}

function areaXZ(bounds) {
  return (bounds.max[0] - bounds.min[0]) * (bounds.max[2] - bounds.min[2]);
}

function volume3d(bounds) {
  return (bounds.max[0] - bounds.min[0]) * (bounds.max[1] - bounds.min[1]) * (bounds.max[2] - bounds.min[2]);
}

function minimumPairDistance(entries, distance, allowed = new Set()) {
  let minimum = null;
  for (let left = 0; left < entries.length; left++) {
    for (let right = left + 1; right < entries.length; right++) {
      if (allowed.has(pairKey(entries[left].id, entries[right].id))) continue;
      const measured = distance(entries[left].bounds, entries[right].bounds);
      minimum = minimum == null ? measured : Math.min(minimum, measured);
    }
  }
  return minimum == null ? 0 : minimum;
}

function measuredClearances(layout) {
  const allowed = new Set(layout.allowedStaticOverlaps.map(([a, b]) => pairKey(a, b)));
  const staticVolumes = allStaticVolumes(layout);
  const actorsToEquipment = [];
  const actorsToAisle = [];
  const equipmentToAisle = [];
  for (const actor of layout.actors) {
    for (const item of staticVolumes) actorsToEquipment.push(boxDistanceXZ(actor.bounds, item.bounds));
    actorsToAisle.push(boxDistanceXZ(actor.bounds, layout.workAisle));
  }
  for (const item of staticVolumes) equipmentToAisle.push(boxDistanceXZ(item.bounds, layout.workAisle));

  const craneSamples = sampleCranePath(layout.crane);
  const craneToPeople = [];
  const craneToForbiddenEquipment = [];
  for (const sample of craneSamples) {
    for (const actor of layout.actors) craneToPeople.push(boxDistance3d(sample.bounds, actor.bounds));
    for (const item of staticVolumes) {
      if (item.id === 'casing'
        || (sample.segment >= layout.crane.loweringSegment
          && layout.crane.installAllowedOverlaps.includes(item.id))) continue;
      craneToForbiddenEquipment.push(boxDistance3d(sample.bounds, item.bounds));
    }
  }
  return {
    staticGap: round(minimumPairDistance(staticVolumes, boxDistance3d, allowed)),
    actorToEquipment: round(Math.min(...actorsToEquipment)),
    actorToAisle: round(Math.min(...actorsToAisle)),
    equipmentToAisle: round(Math.min(...equipmentToAisle)),
    craneToPeople: round(Math.min(...craneToPeople)),
    craneToForbiddenEquipment: round(Math.min(...craneToForbiddenEquipment)),
  };
}

function scaleRatios(layout) {
  const scale = layout.scale;
  return {
    runnerToAdultHeight: round(scale.runnerDiameter / scale.adultHeight),
    casingToRunner: round(scale.casingOutsideDiameter / scale.runnerDiameter),
    generatorToAdultHeight: round(scale.generatorHeight / scale.adultHeight),
    robotToAdultHeight: round(scale.robotHeight / scale.adultHeight),
    aisleToAdultShoulders: round((layout.workAisle.max[2] - layout.workAisle.min[2]) / scale.adultShoulderWidth),
  };
}

export function validatePlantLayout(layout = PLANT_LAYOUT) {
  const issues = [];
  if (!layout || typeof layout !== 'object') return ['layout must be an object'];
  const facility = layout.facility;
  const staticVolumes = allStaticVolumes(layout);
  const allowed = new Set(layout.allowedStaticOverlaps.map(([a, b]) => pairKey(a, b)));

  for (const entry of [...staticVolumes, ...layout.actors, layout.crane.bridge]) {
    if (!entry.bounds || !containsBounds(facility, entry.bounds)) issues.push(`${entry.id} leaves the machine hall bounds`);
  }

  for (let left = 0; left < staticVolumes.length; left++) {
    for (let right = left + 1; right < staticVolumes.length; right++) {
      const a = staticVolumes[left];
      const b = staticVolumes[right];
      if (allowed.has(pairKey(a.id, b.id))) continue;
      if (overlaps3d(a.bounds, b.bounds, layout.clearances.staticGap)) {
        issues.push(`${a.id} and ${b.id} violate the static clearance`);
      }
    }
  }

  for (const actor of layout.actors) {
    for (const item of staticVolumes) {
      if (boxDistanceXZ(actor.bounds, item.bounds) < layout.clearances.actorToEquipment) {
        issues.push(`${actor.id} is too close to ${item.id}`);
      }
    }
    if (boxDistanceXZ(actor.bounds, layout.workAisle) < layout.clearances.actorToAisle) {
      issues.push(`${actor.id} blocks the operating aisle`);
    }
  }

  for (const item of staticVolumes) {
    if (boxDistanceXZ(item.bounds, layout.workAisle) < layout.clearances.equipmentToAisle) {
      issues.push(`${item.id} intrudes on the operating aisle clearance`);
    }
  }

  for (const hose of layout.hosePaths) {
    if (!Array.isArray(hose.points) || hose.points.length < 2 || hose.points.some((point) => point.length !== 3 || !point.every(Number.isFinite))) {
      issues.push(`${hose.id} needs at least two finite 3D points`);
      continue;
    }
    if (hose.points.some((point) => point.some((value, axis) => value < facility.min[axis] || value > facility.max[axis]))) {
      issues.push(`${hose.id} leaves the machine hall bounds`);
    }
    if (hoseIntersectsBounds(hose, layout.workAisle, layout.clearances.hoseToAisle)) {
      issues.push(`${hose.id} crosses the operating aisle`);
    }
    for (const item of staticVolumes) {
      if (item.id === hose.sourceStationId || item.id === hose.targetEquipmentId) continue;
      if (item.role && ['rotating-machine', 'installed-volute', 'generator', 'coupling'].includes(item.role)) continue;
      if (hoseIntersectsBounds(hose, item.bounds, layout.clearances.hoseToObstacle)) {
        issues.push(`${hose.id} collides with ${item.id}`);
      }
    }
    const station = layout.fluidStations.find((entry) => entry.id === hose.sourceStationId);
    const target = layout.equipment.find((entry) => entry.id === hose.targetEquipmentId);
    if (!station) issues.push(`${hose.id} has no source station`);
    if (!target) issues.push(`${hose.id} has no target equipment`);
    if (station && boxDistance3d(boundsFromCenterSize(hose.points[0], [0, 0, 0]), station.bounds) > 0.02) {
      issues.push(`${hose.id} does not begin on ${station.id}`);
    }
    if (target && station?.targetPort
      && station.targetPort.some((value, axis) => Math.abs(value - hose.points.at(-1)[axis]) > 0.02)) {
      issues.push(`${hose.id} does not end on the declared ${target.id} service port`);
    }
  }

  const craneSamples = sampleCranePath(layout.crane);
  for (const sample of craneSamples) {
    if (!containsBounds(facility, sample.bounds)) issues.push(`crane load leaves the machine hall on path segment ${sample.segment}`);
    for (const actor of layout.actors) {
      if (boxDistance3d(sample.bounds, actor.bounds) < layout.clearances.craneToPeople) {
        issues.push(`crane load comes too close to ${actor.id}`);
      }
    }
    for (const item of staticVolumes) {
      const installOverlap = item.id === 'casing'
        || (sample.segment >= layout.crane.loweringSegment
          && layout.crane.installAllowedOverlaps.includes(item.id));
      if (!installOverlap && boxDistance3d(sample.bounds, item.bounds) < layout.clearances.craneToForbiddenEquipment) {
        issues.push(`crane load conflicts with ${item.id} on path segment ${sample.segment}`);
      }
    }
  }

  const ratios = scaleRatios(layout);
  const ratioRanges = {
    runnerToAdultHeight: [1.25, 2.20],
    casingToRunner: [1.20, 1.65],
    // The generator is deliberately a child-readable hero machine: its outer
    // ring and support frame stand a little over three adults high.
    generatorToAdultHeight: [2.50, 3.70],
    robotToAdultHeight: [0.50, 0.85],
    aisleToAdultShoulders: [1.80, 3.50],
  };
  for (const [name, range] of Object.entries(ratioRanges)) {
    if (ratios[name] < range[0] || ratios[name] > range[1]) issues.push(`${name} scale ratio is out of range`);
  }

  return [...new Set(issues)];
}

function validMeasuredBounds(bounds) {
  return Boolean(bounds
    && Array.isArray(bounds.min) && bounds.min.length === 3
    && Array.isArray(bounds.max) && bounds.max.length === 3
    && bounds.min.every(Number.isFinite) && bounds.max.every(Number.isFinite));
}

function expandedBounds3d(bounds, amount) {
  return {
    min: bounds.min.map((value) => value - amount),
    max: bounds.max.map((value) => value + amount),
  };
}

// Slab clipping for a finite segment. Expanding the obstacle by the hose
// radius plus required clearance gives a conservative capsule-vs-box test.
function segmentIntersectsBox3d(start, end, bounds) {
  let low = 0;
  let high = 1;
  for (let axis = 0; axis < 3; axis++) {
    const delta = end[axis] - start[axis];
    if (Math.abs(delta) < 1e-10) {
      if (start[axis] < bounds.min[axis] || start[axis] > bounds.max[axis]) return false;
      continue;
    }
    let near = (bounds.min[axis] - start[axis]) / delta;
    let far = (bounds.max[axis] - start[axis]) / delta;
    if (near > far) [near, far] = [far, near];
    low = Math.max(low, near);
    high = Math.min(high, far);
    if (low > high) return false;
  }
  return true;
}

function measuredHoseIntersectsBounds(hose, bounds, clearance) {
  const expanded = expandedBounds3d(bounds, hose.radius + clearance);
  for (let index = 1; index < hose.points.length; index++) {
    if (segmentIntersectsBox3d(hose.points[index - 1], hose.points[index], expanded)) return true;
  }
  return false;
}

function containmentOverflow(outer, inner) {
  let overflow = 0;
  for (let axis = 0; axis < 3; axis++) {
    overflow = Math.max(
      overflow,
      outer.min[axis] - inner.min[axis],
      inner.max[axis] - outer.max[axis],
    );
  }
  return Math.max(0, overflow);
}

/**
 * Validate the runtime geometry measured by world.js.
 *
 * The authored layout contributes only facility limits, allowed mechanical
 * overlaps and existing clearance thresholds. Planned centers, sizes and
 * missing planned objects deliberately do not create pass/fail issues here.
 */
export function validateMeasuredPlantLayout(measured, layout = PLANT_LAYOUT) {
  const snapshot = measured && typeof measured === 'object' ? measured : {};
  const rawVolumes = Array.isArray(snapshot.volumes) ? snapshot.volumes : [];
  const rawHoses = Array.isArray(snapshot.hoses) ? snapshot.hoses : [];
  const rawCraneSamples = Array.isArray(snapshot.craneSamples) ? snapshot.craneSamples : [];
  const invalidVolumes = rawVolumes.filter((entry) => !validMeasuredBounds(entry?.bounds)).length;
  const invalidCraneSamples = rawCraneSamples.filter((entry) => !validMeasuredBounds(entry?.bounds)).length;
  const volumes = rawVolumes.filter((entry) => validMeasuredBounds(entry?.bounds)).map(clone);
  const craneSamples = rawCraneSamples.filter((entry) => validMeasuredBounds(entry?.bounds)).map(clone);
  const hoses = rawHoses.filter((hose) => (
    hose && Number.isFinite(hose.radius) && hose.radius >= 0
    && Array.isArray(hose.points) && hose.points.length >= 2
    && hose.points.every((point) => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite))
  )).map(clone);
  const invalidHoses = rawHoses.length - hoses.length;
  const facility = layout.facility;
  const required = layout.clearances;
  const allowedStatic = new Set(layout.allowedStaticOverlaps.map(([a, b]) => pairKey(a, b)));
  const installationAllowed = new Set(layout.crane.installAllowedOverlaps);
  const staticVolumes = volumes.filter((entry) => (
    entry.category === 'equipment'
    || entry.category === 'fluidStation'
    || entry.category === 'supportZone'
  ));
  const equipmentVolumes = volumes.filter((entry) => entry.category === 'equipment');
  const fluidStations = volumes.filter((entry) => entry.category === 'fluidStation');
  const actors = volumes.filter((entry) => entry.category === 'actor');
  const craneVolumes = volumes.filter((entry) => entry.category === 'craneBridge');
  const issuesByKey = new Map();
  const minima = {};

  function addIssue(issue, preference = 'min') {
    const ids = Array.isArray(issue.ids) ? [...issue.ids] : [];
    const key = `${issue.code}|${[...ids].sort().join('|')}`;
    const candidate = { ...issue, ids };
    const current = issuesByKey.get(key);
    if (!current) {
      issuesByKey.set(key, candidate);
      return;
    }
    if (!Number.isFinite(candidate.measured) || !Number.isFinite(current.measured)) return;
    const replace = preference === 'max'
      ? candidate.measured > current.measured
      : candidate.measured < current.measured;
    if (replace) issuesByKey.set(key, candidate);
  }

  function observeMinimum(name, value, ids, extra = {}) {
    if (!Number.isFinite(value)) return;
    const candidate = { measured: round(value), ids: [...ids], ...extra };
    if (!minima[name] || candidate.measured < minima[name].measured) minima[name] = candidate;
  }

  for (const volume of [...staticVolumes, ...actors, ...craneVolumes]) {
    if (containsBounds(facility, volume.bounds)) continue;
    const overflow = round(containmentOverflow(facility, volume.bounds));
    addIssue({
      code: 'facility-containment',
      ids: [volume.id],
      measured: overflow,
      required: 0,
      message: `${volume.id} extends ${overflow} m outside the machine hall`,
    }, 'max');
  }

  for (let left = 0; left < staticVolumes.length; left++) {
    for (let right = left + 1; right < staticVolumes.length; right++) {
      const a = staticVolumes[left];
      const b = staticVolumes[right];
      if (allowedStatic.has(pairKey(a.id, b.id))) continue;
      const distance = boxDistance3d(a.bounds, b.bounds);
      observeMinimum('staticGap', distance, [a.id, b.id]);
      if (distance >= required.staticGap) continue;
      addIssue({
        code: 'static-clearance',
        ids: [a.id, b.id],
        measured: round(distance),
        required: required.staticGap,
        message: `${a.id} and ${b.id} have insufficient actual clearance`,
      });
    }
  }

  for (const actor of actors) {
    for (const item of staticVolumes) {
      const distance = boxDistanceXZ(actor.bounds, item.bounds);
      observeMinimum('actorToEquipment', distance, [actor.id, item.id]);
      if (distance >= required.actorToEquipment) continue;
      addIssue({
        code: 'actor-equipment-clearance',
        ids: [actor.id, item.id],
        measured: round(distance),
        required: required.actorToEquipment,
        message: `${actor.id} is too close to ${item.id}`,
      });
    }
  }

  // The aisle is authored as a reserved world-space corridor. Compare the
  // measured render bounds—not planned proxy sizes—against that corridor.
  for (const actor of actors) {
    const distance = boxDistanceXZ(actor.bounds, layout.workAisle);
    observeMinimum('actorToAisle', distance, [actor.id, layout.workAisle.id]);
    if (distance < required.actorToAisle) addIssue({
      code: 'actor-aisle-clearance',
      ids: [actor.id, layout.workAisle.id],
      measured: round(distance),
      required: required.actorToAisle,
      message: `${actor.id} blocks the measured operating aisle`,
    });
  }
  for (const item of staticVolumes) {
    const distance = boxDistanceXZ(item.bounds, layout.workAisle);
    observeMinimum('equipmentToAisle', distance, [item.id, layout.workAisle.id]);
    if (distance < required.equipmentToAisle) addIssue({
      code: 'equipment-aisle-clearance',
      ids: [item.id, layout.workAisle.id],
      measured: round(distance),
      required: required.equipmentToAisle,
      message: `${item.id} intrudes on the measured operating aisle`,
    });
  }

  for (const actor of actors) {
    for (const crane of craneVolumes) {
      const distance = boxDistance3d(actor.bounds, crane.bounds);
      observeMinimum('craneToPeople', distance, [actor.id, crane.id], { source: 'bridge' });
      if (distance >= required.craneToPeople) continue;
      addIssue({
        code: 'actor-crane-clearance',
        ids: [actor.id, crane.id],
        measured: round(distance),
        required: required.craneToPeople,
        message: `${actor.id} is too close to the actual crane bridge`,
      });
    }
    for (const sample of craneSamples) {
      const distance = boxDistance3d(actor.bounds, sample.bounds);
      observeMinimum('craneToPeople', distance, [actor.id, 'crane-load'], {
        source: 'load-trace', sequence: sample.sequence,
      });
      if (distance >= required.craneToPeople) continue;
      addIssue({
        code: 'actor-crane-clearance',
        ids: [actor.id, 'crane-load'],
        measured: round(distance),
        required: required.craneToPeople,
        sampleSequence: sample.sequence,
        message: `${actor.id} is too close to the actual crane load path`,
      });
    }
  }

  for (const crane of craneVolumes) {
    for (const item of staticVolumes) {
      const distance = boxDistance3d(crane.bounds, item.bounds);
      observeMinimum('craneToForbiddenEquipment', distance, [crane.id, item.id], { source: 'bridge' });
      if (distance >= required.craneToForbiddenEquipment) continue;
      addIssue({
        code: 'crane-equipment-clearance',
        ids: [crane.id, item.id],
        measured: round(distance),
        required: required.craneToForbiddenEquipment,
        message: `the actual crane bridge is too close to ${item.id}`,
      });
    }
  }

  for (const sample of craneSamples) {
    if (!containsBounds(facility, sample.bounds)) {
      const overflow = round(containmentOverflow(facility, sample.bounds));
      addIssue({
        code: 'facility-containment',
        ids: ['crane-load'],
        measured: overflow,
        required: 0,
        sampleSequence: sample.sequence,
        message: `the actual crane load extends ${overflow} m outside the machine hall`,
      }, 'max');
    }
    for (const item of staticVolumes) {
      if (item.id === 'casing' || (sample.installation && installationAllowed.has(item.id))) continue;
      const distance = boxDistance3d(sample.bounds, item.bounds);
      observeMinimum('craneToForbiddenEquipment', distance, ['crane-load', item.id], {
        source: 'load-trace', sequence: sample.sequence,
      });
      if (distance >= required.craneToForbiddenEquipment) continue;
      addIssue({
        code: 'crane-equipment-clearance',
        ids: ['crane-load', item.id],
        measured: round(distance),
        required: required.craneToForbiddenEquipment,
        sampleSequence: sample.sequence,
        message: `the actual crane load path conflicts with ${item.id}`,
      });
    }
  }

  const hoseObstacles = [...actors, ...equipmentVolumes, ...fluidStations];
  for (const hose of hoses) {
    // Both service lines intentionally terminate inside the common turbine /
    // casing / generator envelope. Their final approach is not an obstacle
    // crossing; people and unrelated floor stations remain fully checked.
    const intentionalMachineTargets = new Set([
      hose.targetEquipmentId,
      'turbine',
      'casing',
      'generator',
    ]);
    let outside = 0;
    for (const point of hose.points) {
      for (let axis = 0; axis < 3; axis++) {
        outside = Math.max(
          outside,
          facility.min[axis] - (point[axis] - hose.radius),
          (point[axis] + hose.radius) - facility.max[axis],
        );
      }
    }
    if (outside > 0) {
      const overflow = round(outside);
      addIssue({
        code: 'hose-facility-containment',
        ids: [hose.id],
        measured: overflow,
        required: 0,
        message: `${hose.id} extends ${overflow} m outside the machine hall`,
      }, 'max');
    }
    if (measuredHoseIntersectsBounds(hose, layout.workAisle, required.hoseToAisle)) {
      observeMinimum('hoseToAisle', 0, [hose.id, layout.workAisle.id]);
      addIssue({
        code: 'hose-aisle-clearance',
        ids: [hose.id, layout.workAisle.id],
        measured: 0,
        required: required.hoseToAisle,
        message: `${hose.id} crosses the measured operating aisle`,
      });
    }
    for (const obstacle of hoseObstacles) {
      if (obstacle.id === hose.sourceStationId || obstacle.id === hose.targetEquipmentId) continue;
      if (obstacle.category === 'equipment' && intentionalMachineTargets.has(obstacle.id)) continue;
      if (!measuredHoseIntersectsBounds(hose, obstacle.bounds, required.hoseToObstacle)) continue;
      observeMinimum('hoseToObstacle', 0, [hose.id, obstacle.id]);
      addIssue({
        code: 'hose-obstacle-clearance',
        ids: [hose.id, obstacle.id],
        measured: 0,
        required: required.hoseToObstacle,
        message: `${hose.id} enters the required clearance around ${obstacle.id}`,
      });
    }
  }

  const clearanceMeasurements = {};
  for (const name of ['staticGap', 'actorToEquipment', 'craneToPeople', 'craneToForbiddenEquipment', 'hoseToObstacle']) {
    clearanceMeasurements[name] = minima[name] || null;
  }
  const result = {
    issues: [...issuesByKey.values()],
    measurements: {
      source: 'rendered-world-geometry',
      coordinateSpace: snapshot.coordinateSpace || 'world-metres',
      requiredClearances: clone(required),
      measuredClearances: clearanceMeasurements,
      counts: {
        volumes: volumes.length,
        actors: actors.length,
        staticVolumes: staticVolumes.length,
        hoses: hoses.length,
        craneSamples: craneSamples.length,
      },
      diagnostics: { invalidVolumes, invalidHoses, invalidCraneSamples },
      volumes,
      hoses,
      craneSamples,
    },
  };
  return freezeDeep(result);
}

export function getPlantLayoutStats(layout = PLANT_LAYOUT) {
  const facilitySize = layout.facility.max.map((value, axis) => round(value - layout.facility.min[axis]));
  const aisleSize = layout.workAisle.max.map((value, axis) => round(value - layout.workAisle.min[axis]));
  const floorVolumes = floorOccupancyVolumes(layout);
  const grossFootprintArea = floorVolumes.reduce((total, item) => total + areaXZ(item.bounds), 0);
  const facilityFloorArea = facilitySize[0] * facilitySize[2];
  const craneSamples = sampleCranePath(layout.crane);
  const craneEnvelope = {
    min: [0, 1, 2].map((axis) => Math.min(...craneSamples.map((sample) => sample.bounds.min[axis]))),
    max: [0, 1, 2].map((axis) => Math.max(...craneSamples.map((sample) => sample.bounds.max[axis]))),
  };
  const stats = {
    dimensions: {
      facility: facilitySize,
      floorArea: round(facilityFloorArea),
      operatingAisle: aisleSize,
      runnerDiameter: layout.scale.runnerDiameter,
      casingOutsideDiameter: layout.scale.casingOutsideDiameter,
      generatorHeight: layout.scale.generatorHeight,
    },
    counts: {
      equipment: layout.equipment.length,
      fluidStations: layout.fluidStations.length,
      hosePaths: layout.hosePaths.length,
      supportZones: layout.supportZones.length,
      adultTechnicians: layout.actors.filter((actor) => actor.role === 'supervising-technician').length,
      maintenanceRobots: layout.actors.filter((actor) => actor.role === 'friendly-maintenance-robot').length,
      cranePathSegments: Math.max(0, layout.crane.path.length - 1),
    },
    clearances: {
      required: clone(layout.clearances),
      measured: measuredClearances(layout),
    },
    scaleRatios: scaleRatios(layout),
    occupancy: {
      operatingAisleArea: round(aisleSize[0] * aisleSize[2]),
      grossStaticFootprintArea: round(grossFootprintArea),
      grossStaticFootprintRatio: round(grossFootprintArea / facilityFloorArea),
      actorFootprintArea: round(layout.actors.reduce((total, actor) => total + areaXZ(actor.bounds), 0)),
      craneSweptEnvelope: {
        min: craneEnvelope.min.map((value) => round(value)),
        max: craneEnvelope.max.map((value) => round(value)),
        volume: round(volume3d(craneEnvelope)),
      },
    },
    validationIssues: validatePlantLayout(layout),
  };
  return freezeDeep(stats);
}

export const PLANT_LAYOUT = createPlantLayout();
