import * as THREE from 'three';

/* One place for the room's real dimensions.  Everything else derives from
 * here so the three mechanisms keep a believable size relationship:
 * smoker 26 cm, pyramid 52 cm, chimes 31 cm - all tabletop objects. */

export const BENCH_TOP = 0.90;
export const BENCH_W = 2.42;
export const BENCH_D = 0.80;
export const BENCH_TOP_THICK = 0.062;

export const ROOM = {
  floorY: 0,
  ceilY: 2.62,
  backZ: -0.86,
  frontZ: 2.9,
  leftX: -2.35,
  rightX: 2.35,
};

export const WINDOW = {
  cx: 0.16, cy: 1.62, w: 1.46, h: 0.92, depth: 0.14,
};

export const SMOKER_POS = new THREE.Vector3(-0.545, BENCH_TOP, 0.175);
export const PYRAMID_POS = new THREE.Vector3(0.045, BENCH_TOP, -0.075);
export const CHIMES_POS = new THREE.Vector3(0.625, BENCH_TOP, 0.055);

/** Where loose parts wait before they are fitted: always in front of the
 *  machine being built, offset to the side in landscape and straight in
 *  front (so, lower on screen) in portrait, where the hand comes from below
 *  and must not cover the socket. */
export const TRAY_Z = 0.280;
export const TRAY_DX_LANDSCAPE = -0.10;
export const TRAY_DX_PORTRAIT = 0.0;
export const TRAY_MAX_X = 0.90;

export const LIGHTER_HOME = new THREE.Vector3(0.99, BENCH_TOP + 0.012, 0.285);
