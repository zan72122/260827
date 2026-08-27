/**
 * specimen.ts — the single source of truth for the physical world of this game.
 *
 * Every number here is a real millimetre on a real slide. The 3D microscope scene,
 * the tissue image pyramid, the landmark tracker and the optics all read from this
 * one coordinate system, which is what keeps the hair follicle nailed to the same
 * screen position from the slide overview down to the cellular level.
 *
 * Two frames are used:
 *   SLIDE frame   — millimetres, origin at the centre of the 75x25 mm glass slide,
 *                   +x toward the coverslip end, +y "up" across the short axis.
 *   TISSUE frame  — millimetres, origin at the hair follicle ostium on the skin
 *                   surface, +x along the skin surface, +y = depth into the dermis.
 *
 * TISSUE -> SLIDE is a rigid transform (small rotation + offset), so a point has one
 * unambiguous identity in both. The tissue shader works purely in the TISSUE frame.
 */

export const DEG = Math.PI / 180;

/* ------------------------------------------------------------------ *
 * Glass hardware — standard clinical histology consumables.
 * ------------------------------------------------------------------ */
export const SLIDE = {
  /** 75 x 25 mm ("3 x 1 inch") is the universal histology slide footprint. */
  lengthMM: 75.0,
  widthMM: 25.0,
  /** Clinical slides are 1.0-1.2 mm thick; 1.0 mm is typical. */
  thicknessMM: 1.0,
  /** Frosted writing end occupies the left ~20 mm of the slide. */
  frostedLengthMM: 20.0,
} as const;

export const COVERSLIP = {
  sizeMM: 22.0,
  /** No. 1.5 coverslip = 0.17 mm, the thickness objectives are corrected for. */
  thicknessMM: 0.17,
  /** Centre in SLIDE frame. */
  centreMM: { x: 6.5, y: 0.0 },
} as const;

/** Routine paraffin sections are cut at 4 um for skin. */
export const SECTION_THICKNESS_MM = 0.004;

/* ------------------------------------------------------------------ *
 * Where the section sits on the glass.
 * ------------------------------------------------------------------ */
/** Half-extents of the section ribbon in the TISSUE frame. */
export const TISSUE_EXTENT = {
  xMin: -4.6,
  xMax: 4.6,
  /** A little empty glass above the skin surface, subcutis at the bottom. */
  yMin: -0.55,
  yMax: 6.1,
} as const;

/** Sections are never mounted perfectly square. A few degrees of tilt reads as real. */
export const TISSUE_ROT_RAD = -5.4 * DEG;
/** SLIDE-frame position of TISSUE-frame point (0, TISSUE_PIVOT_Y). */
export const TISSUE_POS_MM = { x: 6.1, y: 1.55 };
export const TISSUE_PIVOT_Y = 2.5;

export function tissueToSlide(tx: number, ty: number): { x: number; y: number } {
  const c = Math.cos(TISSUE_ROT_RAD);
  const s = Math.sin(TISSUE_ROT_RAD);
  const dx = tx;
  const dy = ty - TISSUE_PIVOT_Y;
  return {
    // TISSUE +y is depth (downward on screen); SLIDE +y is up, hence the sign flip.
    x: TISSUE_POS_MM.x + (dx * c + dy * s),
    y: TISSUE_POS_MM.y - (-dx * s + dy * c),
  };
}

/* ------------------------------------------------------------------ *
 * The hero anchor: one terminal hair follicle.
 * ------------------------------------------------------------------ */
export const FOLLICLE = {
  /** Ostium (opening at the skin surface) is the TISSUE frame origin. */
  tiltRad: 0.30,
  /** Gentle curvature of the follicular axis, mm per mm^2. */
  curve: -0.035,
  /** Bulb sits ~3.4 mm deep — a terminal (scalp-type) follicle. */
  lengthMM: 3.4,
  /** Terminal hair shaft: >60 um diameter by definition; 72 um here. */
  shaftRadiusMM: 0.036,
  /** Sebaceous duct enters at the infundibulum/isthmus junction. */
  sebaceousDuctS: 0.55,
  /** Arrector pili inserts at the bulge, below the isthmus. */
  bulgeS: 1.18,
} as const;

/**
 * Arc-length parameter of the hero anchor, on the follicular axis just below the
 * bulge. Two things decided this depth. At 4x it centres the field so the entire
 * follicle — ostium, sebaceous glands, arrector pili, shaft and bulb — fits in one
 * circle with only a little bare glass above the skin. At 40x the same point shows
 * the pigmented shaft dead centre inside a fully formed inner root sheath, ringed by
 * outer-root-sheath cells whose nuclei are the pay-off of the whole dive.
 */
export const HERO_S = 1.30;

export function follicleAxisPoint(s: number): { x: number; y: number } {
  const d = { x: Math.sin(FOLLICLE.tiltRad), y: Math.cos(FOLLICLE.tiltRad) };
  const n = { x: Math.cos(FOLLICLE.tiltRad), y: -Math.sin(FOLLICLE.tiltRad) };
  const k = FOLLICLE.curve * s * s;
  return { x: d.x * s + n.x * k, y: d.y * s + n.y * k };
}

export function follicleAxisTangent(s: number): { x: number; y: number } {
  const d = { x: Math.sin(FOLLICLE.tiltRad), y: Math.cos(FOLLICLE.tiltRad) };
  const n = { x: Math.cos(FOLLICLE.tiltRad), y: -Math.sin(FOLLICLE.tiltRad) };
  const k = 2.0 * FOLLICLE.curve * s;
  const vx = d.x + n.x * k;
  const vy = d.y + n.y * k;
  const len = Math.hypot(vx, vy) || 1;
  return { x: vx / len, y: vy / len };
}

/** The point every magnification stage keeps at the same place on screen. */
export const HERO_TISSUE = follicleAxisPoint(HERO_S);
export const HERO_SLIDE = tissueToSlide(HERO_TISSUE.x, HERO_TISSUE.y);
/** Direction of the follicular axis at the anchor; the section's own "up". */
export const HERO_AXIS = follicleAxisTangent(HERO_S);

/**
 * Secondary landmarks, verified to stay inside the field at the magnifications noted.
 * Having two of them means the player never loses the thread if one drifts off-frame.
 */
export const LANDMARKS = {
  /** Sebaceous lobule — legible from 4x through 20x. */
  sebaceousLobule: { x: -0.205, y: 0.505, visibleFieldMM: [6.0, 0.9] },
  /** Perifollicular venule — legible from 10x down to 40x, clear of the sheath. */
  venule: {
    x: HERO_TISSUE.x + 0.150,
    y: HERO_TISSUE.y + 0.090,
    visibleFieldMM: [2.4, 0.4],
  },
} as const;
