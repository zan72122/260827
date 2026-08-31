import * as THREE from 'three';
import { MM } from '../core/units';
import {
  spec,
  trunkFaceRadius,
  trunkCornerRadius,
  trunkTopY,
  TRUNK_FACES,
} from '../design/treeSpec';
import { MeshBuilder, orientFaces, panelWithOpenings, v3 } from './meshbuilder';

/* ------------------------------------------------------------------ 葉板 */

/** Outline of one leaf board, in millimetres, in its own XY plane. */
export function leafOutline(span: number): THREE.Vector2[] {
  const { tenonLength: TL, tenonHeight: TH, rootHalfHeight: RH, droop } = spec.leaf;
  const half = (t: number) => RH * (1 - 0.88 * t) + 0.6 * t;
  const drop = (t: number) => droop * span * t;
  // three shallow scallops along the underside, the way a fir branch steps back
  const scallop = (t: number) => {
    let s = 0;
    for (const c of [0.3, 0.55, 0.79]) s += 0.34 * half(t) * Math.exp(-Math.pow((t - c) / 0.085, 2));
    return s;
  };
  const topScallop = (t: number) => {
    let s = 0;
    for (const c of [0.42, 0.67]) s += 0.16 * half(t) * Math.exp(-Math.pow((t - c) / 0.09, 2));
    return s;
  };
  const pts: THREE.Vector2[] = [];
  const push = (x: number, y: number) => pts.push(new THREE.Vector2(x, y));

  push(-TL, -TH / 2);
  push(0, -TH / 2);
  push(0, -RH);
  const steps = 30;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    push(span * t, -drop(t) - half(t) + scallop(t));
  }
  for (let i = steps; i >= 1; i--) {
    const t = i / steps;
    push(span * t, -drop(t) + half(t) - topScallop(t));
  }
  push(0, RH);
  push(0, TH / 2);
  push(-TL, TH / 2);
  return pts;
}

/**
 * One leaf board.  Origin is the middle of the shoulder face: +X points out
 * along the branch, +Y is up, +Z is across the 5 mm thickness.  The fibres run
 * along +X, so the shader shows end grain on the tenon's end and on the tip.
 */
export function buildLeafGeometry(span: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(leafOutline(span));
  const { thickness, chamfer } = spec.leaf;
  // the chamfer is taken off the board, not added to it: bevelOffset pulls the
  // bevel ring inside the outline so the finished board is exactly 5 mm thick
  // and exactly as long as the design says
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness - 2 * chamfer,
    bevelEnabled: true,
    bevelThickness: chamfer,
    bevelSize: chamfer,
    bevelOffset: -chamfer,
    bevelSegments: 1,
    curveSegments: 1,
    steps: 1,
  });
  geo.translate(0, 0, -thickness / 2 + chamfer);
  geo.scale(MM, MM, MM);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/* -------------------------------------------------------------------- 幹 */

const faceFrame = (k: number) => {
  const th = (k * Math.PI * 2) / TRUNK_FACES;
  const n = v3(Math.sin(th), 0, Math.cos(th));
  const t = v3(Math.cos(th), 0, -Math.sin(th));
  return { n, t, th };
};

/**
 * The octagonal post with its sixteen stopped mortises (止め溝) and the stopped
 * slot in the top that receives the star.  Every mortise is a real pocket: a
 * floor, two sides, a top and a closed bottom.  Trunk-local Y = 0 is the
 * shoulder plane, so the axle is below zero.
 */
