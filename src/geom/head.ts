/**
 * The separate head: a hollow paper shell with horns and ears, the stem that
 * passes through the body's opening, the notch the support thread sits in, the
 * arm that reaches down inside the belly, and the counterweight on it.
 *
 * Everything is built in the head's own frame, origin at the support notch, so
 * the renderer can place the whole assembly with one rotation about that point
 * -- the same point the physics rotates about.
 */
import { BufferGeometry } from 'three';
import { MeshBuilder, addGrid, addTube, addEllipsoid } from './mesh';
import { HEAD, WEIGHT_RAIL } from '../sim/dims';
import { Rng } from '../core/rng';

interface HeadStation {
  x: number;
  cy: number;
  hy: number;
  hz: number;
  wall: number;
}

/** Stations of the head shell, nape -> muzzle, in head-local millimetres. */
const HEAD_STATIONS: HeadStation[] = [
  { x: -2.0, cy: 15.5, hy: 0.0, hz: 0.0, wall: 1.0 },
  { x: 0.0, cy: 15.4, hy: 8.2, hz: 8.6, wall: 1.0 },
  { x: 3.0, cy: 15.0, hy: 12.2, hz: 12.4, wall: 1.05 },
  { x: 7.5, cy: 14.4, hy: 14.2, hz: 13.8, wall: 1.1 },
  { x: 13.0, cy: 13.6, hy: 14.9, hz: 14.0, wall: 1.05 },
  { x: 19.0, cy: 13.0, hy: 14.8, hz: 13.6, wall: 1.0 },
  { x: 25.0, cy: 12.2, hy: 13.6, hz: 12.2, wall: 1.0 },
  { x: 30.5, cy: 11.2, hy: 11.4, hz: 10.0, wall: 1.05 },
  { x: 35.5, cy: 10.0, hy: 9.0, hz: 8.0, wall: 1.1 },
  { x: 39.5, cy: 9.0, hy: 6.8, hz: 6.4, wall: 1.15 },
  { x: 42.5, cy: 8.2, hy: 4.4, hz: 4.6, wall: 1.2 },
  { x: 44.5, cy: 8.0, hy: 0.0, hz: 0.0, wall: 1.2 },
];


function lerpStation(u: number): HeadStation {
  const f = Math.max(0, Math.min(1, u)) * (HEAD_STATIONS.length - 1);
  const i = Math.min(HEAD_STATIONS.length - 2, Math.floor(f));
  const t = f - i;
  const a = HEAD_STATIONS[i]!;
  const b = HEAD_STATIONS[i + 1]!;
  const s = t * t * (3 - 2 * t);
  return {
    x: a.x + (b.x - a.x) * s,
    cy: a.cy + (b.cy - a.cy) * s,
    hy: a.hy + (b.hy - a.hy) * s,
    hz: a.hz + (b.hz - a.hz) * s,
    wall: a.wall + (b.wall - a.wall) * s,
  };
}

const rng = new Rng(0x1c0a2);
const bump = Array.from({ length: 4 }, () => ({
  au: rng.range(2, 7),
  av: Math.round(rng.range(1, 3)),
  ph: rng.range(0, 6.28),
  am: rng.range(0.05, 0.16),
}));

function headPoint(u: number, ang: number, inset: boolean): { x: number; y: number; z: number } {
  const s = lerpStation(u);
  let d = 0;
  for (const t of bump) d += t.am * Math.sin(u * t.au + ang * t.av + t.ph);
  // A boxier section than an ellipse: the paper form has flatter cheeks.
  const p = 2 / 2.8;
  const c = Math.cos(ang);
  const si = Math.sin(ang);
  const a = Math.sign(c) * Math.pow(Math.abs(c), p);
  const b = Math.sign(si) * Math.pow(Math.abs(si), p);
  const hy = Math.max(0, inset ? s.hy - s.wall : s.hy) + (s.hy > 0.3 ? d : 0);
  const hz = Math.max(0, inset ? s.hz - s.wall : s.hz) + (s.hz > 0.3 ? d : 0);
  // the muzzle droops slightly and the jaw is fuller than the crown
  const drop = b < 0 ? 1.12 : 1.0;
  return { x: s.x, y: s.cy + hy * b * drop, z: hz * a };
}

