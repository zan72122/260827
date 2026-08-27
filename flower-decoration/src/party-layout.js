// 披露宴会場の縮尺・動線・衝突判定を一元化する純ロジック。
// Three.js や DOM に依存せず、Node テストと実行時の会場構築で同じ座標を共有する。

const EPSILON = 1e-6;

const SPEC = Object.freeze({
  hall: Object.freeze({ minX: -8, maxX: 8, minZ: -12, maxZ: 10 }),
  aisle: Object.freeze({
    halfWidth: 1.35,
    flowerInnerX: 1.42,
    flowerOuterX: 2.20,
    minZ: -8.4,
    maxZ: 7.6,
  }),
  table: Object.freeze({
    radius: 0.94,
    topY: 0.752,
    centersX: Object.freeze([-4.2, 4.2]),
    centersZ: Object.freeze([-7, -2.5, 2]),
    seatsPerTable: 8,
    seatAngleOffset: Math.PI / 8,
    chairRadiusFromTable: 1.36,
    chairFootprintRadius: 0.27,
    chairPullRadiusFromTable: 1.72,
    bodyRadiusFromTable: 1.22,
    bodyRadius: 0.24,
    settingRadiusFromTable: 0.63,
    chargerRadius: 0.205,
    floralRadius: 0.28,
  }),
  serviceLanes: Object.freeze([
    Object.freeze({ id: 'service-left', minX: -7.25, maxX: -6.35, minZ: -8.65, maxZ: 3.75 }),
    Object.freeze({ id: 'service-right', minX: 6.35, maxX: 7.25, minZ: -8.65, maxZ: 3.75 }),
  ]),
  vignettes: Object.freeze({
    cake: Object.freeze({ center: Object.freeze([-6.35, -10.20]), radius: 0.90 }),
    bar: Object.freeze({ center: Object.freeze([6.15, -10.15]), radius: 1.05 }),
    piano: Object.freeze({ center: Object.freeze([-6.25, 5.90]), radius: 1.30 }),
    lounge: Object.freeze({ center: Object.freeze([5.95, 6.15]), radius: 1.40 }),
    seatingChart: Object.freeze({ center: Object.freeze([7.15, 8.65]), radius: 0.45 }),
  }),
  headTable: Object.freeze({
    center: Object.freeze([0, -10.55]),
    halfWidth: 1.80,
    halfDepth: 0.45,
    backdropZ: -11.82,
    couple: Object.freeze([
      Object.freeze({ role: 'bride', center: Object.freeze([-0.62, -11.43]) }),
      Object.freeze({ role: 'groom', center: Object.freeze([0.62, -11.43]) }),
    ]),
    chairs: Object.freeze([
      Object.freeze({ role: 'bride', center: Object.freeze([-1.35, -11.43]) }),
      Object.freeze({ role: 'groom', center: Object.freeze([1.35, -11.43]) }),
    ]),
    settings: Object.freeze([
      Object.freeze([-0.62, 1.105, -10.55]),
      Object.freeze([0.62, 1.105, -10.55]),
    ]),
    personHalfWidth: 0.30,
    personHalfDepth: 0.22,
    chairHalfWidth: 0.25,
    chairHalfDepth: 0.18,
  }),
  clearances: Object.freeze({
    bodyToTable: 0.02,
    chairToTable: 0.10,
    chairPullToFlowers: 0.10,
    chargerToFlowers: 0.10,
    tableToTable: 0.45,
    serviceLane: 0.10,
    vignette: 0.20,
    coupleToHeadTable: 0.10,
    coupleToBackdrop: 0.10,
    coupleToHeadChair: 0.10,
  }),
});

