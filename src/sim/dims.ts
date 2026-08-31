/**
 * Every dimension of the doll, in millimetres, y = 0 at the workbench top.
 *
 * This file is the single source of truth: the mesh builders and the physics
 * rig both read from here, so "what you see" and "what moves" cannot drift.
 *
 * Starting point for the silhouette (see STATUS.md): overall length ~160 mm,
 * overall height ~100 mm, shell wall 0.8-1.5 mm. These are the values this
 * piece was authored to -- not measurements of any real workshop's product.
 *
 * Axes: +x forward (towards the muzzle), +y up, +z to the doll's left.
 */

export const MM = 0.001; // millimetre -> metre (scene units are metres)

/* ---------------------------------------------------------------- body --- */

/** Spine stations of the hollow torso, tail -> collar opening. */
export const BODY_SPINE: ReadonlyArray<{
  /** centre of the cross-section */
  x: number;
  y: number;
  /** outer half-size across (z) and up (y) of the section */
  hz: number;
  hy: number;
  /** paper shell thickness at this station */
  wall: number;
}> = [
  { x: -73.0, y: 43.6, hz: 0.0, hy: 0.0, wall: 1.4 },
  { x: -70.5, y: 43.9, hz: 4.6, hy: 5.4, wall: 1.4 },
  { x: -66, y: 44.6, hz: 9.8, hy: 11.2, wall: 1.4 },
  { x: -60, y: 45, hz: 14.4, hy: 16.4, wall: 1.35 },
  { x: -54, y: 45, hz: 17.0, hy: 19.5, wall: 1.3 },
  { x: -40, y: 44, hz: 20.4, hy: 22.4, wall: 1.2 },
  { x: -22, y: 43.5, hz: 21.6, hy: 23.0, wall: 1.1 },
  { x: -4, y: 43.5, hz: 21.4, hy: 22.8, wall: 1.0 },
  { x: 12, y: 44, hz: 20.0, hy: 22.0, wall: 1.0 },
  { x: 24, y: 45.5, hz: 17.8, hy: 20.4, wall: 1.1 },
  { x: 33, y: 48.5, hz: 15.2, hy: 17.6, wall: 1.2 },
  { x: 39, y: 53.0, hz: 13.2, hy: 15.0, wall: 1.3 },
  { x: 42.5, y: 57.0, hz: 12.2, hy: 13.2, wall: 1.4 },
  { x: 44.0, y: 60.0, hz: 12.0, hy: 12.6, wall: 1.5 },
];

/** Superellipse exponent of the body cross-section (2 = ellipse, >2 = boxier). */
export const BODY_SECTION_EXP = 2.5;

/** Centre of the neck opening (last spine station), and its outward normal. */
export const COLLAR = {
  x: 44.0,
  y: 60.0,
  /** opening plane tilt from vertical, radians (leans forward) */
  tilt: 0.62,
  /** outer half-width / half-height of the rim */
  hz: 12.0,
  hy: 12.6,
  wall: 1.5,
};

/** The four legs: solid tapered posts formed with the body. */
export const LEGS: ReadonlyArray<{ x: number; z: number; rTop: number; rBot: number }> = [
  { x: -40, z: 13.5, rTop: 7.2, rBot: 5.4 },
  { x: -40, z: -13.5, rTop: 7.2, rBot: 5.4 },
  { x: 14, z: 13.0, rTop: 7.0, rBot: 5.2 },
  { x: 14, z: -13.0, rTop: 7.0, rBot: 5.2 },
];
export const LEG_TOP_Y = 34;

/* ---------------------------------------------------------------- head --- */

/**
 * Head-local frame. Origin = the support notch that hangs on the thread; this
 * is the pivot the head nods about. +x forward, +y up.
 */
export const HEAD = {
  /** centre of the hollow paper head */
  cx: 22,
  cy: 12,
  /** outer half-sizes of the head shell */
  hx: 21,
  hy: 16,
  hz: 14.0,
  /** muzzle tip, head-local */
  muzzle: { x: 41, y: 8 },
  /** underside of the jaw: the point that lands on the chin rest */
  chin: { x: 20, y: 5 },
  /** neck flange: the lip that clears the body rim when the head lifts */
  flangeY: 2,
  flangeR: 9.6,
  /** the stem passing through the collar opening */
  stemR: 6.2,
  /** far end of the inner arm, head-local (down inside the belly) */
  armTip: { x: -16, y: -22 },
};

/** Rail the counterweight slides along, inside the belly (head-local mm). */
export const WEIGHT_RAIL = {
  x0: -7,
  y0: -9,
  x1: -13,
  y1: -18,
  /** radius of the weight bead */
  r: 6.0,
};

/** Masses in grams and their head-local centres. */
export const HEAD_PARTS: ReadonlyArray<{
  name: string;
  m: number;
  x: number;
  y: number;
  /** radius of gyration about its own centre, mm */
  k: number;
}> = [
  { name: 'shell', m: 14, x: HEAD.cx, y: HEAD.cy, k: 11.0 },
  { name: 'stem', m: 4, x: 6, y: 8, k: 5.0 },
  { name: 'arm', m: 5, x: -9, y: -11, k: 8.0 },
];
export const WEIGHT_MASS = 30;

/* -------------------------------------------------------- thread & jigs --- */

/** The two pegs on the collar rim the support thread is tied between. */
export const THREAD_PEGS = {
  y: 70,
  x: 44.0,
  hz: 10.0,
  pegR: 1.6,
};
/** Free thread length between the two pegs. Shorter = head rides higher. */
export const THREAD_LEN = { min: 21.5, max: 40.0, start: 40.0 };
/** Radius of the drawn thread. */
export const THREAD_R = 0.42;

/** Top surface of the wooden chin rest the head sits on before it is hung. */
export const CHIN_REST = { y: 59.4, x: 66, hz: 11, cradle: 0.08 };

/**
 * The temporary hanging jig the head sits on while the counterweight is set.
 * It stands in front of and to the left of the body, clear of the doll.
 */
export const JIG = {
  hookX: -58,
  hookY: 96,
  hookZ: 64,
  postR: 5.0,
};

/**
 * The grip clamped to the counterweight while it is being set: a stout wooden
 * knob standing off to the side so a small hand can find it. It travels with
 * the weight one-to-one; the reduction from a big drag to a small slide lives
 * in the pointer mapping, not in a pretended mechanism (see STATUS.md).
 */
export const GRIP = { z: 27, r: 8.4, stemR: 2.6 };

/** The wooden toggle on the free end of the thread. */
export const TOGGLE = { r: 6.6, restX: 84, restY: 7, restZ: 30, travel: 62 };

/* ------------------------------------------------------------- dynamics --- */

export const GRAVITY = 9.81; // m/s^2
/** Damping ratio of the nod. Low enough to nod several times, high enough to stop. */
export const NOD_ZETA = 0.075;
/** Sideways sway is stiffer and dies sooner than the nod. */
export const SWAY_FREQ_RATIO = 1.7;
export const SWAY_ZETA = 0.16;
/** Restitution when the inner arm meets the inside of the shell. */
export const SHELL_RESTITUTION = 0.18;
/** Rest posture counts as "balanced" inside this band. */
export const BALANCE_BAND = 6.0 * (Math.PI / 180);
