import * as THREE from 'three';
import { BLANK, GRAIN_PERIOD, blankRadius } from '../config';

/**
 * A shaving ("Span") raised from the blank and left attached.
 *
 * Model
 * -----
 * The chisel travels UP the blank along its length. Material separates at the
 * cutting edge, so the shaving is rooted AT THE EDGE and its already-formed
 * part trails behind, rolling into a spiral. Therefore:
 *
 *   root  = current blade contact point  (grows upward as the stroke advances)
 *   tip   = the first material formed, at the bottom of the stroke, tightly curled
 *
 * The intrinsic shape is a function of the MATERIAL coordinate s (distance
 * from the free tip), never of time or frame:
 *
 *   curvature  kappa(s) = 1 / (tipRadius + curlOpen * s)
 *
 * so the tip is tightly rolled and the curl opens out towards the root. Every
 * material point keeps its curvature, its width and its UV forever; as the
 * stroke advances the shaving is pushed out and swings, exactly as a real one
 * does, but no already-formed part changes shape and the grain cannot swim.
 *
 * UVs are the material's own coordinates on the blank (axial position, and
 * arc position around it), divided by GRAIN_PERIOD. The grain of a shaving is
 * therefore literally continuous with the grain of the trunk it came from, at
 * one single scale for every branch.
 */

export interface ChipParams {
  /** axial height where the stroke starts (the tip end) */
  yStart: number;
  /** sector centre angle on the blank, in the blank's own frame */
  phi: number;
  /** full stroke length for this row */
  length: number;
  width: number;
  depth: number;
  tipRadius: number;
  curlOpen: number;
  rake: number;
  /** deterministic per-branch variation, fixed for the life of the branch */
  skew: number;
  cup: number;
}

const _n = new THREE.Vector3();
const _t = new THREE.Vector3();
const _w = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _bi = new THREE.Vector3();
const _fn = new THREE.Vector3();
const _p = new THREE.Vector3();
const _tmp = new THREE.Vector3();

/* scratch for the centreline: this runs every frame while cutting, so it must
 * not allocate. Grown once, never per call. */
let px = new Float64Array(0), py = new Float64Array(0), pz = new Float64Array(0);
let dx = new Float64Array(0), dy = new Float64Array(0), dz = new Float64Array(0);
function grow(n: number) {
  px = new Float64Array(n); py = new Float64Array(n); pz = new Float64Array(n);
  dx = new Float64Array(n); dy = new Float64Array(n); dz = new Float64Array(n);
}

/** outward surface normal of the (conical) blank */
export function blankNormal(phi: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(Math.cos(phi), BLANK.taper, Math.sin(phi)).normalize();
}
/** up-along-the-surface tangent: the cutting direction */
export function blankTangent(phi: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(-BLANK.taper * Math.cos(phi), 1, -BLANK.taper * Math.sin(phi)).normalize();
}
/** across the cut: around the blank */
export function blankBinormal(phi: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(-Math.sin(phi), 0, Math.cos(phi));
}
export function blankSurfacePoint(y: number, phi: number, out = new THREE.Vector3()): THREE.Vector3 {
  const r = blankRadius(y);
  return out.set(r * Math.cos(phi), y, r * Math.sin(phi));
}

/** how far the shaving's root is buried in the standing wood above the edge */
export function embedLength(p: ChipParams): number {
  return p.length * 0.16 + 0.02;
}

/** width / thickness ramp at the very tip, where the blade entered the wood */
function rampAt(s: number, len: number): number {
  const r = Math.min(1, Math.max(0, s / (len * 0.22 + 1e-6)));
  return r * r * (3 - 2 * r);
}
export function entryRamp(s: number, len: number): number {
  return 0.34 + 0.66 * rampAt(s, len);
}