function round(value) {
  return Math.round(value * 10000) / 10000;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function pointRectDistance([x, z], rect) {
  const dx = Math.max(rect.minX - x, 0, x - rect.maxX);
  const dz = Math.max(rect.minZ - z, 0, z - rect.maxZ);
  return Math.hypot(dx, dz);
}

function pointSegmentDistance(point, start, end) {
  const vx = end[0] - start[0];
  const vz = end[1] - start[1];
  const lengthSquared = vx * vx + vz * vz;
  if (lengthSquared <= EPSILON) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = Math.max(0, Math.min(1,
    ((point[0] - start[0]) * vx + (point[1] - start[1]) * vz) / lengthSquared));
  return Math.hypot(point[0] - (start[0] + vx * t), point[1] - (start[1] + vz * t));
}

function orientation(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a, b, point) {
  return point[0] >= Math.min(a[0], b[0]) - EPSILON
    && point[0] <= Math.max(a[0], b[0]) + EPSILON
    && point[1] >= Math.min(a[1], b[1]) - EPSILON
    && point[1] <= Math.max(a[1], b[1]) + EPSILON;
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (((o1 > EPSILON && o2 < -EPSILON) || (o1 < -EPSILON && o2 > EPSILON))
      && ((o3 > EPSILON && o4 < -EPSILON) || (o3 < -EPSILON && o4 > EPSILON))) return true;
  if (Math.abs(o1) <= EPSILON && onSegment(a, b, c)) return true;
  if (Math.abs(o2) <= EPSILON && onSegment(a, b, d)) return true;
  if (Math.abs(o3) <= EPSILON && onSegment(c, d, a)) return true;
  if (Math.abs(o4) <= EPSILON && onSegment(c, d, b)) return true;
  return false;
}

function segmentDistance(a, b, c, d) {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    pointSegmentDistance(a, c, d),
    pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b),
    pointSegmentDistance(d, a, b),
  );
}

function segmentRectDistance(start, end, rect) {
  if (pointRectDistance(start, rect) <= EPSILON || pointRectDistance(end, rect) <= EPSILON) return 0;
  const corners = [
    [rect.minX, rect.minZ], [rect.maxX, rect.minZ],
    [rect.maxX, rect.maxZ], [rect.minX, rect.maxZ],
  ];
  let minimum = Infinity;
  for (let index = 0; index < corners.length; index += 1) {
    minimum = Math.min(minimum, segmentDistance(
      start, end, corners[index], corners[(index + 1) % corners.length],
    ));
  }
  return minimum;
}

function circleGap(a, radiusA, b, radiusB) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) - radiusA - radiusB;
}

function boxGap(a, halfWidthA, halfDepthA, b, halfWidthB, halfDepthB) {
  const dx = Math.max(Math.abs(a[0] - b[0]) - halfWidthA - halfWidthB, 0);
  const dz = Math.max(Math.abs(a[1] - b[1]) - halfDepthA - halfDepthB, 0);
  return Math.hypot(dx, dz);
}

function gardenRects(aisle) {
  return [
    { id: 'garden-left', minX: -aisle.flowerOuterX, maxX: -aisle.flowerInnerX, minZ: aisle.minZ, maxZ: aisle.maxZ },
    { id: 'garden-right', minX: aisle.flowerInnerX, maxX: aisle.flowerOuterX, minZ: aisle.minZ, maxZ: aisle.maxZ },
    { id: 'garden-stage-left', minX: -4.75, maxX: -2.45, minZ: -9.95, maxZ: -9.25 },
    { id: 'garden-stage-right', minX: 2.45, maxX: 4.75, minZ: -9.95, maxZ: -9.25 },
  ];
}

function createTables() {
  const tables = [];
  let tableIndex = 0;
  for (let row = 0; row < SPEC.table.centersZ.length; row += 1) {
    for (let sideIndex = 0; sideIndex < SPEC.table.centersX.length; sideIndex += 1) {
      const x = SPEC.table.centersX[sideIndex];
      const z = SPEC.table.centersZ[row];
      tables.push({
        id: `guest-table-${tableIndex + 1}`,
        index: tableIndex,
        row,
        side: x < 0 ? 'left' : 'right',
        center: [x, 0, z],
        radius: SPEC.table.radius,
        topY: SPEC.table.topY,
      });
      tableIndex += 1;
    }
  }
  return tables;
}