export function buildTrunkGeometry(): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  const R = trunkFaceRadius;
  const s = 2 * R * Math.tan(Math.PI / TRUNK_FACES);
  const yBase = spec.trunk.collarHeight;
  const yTop = trunkTopY;
  const m = spec.trunk.mortise;

  for (let k = 0; k < TRUNK_FACES; k++) {
    const { n, t } = faceFrame(k);
    const P = (u: number, v: number) =>
      v3(n.x * R + t.x * u, v, n.z * R + t.z * u);
    const openings = spec.tiers
      .map((tier, ti) => ({ tier, ti }))
      .filter(({ tier }) => tier.faceParity === k % 2)
      .map(({ tier }) => ({
        u0: -m.width / 2,
        u1: m.width / 2,
        v0: tier.height - m.height / 2,
        v1: tier.height + m.height / 2,
      }));
    panelWithOpenings(mb, -s / 2, s / 2, yBase, yTop, openings, P, n);

    // the pockets themselves
    const D = m.depth;
    const Pin = (u: number, v: number) =>
      v3(n.x * (R - D) + t.x * u, v, n.z * (R - D) + t.z * u);
    for (const o of openings) {
      // floor (facing out)
      mb.quad(Pin(o.u0, o.v0), Pin(o.u1, o.v0), Pin(o.u1, o.v1), Pin(o.u0, o.v1), n);
      // sides
      mb.quad(Pin(o.u0, o.v0), Pin(o.u0, o.v1), P(o.u0, o.v1), P(o.u0, o.v0), t);
      mb.quad(P(o.u1, o.v0), P(o.u1, o.v1), Pin(o.u1, o.v1), Pin(o.u1, o.v0), t.clone().negate());
      // closed bottom — this is what the leaf's tenon lands on
      mb.quad(Pin(o.u0, o.v0), P(o.u0, o.v0), P(o.u1, o.v0), Pin(o.u1, o.v0), v3(0, 1, 0));
      // top of the pocket
      mb.quad(Pin(o.u0, o.v1), Pin(o.u1, o.v1), P(o.u1, o.v1), P(o.u0, o.v1), v3(0, -1, 0));
    }
  }

  const sl = spec.trunk.starSlot;
  const half = sl.width / 2;
  const L = sl.length / 2;
  const slotFloor = yTop - sl.depth;
  {
    // slot walls and floor (a stopped slot: closed at both ends)
    const up = v3(0, 1, 0);
    mb.quad(v3(-L, slotFloor, -half), v3(L, slotFloor, -half), v3(L, slotFloor, half), v3(-L, slotFloor, half), up);
    mb.quad(v3(-L, slotFloor, -half), v3(-L, slotFloor, half), v3(-L, yTop, half), v3(-L, yTop, -half), v3(1, 0, 0));
    mb.quad(v3(L, yTop, -half), v3(L, yTop, half), v3(L, slotFloor, half), v3(L, slotFloor, -half), v3(-1, 0, 0));
    mb.quad(v3(-L, slotFloor, -half), v3(-L, yTop, -half), v3(L, yTop, -half), v3(L, slotFloor, -half), v3(0, 0, 1));
    mb.quad(v3(L, slotFloor, half), v3(L, yTop, half), v3(-L, yTop, half), v3(-L, slotFloor, half), v3(0, 0, -1));
  }

  const geo = mb.build();

  // top and bottom faces of the octagon, cut with the slot and the collar hole
  const octagon = () => {
    const shape = new THREE.Shape();
    for (let k = 0; k < TRUNK_FACES; k++) {
      const a = ((k + 0.5) * Math.PI * 2) / TRUNK_FACES;
      const x = Math.sin(a) * trunkCornerRadius;
      const z = Math.cos(a) * trunkCornerRadius;
      if (k === 0) shape.moveTo(x, z);
      else shape.lineTo(x, z);
    }
    shape.closePath();
    return shape;
  };

  const topShape = octagon();
  const slotHole = new THREE.Path();
  slotHole.moveTo(-L, -half);
  slotHole.lineTo(-L, half);
  slotHole.lineTo(L, half);
  slotHole.lineTo(L, -half);
  slotHole.closePath();
  topShape.holes.push(slotHole);
  const topCap = new THREE.ShapeGeometry(topShape);
  topCap.rotateX(-Math.PI / 2);
  topCap.translate(0, yTop, 0);
  orientFaces(topCap, v3(0, 1, 0));

  const bottomShape = octagon();
  const collarHole = new THREE.Path();
  collarHole.absarc(0, 0, spec.trunk.collarDia / 2, 0, Math.PI * 2, true);
  bottomShape.holes.push(collarHole);
  const bottomCap = new THREE.ShapeGeometry(bottomShape);
  bottomCap.rotateX(-Math.PI / 2);
  bottomCap.translate(0, yBase, 0);
  orientFaces(bottomCap, v3(0, -1, 0));

  const merged = mergeSimple([geo, topCap, bottomCap]);
  merged.scale(MM, MM, MM);
  return merged;
}

