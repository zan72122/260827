/**
 * Swept-section description of the hollow papier-mache torso.
 *
 * Pure maths, no renderer: the mesh builder turns it into triangles and the
 * physics rig queries the same functions to know where the inside of the shell
 * is. One description, so the visible wall and the collision wall are the same
 * wall.
 */
import { BODY_SPINE, BODY_SECTION_EXP } from '../sim/dims';

export interface Station {
  x: number;
  y: number;
  hz: number;
  hy: number;
  wall: number;
}

export interface Section {
  /** section centre on the spine */
  cx: number;
  cy: number;
  /** unit tangent along the spine */
  tx: number;
  ty: number;
  /** unit "up" of the section plane (tangent rotated +90 deg) */
  ux: number;
  uy: number;
  hz: number;
  hy: number;
  wall: number;
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

function pick(i: number): Station {
  const n = BODY_SPINE.length;
  return BODY_SPINE[Math.max(0, Math.min(n - 1, i))]!;
}

/** Interpolated station at u in [0, 1] over the spine. */
export function stationAt(u: number): Station {
  const n = BODY_SPINE.length;
  const f = Math.max(0, Math.min(1, u)) * (n - 1);
  const i = Math.min(n - 2, Math.floor(f));
  const t = f - i;
  const a = pick(i - 1);
  const b = pick(i);
  const c = pick(i + 1);
  const d = pick(i + 2);
  return {
    x: catmull(a.x, b.x, c.x, d.x, t),
    y: catmull(a.y, b.y, c.y, d.y, t),
    hz: Math.max(0, catmull(a.hz, b.hz, c.hz, d.hz, t)),
    hy: Math.max(0, catmull(a.hy, b.hy, c.hy, d.hy, t)),
    wall: catmull(a.wall, b.wall, c.wall, d.wall, t),
  };
}

/** Station plus the frame of its cross-section plane. */
export function sectionAt(u: number): Section {
  const s = stationAt(u);
  const e = 1e-3;
  const a = stationAt(Math.max(0, u - e));
  const b = stationAt(Math.min(1, u + e));
  let tx = b.x - a.x;
  let ty = b.y - a.y;
  const len = Math.hypot(tx, ty) || 1;
  tx /= len;
  ty /= len;
  return { cx: s.x, cy: s.y, tx, ty, ux: -ty, uy: tx, hz: s.hz, hy: s.hy, wall: s.wall };
}

/** Superellipse unit outline; v in [0, 2pi). Returns (across, up) in [-1, 1]. */
export function outline(v: number, exp = BODY_SECTION_EXP): { a: number; b: number } {
  const c = Math.cos(v);
  const s = Math.sin(v);
  const p = 2 / exp;
  return {
    a: Math.sign(c) * Math.pow(Math.abs(c), p),
    b: Math.sign(s) * Math.pow(Math.abs(s), p),
  };
}

/** Surface point of the torso at (u, v). `inset` shrinks by the wall thickness. */
export function surfacePoint(
  u: number,
  v: number,
  inset: boolean,
): { x: number; y: number; z: number } {
  const s = sectionAt(u);
  const hz = inset ? Math.max(0, s.hz - s.wall) : s.hz;
  const hy = inset ? Math.max(0, s.hy - s.wall) : s.hy;
  const o = outline(v);
  return {
    x: s.cx + s.ux * (hy * o.b),
    y: s.cy + s.uy * (hy * o.b),
    z: hz * o.a,
  };
}

/** Smallest u at which the inner surface still has area (the inner tail pole). */
export function innerStartU(): number {
  for (let i = 0; i <= 400; i++) {
    const u = i / 400;
    const s = stationAt(u);
    if (Math.min(s.hz, s.hy) - s.wall > 0.25) return u;
  }
  return 0.2;
}

/**
 * Flat cache of the spine, built once. `cavityRatio` is called thousands of
 * times when the shell-contact limits are recomputed, so the nearest-point
 * search reads this table instead of re-evaluating the spline.
 */
const TABLE_N = 288;
let TABLE_X: Float64Array | null = null;
let TABLE_Y: Float64Array | null = null;

function table(): void {
  if (TABLE_X) return;
  const xs = new Float64Array(TABLE_N + 1);
  const ys = new Float64Array(TABLE_N + 1);
  for (let i = 0; i <= TABLE_N; i++) {
    const s = stationAt(i / TABLE_N);
    xs[i] = s.x;
    ys[i] = s.y;
  }
  TABLE_X = xs;
  TABLE_Y = ys;
}

/** Nearest spine parameter to a point in the x-y plane. */
function nearestU(x: number, y: number): number {
  table();
  const xs = TABLE_X!;
  const ys = TABLE_Y!;
  let bu = 0;
  let bd = Infinity;
  const N = TABLE_N;
  for (let i = 0; i <= N; i++) {
    const dx = xs[i] - x;
    const dy = ys[i] - y;
    const d = dx * dx + dy * dy;
    if (d < bd) {
      bd = d;
      bu = i / N;
    }
  }
  let lo = Math.max(0, bu - 1 / N);
  let hi = Math.min(1, bu + 1 / N);
  for (let k = 0; k < 10; k++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    const s1 = stationAt(m1);
    const s2 = stationAt(m2);
    const d1 = (s1.x - x) ** 2 + (s1.y - y) ** 2;
    const d2 = (s2.x - x) ** 2 + (s2.y - y) ** 2;
    if (d1 < d2) hi = m2;
    else lo = m1;
  }
  return (lo + hi) / 2;
}

/**
 * How deep a point sits inside the cavity, as a superellipse ratio.
 * < 1 is inside the inner wall, 1 is on it, > 1 is in or beyond the paper.
 * Points past the collar opening are reported as outside.
 */
export function cavityRatio(x: number, y: number, z: number): number {
  const u = nearestU(x, y);
  const s = sectionAt(u);
  const hz = Math.max(0.01, s.hz - s.wall);
  const hy = Math.max(0.01, s.hy - s.wall);
  // local coordinates in the section plane
  const dx = x - s.cx;
  const dy = y - s.cy;
  const up = dx * s.ux + dy * s.uy;
  const along = dx * s.tx + dy * s.ty;
  const e = BODY_SECTION_EXP;
  const r = Math.pow(Math.abs(z / hz), e) + Math.pow(Math.abs(up / hy), e);
  const ratio = Math.pow(r, 1 / e);
  // past the opening: no shell to hit
  if (u > 0.999 && along > 0) return 0;
  return ratio;
}

/** True when the point is in the air pocket inside the shell. */
export function insideCavity(x: number, y: number, z: number): boolean {
  return cavityRatio(x, y, z) < 1;
}