function createSeats(tables) {
  const seats = [];
  for (const table of tables) {
    for (let seatIndex = 0; seatIndex < SPEC.table.seatsPerTable; seatIndex += 1) {
      const angle = SPEC.table.seatAngleOffset
        + seatIndex * (Math.PI * 2 / SPEC.table.seatsPerTable);
      const outward = [round(Math.cos(angle)), 0, round(Math.sin(angle))];
      const atRadius = (radius, y = 0) => [
        round(table.center[0] + outward[0] * radius),
        y,
        round(table.center[2] + outward[2] * radius),
      ];
      const chair = atRadius(SPEC.table.chairRadiusFromTable);
      const chairPulled = atRadius(SPEC.table.chairPullRadiusFromTable);
      const body = atRadius(SPEC.table.bodyRadiusFromTable);
      const placeSetting = atRadius(SPEC.table.settingRadiusFromTable, SPEC.table.topY);
      const globalSeatIndex = seats.length;
      seats.push({
        id: `${table.id}-seat-${seatIndex + 1}`,
        index: globalSeatIndex,
        accessible: globalSeatIndex === 10 || globalSeatIndex === 34,
        tableIndex: table.index,
        seatIndex,
        angle: round(angle),
        outward,
        chair,
        chairLocal: [round(outward[0] * SPEC.table.chairRadiusFromTable), 0, round(outward[2] * SPEC.table.chairRadiusFromTable)],
        body,
        bodyLocal: [round(outward[0] * SPEC.table.bodyRadiusFromTable), 0, round(outward[2] * SPEC.table.bodyRadiusFromTable)],
        placeSetting,
        placeSettingLocal: [round(outward[0] * SPEC.table.settingRadiusFromTable), SPEC.table.topY, round(outward[2] * SPEC.table.settingRadiusFromTable)],
        chairPullArea: { start: [chair[0], chair[2]], end: [chairPulled[0], chairPulled[2]], radius: SPEC.table.chairFootprintRadius },
      });
    }
  }
  return seats;
}

/** 同じ寸法から毎回同一の48席レイアウトを生成する。 */
export function createPartyLayout() {
  const tables = createTables();
  const seats = createSeats(tables);
  const vignettes = Object.fromEntries(Object.entries(SPEC.vignettes).map(([name, value]) => [name, {
    name,
    center: [...value.center],
    radius: value.radius,
  }]));
  return deepFreeze({
    seed: 'wedding-party-layout-v2',
    hall: { ...SPEC.hall, width: 16, depth: 22 },
    aisle: { ...SPEC.aisle },
    tableGeometry: {
      radius: SPEC.table.radius,
      topY: SPEC.table.topY,
      seatsPerTable: SPEC.table.seatsPerTable,
      seatAngleOffset: SPEC.table.seatAngleOffset,
      chairRadiusFromTable: SPEC.table.chairRadiusFromTable,
      chairPullRadiusFromTable: SPEC.table.chairPullRadiusFromTable,
      chairFootprintRadius: SPEC.table.chairFootprintRadius,
      bodyRadiusFromTable: SPEC.table.bodyRadiusFromTable,
      bodyRadius: SPEC.table.bodyRadius,
      settingRadiusFromTable: SPEC.table.settingRadiusFromTable,
      floralRadius: SPEC.table.floralRadius,
      chargerRadius: SPEC.table.chargerRadius,
      furnitureEnvelopeRadius: round(SPEC.table.chairPullRadiusFromTable + SPEC.table.chairFootprintRadius),
    },
    tableCenters: tables.map((table) => [table.center[0], table.center[2]]),
    tables,
    seats,
    chairs: seats.map((seat) => ({ id: seat.id, tableIndex: seat.tableIndex, position: seat.chair, local: seat.chairLocal, outward: seat.outward, pullArea: seat.chairPullArea })),
    guestBodies: seats.map((seat) => ({ id: seat.id, tableIndex: seat.tableIndex, position: seat.body, local: seat.bodyLocal, radius: SPEC.table.bodyRadius })),
    placeSettings: seats.map((seat) => ({ id: seat.id, tableIndex: seat.tableIndex, position: seat.placeSetting, local: seat.placeSettingLocal, chargerRadius: SPEC.table.chargerRadius })),
    gardenExclusions: gardenRects(SPEC.aisle),
    serviceLanes: SPEC.serviceLanes.map((lane) => ({ ...lane })),
    vignettes,
    headTable: {
      center: [...SPEC.headTable.center],
      halfWidth: SPEC.headTable.halfWidth,
      halfDepth: SPEC.headTable.halfDepth,
      backdropZ: SPEC.headTable.backdropZ,
      couple: SPEC.headTable.couple.map((person) => ({ role: person.role, center: [...person.center] })),
      chairs: SPEC.headTable.chairs.map((chair) => ({ role: chair.role, center: [...chair.center] })),
      settings: SPEC.headTable.settings.map((setting) => [...setting]),
      personHalfWidth: SPEC.headTable.personHalfWidth,
      personHalfDepth: SPEC.headTable.personHalfDepth,
      chairHalfWidth: SPEC.headTable.chairHalfWidth,
      chairHalfDepth: SPEC.headTable.chairHalfDepth,
    },
    counts: { guestTables: tables.length, seatsPerTable: SPEC.table.seatsPerTable, guestSeats: seats.length, headSettings: 2 },
    requiredClearances: { ...SPEC.clearances },
  });
}