/** Collar + axle, turned round below the octagon. */
export function buildTrunkFootGeometry(): THREE.BufferGeometry {
  const { collarDia, collarHeight, axleDia, axleLength } = spec.trunk;
  const collar = new THREE.CylinderGeometry(collarDia / 2, collarDia / 2, collarHeight, 20, 1, false);
  collar.translate(0, collarHeight / 2, 0);
  collar.scale(MM, MM, MM);
  void axleDia;
  void axleLength;
  return collar;
}

export function buildAxleGeometry(): THREE.BufferGeometry {
  const { axleDia, axleLength } = spec.trunk;
  const g = new THREE.CylinderGeometry(axleDia / 2, axleDia / 2, axleLength, 16, 1, false);
  g.translate(0, -axleLength / 2, 0);
  g.scale(MM, MM, MM);
  return g;
}

/* ------------------------------------------------------------------ 星 */

function starOutline(span: number, height: number): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  const spikes = 5;
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i / (spikes * 2)) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 === 0 ? 1 : 0.44;
    pts.push(new THREE.Vector2(Math.cos(a) * (span / 2) * r, Math.sin(a) * (height / 2) * r));
  }
  return pts;
}

/** Sutherland-Hodgman clip of a polygon against the half plane dot(p,n) >= d. */
function clipHalfPlane(pts: THREE.Vector2[], n: THREE.Vector2, d: number): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  const inside = (p: THREE.Vector2) => p.dot(n) >= d - 1e-9;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const ai = inside(a);
    const bi = inside(b);
    if (ai) out.push(a.clone());
    if (ai !== bi) {
      const da = a.dot(n) - d;
      const db = b.dot(n) - d;
      const t = da / (da - db);
      out.push(new THREE.Vector2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t));
    }
  }
  return out;
}

/**
 * 星 — two boards cross-lapped (相欠き) at ninety degrees.  Board A is slotted
 * from its top edge down to the centre, board B from its bottom edge up to the
 * centre, so B drops onto A and the two close flush.  Only board A carries the
 * tenon that goes down into the trunk's stopped slot.
 */
export function buildStarGeometry(): { boardA: THREE.BufferGeometry; boardB: THREE.BufferGeometry } {
  const { thickness, span, height, tenonLength } = spec.star;
  const outline = starOutline(span, height);
  const w = thickness + 0.2; // lap slot width, one board's thickness plus a whisker
  const up = new THREE.Vector2(0, 1);
  const down = new THREE.Vector2(0, -1);
  const right = new THREE.Vector2(1, 0);
  const left = new THREE.Vector2(-1, 0);

  const opts = (t: number) => ({
    depth: t - 0.6,
    bevelEnabled: true,
    bevelThickness: 0.3,
    bevelSize: 0.3,
    bevelOffset: -0.3,
    bevelSegments: 1,
    curveSegments: 1,
    steps: 1,
  });

  const pieces = (slotFrom: THREE.Vector2) => {
    const solidHalf = clipHalfPlane(outline, slotFrom.clone().negate(), 0);
    const slotHalf = clipHalfPlane(outline, slotFrom, 0);
    const legL = clipHalfPlane(slotHalf, left, w / 2);
    const legR = clipHalfPlane(slotHalf, right, w / 2);
    return [solidHalf, legL, legR].filter((p) => p.length >= 3);
  };

  const tenon = [
    new THREE.Vector2(-spec.trunk.starSlot.length / 2 + 0.6, -height / 2 - tenonLength),
    new THREE.Vector2(spec.trunk.starSlot.length / 2 - 0.6, -height / 2 - tenonLength),
    new THREE.Vector2(spec.trunk.starSlot.length / 2 - 0.6, -height / 2 + 4),
    new THREE.Vector2(-spec.trunk.starSlot.length / 2 + 0.6, -height / 2 + 4),
  ];

  const extrude = (poly: THREE.Vector2[]) =>
    new THREE.ExtrudeGeometry(new THREE.Shape(poly), opts(thickness));

  const a = mergeSimple([...pieces(up).map(extrude), extrude(tenon)]);
  a.translate(0, 0, -thickness / 2 + 0.3);
  a.scale(MM, MM, MM);

  const b = mergeSimple(pieces(down).map(extrude));
  b.translate(0, 0, -thickness / 2 + 0.3);
  b.scale(MM, MM, MM);
  b.rotateY(Math.PI / 2);
  return { boardA: a, boardB: b };
}

