/**
 * The hollow papier-mache torso, its four legs, and the same torso cut in half
 * for the explanatory view.
 *
 * The cut is generated from this doll's own inner and outer surfaces -- the
 * half shell plus a band joining wall to wall -- so the cross-section shows the
 * real paper thickness of the body the child is holding, not a diagram drawn
 * over the top of it.
 */
import { BufferGeometry } from 'three';
import { MeshBuilder, addGrid, addBand, addTube } from './mesh';
import { sectionAt, outline, stationAt } from './profile';
import { LEGS, LEG_TOP_Y, BODY_SPINE, BODY_SECTION_EXP, COLLAR } from '../sim/dims';
import { Rng } from '../core/rng';

/** Low, seeded, hand-formed unevenness, in millimetres. */
function makeWobble(seed: number): (u: number, ang: number) => number {
  const r = new Rng(seed);
  const terms = Array.from({ length: 5 }, () => ({
    au: r.range(1.5, 6.5),
    av: Math.round(r.range(1, 4)),
    ph: r.range(0, Math.PI * 2),
    am: r.range(0.06, 0.2),
  }));
  return (u, ang) => {
    let d = 0;
    for (const t of terms) d += t.am * Math.sin(u * t.au + ang * t.av + t.ph);
    return d;
  };
}

const wobble = makeWobble(0x5eed01);

/** A point on the torso wall. `inset` gives the inner surface. */
function shellPoint(u: number, ang: number, inset: boolean): { x: number; y: number; z: number } {
  const s = sectionAt(u);
  const o = outline(ang);
  // The same offset is added to both surfaces, so the wall keeps its thickness.
  const d = wobble(u, ang) * Math.min(1, u * 6);
  const hz = Math.max(0, inset ? s.hz - s.wall : s.hz) + (s.hz > 0.2 ? d : 0);
  const hy = Math.max(0, inset ? s.hy - s.wall : s.hy) + (s.hy > 0.2 ? d : 0);
  return {
    x: s.cx + s.ux * (hy * o.b),
    y: s.cy + s.uy * (hy * o.b),
    z: hz * o.a,
  };
}

const NU = 60;
const NV_FULL = 44;

export interface BodyShell {
  outer: BufferGeometry;
  inner: BufferGeometry;
  /** rim of the neck opening, plus the cut faces when the body is halved */
  edge: BufferGeometry;
  triangles: number;
}

/** Build the intact torso: outer paper, inner paper, and the rim of the opening. */
export function buildBody(): BodyShell {
  const nv = NV_FULL;
  const ang = (v: number): number => v * Math.PI * 2;

  const outerB = new MeshBuilder();
  addGrid(outerB, NU, nv, true, (u, v) => shellPoint(u, ang(v), false), true);

  const innerB = new MeshBuilder();
  addGrid(innerB, NU, nv, true, (u, v) => shellPoint(u, ang(v), true));

  // The rim of the neck opening: a real band between the two surfaces, so the
  // wall thickness reads where the head goes in.
  const edgeB = new MeshBuilder();
  const rimOuter: number[] = [];
  const rimInner: number[] = [];
  for (let j = 0; j <= nv; j++) {
    const a = ang(j / nv);
    rimOuter.push(edgeB.vertex(shellPoint(1, a, false), j / nv, 1));
    rimInner.push(edgeB.vertex(shellPoint(1, a, true), j / nv, 0));
  }
  addBand(edgeB, rimOuter, rimInner);

  return {
    outer: outerB.build(),
    inner: innerB.build(),
    edge: edgeB.build(),
    triangles: outerB.triangleCount + innerB.triangleCount + edgeB.triangleCount,
  };
}

/**
 * The face left where a plane at z = `zc` cuts this same torso.
 *
 * It is solved against the very surfaces above -- for each station, the two
 * angles at which the outer wall crosses the plane and the two at which the
 * inner wall does -- so the cut shows the doll's own wall with its own
 * thickness. Nothing is drawn on top of the doll and no second interior exists.
 */
