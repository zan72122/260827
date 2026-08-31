/**
 * All dimensions are in metres, matching the real object:
 *   height ~0.29 m, opened diameter ~0.23 m.
 *
 * The values marked DESIGN are choices made for this game. They are not
 * measurements taken from the manufacturer's material (the product page could
 * not be reached from this environment - see docs/REFERENCE.md).
 */

/** Number of tissue-paper leaves in the stack. DESIGN. */
export const SHEETS = 48;

/** Number of glue rows along the height (row j = 0 .. ROWS-1). DESIGN. */
export const ROWS = 24;

/** Vertical distance between glue rows (cell pitch). DESIGN. */
export const ROW_PITCH = 0.0125;

/** y of the lowest glue row. */
export const ROW_Y0 = 0.0035;

/** Width of a glue line: the doubled, flat part of each honeycomb cell. DESIGN. */
export const GLUE_BAND = 0.0030;

/** Half thickness of one tissue leaf (leaf is 0.12 mm). DESIGN. */
export const PAPER_HALF = 0.00006;

/** Radius of the spine channel that every leaf folds around. DESIGN. */
export const CORE_RADIUS = 0.0035;

/** Half thickness of a cardboard cover (cover is 1.3 mm). DESIGN. */
export const COVER_HALF = 0.00065;

/**
 * Leaf-to-leaf spacing of the *closed* stack. Gives the shut book a finite
 * thickness so leaves never collapse onto one plane. DESIGN.
 */
export const STACK_GAP = 0.00024;

/** Total height of the paper part. */
export const TREE_HEIGHT = ROW_Y0 + (ROWS - 1) * ROW_PITCH; // 0.291
/** Widest radius, so opened width = 0.23 m. */
export const OPEN_RADIUS = 0.115;

/** Number of glue bonds between leaves. */
export const BONDS = SHEETS - 2;

/**
 * Maximum fan angle. One cell-width short of a full turn, so the two
 * cardboard covers arrive back to back at the seam instead of overlapping.
 */
export const OPEN_MAX = (Math.PI * 2 * BONDS) / (SHEETS - 1);

/** Radial samples across a leaf. Tessellation only - never structure. */
export const RADIAL_SAMPLES = 4;

/** The clasp bites when the covers are this close to meeting. */
export const CLASP_ON = 0.965;
export const CLASP_OFF = 0.930;

/** Height at which the finger grabs the moving cover. */
export const HANDLE_Y = 0.055;

/**
 * Leaf-to-leaf gap for a given fan angle. It fades out as the fan itself
 * starts to provide the separation, so the seam can shut cleanly at full open.
 */
export function stackGapFor(open: number): number {
  return Math.max(0, STACK_GAP - (0.9 * open * CORE_RADIUS) / BONDS);
}