/* ------------------------------------------------------------------ 鉢 */

function revolve(
  mb: MeshBuilder,
  profile: Array<[number, number]>,
  segments: number,
  skip?: (thetaMid: number, yMid: number) => boolean,
  flip = false,
) {
  for (let i = 0; i + 1 < profile.length; i++) {
    const [r0, y0] = profile[i];
    const [r1, y1] = profile[i + 1];
    for (let j = 0; j < segments; j++) {
      const a0 = (j / segments) * Math.PI * 2;
      const a1 = ((j + 1) / segments) * Math.PI * 2;
      if (skip && skip((a0 + a1) / 2, (y0 + y1) / 2)) continue;
      const p = (r: number, y: number, a: number) => v3(Math.sin(a) * r, y, Math.cos(a) * r);
      const A = p(r0, y0, a0);
      const B = p(r0, y0, a1);
      const C = p(r1, y1, a1);
      const D = p(r1, y1, a0);
      if (flip) mb.quad(A, D, C, B);
      else mb.quad(A, B, C, D);
    }
  }
}

const POT_OUTER: Array<[number, number]> = [
  [50, 0], [51, 3], [53, 10], [58, 26], [64, 46], [68, 64], [69, 76], [69, 84],
];
const POT_INNER: Array<[number, number]> = [
  [62, 84], [60, 70], [54, 44], [47, 20], [44, 12], [0, 12],
];

/** Angular half-width of the window aperture at the pot wall. */
function windowAngles() {
  const w = spec.pot.window;
  const rAtWindow = 65.5;
  const halfA = Math.asin(Math.min(0.9, w.width / 2 / rAtWindow));
  return { halfA, y0: w.centerY - w.height / 2, y1: w.centerY + w.height / 2 };
}

/** 鉢 — turned, hollow, with a window in the front wall. */
export function buildPotGeometry(): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  const { halfA, y0, y1 } = windowAngles();
  const inWindow = (theta: number, y: number) => {
    const t = ((theta + Math.PI) % (Math.PI * 2)) - Math.PI;
    return Math.abs(t) < halfA && y > y0 && y < y1;
  };
  revolve(mb, POT_OUTER, 40, inWindow);
  revolve(mb, POT_INNER, 40, inWindow, true);
  // rim between outer and inner at the top
  for (let j = 0; j < 40; j++) {
    const a0 = (j / 40) * Math.PI * 2;
    const a1 = ((j + 1) / 40) * Math.PI * 2;
    const p = (r: number, a: number) => v3(Math.sin(a) * r, 84, Math.cos(a) * r);
    mb.quad(p(69, a0), p(69, a1), p(62, a1), p(62, a0), v3(0, 1, 0));
  }
  // base disc
  const base: THREE.Vector3[] = [];
  for (let j = 0; j < 40; j++) {
    const a = (j / 40) * Math.PI * 2;
    base.push(v3(Math.sin(a) * 50, 0, Math.cos(a) * 50));
  }
  mb.fan(base.slice().reverse(), v3(0, -1, 0));

  const g = mb.build();
  g.scale(MM, MM, MM);
  return g;
}