export function buildCutFace(zc: number): BufferGeometry {
  const mb = new MeshBuilder();
  const p = 2 / BODY_SECTION_EXP;

  /**
   * The angle at which the surface crosses the plane z = zc, upper branch.
   *
   * The hand-formed unevenness makes the half-width depend on the very angle
   * being solved for, so this bisects the real function rather than inverting
   * an idealised one -- the cut face then lands exactly on the plane instead of
   * a few hundredths of a millimetre off it, which would show as a seam.
   */
  const angleAt = (u: number, inset: boolean, branch: number): number | null => {
    const s = sectionAt(u);
    const halfAt = (ang: number): number => {
      // the unevenness is not symmetric about the plane, so each side of the
      // cut is solved against its own wall
      const d = wobble(u, branch * ang) * Math.min(1, u * 6);
      return Math.max(0, inset ? s.hz - s.wall : s.hz) + (s.hz > 0.2 ? d : 0);
    };
    const f = (ang: number): number => {
      const c = Math.cos(ang);
      return halfAt(ang) * Math.sign(c) * Math.pow(Math.abs(c), p) - zc;
    };
    if (f(0) < 0 || f(Math.PI) > 0) return null;
    let lo = 0;
    let hi = Math.PI;
    for (let k = 0; k < 40; k++) {
      const m = (lo + hi) / 2;
      if (f(m) >= 0) lo = m;
      else hi = m;
    }
    return (lo + hi) / 2;
  };

  for (const branch of [1, -1]) {
    const outerRow: number[] = [];
    const innerRow: number[] = [];
    let run = 0;
    const flush = (): void => {
      if (run >= 2) addBand(mb, outerRow.slice(-run), innerRow.slice(-run), branch > 0);
      run = 0;
    };
    for (let i = 0; i <= NU; i++) {
      const u = i / NU;
      const ao = angleAt(u, false, branch);
      const ai = angleAt(u, true, branch);
      if (ao === null) {
        flush();
        continue;
      }
      const inner = ai === null ? shellPoint(u, branch > 0 ? Math.PI / 2 : -Math.PI / 2, true) : shellPoint(u, branch * ai, true);
      // where there is no cavity yet the cut runs to the spine, as it does in
      // the real solid tail of the form
      const s = sectionAt(u);
      const fill = ai === null ? { x: s.cx, y: s.cy, z: zc } : inner;
      outerRow.push(mb.vertex(shellPoint(u, branch * ao, false), u, 1));
      innerRow.push(mb.vertex(fill, u, 0));
      run++;
    }
    flush();
  }
  return mb.build();
}

/** The four legs, formed with the body and standing flat on the bench. */
export function buildLegs(): BufferGeometry {
  const mb = new MeshBuilder();
  for (const leg of LEGS) {
    const splay = Math.sign(leg.z) * 1.6;
    addTube(
      mb,
      [
        { x: leg.x, y: LEG_TOP_Y + 1.5, z: leg.z, r: leg.rTop * 0.84 },
        { x: leg.x, y: LEG_TOP_Y - 4, z: leg.z, r: leg.rTop },
        { x: leg.x + splay * 0.4, y: 11, z: leg.z + splay, r: (leg.rTop + leg.rBot) / 2 },
        { x: leg.x + splay * 0.7, y: 3.0, z: leg.z + splay * 1.6, r: leg.rBot },
        { x: leg.x + splay * 0.75, y: 0.6, z: leg.z + splay * 1.7, r: leg.rBot * 0.86 },
      ],
      12,
    );
  }
  return mb.build();
}

/**
 * The two pins the support thread is tied to.
 *
 * They are driven into the wall of the collar and lean outwards, so the tie
 * points end up wide of the neck stem and the thread runs down to the notch
 * without cutting back through it.
 */
export function buildPegs(pegs: { x: number; y: number; hz: number; pegR: number }): BufferGeometry {
  const mb = new MeshBuilder();
  const root = COLLAR.hz - COLLAR.wall * 0.5;
  for (const side of [-1, 1]) {
    addTube(
      mb,
      [
        { x: pegs.x - 3.0, y: COLLAR.y - 3.0, z: side * root * 0.72, r: pegs.pegR * 0.9 },
        { x: pegs.x - 1.4, y: COLLAR.y + 0.5, z: side * root, r: pegs.pegR },
        { x: pegs.x - 0.4, y: pegs.y - 2.2, z: side * (pegs.hz - 0.8), r: pegs.pegR * 0.92 },
        { x: pegs.x, y: pegs.y, z: side * pegs.hz, r: pegs.pegR * 1.3 },
      ],
      8,
    );
  }
  return mb.build();
}

/** Extent of the finished doll, for framing the camera and for the tests. */
export function bodyExtent(): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i <= 60; i++) {
    const s = stationAt(i / 60);
    minX = Math.min(minX, s.x - s.hy);
    maxX = Math.max(maxX, s.x + s.hy);
    minY = Math.min(minY, s.y - s.hy);
    maxY = Math.max(maxY, s.y + s.hy);
  }
  void BODY_SPINE;
  return { minX, maxX, minY: 0, maxY };
}