/** cross-section outline: a thin band, not a tube. (across a in [-1,1], side) */
const outlineCache = new Map<number, { a: number; face: number }[]>();
function outline(ring: number): { a: number; face: number }[] {
  const hit = outlineCache.get(ring);
  if (hit) return hit;
  const made = buildOutline(ring);
  outlineCache.set(ring, made);
  return made;
}
function buildOutline(ring: number): { a: number; face: number }[] {
  const half = Math.max(3, (ring - 2) >> 1);
  const pts: { a: number; face: number }[] = [];
  for (let i = 0; i <= half; i++) pts.push({ a: -1 + (2 * i) / half, face: 1 });   // outer face
  pts.push({ a: 1, face: 0 });                                                     // arris
  for (let i = 0; i <= half; i++) pts.push({ a: 1 - (2 * i) / half, face: -1 });   // inner face
  pts.push({ a: -1, face: 0 });                                                    // arris
  return pts;
}

export interface ChipBuffers {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  index: Uint32Array;
  vertexCount: number;
  indexCount: number;
}

export function chipVertexCount(seg: number, ring: number): number {
  return (seg + 1) * (outline(ring).length + 1);
}
export function chipIndexCount(seg: number, ring: number): number {
  const rc = outline(ring).length;
  return seg * rc * 6 + (rc - 1) * 3;
}

export function allocChip(seg: number, ring: number, count = 1): ChipBuffers {
  const vc = chipVertexCount(seg, ring) * count;
  const ic = chipIndexCount(seg, ring) * count;
  return {
    position: new Float32Array(vc * 3),
    normal: new Float32Array(vc * 3),
    uv: new Float32Array(vc * 2),
    index: new Uint32Array(ic),
    vertexCount: vc,
    indexCount: ic,
  };
}

export function writeChipIndices(buf: ChipBuffers, seg: number, ring: number, chipIdx: number) {
  const out = outline(ring);
  const rc = out.length;         // closed loop length
  const per = rc + 1;            // duplicated seam vertex for UV continuity
  const vBase = chipIdx * chipVertexCount(seg, ring);
  let o = chipIdx * chipIndexCount(seg, ring);
  for (let i = 0; i < seg; i++) {
    for (let k = 0; k < rc; k++) {
      const a = vBase + i * per + k;
      const b = a + 1;
      const c = a + per;
      const d = c + 1;
      buf.index[o++] = a; buf.index[o++] = c; buf.index[o++] = b;
      buf.index[o++] = b; buf.index[o++] = c; buf.index[o++] = d;
    }
  }
  // flat cap closing the free tip (last section), fanned from its first vertex
  const t0 = vBase + seg * per;
  for (let k = 1; k < rc - 1; k++) {
    buf.index[o++] = t0; buf.index[o++] = t0 + k; buf.index[o++] = t0 + k + 1;
  }
}

/**
 * Write one shaving of current length `cut` into the buffers.
 * Returns the world-space root (blade contact) point.
 */
