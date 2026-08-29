import * as THREE from 'three';
import type { Shot } from '../core/cameraRig';
import { SHELF_POS, SHELF_Y, pathX } from '../world/shed';
import { BENCH_Y } from '../ice/dims';

export const MOLD_POS = new THREE.Vector3(0, BENCH_Y, -0.02);

/** The finale camera is pinned: eye just above the snow, looking down the path. */
export const FINALE_EYE = new THREE.Vector3(pathX(-3.4), 0.42, -3.4);
export const FINALE_TARGET = new THREE.Vector3(pathX(-8), 0.3, -8);
export const FINALE_DIST = FINALE_EYE.distanceTo(FINALE_TARGET);

/** x of the camera axis at depth z - keeps foreground props inside a phone frame */
export function finaleAxisX(z: number) {
  const t = (z - FINALE_EYE.z) / (FINALE_TARGET.z - FINALE_EYE.z);
  return THREE.MathUtils.lerp(FINALE_EYE.x, FINALE_TARGET.x, t);
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * One authored shot per beat. The player never drives the camera; the rig only
 * re-frames for the current orientation.
 */
export const SHOTS: Record<string, Shot> = {
  // wide establishing: foreground pitcher, mid moulds, far snow path
  intro: {
    target: v(-0.02, 0.88, 0.0),
    dir: v(0.46, 0.34, 0.82),
    halfW: 0.62,
    halfH: 0.42,
    fov: 46,
    fovPortrait: 54,
    maxDist: 3.4,
    bias: 0.04,
    portrait: { target: v(-0.02, 0.84, 0.02), dir: v(0.3, 0.5, 0.82), halfW: 0.44, halfH: 0.44, maxDist: 2.7 },
  },
  // three quarter from above: outer, inner and the gap all visible at once
  assemble: {
    target: v(-0.07, BENCH_Y + 0.13, 0.02),
    dir: v(0.44, 0.62, 0.72),
    halfW: 0.34,
    halfH: 0.27,
    fov: 42,
    fovPortrait: 50,
    minDist: 0.62,
    portrait: { target: v(-0.05, BENCH_Y + 0.06, 0.06), dir: v(0.26, 1.02, 0.66), halfW: 0.28, halfH: 0.3 },
  },
  decorate: {
    target: v(0.12, BENCH_Y + 0.09, 0.03),
    dir: v(0.3, 0.78, 0.62),
    halfW: 0.4,
    halfH: 0.38,
    fov: 42,
    fovPortrait: 50,
    minDist: 0.6,
    portrait: { target: v(0.02, BENCH_Y + 0.05, 0.06), dir: v(0.2, 1.15, 0.6), halfW: 0.25, halfH: 0.3 },
  },
  // nearly overhead: the water level and the decorations read together
  fill: {
    target: v(-0.08, BENCH_Y + 0.13, 0.03),
    dir: v(0.24, 0.82, 0.56),
    halfW: 0.38,
    halfH: 0.36,
    fov: 44,
    fovPortrait: 52,
    minDist: 0.58,
    bias: 0.05,
    portrait: { target: v(-0.02, BENCH_Y + 0.08, 0.04), dir: v(0.18, 0.95, 0.6), halfW: 0.26, halfH: 0.37, bias: 0.06 },
  },
  shelve: {
    target: v(0.6, BENCH_Y + 0.12, -0.05),
    dir: v(0.16, 0.42, 0.9),
    halfW: 0.78,
    halfH: 0.4,
    fov: 44,
    fovPortrait: 54,
    portrait: { target: v(0.56, BENCH_Y + 0.1, -0.04), dir: v(0.13, 0.5, 0.86), halfW: 0.74, halfH: 0.46 },
  },
  // fixed side view for the whole freeze so the change is comparable
  freeze: {
    target: v(SHELF_POS.x, SHELF_Y + 0.15, SHELF_POS.z),
    dir: v(0.44, 0.72, 0.8),
    halfW: 0.26,
    halfH: 0.23,
    fov: 42,
    fovPortrait: 50,
    minDist: 0.62,
    portrait: { halfW: 0.21, halfH: 0.3 },
  },
  // middle distance close up: the cavity appearing is the moment
  pullInner: {
    target: v(0, BENCH_Y + 0.2, -0.02),
    dir: v(0.36, 0.5, 0.85),
    halfW: 0.26,
    halfH: 0.28,
    fov: 42,
    fovPortrait: 50,
    minDist: 0.6,
    portrait: { halfW: 0.2, halfH: 0.36 },
  },
  // low three quarter: the boundary between mould and ice stays visible
  pullOuter: {
    target: v(0, BENCH_Y + 0.15, -0.02),
    dir: v(0.5, 0.26, 0.86),
    halfW: 0.27,
    halfH: 0.3,
    fov: 42,
    fovPortrait: 50,
    minDist: 0.6,
    portrait: { halfW: 0.21, halfH: 0.38 },
  },
  led: {
    target: v(0.1, BENCH_Y + 0.09, 0.02),
    dir: v(0.34, 0.62, 0.78),
    halfW: 0.32,
    halfH: 0.34,
    fov: 42,
    fovPortrait: 50,
    minDist: 0.55,
    portrait: { target: v(0.04, BENCH_Y + 0.06, 0.06), dir: v(0.26, 0.92, 0.68), halfW: 0.24, halfH: 0.3 },
  },
  // inside of the ice and the light on the snow in one frame
  lit: {
    target: v(0.0, BENCH_Y + 0.11, -0.02),
    dir: v(0.46, 0.3, 0.84),
    halfW: 0.3,
    halfH: 0.27,
    fov: 42,
    fovPortrait: 50,
    minDist: 0.62,
    portrait: { target: v(0.0, BENCH_Y + 0.1, 0.02), dir: v(0.4, 0.3, 0.86), halfW: 0.24, halfH: 0.34 },
  },
  carry: {
    target: v(0.1, 0.95, -1.9),
    dir: v(0.22, 0.34, 1),
    halfW: 1.5,
    halfH: 1.0,
    fov: 46,
    fovPortrait: 58,
  },
  // down at snow level, the row of lights running away into the dark
  finale: {
    target: FINALE_TARGET.clone(),
    dir: FINALE_EYE.clone().sub(FINALE_TARGET),
    halfW: 0.62,
    halfH: 0.44,
    fov: 52,
    fovPortrait: 62,
    minDist: FINALE_DIST,
    maxDist: FINALE_DIST,
  },
};
