import * as THREE from 'three';
import {
  SHEETS,
  ROWS,
  GLUE_BAND,
  CORE_RADIUS,
  RADIAL_SAMPLES,
  BONDS,
} from '../config';
import { radiusAbove, radiusBelow, rowY } from './profile';

/**
 * Builds one merged, static BufferGeometry holding every tissue leaf of the
 * honeycomb stack. Nothing here depends on how far the tree is opened: the fan
 * angle is a single shader uniform, so opening and closing never touches the
 * CPU, never reallocates and never accumulates.
 *
 * Structure encoded per vertex:
 *   aGeom = (radius, y, bondIndex, bondSlope)
 *   aMode = (stackIndex, side, rimKind, leafIndex)
 *
 * The shader turns bondIndex k into an angle  theta = open * k / BONDS, so a
 * leaf that alternates between bond k-1 and bond k zig-zags between two
 * angular positions. Two neighbouring zig-zags enclose a hexagonal cell: this
 * is the honeycomb, and it is the same geometry at every degree of opening.
 */

/** rimKind values, shared with the shader. */
export const RIM_FACE = 0;
export const RIM_OUTER = 1;
export const RIM_INNER = 2;
export const RIM_TOP = 3;
export const RIM_BOTTOM = 4;

type Level = {
  y: number;
  /** clamped bond index this leaf is pinned to at this height */
  k: number;
  rOuter: number;
};

type Segment = {
  lo: Level;
  hi: Level;
  /** d(bondIndex)/dy across the segment; 0 inside a glue band */
  slope: number;
};

const HALF_BAND = GLUE_BAND * 0.5;

/**
 * A cell wall is one sheet pinned to different neighbours at its two ends, so
 * real paper leaves the glue line flat and bows across the middle. Splitting
 * each wall and easing the angle reproduces that: cells come out as rounded
 * hexagons, not folded triangles.
 */
const WALL_STEPS = 3;
const ease = (t: number) => t * t * (3 - 2 * t);

/** Which bond a leaf is glued to at row j. */
function bondIndex(leaf: number, j: number): number {
  const k = (leaf + j) % 2 === 0 ? leaf : leaf - 1;
  return Math.max(0, Math.min(BONDS - 1, k));
}

function leafSegments(leaf: number): Segment[] {
  const levels: Level[] = [];
  for (let j = 0; j < ROWS; j++) {
    const k = bondIndex(leaf, j);
    const y = rowY(j);
    levels.push({ y: y - HALF_BAND, k, rOuter: radiusBelow(j) });
    levels.push({ y: y + HALF_BAND, k, rOuter: radiusAbove(j) });
  }
  const segs: Segment[] = [];
  for (let j = 0; j < ROWS; j++) {
    // glue band: flat, both ends pinned to the same bond
    segs.push({ lo: levels[2 * j], hi: levels[2 * j + 1], slope: 0 });
    if (j < ROWS - 1) {
      const lo = levels[2 * j + 1];
      const hi = levels[2 * j + 2];
      const span = hi.y - lo.y;
      let prev = lo;
      for (let w = 1; w <= WALL_STEPS; w++) {
        const t = w / WALL_STEPS;
        const y = lo.y + span * t;
        const next: Level =
          w === WALL_STEPS
            ? hi
            : {
                y,
                k: lo.k + (hi.k - lo.k) * ease(t),
                rOuter: lo.rOuter + (hi.rOuter - lo.rOuter) * t,
              };
        const dy = next.y - prev.y;
        segs.push({ lo: prev, hi: next, slope: dy > 1e-9 ? (next.k - prev.k) / dy : 0 });
        prev = next;
      }
    }
  }
  return segs;
}

export type HoneycombBuild = {
  geometry: THREE.BufferGeometry;
  leafCount: number;
  triangles: number;
};