export const PARTY_LAYOUT = createPartyLayout();

function minimum(values) {
  return values.length ? Math.min(...values) : Infinity;
}

/** レイアウトの最小余白をメートルで返す。 */
export function getPartyLayoutStats(layout = PARTY_LAYOUT) {
  const tableByIndex = new Map(layout.tables.map((table) => [table.index, table]));
  const bodyToTables = [];
  const bodyToGarden = [];
  const chairToTables = [];
  const chairPullToGarden = [];
  const chargerToFlowers = [];
  for (const seat of layout.seats) {
    const bodyPoint = [seat.body[0], seat.body[2]];
    const chairPoint = [seat.chair[0], seat.chair[2]];
    for (const table of layout.tables) {
      const tablePoint = [table.center[0], table.center[2]];
      bodyToTables.push(circleGap(bodyPoint, SPEC.table.bodyRadius, tablePoint, table.radius));
      chairToTables.push(circleGap(chairPoint, SPEC.table.chairFootprintRadius, tablePoint, table.radius));
    }
    for (const garden of layout.gardenExclusions) {
      bodyToGarden.push(pointRectDistance(bodyPoint, garden) - SPEC.table.bodyRadius);
      chairPullToGarden.push(segmentRectDistance(
        seat.chairPullArea.start, seat.chairPullArea.end, garden,
      ) - seat.chairPullArea.radius);
    }
    const settingPoint = [seat.placeSetting[0], seat.placeSetting[2]];
    const ownTable = tableByIndex.get(seat.tableIndex);
    if (ownTable) chargerToFlowers.push(circleGap(
      settingPoint, SPEC.table.chargerRadius,
      [ownTable.center[0], ownTable.center[2]], SPEC.table.floralRadius,
    ));
    if (!tableByIndex.has(seat.tableIndex)) bodyToTables.push(-Infinity);
  }

  const tableToTable = [];
  for (let i = 0; i < layout.tables.length; i += 1) {
    for (let j = i + 1; j < layout.tables.length; j += 1) {
      const a = layout.tables[i].center;
      const b = layout.tables[j].center;
      tableToTable.push(circleGap(
        [a[0], a[2]], layout.tableGeometry.furnitureEnvelopeRadius,
        [b[0], b[2]], layout.tableGeometry.furnitureEnvelopeRadius,
      ));
    }
  }

  const serviceLane = [];
  for (const lane of layout.serviceLanes) {
    for (const table of layout.tables) {
      serviceLane.push(pointRectDistance([table.center[0], table.center[2]], lane)
        - layout.tableGeometry.furnitureEnvelopeRadius);
    }
    for (const vignette of Object.values(layout.vignettes)) {
      serviceLane.push(pointRectDistance(vignette.center, lane) - vignette.radius);
    }
  }

  const vignetteToFurniture = [];
  const vignetteToVignette = [];
  const vignetteList = Object.values(layout.vignettes);
  for (const vignette of vignetteList) {
    for (const table of layout.tables) {
      vignetteToFurniture.push(circleGap(
        vignette.center, vignette.radius,
        [table.center[0], table.center[2]], layout.tableGeometry.furnitureEnvelopeRadius,
      ));
    }
  }
  for (let i = 0; i < vignetteList.length; i += 1) {
    for (let j = i + 1; j < vignetteList.length; j += 1) {
      vignetteToVignette.push(circleGap(
        vignetteList[i].center, vignetteList[i].radius,
        vignetteList[j].center, vignetteList[j].radius,
      ));
    }
  }

  const corridor = {
    minX: -layout.aisle.halfWidth,
    maxX: layout.aisle.halfWidth,
    minZ: layout.aisle.minZ,
    maxZ: layout.aisle.maxZ,
  };
  const centralAisle = [];
  for (const garden of layout.gardenExclusions) centralAisle.push(segmentRectDistance(
    [garden.minX, garden.minZ], [garden.maxX, garden.maxZ], corridor,
  ));
  for (const table of layout.tables) centralAisle.push(
    pointRectDistance([table.center[0], table.center[2]], corridor)
      - layout.tableGeometry.furnitureEnvelopeRadius,
  );
  for (const vignette of vignetteList) centralAisle.push(
    pointRectDistance(vignette.center, corridor) - vignette.radius,
  );

  const head = layout.headTable;
  const headRect = {
    minX: head.center[0] - head.halfWidth,
    maxX: head.center[0] + head.halfWidth,
    minZ: head.center[1] - head.halfDepth,
    maxZ: head.center[1] + head.halfDepth,
  };
  const coupleToHeadTable = head.couple.map((person) => (
    pointRectDistance(person.center, headRect) - head.personHalfDepth
  ));
  const coupleToBackdrop = head.couple.map((person) => (
    Math.abs(person.center[1] - head.backdropZ) - head.personHalfDepth
  ));
  const headChairToTable = head.chairs.map((chair) => (
    pointRectDistance(chair.center, headRect) - head.chairHalfDepth
  ));
  const headChairToBackdrop = head.chairs.map((chair) => (
    Math.abs(chair.center[1] - head.backdropZ) - head.chairHalfDepth
  ));
  const coupleToHeadChair = head.couple.flatMap((person) => head.chairs.map((chair) => boxGap(
    person.center, head.personHalfWidth, head.personHalfDepth,
    chair.center, head.chairHalfWidth, head.chairHalfDepth,
  )));

  return deepFreeze({
    guestTables: layout.tables.length,
    guestSeats: layout.seats.length,
    guestBodies: layout.guestBodies.length,
    placeSettings: layout.placeSettings.length,
    headSettings: layout.counts.headSettings,
    minimumClearance: {
      bodyToTable: round(minimum(bodyToTables)),
      bodyToGarden: round(minimum(bodyToGarden)),
      chairToTable: round(minimum(chairToTables)),
      chairPullToGarden: round(minimum(chairPullToGarden)),
      chargerToFlowers: round(minimum(chargerToFlowers)),
      tableToTable: round(minimum(tableToTable)),
      serviceLane: round(minimum(serviceLane)),
      vignetteToFurniture: round(minimum(vignetteToFurniture)),
      vignetteToVignette: round(minimum(vignetteToVignette)),
      centralAisle: round(minimum(centralAisle)),
      coupleToHeadTable: round(minimum(coupleToHeadTable)),
      coupleToBackdrop: round(minimum(coupleToBackdrop)),
      headChairToTable: round(minimum(headChairToTable)),
      headChairToBackdrop: round(minimum(headChairToBackdrop)),
      coupleToHeadChair: round(minimum(coupleToHeadChair)),
    },
  });
}