export interface HeadMeshes {
  /** red painted paper: shell, ears, horns */
  shell: BufferGeometry;
  /** white ground visible inside the shell and at the neck flange */
  lining: BufferGeometry;
  /** wooden stem, notch and inner arm */
  stem: BufferGeometry;
  /** the lead counterweight */
  weight: BufferGeometry;
  triangles: number;
}

/**
 * Build every part of the head assembly.
 *
 * The counterweight is built about its own origin and positioned by the
 * renderer, so sliding it is a transform of the same mesh -- there is no second
 * weight and no rebuilt geometry to fall out of step with the physics.
 */
export function buildHead(): HeadMeshes {
  const NU = 44;
  const NV = 34;

  const shellB = new MeshBuilder();
  addGrid(shellB, NU, NV, true, (u, v) => headPoint(u, v * Math.PI * 2, false), true);

  // ears: flattened paper cones, and short horns, both formed with the head
  for (const sgn of [-1, 1]) {
    addTube(
      shellB,
      [
        { x: 12.0, y: 19.5, z: sgn * 9.0, r: 4.4 },
        { x: 9.5, y: 21.8, z: sgn * 13.5, r: 3.8 },
        { x: 6.8, y: 22.8, z: sgn * 17.6, r: 2.4 },
        { x: 5.2, y: 23.0, z: sgn * 19.8, r: 0.9 },
      ],
      9,
    );
    addTube(
      shellB,
      [
        { x: 13.5, y: 24.5, z: sgn * 4.6, r: 2.9 },
        { x: 14.2, y: 27.8, z: sgn * 5.8, r: 2.2 },
        { x: 14.0, y: 30.4, z: sgn * 7.4, r: 1.1 },
      ],
      8,
    );
  }

  const liningB = new MeshBuilder();
  addGrid(liningB, 30, 24, true, (u, v) => headPoint(u, v * Math.PI * 2, true));

  // Stem through the opening, the notch the thread sits in, and the inner arm.
  const stemB = new MeshBuilder();
  // The stem flares where it meets the head and pinches at the notch: the
  // thread has to be able to sit in something.
  addTube(
    stemB,
    [
      { x: 6.4, y: 13.0, r: 8.4 },
      { x: 4.4, y: 9.0, r: 7.4 },
      { x: 2.6, y: 5.4, r: HEAD.stemR },
      { x: 1.4, y: 2.9, r: HEAD.stemR * 0.99 },
      // The notch: a groove deep and tall enough that the thread leaves it
      // sideways without cutting back through the stem.
      { x: 0.9, y: 2.5, r: HEAD.stemR * 0.58 },
      { x: 0, y: 0, r: HEAD.stemR * 0.56 },
      { x: -0.9, y: -2.5, r: HEAD.stemR * 0.58 },
      { x: -1.4, y: -2.9, r: HEAD.stemR * 0.99 },
      { x: -1.9, y: -3.6, r: HEAD.stemR },
      { x: -4.0, y: -5.2, r: 4.4 },
      { x: -7.0, y: -9.0, r: 3.5 },
      { x: -10.0, y: -13.5, r: 3.1 },
      { x: -13.0, y: -18.0, r: 2.8 },
      { x: HEAD.armTip.x, y: HEAD.armTip.y, r: 2.3 },
    ],
    12,
  );

  const weightB = new MeshBuilder();
  addEllipsoid(
    weightB,
    { x: 0, y: 0, z: 0 },
    { x: WEIGHT_RAIL.r * 0.92, y: WEIGHT_RAIL.r, z: WEIGHT_RAIL.r * 0.92 },
    14,
    18,
  );

  return {
    shell: shellB.build(),
    lining: liningB.build(),
    stem: stemB.build(),
    weight: weightB.build(),
    triangles:
      shellB.triangleCount + liningB.triangleCount + stemB.triangleCount + weightB.triangleCount,
  };
}

/** Where the counterweight sits, head-local mm -- shared with the physics. */
export function weightCentre(weightT: number): { x: number; y: number } {
  return {
    x: WEIGHT_RAIL.x0 + (WEIGHT_RAIL.x1 - WEIGHT_RAIL.x0) * weightT,
    y: WEIGHT_RAIL.y0 + (WEIGHT_RAIL.y1 - WEIGHT_RAIL.y0) * weightT,
  };
}
