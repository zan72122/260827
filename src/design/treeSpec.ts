/**
 * 作中の設計値 (in-fiction design values) for the wooden interlocking tree.
 *
 * These are OUR OWN design numbers, chosen so the tree is actually buildable and
 * so every joint has a single straight insertion axis.  Overall scale (about
 * 450 mm tall, about 240 mm across, 5 mm leaf boards, 16 leaf boards) is taken
 * as a *reference scale* from a commercially sold wooden music-box tree; nothing
 * here is a measurement of that product and no part of its shape is copied.
 *
 * All numbers are millimetres unless the name says otherwise.
 */

export const TRUNK_FACES = 8; // regular octagon, planed from a square blank

export const spec = {
  /** 鉢 — turned pot. Screwed to the bench: it never moves. */
  pot: {
    height: 84,
    rimDia: 138,
    baseDia: 100,
    wallTop: 7,
    /** brass bearing cup pressed into the pot's top face */
    bushingBore: 8.4,
    bushingOuter: 15,
    bushingDepth: 18,
    /** brass thrust washer that actually carries the tree's weight */
    washerOuter: 22,
    washerThickness: 1.5,
    /** window in the pot wall through which the movement is visible */
    window: { width: 54, height: 42, centerY: 51, frame: 2.5 },
    /** brass bed plate screwed to the pot rim; it carries the bushing */
    bedPlate: { radius: 64, thickness: 2.5 },
  },

  /** 幹 — octagonal post. */
  trunk: {
    acrossFlats: 30,
    /** length of the octagonal post itself (the collar sits below it) */
    length: 310,
    /** turned axle below the shoulder, dropped into the bushing */
    axleDia: 8.0,
    axleLength: 16,
    /** the axle bottoms out 0.5 mm clear of the bore floor: the shoulder carries the load */
    axleEndClearance: 0.5,
    /** collar turned just above the shoulder */
    collarDia: 26,
    collarHeight: 6,
    /** stopped mortise cut into one octagon face for one leaf board */
    mortise: {
      width: 5.2, // tangential — leaf board is 5.0 thick
      depth: 7.2, // radial
      height: 41, // vertical; the bottom of the groove is closed (止め溝)
    },
    /** cross slot in the top face that receives the star */
    starSlot: { width: 3.7, depth: 8, length: 22 },
  },

  /** 葉板 — leaf boards.  Rigid 5 mm planks, never bent. */
  leaf: {
    thickness: 5.0,
    tenonLength: 7.0,
    tenonHeight: 40,
    /** half height of the board where it meets the trunk face */
    rootHalfHeight: 20,
    /** how far the branch droops over its span, as a fraction of the span */
    droop: 0.19,
    chamfer: 0.5,
  },

  /** 星 — two 3.5 mm boards cross-lapped (相欠き) at 90 degrees. */
  star: {
    thickness: 3.5,
    span: 50,
    height: 46,
    tenonLength: 8,
  },

  /**
   * Tiers.  Heights are measured from the shoulder plane (the top of the thrust
   * washer).  `faceParity` selects which four of the eight octagon faces carry a
   * mortise, so consecutive tiers are 45 degrees apart.
   */
  tiers: [
    { height: 60, span: 105, faceParity: 0 },
    { height: 132, span: 87, faceParity: 1 },
    { height: 200, span: 69, faceParity: 0 },
    { height: 262, span: 49, faceParity: 1 },
  ],
} as const;

export type TierSpec = (typeof spec.tiers)[number];

/** Radius of the octagon's flat faces (distance from axis to a face). */
export const trunkFaceRadius = spec.trunk.acrossFlats / 2;
/** Radius of the octagon's corners. */
export const trunkCornerRadius = trunkFaceRadius / Math.cos(Math.PI / TRUNK_FACES);

/** Height of the shoulder plane (top of the thrust washer) above the pot's base. */
export const shoulderPlaneY =
  spec.pot.height + spec.pot.bedPlate.thickness + spec.pot.washerThickness;

