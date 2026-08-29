import { TAU } from '../core/rng';

/** Every dimension is in metres, at real patisserie scale (a 17 cm entremets). */
export const CAKE = {
  radius: 0.085,
  /** Lower sponge. */
  baseY: 0,
  baseTop: 0.025,
  /** The thin cream layer the child places into. */
  creamBase: 0.025,
  creamInitial: 0.0042,
  /** Ceiling the piping bag fills up to, set by the tallest berry. */
  fillCeiling: 0.0638,
  /** Upper sponge. */
  topSpongeThickness: 0.025,
  /** Outer coat. */
  coatThickness: 0.0022,
  /** Ring of placement wells. */
  ringSlots: 12,
  ringRadius: 0.0605,
  /** Knife directions. Twelve, aligned with the wells so a cut can meet one. */
  cutDirections: 12,
  /** Angular width of the slice that gets lifted out: one twelfth of the cake. */
  wedgeSpan: TAU / 12,
} as const;

export const cutAngle = (i: number): number =>
  ((i % CAKE.cutDirections) + CAKE.cutDirections) % CAKE.cutDirections * (TAU / CAKE.cutDirections);

export const slotAngle = (i: number): number => (i / CAKE.ringSlots) * TAU;