export function buildHoneycombGeometry(): HoneycombBuild {
  const K = RADIAL_SAMPLES;
  const geomAttr: number[] = [];
  const modeAttr: number[] = [];
  const uvAttr: number[] = [];
  const indices: number[] = [];

  const push = (
    r: number,
    y: number,
    k: number,
    slope: number,
    stack: number,
    side: number,
    rim: number,
    leaf: number,
    u: number,
    v: number
  ): number => {
    const id = geomAttr.length / 4;
    geomAttr.push(r, y, k, slope);
    modeAttr.push(stack, side, rim, leaf);
    uvAttr.push(u, v);
    return id;
  };

  const quad = (a: number, b: number, c: number, d: number) => {
    indices.push(a, b, c, a, c, d);
  };

  for (let leaf = 0; leaf < SHEETS; leaf++) {
    const stack = leaf - (SHEETS - 1) / 2;
    const segs = leafSegments(leaf);

    for (let s = 0; s < segs.length; s++) {
      const seg = segs[s];
      const rowsLv = [seg.lo, seg.hi];

      // --- the two paper faces -------------------------------------------
      for (const side of [1, -1]) {
        const ids: number[][] = [];
        for (let li = 0; li < 2; li++) {
          const lv = rowsLv[li];
          const row: number[] = [];
          for (let m = 0; m < K; m++) {
            const t = m / (K - 1);
            const r = CORE_RADIUS + t * (lv.rOuter - CORE_RADIUS);
            row.push(
              push(r, lv.y, lv.k, seg.slope, stack, side, RIM_FACE, leaf, t, lv.y * 12)
            );
          }
          ids.push(row);
        }
        for (let m = 0; m < K - 1; m++) {
          if (side > 0) quad(ids[0][m], ids[0][m + 1], ids[1][m + 1], ids[1][m]);
          else quad(ids[0][m], ids[1][m], ids[1][m + 1], ids[0][m + 1]);
        }
      }

      // --- thin cut edges -------------------------------------------------
      const rimQuad = (r0: number, r1: number, kind: number, flip: boolean) => {
        const a = push(r0, seg.lo.y, seg.lo.k, seg.slope, stack, -1, kind, leaf, 0, 0);
        const b = push(r1, seg.hi.y, seg.hi.k, seg.slope, stack, -1, kind, leaf, 0, 1);
        const c = push(r1, seg.hi.y, seg.hi.k, seg.slope, stack, 1, kind, leaf, 1, 1);
        const d = push(r0, seg.lo.y, seg.lo.k, seg.slope, stack, 1, kind, leaf, 1, 0);
        if (!flip) quad(a, b, c, d);
        else quad(a, d, c, b);
      };
      rimQuad(seg.lo.rOuter, seg.hi.rOuter, RIM_OUTER, false);
      rimQuad(CORE_RADIUS, CORE_RADIUS, RIM_INNER, true);

      // --- caps at the very top / bottom of the leaf ----------------------
      const capAt = (lv: Level, kind: number) => {
        const rowA: number[] = [];
        const rowB: number[] = [];
        for (let m = 0; m < K; m++) {
          const t = m / (K - 1);
          const r = CORE_RADIUS + t * (lv.rOuter - CORE_RADIUS);
          rowA.push(push(r, lv.y, lv.k, seg.slope, stack, -1, kind, leaf, t, 0));
          rowB.push(push(r, lv.y, lv.k, seg.slope, stack, 1, kind, leaf, t, 1));
        }
        for (let m = 0; m < K - 1; m++) {
          if (kind === RIM_TOP) quad(rowA[m], rowB[m], rowB[m + 1], rowA[m + 1]);
          else quad(rowA[m], rowA[m + 1], rowB[m + 1], rowB[m]);
        }
      };
      if (s === 0) capAt(seg.lo, RIM_BOTTOM);
      if (s === segs.length - 1) capAt(seg.hi, RIM_TOP);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('aGeom', new THREE.Float32BufferAttribute(geomAttr, 4));
  geometry.setAttribute('aMode', new THREE.Float32BufferAttribute(modeAttr, 4));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvAttr, 2));
  // `position` and `normal` are never read - both are produced in the vertex
  // shader - but three.js requires the attributes to exist.
  const zeros = new Float32Array((geomAttr.length / 4) * 3);
  geometry.setAttribute('position', new THREE.BufferAttribute(zeros, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(zeros, 3));
  geometry.setIndex(indices);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.145, 0), 0.34);
  geometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(-0.13, -0.01, -0.13),
    new THREE.Vector3(0.13, 0.3, 0.13)
  );

  return {
    geometry,
    leafCount: SHEETS,
    triangles: indices.length / 3,
  };
}