/** Top of the octagonal post, above the shoulder plane. */
export const trunkTopY = spec.trunk.collarHeight + spec.trunk.length;

/** Total design height of the finished tree, pot base to star tip, in mm. */
export const totalHeightMM = shoulderPlaneY + trunkTopY + spec.star.height;

/** Largest diameter of the finished tree, in mm. */
export const maxDiameterMM = 2 * (trunkFaceRadius + spec.tiers[0].span);

export interface LeafSlot {
  /** stable id, e.g. "t0f2" */
  id: string;
  tier: number;
  /** index of the octagon face, 0..7 */
  face: number;
  /** yaw of the face normal, radians, in tree-local space */
  yaw: number;
  /** height of the tier reference line above the shoulder plane, mm */
  height: number;
  /** radial distance from axis to the tip of the seated board, mm */
  span: number;
}

/** All sixteen leaf sockets, in assembly order (bottom tier first). */
export function leafSlots(): LeafSlot[] {
  const out: LeafSlot[] = [];
  spec.tiers.forEach((tier, ti) => {
    for (let k = 0; k < 4; k++) {
      const face = tier.faceParity + k * 2;
      out.push({
        id: `t${ti}f${face}`,
        tier: ti,
        face,
        yaw: (face * Math.PI * 2) / TRUNK_FACES,
        height: tier.height,
        span: tier.span,
      });
    }
  });
  return out;
}

/**
 * Geometry of one leaf joint, in tree-local millimetres.
 *
 * `seated` is the board origin (the middle of the shoulder face, on the tier
 * reference line) once the joint is closed.  `axis` is the unit vector the board
 * travels along while it is inserted — always horizontal and radial.  The board
 * enters from `entry` and stops at `seated`, where its shoulder meets the trunk
 * face and the bottom of its tenon lands on the closed bottom of the groove.
 */
export interface JointAxis {
  seated: [number, number, number];
  entry: [number, number, number];
  /** unit vector pointing from entry towards seated */
  axis: [number, number, number];
  /** length of the insertion travel, mm */
  travel: number;
}

export const LEAF_ENTRY_TRAVEL = 62; // mm of free slide before the shoulder closes

export function leafJoint(slot: LeafSlot): JointAxis {
  const n: [number, number, number] = [Math.sin(slot.yaw), 0, Math.cos(slot.yaw)];
  const seated: [number, number, number] = [
    n[0] * trunkFaceRadius,
    slot.height,
    n[2] * trunkFaceRadius,
  ];
  const travel = LEAF_ENTRY_TRAVEL;
  const entry: [number, number, number] = [
    seated[0] + n[0] * travel,
    seated[1],
    seated[2] + n[2] * travel,
  ];
  // travel runs inward, i.e. along -n
  return { seated, entry, axis: [-n[0], 0, -n[2]], travel };
}

export const STAR_ENTRY_TRAVEL = 45;

/** The star drops straight down into the cross slot in the top of the trunk. */
export function starJoint(): JointAxis {
  const y = trunkTopY;
  return {
    seated: [0, y, 0],
    entry: [0, y + STAR_ENTRY_TRAVEL, 0],
    axis: [0, -1, 0],
    travel: STAR_ENTRY_TRAVEL,
  };
}

/**
 * Vertical extent of a seated leaf board at radial distance `u` from the trunk
 * face.  Used by the fit tests: tiers must not run into each other and the
 * bottom tier must clear the pot rim.
 */
export function leafEdgesAt(slot: LeafSlot, u: number): { top: number; bottom: number } | null {
  if (u < 0 || u > slot.span) return null;
  const t = u / slot.span;
  const drop = spec.leaf.droop * slot.span * t;
  const half = spec.leaf.rootHalfHeight * (1 - 0.88 * t) + 0.6 * t;
  return { top: slot.height - drop + half, bottom: slot.height - drop - half };
}
