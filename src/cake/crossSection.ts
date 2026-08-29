import * as THREE from 'three';
import type { Berry } from './berry';

export interface BerryInstance {
  berry: Berry;
  /** berry local space -> cake local space */
  matrix: THREE.Matrix4;
  inverse: THREE.Matrix4;
  /** Half-thickness of a lengthwise slice; 0 for a whole berry. */
  slab: number;
  seed: number;
}

/** A vertical plane through the cake axis, at `angle` around +Y. */
export class CutPlane {
  readonly angle: number;
  /** Radial direction of the cut (points from the axis outward). */
  readonly dir: THREE.Vector3;
  /** Plane normal (right-hand side of `dir`). */
  readonly normal: THREE.Vector3;

  constructor(angle: number) {
    this.angle = angle;
    this.dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    this.normal = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
  }
  /** Plane coords (u along dir, v along +Y) -> cake space. */
  toWorld(u: number, v: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.dir.x * u, v, this.dir.z * u);
  }
}

/** Approximate signed field of a berry in its own local space (negative inside). */
function signedField(berry: Berry, x: number, y: number, z: number, slab: number): number {
  if (slab > 0) return berry.signedSlab(x, y, z, slab);
  const hl = berry.halfLength;
  const L = berry.p.length;
  const axial = Math.max(-(y + hl), y - hl);
  const s = Math.min(0.998, Math.max(0.002, (y + hl) / L));
  const off = berry.axisOffset(s);
  const dx = x - off.x;
  const dz = z - off.z;
  const r = Math.hypot(dx, dz);
  const radial = r - berry.radiusAt(s, Math.atan2(dz, dx));
  return Math.max(axial, radial);
}

interface Loop {
  pts: THREE.Vector2[];
  area: number;
}

function extractLoops(field: Float32Array, res: number, u0: number, v0: number, cell: number): Loop[] {
  const segs: { a: THREE.Vector2; b: THREE.Vector2 }[] = [];
  const at = (i: number, j: number) => field[j * res + i];
  const lerpPt = (
    ax: number, ay: number, av: number,
    bx: number, by: number, bv: number
  ) => {
    const t = av === bv ? 0.5 : av / (av - bv);
    return new THREE.Vector2(ax + (bx - ax) * t, ay + (by - ay) * t);
  };
  for (let j = 0; j < res - 1; j++) {
    for (let i = 0; i < res - 1; i++) {
      const x0 = u0 + i * cell;
      const y0 = v0 + j * cell;
      const x1 = x0 + cell;
      const y1 = y0 + cell;
      const f00 = at(i, j);
      const f10 = at(i + 1, j);
      const f11 = at(i + 1, j + 1);
      const f01 = at(i, j + 1);
      let code = 0;
      if (f00 < 0) code |= 1;
      if (f10 < 0) code |= 2;
      if (f11 < 0) code |= 4;
      if (f01 < 0) code |= 8;
      if (code === 0 || code === 15) continue;
      const eB = () => lerpPt(x0, y0, f00, x1, y0, f10);
      const eR = () => lerpPt(x1, y0, f10, x1, y1, f11);
      const eT = () => lerpPt(x1, y1, f11, x0, y1, f01);
      const eL = () => lerpPt(x0, y1, f01, x0, y0, f00);
      const push = (a: THREE.Vector2, b: THREE.Vector2) => segs.push({ a, b });
      switch (code) {
        case 1: case 14: push(eL(), eB()); break;
        case 2: case 13: push(eB(), eR()); break;
        case 3: case 12: push(eL(), eR()); break;
        case 4: case 11: push(eR(), eT()); break;
        case 5: push(eL(), eT()); push(eB(), eR()); break;
        case 6: case 9: push(eB(), eT()); break;
        case 7: case 8: push(eL(), eT()); break;
        case 10: push(eL(), eB()); push(eR(), eT()); break;
      }
    }
  }
  if (!segs.length) return [];

  // Chain segments into closed loops by snapping endpoints to a fine grid.
  const key = (p: THREE.Vector2) => `${Math.round(p.x / (cell * 0.06))},${Math.round(p.y / (cell * 0.06))}`;
  const adj = new Map<string, { p: THREE.Vector2; next: string[] }>();
  const touch = (p: THREE.Vector2) => {
    const k = key(p);
    let e = adj.get(k);
    if (!e) {
      e = { p, next: [] };
      adj.set(k, e);
    }
    return k;
  };
  for (const s of segs) {
    const ka = touch(s.a);
    const kb = touch(s.b);
    adj.get(ka)!.next.push(kb);
    adj.get(kb)!.next.push(ka);
  }
  const visited = new Set<string>();
  const loops: Loop[] = [];
  for (const start of adj.keys()) {
    if (visited.has(start)) continue;
    const pts: THREE.Vector2[] = [];
    let cur = start;
    let prev = '';
    for (let guard = 0; guard < 4000; guard++) {
      visited.add(cur);
      const node = adj.get(cur)!;
      pts.push(node.p);
      const nxt = node.next.find((k) => k !== prev && !visited.has(k));
      if (!nxt) break;
      prev = cur;
      cur = nxt;
    }
    if (pts.length < 6) continue;
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      area += a.x * b.y - b.x * a.y;
    }
    loops.push({ pts, area: Math.abs(area) * 0.5 });
  }
  loops.sort((a, b) => b.area - a.area);
  return loops;
}

