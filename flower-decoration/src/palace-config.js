// 欧州ガーデン宮殿内装の共有レイアウト契約。Three.js / DOM 非依存。
// 既存のゲーム座標と中央通路を守りつつ、各内装モジュールが同じ配置を使う。

import { PARTY_LAYOUT, validatePartyLayout } from './party-layout.js';

export const PALACE_LAYOUT = Object.freeze({
  seed: 'european-garden-palace-v2',
  hall: Object.freeze({ halfWidth: 8, backZ: -12, frontZ: 10, ceilingY: 7 }),
  safety: Object.freeze({ aisleHalfWidth: 1.35, vignetteMargin: 0.35 }),
  tables: PARTY_LAYOUT.tables,
  tableCenters: PARTY_LAYOUT.tableCenters,
  serviceLanes: PARTY_LAYOUT.serviceLanes,
  headTable: PARTY_LAYOUT.headTable,
  chandeliers: Object.freeze([
    Object.freeze([0, 5.45, -6.7]),
    Object.freeze([0, 5.55, -2.2]),
    Object.freeze([0, 5.45, 2.5]),
  ]),
  vignettes: Object.freeze({
    cake: Object.freeze([-6.35, 0, -10.20]),
    bar: Object.freeze([6.15, 0, -10.15]),
    piano: Object.freeze([-6.25, 0, 5.90]),
    lounge: Object.freeze([5.95, 0, 6.15]),
    seatingChart: Object.freeze([7.15, 0, 8.65]),
  }),
  characters: Object.freeze({
    bride: Object.freeze([-0.62, 0.35, -11.43]),
    groom: Object.freeze([0.62, 0.35, -11.43]),
    pianist: Object.freeze([-5.00, 0, 5.95]),
    bartender: Object.freeze([6.15, 0, -9.02]),
  }),
  counts: Object.freeze({
    guestTables: 6,
    guestSettings: 48,
    headSettings: 2,
    chandeliers: 3,
    vignettes: 5,
    celebrationCharacters: 4,
  }),
});

export function validatePalaceLayout(layout = PALACE_LAYOUT) {
  const issues = layout === PALACE_LAYOUT
    ? validatePartyLayout().map((issue) => `party layout: ${issue}`)
    : [];
  const { hall, safety } = layout;
  const inHall = ([x, y, z]) => (
    Math.abs(x) <= hall.halfWidth - safety.vignetteMargin
    && y >= 0 && y <= hall.ceilingY
    && z >= hall.backZ + safety.vignetteMargin
    && z <= hall.frontZ - safety.vignetteMargin
  );

  for (const [name, position] of Object.entries(layout.vignettes)) {
    if (!inHall(position)) issues.push(`${name} is outside the hall`);
    if (Math.abs(position[0]) < safety.aisleHalfWidth) issues.push(`${name} enters the aisle`);
  }
  for (const [name, position] of Object.entries(layout.characters)) {
    if (!inHall(position)) issues.push(`${name} is outside the hall`);
    if (!['bride', 'groom'].includes(name) && Math.abs(position[0]) < safety.aisleHalfWidth) {
      issues.push(`${name} enters the aisle`);
    }
  }
  if (layout.chandeliers.length !== layout.counts.chandeliers) issues.push('chandelier count mismatch');
  if (Object.keys(layout.vignettes).length !== layout.counts.vignettes) issues.push('vignette count mismatch');
  if (Object.keys(layout.characters).length !== layout.counts.celebrationCharacters) issues.push('character count mismatch');
  if (layout.tables?.length !== layout.counts.guestTables) issues.push('guest table count mismatch');
  if (layout.counts.guestSettings !== layout.counts.guestTables * 8) issues.push('guest setting count mismatch');
  return issues;
}