/** すべてのP0動線契約を検証し、問題を文字列配列で返す。 */
export function validatePartyLayout(layout = PARTY_LAYOUT) {
  const issues = [];
  if (!layout || typeof layout !== 'object') return ['layout must be an object'];
  if (!layout.hall || !layout.aisle || !layout.tableGeometry || !layout.headTable
    || !Array.isArray(layout.tables) || !Array.isArray(layout.seats)
    || !Array.isArray(layout.guestBodies) || !Array.isArray(layout.placeSettings)
    || !Array.isArray(layout.gardenExclusions) || !Array.isArray(layout.serviceLanes)
    || !layout.vignettes || !layout.requiredClearances) return ['layout is missing required geometry'];
  if (layout.hall?.width !== 16 || layout.hall?.depth !== 22) issues.push('hall must be 16 x 22 metres');
  if (layout.tables?.length !== 6) issues.push('guest table count must be 6');
  if (layout.seats?.length !== 48) issues.push('guest seat count must be 48');
  if (layout.guestBodies?.length !== 48) issues.push('guest body count must be 48');
  if (layout.placeSettings?.length !== 48) issues.push('place-setting count must be 48');

  const corridor = {
    minX: -layout.aisle.halfWidth,
    maxX: layout.aisle.halfWidth,
    minZ: layout.aisle.minZ,
    maxZ: layout.aisle.maxZ,
  };
  for (const garden of layout.gardenExclusions || []) {
    if (garden.minX < corridor.maxX && garden.maxX > corridor.minX) {
      issues.push(`${garden.id} enters the central aisle`);
    }
  }

  const stats = getPartyLayoutStats(layout);
  const required = layout.requiredClearances;
  if (stats.minimumClearance.bodyToTable + EPSILON < required.bodyToTable) issues.push('a guest body intersects a table');
  if (stats.minimumClearance.bodyToGarden < -EPSILON) issues.push('a guest body intersects aisle flowers');
  if (stats.minimumClearance.chairToTable + EPSILON < required.chairToTable) issues.push('a chair intersects a table');
  if (stats.minimumClearance.chairPullToGarden + EPSILON < required.chairPullToFlowers) issues.push('a chair-pull area intersects aisle flowers');
  if (stats.minimumClearance.chargerToFlowers + EPSILON < required.chargerToFlowers) issues.push('a charger intersects the table florals');
  if (stats.minimumClearance.tableToTable + EPSILON < required.tableToTable) issues.push('guest-table furniture envelopes overlap');
  if (stats.minimumClearance.serviceLane + EPSILON < required.serviceLane) issues.push('a service lane is obstructed');
  if (stats.minimumClearance.vignetteToFurniture + EPSILON < required.vignette) issues.push('a vignette overlaps guest furniture');
  if (stats.minimumClearance.vignetteToVignette < -EPSILON) issues.push('vignettes overlap');
  if (stats.minimumClearance.centralAisle < -EPSILON) issues.push('the central aisle is obstructed');
  if (stats.minimumClearance.coupleToHeadTable + EPSILON < required.coupleToHeadTable) issues.push('the couple intersects the head table');
  if (stats.minimumClearance.coupleToBackdrop + EPSILON < required.coupleToBackdrop) issues.push('the couple intersects the backdrop');
  if (stats.minimumClearance.headChairToTable + EPSILON < required.coupleToHeadTable) issues.push('a head chair intersects the head table');
  if (stats.minimumClearance.headChairToBackdrop + EPSILON < required.coupleToBackdrop) issues.push('a head chair intersects the backdrop');
  if (stats.minimumClearance.coupleToHeadChair + EPSILON < required.coupleToHeadChair) issues.push('the standing couple intersects a head chair');

  for (const vignette of Object.values(layout.vignettes || {})) {
    const { minX, maxX, minZ, maxZ } = layout.hall;
    if (vignette.center[0] - vignette.radius < minX || vignette.center[0] + vignette.radius > maxX
      || vignette.center[1] - vignette.radius < minZ || vignette.center[1] + vignette.radius > maxZ) {
      issues.push(`${vignette.name} is outside the hall`);
    }
  }
  return issues;
}

export const PARTY_LAYOUT_STATS = getPartyLayoutStats(PARTY_LAYOUT);