export interface SectionResult {
  geometry: THREE.BufferGeometry;
  area: number;
}

/**
 * True cross-section of one placed berry against one cut plane. The contour is
 * solved from the very same shape function that builds the berry mesh, so the
 * revealed face can never disagree with what the player put inside.
 */
export function berrySection(
  inst: BerryInstance,
  plane: CutPlane,
  resolution = 46
): SectionResult | null {
  const centre = new THREE.Vector3().setFromMatrixPosition(inst.matrix);
  const bound = inst.berry.boundRadius * maxScale(inst.matrix);
  const dist = plane.normal.dot(centre);
  if (Math.abs(dist) >= bound) return null;

  const rDisc = Math.sqrt(Math.max(0, bound * bound - dist * dist)) * 1.06 + 0.05;
  const uc = plane.dir.dot(centre);
  const vc = centre.y;
  const u0 = uc - rDisc;
  const v0 = vc - rDisc;
  const cell = (rDisc * 2) / (resolution - 1);

  const field = new Float32Array(resolution * resolution);
  const p = new THREE.Vector3();
  for (let j = 0; j < resolution; j++) {
    for (let i = 0; i < resolution; i++) {
      plane.toWorld(u0 + i * cell, v0 + j * cell, p);
      p.applyMatrix4(inst.inverse);
      field[j * resolution + i] = signedField(inst.berry, p.x, p.y, p.z, inst.slab);
    }
  }

  const loops = extractLoops(field, resolution, u0, v0, cell);
  if (!loops.length || loops[0].area < 0.06) return null;
  const loop = loops[0];

  // Resample to a fixed, star-shaped ring around the centroid so the fan
  // triangulation stays valid and the radial attribute is well defined.
  let cx = 0;
  let cy = 0;
  for (const q of loop.pts) {
    cx += q.x;
    cy += q.y;
  }
  cx /= loop.pts.length;
  cy /= loop.pts.length;

  // A cut berry is not flat: the flesh stands very slightly proud of the cream.
  const bulge = (k: number) => (1 - k * k) * 0.045;
  const RING = 64;
  const rays = new Float32Array(RING);
  for (const q of loop.pts) {
    let a = Math.atan2(q.y - cy, q.x - cx);
    if (a < 0) a += Math.PI * 2;
    const k = Math.min(RING - 1, Math.floor((a / (Math.PI * 2)) * RING));
    const r = Math.hypot(q.x - cx, q.y - cy);
    if (r > rays[k]) rays[k] = r;
  }
  // Fill any empty angular bucket from its neighbours.
  for (let pass = 0; pass < 3; pass++) {
    for (let k = 0; k < RING; k++) {
      if (rays[k] > 0) continue;
      const a = rays[(k - 1 + RING) % RING];
      const b = rays[(k + 1) % RING];
      if (a > 0 && b > 0) rays[k] = (a + b) * 0.5;
      else if (a > 0) rays[k] = a;
      else if (b > 0) rays[k] = b;
    }
  }
  // Light angular smoothing keeps the outline organic without marching-square stairs.
  const smooth = new Float32Array(RING);
  for (let k = 0; k < RING; k++) {
    smooth[k] =
      rays[(k - 1 + RING) % RING] * 0.25 + rays[k] * 0.5 + rays[(k + 1) % RING] * 0.25;
  }

  const pos: number[] = [];
  const radial: number[] = [];
  const angle: number[] = [];
  const seed: number[] = [];
  const idx: number[] = [];
  const tmp = new THREE.Vector3();

  plane.toWorld(cx, cy, tmp);
  tmp.addScaledVector(plane.normal, bulge(0));
  pos.push(tmp.x, tmp.y, tmp.z);
  radial.push(0);
  angle.push(0);
  seed.push(inst.seed);

  // Two rings (centre, mid, rim) so the radial gradient interpolates smoothly.
  const RINGS = [0.32, 0.66, 1];
  for (let ri = 0; ri < RINGS.length; ri++) {
    for (let k = 0; k < RING; k++) {
      const a = (k / RING) * Math.PI * 2;
      const r = smooth[k] * RINGS[ri];
      plane.toWorld(cx + Math.cos(a) * r, cy + Math.sin(a) * r, tmp);
      tmp.addScaledVector(plane.normal, bulge(RINGS[ri]));
      pos.push(tmp.x, tmp.y, tmp.z);
      radial.push(RINGS[ri]);
      angle.push(a);
      seed.push(inst.seed);
    }
  }
  for (let k = 0; k < RING; k++) {
    const k2 = (k + 1) % RING;
    idx.push(0, 1 + k, 1 + k2);
    for (let ri = 0; ri < RINGS.length - 1; ri++) {
      const inner = 1 + ri * RING;
      const outer = inner + RING;
      idx.push(inner + k, outer + k, inner + k2);
      idx.push(inner + k2, outer + k, outer + k2);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aRadial', new THREE.Float32BufferAttribute(radial, 1));
  g.setAttribute('aAngle', new THREE.Float32BufferAttribute(angle, 1));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return { geometry: g, area: loop.area };
}

function maxScale(m: THREE.Matrix4): number {
  const e = m.elements;
  const sx = Math.hypot(e[0], e[1], e[2]);
  const sy = Math.hypot(e[4], e[5], e[6]);
  const sz = Math.hypot(e[8], e[9], e[10]);
  return Math.max(sx, sy, sz);
}
