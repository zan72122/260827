/**
 * Spanbaum — design values.
 *
 * 1 world unit = 10 cm. All dimensions below are DESIGN VALUES chosen so the
 * craft reads clearly on a phone; they are not measurements of any real
 * workshop piece. What is taken from the craft itself (Seiffen
 * "Spanbaumstechen"): a conically turned blank of pale, straight-grained
 * linden, held so it can be rotated, from which a chisel lifts a thin shaving
 * that is NOT severed — it stays rooted in the blank and rolls into a spiral.
 * The spindle is indexed a little between shavings.
 */

export const BLANK = {
  /** radius at y = 0 (blank-local) */
  baseRadius: 0.240,
  /** radius shrinks by this much per unit of height */
  taper: 0.1287,
  /** blank is cut off here (the turned point) */
  height: 1.42,
  /** small spigot held by the lower centre */
  footRadius: 0.055,
  footDepth: 0.10,
  /** blank-local y = 0 sits this high above the bench */
  standHeight: 0.16,
} as const;

export function blankRadius(y: number): number {
  return BLANK.baseRadius - BLANK.taper * y;
}

/**
 * Rows, top-down. The child's row is index 0: the topmost, so nothing hangs
 * over the work. The craftsman's rows below hold more branches simply because
 * the blank is fatter there and the chisel is one width -- which is why six,
 * and exactly six, fit at the working row.
 */
export const ROW_Y = [0.96, 0.66, 0.36, 0.06] as const;
export const ROW_COUNT = [6, 8, 10, 12] as const;
export const WORK_ROW_INDEX = 0;

/** Shavings per row. "One row" in this piece = six branches at one height. */
export const BRANCHES_PER_ROW = 6;

/** Reference chip geometry, defined at the working row; other rows scale by radius. */
export const CHIP = {
  /** stroke length (= finished shaving length). One chisel, so one length. */
  length: 0.32,
  /** blade width */
  width: 0.085,
  /** depth of cut == shaving thickness (0.7 mm design value) */
  depth: 0.0065,
  /** curl radius at the free tip */
  tipRadius: 0.022,
  /** how fast the curl radius opens up along the shaving (dimensionless) */
  curlOpen: 0.22,
  /** rake: the shaving leaves the edge tilted this far off the surface (rad) */
  rake: 0.30,
  /** lengthwise segments of the ribbon */
  seg: 64,
  /** points around the thin rectangular cross-section */
  ring: 14,
} as const;

/** Lower-quality ribbon for the craftsman's rows, which never change. */
export const CHIP_LOD = { seg: 40, ring: 10 } as const;

/** Grain repeats every this many world units along the trunk axis. */
export const GRAIN_PERIOD = 0.30;

/** Rows already finished by the craftsman, plus the working row, top-down. */
export const ROW_GAP = 0.055;

/** Feed is 1:1 with the finger in screen space; these frame the camera so a
 *  full stroke is a comfortable swipe. Values are visible world height. */
export const FRAMING = {
  portraitHeight: 2.10,
  /** landscape: closer and more oblique, so the curl and the contact read big */
  landscapeHeight: 1.10,
  /** world point the fixed working camera orbits */
  targetY: 0.94,
  landscapeTargetY: 1.02,
  portraitTilt: 0.20,
  landscapeTilt: 0.15,
  landscapeAzimuth: 0.40,
  /** how far the framing leans from the blank's axis towards the cut */
  portraitLookBias: 0.34,
  landscapeLookBias: 0.46,
  fov: 34,
} as const;

/** Blade / curl start should sit this far from the finger at the start (CSS px). */
export const HANDLE_OFFSET_PX = 55;
export const HANDLE_OFFSET_PX_RANGE: [number, number] = [40, 60];

export const TIMING = {
  /** tool lifts clear, blank indexes 60 deg, tool returns */
  indexDuration: 0.85,
  /** held after the sixth shaving before any camera move (never cut the curl) */
  holdAfterLast: 1.5,
  revealDuration: 3.4,
  resetOut: 0.45,
  resetIn: 0.60,
} as const;