/** Brass frame that finishes the raw edge of the window aperture. */
export function buildWindowFrameGeometry(): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  const { halfA, y0, y1 } = windowAngles();
  const f = spec.pot.window.frame;
  const rOut = 70.5;
  const rIn = 60;
  const segs = 10;
  const strip = (aFrom: number, aTo: number, yA: number, yB: number) => {
    for (let i = 0; i < segs; i++) {
      const a0 = aFrom + ((aTo - aFrom) * i) / segs;
      const a1 = aFrom + ((aTo - aFrom) * (i + 1)) / segs;
      const p = (r: number, y: number, a: number) => v3(Math.sin(a) * r, y, Math.cos(a) * r);
      mb.quad(p(rOut, yA, a0), p(rOut, yA, a1), p(rOut, yB, a1), p(rOut, yB, a0));
      mb.quad(p(rIn, yB, a0), p(rIn, yB, a1), p(rOut, yB, a1), p(rOut, yB, a0));
      mb.quad(p(rOut, yA, a0), p(rOut, yA, a1), p(rIn, yA, a1), p(rIn, yA, a0));
    }
  };
  const dA = f / 64;
  strip(-halfA - dA, halfA + dA, y0 - f, y0);
  strip(-halfA - dA, halfA + dA, y1, y1 + f);
  strip(-halfA - dA, -halfA, y0, y1);
  strip(halfA, halfA + dA, y0, y1);
  const g = mb.build();
  g.scale(MM, MM, MM);
  return g;
}

/* ------------------------------------------------------- 機構 (movement) */

/** A spur gear as a real toothed disc. */
export function buildGearGeometry(pitchRadius: number, teeth: number, thickness: number, bore: number) {
  const pts: THREE.Vector2[] = [];
  const ro = pitchRadius + pitchRadius / teeth;
  const ri = pitchRadius - pitchRadius / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    const step = (Math.PI * 2) / teeth;
    pts.push(new THREE.Vector2(Math.cos(a) * ri, Math.sin(a) * ri));
    pts.push(new THREE.Vector2(Math.cos(a + step * 0.22) * ro, Math.sin(a + step * 0.22) * ro));
    pts.push(new THREE.Vector2(Math.cos(a + step * 0.5) * ro, Math.sin(a + step * 0.5) * ro));
    pts.push(new THREE.Vector2(Math.cos(a + step * 0.72) * ri, Math.sin(a + step * 0.72) * ri));
  }
  const shape = new THREE.Shape(pts);
  if (bore > 0) {
    const hole = new THREE.Path();
    hole.absarc(0, 0, bore, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 8,
    steps: 1,
  });
  g.translate(0, 0, -thickness / 2);
  g.rotateX(-Math.PI / 2);
  g.scale(MM, MM, MM);
  return g;
}

/** The pin drum, with its pins standing proud of the barrel. */
export function buildPinDrumGeometry(pinPhases: number[], radius: number, height: number) {
  const parts: THREE.BufferGeometry[] = [];
  const drum = new THREE.CylinderGeometry(radius, radius, height, 24, 1, false);
  parts.push(drum);
  pinPhases.forEach((phase, i) => {
    const a = phase * Math.PI * 2;
    const y = -height / 2 + 2 + ((i * 0.77) % 1) * (height - 4);
    const pin = new THREE.BoxGeometry(0.9, 0.9, 1.6);
    pin.translate(0, 0, radius + 0.8);
    pin.rotateY(a);
    pin.translate(0, y, 0);
    parts.push(pin);
  });
  const g = mergeSimple(parts);
  g.scale(MM, MM, MM);
  return g;
}

/** The block the comb's teeth are cut from; the teeth themselves are instanced. */
export function buildCombBackGeometry(teeth: number) {
  const g = new THREE.BoxGeometry(4, 3.4, teeth * 1.9 + 3);
  g.scale(MM, MM, MM);
  return g;
}

/* ------------------------------------------------------------------ util */

/** Concatenate geometries that share position/normal/uv attributes. */
export function mergeSimple(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let base = 0;
  for (const g of list) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const u = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      if (n) nor.push(n.getX(i), n.getY(i), n.getZ(i));
      else nor.push(0, 1, 0);
      if (u) uv.push(u.getX(i), u.getY(i));
      else uv.push(0, 0);
    }
    const index = g.getIndex();
    if (index) for (let i = 0; i < index.count; i++) idx.push(index.getX(i) + base);
    else for (let i = 0; i < p.count; i++) idx.push(i + base);
    base += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

