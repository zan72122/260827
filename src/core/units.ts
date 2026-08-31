/**
 * World units.
 *
 * One world unit == one metre. Every dimension in this project is written as
 * `mm(x)` so the source reads in millimetres (the units a baker actually uses)
 * while the scene stays in metres, which is what three.js' physically based
 * lighting and shadow defaults expect.
 *
 * The concrete figures live in DIM below and are documented in
 * REFERENCE_NOTES.md, which separates the numbers we were given from the ones
 * we assumed.
 */

export const mm = (v: number): number => v * 0.001;
export const cm = (v: number): number => v * 0.01;

export const DIM = {
  /** Round cake: 180 mm diameter, 80 mm tall (design brief). */
  cakeRadius: mm(90),
  cakeHeight: mm(80),
  /** Turntable: 280 mm diameter plate (design brief). */
  turntableRadius: mm(140),
  turntablePlateThickness: mm(6),
  turntableBaseRadius: mm(75),
  turntableBaseHeight: mm(34),

  /** Flower nail: 38 mm disc on a ~70 mm shaft (disc from the brief). */
  nailDiscRadius: mm(19),
  nailDiscThickness: mm(1.0),
  nailShaftRadius: mm(1.6),
  nailShaftLength: mm(72),

  /** Parchment square used under the flower. Assumption: 45 mm square. */
  paperHalf: mm(22.5),
  paperThickness: mm(0.14),

  /** Petal ("104"-style) tip. Assumption, see REFERENCE_NOTES.md. */
  tipLength: mm(34),
  tipBackRadius: mm(11),
  tipWallThickness: mm(0.32),
  tipSlotLength: mm(11.5),
  tipSlotWideOpening: mm(4.4),
  tipSlotNarrowOpening: mm(0.55),

  /** Finished flower: 30-40 mm across (design brief). */
  flowerSmallWidth: mm(24),
  flowerLargeWidth: mm(38),

  /** Dinner plate. Assumption: 200 mm porcelain plate. */
  plateRadius: mm(100),
  plateHeight: mm(18),

  /** Birthday candle. Assumption. */
  candleRadius: mm(3.2),
  candleHeight: mm(62),
} as const;