export function writeChip(
  buf: ChipBuffers, seg: number, ring: number, chipIdx: number,
  p: ChipParams, cut: number,
  rootOut?: THREE.Vector3,
): void {
  const out = outline(ring);
  const rc = out.length;
  const vBase = chipIdx * chipVertexCount(seg, ring);

  const L = Math.max(0, cut);
  const yRoot = p.yStart + L;
  const embed = embedLength(p);

  blankNormal(p.phi, _n);
  blankTangent(p.phi, _t);
  blankBinormal(p.phi, _w);

  const rowR = blankRadius(p.yStart);
  const hw0 = p.width * 0.5;
  const ht0 = p.depth * 0.5;
  const a = p.curlOpen;
  const r0 = p.tipRadius;
  const total = L + embed;
  const du = total / seg;

  // integrate the centreline from the root outwards, in u = distance from root
  // (u < 0 is the buried stub lying under the intact skin above the edge)
  if (px.length < seg + 1) grow(seg + 1);

  // section index runs tip(0) -> root(seg); u = L - s where s is material coord
  // the buried stub must clear the cross-section's own dishing, or its
  // edges would break back out through the intact skin above the edge
  const rootSunk = ht0 + Math.abs(p.cup) * 0.667 * hw0 + 0.002;
  blankSurfacePoint(yRoot, p.phi, _p).addScaledVector(_n, -rootSunk);
  const rootX = _p.x, rootY = _p.y, rootZ = _p.z;
  if (rootOut) rootOut.set(rootX, rootY, rootZ);

  const iRoot = Math.round((embed / total) * seg); // section index of the root
  // stub: sections iRoot..0 correspond to u = 0 .. +embed (into standing wood)
  for (let i = iRoot; i >= 0; i--) {
    const u = (iRoot - i) * du;
    blankSurfacePoint(yRoot + u, p.phi, _p).addScaledVector(_n, -rootSunk);
    px[i] = _p.x; py[i] = _p.y; pz[i] = _p.z;
    dx[i] = _t.x; dy[i] = _t.y; dz[i] = _t.z;
  }
  // curled part: sections iRoot..seg correspond to u = 0 .. L (away from the edge)
  let cx = rootX, cy = rootY, cz = rootZ;
  const lnTop = r0 + a * L;
  for (let i = iRoot; i <= seg; i++) {
    const u = (i - iRoot) * du;
    const s = Math.max(0, L - u);
    const theta = a > 1e-6 ? Math.log(lnTop / (r0 + a * s)) / a : u / r0;
    const ang = p.rake + theta;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    _dir.set(
      _t.x * ca + _n.x * sa,
      _t.y * ca + _n.y * sa,
      _t.z * ca + _n.z * sa,
    );
    if (p.skew !== 0) {
      const k = p.skew * (u / Math.max(total, 1e-6));
      _dir.addScaledVector(_w, k).normalize();
    }
    px[i] = cx; py[i] = cy; pz[i] = cz;
    dx[i] = _dir.x; dy[i] = _dir.y; dz[i] = _dir.z;
    cx += _dir.x * du; cy += _dir.y * du; cz += _dir.z * du;
  }

  // sweep the cross-section
  let vo = vBase * 3, uo = vBase * 2;
  for (let i = 0; i <= seg; i++) {
    const u = (i - iRoot) * du;          // >0 : out from the edge
    const s = Math.max(0, L - u);        // material coordinate from the tip
    const ramp = entryRamp(s, p.length);
    const hw = hw0 * (0.62 + 0.38 * ramp);
    const ht = ht0 * (0.45 + 0.55 * ramp);

    _dir.set(dx[i], dy[i], dz[i]);
    // width axis stays around the blank; re-orthogonalise for the skew
    _bi.copy(_w).addScaledVector(_dir, -_w.dot(_dir)).normalize();
    _fn.crossVectors(_dir, _bi).normalize();

    // material coordinates -> UV. Same scale on every branch and on the trunk.
    const uCoord = (p.yStart + s) / GRAIN_PERIOD;

    for (let k = 0; k <= rc; k++) {
      const o = out[k % rc];
      const av = o.a;
      // gentle cross-cupping: the band is dished, not a rod
      const cupOff = p.cup * (av * av - 0.3333) * hw;
      const cSlope = p.cup * 2 * av;
      const across = av * hw;
      const thick = o.face === 0 ? 0 : o.face * ht;
      _p.set(px[i], py[i], pz[i])
        .addScaledVector(_bi, across)
        .addScaledVector(_fn, cupOff + thick);
      _tmp.set(0, 0, 0);
      if (o.face === 0) _tmp.copy(_bi).multiplyScalar(Math.sign(av));
      else _tmp.copy(_fn).multiplyScalar(o.face).addScaledVector(_bi, -cSlope * o.face);
      _tmp.normalize();

      buf.position[vo] = _p.x; buf.position[vo + 1] = _p.y; buf.position[vo + 2] = _p.z; vo += 3;
      buf.normal[vo - 3] = _tmp.x; buf.normal[vo - 2] = _tmp.y; buf.normal[vo - 1] = _tmp.z;
      buf.uv[uo] = uCoord;
      buf.uv[uo + 1] = (p.phi * rowR + across) / GRAIN_PERIOD;
      uo += 2;
    }
  }
}

/** Collapse a chip to a zero-size point inside the blank (used for unused slots). */
export function hideChip(buf: ChipBuffers, seg: number, ring: number, chipIdx: number) {
  const vc = chipVertexCount(seg, ring);
  const base = chipIdx * vc;
  for (let i = 0; i < vc; i++) {
    buf.position[(base + i) * 3] = 0;
    buf.position[(base + i) * 3 + 1] = -10;
    buf.position[(base + i) * 3 + 2] = 0;
  }
}
