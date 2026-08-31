import { TAU } from '../util/math';

/** The three edible colours offered. Icons, not words, select these. */
export type CreamColorId = 'rose' | 'butter' | 'lilac';

export interface CreamColor {
  id: CreamColorId;
  /** Linear-ish sRGB hex for the buttercream body. */
  hex: number;
  /** Slightly deeper hex used in the crease shading of the petal. */
  deepHex: number;
  /** Swatch colour for the picture button. */
  swatch: string;
}

export const CREAM_COLORS: Record<CreamColorId, CreamColor> = {
  rose: { id: 'rose', hex: 0xf2b7c0, deepHex: 0xd9909d, swatch: '#f0adb8' },
  butter: { id: 'butter', hex: 0xf6e0a6, deepHex: 0xe2c477, swatch: '#f3dc9c' },
  lilac: { id: 'lilac', hex: 0xd6c4e8, deepHex: 0xb9a2d3, swatch: '#d2bee6' },
};

export const CREAM_COLOR_ORDER: CreamColorId[] = ['rose', 'butter', 'lilac'];

/** One deposited ribbon of cream. Stored in the nail's local frame. */
export interface PetalRecord {
  /** Which ring of the flower this belongs to: 0 inner, 1 outer. */
  row: number;
  /** Nail rotation, in radians, at the moment the petal was started. */
  startAngle: number;
  /** How far the nail turned while this petal was being piped. */
  sweep: number;
  /** Height of the arc the tip travelled, metres. */
  arch: number;
  /** Height on the cone at which this petal starts, metres. */
  baseY: number;
  /** Distance of the tip from the nail axis, metres. */
  radius: number;
  /** How far above horizontal the bag was held, radians. */
  lean: number;
  /**
   * How the free edge of the ribbon settles, along the face normal of the
   * ribbon: positive furls it in over the centre, which is what makes the inner
   * whorl read as a bud; negative lets it fall away, which opens the outer one.
   */
  furl: number;
  /** Length of the tip's slot in contact, i.e. how wide the ribbon is. */
  band: number;
  /** Root thickness of the ribbon, metres. */
  thickness: number;
  /** Colour the bag held when this petal was piped. */
  color: CreamColorId;
}

export type FlowerSize = 'small' | 'large';

/**
 * Everything needed to rebuild a flower exactly as the child piped it. The
 * flower is never replaced by a stock model: transferring it to the cake only
 * changes which coordinate frame these petals are drawn in.
 */
export interface FlowerRecord {
  id: string;
  createdAt: number;
  color: CreamColorId;
  size: FlowerSize;
  petals: PetalRecord[];
  /** Where on the cake top it was placed, in cake-local metres. */
  placement: { x: number; z: number; yaw: number } | null;
}

let flowerCounter = 0;

export function newFlowerRecord(color: CreamColorId): FlowerRecord {
  flowerCounter += 1;
  return {
    id: `f${Date.now().toString(36)}-${flowerCounter}`,
    createdAt: Date.now(),
    color,
    size: 'small',
    petals: [],
    placement: null,
  };
}

/** Radius of the flower as piped, used to keep the knife clear of it. */
export function flowerRadius(rec: FlowerRecord): number {
  let r = 0.007;
  for (const p of rec.petals) {
    r = Math.max(r, p.radius + Math.max(0, -p.furl) * p.band * 0.42 + p.thickness + 0.0015);
  }
  return r;
}

/** Angle around the cake centre of the placed flower. */
export function flowerBearing(rec: FlowerRecord): number {
  if (!rec.placement) return 0;
  const a = Math.atan2(rec.placement.z, rec.placement.x);
  return (a + TAU) % TAU;
}
