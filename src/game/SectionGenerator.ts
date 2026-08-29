import * as THREE from 'three';

/**
 * SectionGenerator — the exact cross section of a solid against a plane.
 *
 * The knife direction is one of twelve planes, but nothing about the result is
 * pre-baked: every placed strawberry is intersected analytically against the
 * plane it actually meets, triangle by triangle, and the cap that appears in
 * the reveal is generated from that intersection. Change the orientation of a
 * berry and the very same code returns a different polygon, because the solid
 * really is in a different place.
 */

export interface CapOptions {
  /** Local XY box used to map the cap into the berry's painted interior. */
  uvBox: THREE.Box2;
  /** Slab thickness; gives the interior a slight depth-dependent shift. */
  thickness: number;
  /** Face the cap the other way (the mating half of the same cut). */
  flip?: boolean;
  /** Signed nudge along the plane normal, so the cap sits just proud of the
   *  cream and sponge faces it shares the plane with. */
  offset?: number;
  /**
   * Half plane the cut actually occupies, in the solid's local space: the knife
   * runs outward from the cake's axis, so a berry sitting over the middle is
   * trimmed at the axis instead of spilling past the apex of the wedge.
   */
  trim?: { axis: THREE.Vector3; outward: THREE.Vector3 };
}

export interface SectionResult {
  geometry: THREE.BufferGeometry;
  /** Area of the cut face in square metres. */
  area: number;
  /** Centre of the cut face, in the solid's local space. */
  centroid: THREE.Vector3;
  /** Extent of the cut face along the plane's two in-plane axes. */
  extent: THREE.Vector2;
  loops: THREE.Vector2[][];
}

const EPS = 1e-9;

/** Orthonormal in-plane basis for a plane normal. */
function planeBasis(n: THREE.Vector3): { u: THREE.Vector3; v: THREE.Vector3 } {
  const helper =
    Math.abs(n.x) < 0.8 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(helper, n).normalize();
  const v = new THREE.Vector3().crossVectors(n, u).normalize();
  return { u, v };
}

/** Sutherland-Hodgman clip of a polygon to the half plane (p - a) . d >= 0. */
function clipHalfPlane(
  poly: THREE.Vector2[],
  a: THREE.Vector2,
  d: THREE.Vector2,
): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  const side = (p: THREE.Vector2) => (p.x - a.x) * d.x + (p.y - a.y) * d.y;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const sp = side(p);
    const sq = side(q);
    if (sp >= 0) out.push(p.clone());
    if ((sp >= 0) !== (sq >= 0)) {
      const t = sp / (sp - sq);
      out.push(new THREE.Vector2(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t));
    }
  }
  return out;
}

function signedArea(loop: THREE.Vector2[]): number {
  let a = 0;
  for (let i = 0, n = loop.length; i < n; i++) {
    const p = loop[i];
    const q = loop[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/**
 * `plane` must already be expressed in the geometry's local space, and the
 * geometry must be the watertight collider hull of the solid (shared vertices,
 * indexed). Crossings are keyed by the mesh edge they sit on, so the outline is
 * chained topologically rather than by comparing floating point positions, and
 * a cut that grazes the equator of a slice still closes into one loop.
 *
 * Returns null when the plane misses the solid entirely — which is exactly what
 * happens to every strawberry the knife does not reach.
 */
export function sectionOf(
  geometry: THREE.BufferGeometry,
  plane: THREE.Plane,
  opts: CapOptions,
): SectionResult | null {
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
  const index = geometry.getIndex();
  if (!index) return null;
  const triCount = index.count / 3;

  const n = plane.normal;
  const { u, v } = planeBasis(n);
  const origin = n.clone().multiplyScalar(-plane.constant);

  // Signed distance per vertex, computed once so adjacent triangles agree.
  const dist = new Float64Array(posAttr.count);
  const p = new THREE.Vector3();
  let anyPos = false;
  let anyNeg = false;
  for (let i = 0; i < posAttr.count; i++) {
    p.fromBufferAttribute(posAttr, i);
    const d = plane.distanceToPoint(p);
    // A vertex exactly on the plane (the equator ring of a slice cut parallel
    // to its own face) is nudged to one side so the walk stays well defined.
    dist[i] = Math.abs(d) < EPS ? EPS : d;
    if (dist[i] > 0) anyPos = true;
    else anyNeg = true;
  }
  if (!anyPos || !anyNeg) return null;

  const points = new Map<number, THREE.Vector2>();
  const segA: number[] = [];
  const segB: number[] = [];
  const a3 = new THREE.Vector3();
  const b3 = new THREE.Vector3();

  const crossing = (vi: number, vj: number): number => {
    const lo = Math.min(vi, vj);
    const hi = Math.max(vi, vj);
    const id = lo * posAttr.count + hi;
    if (!points.has(id)) {
      a3.fromBufferAttribute(posAttr, lo);
      b3.fromBufferAttribute(posAttr, hi);
      const t = dist[lo] / (dist[lo] - dist[hi]);
      const q = a3.clone().lerp(b3, t).sub(origin);
      points.set(id, new THREE.Vector2(q.dot(u), q.dot(v)));
    }
    return id;
  };

  for (let t = 0; t < triCount; t++) {
    const i0 = index.getX(t * 3);
    const i1 = index.getX(t * 3 + 1);
    const i2 = index.getX(t * 3 + 2);
    const d0 = dist[i0];
    const d1 = dist[i1];
    const d2 = dist[i2];
    if ((d0 > 0 && d1 > 0 && d2 > 0) || (d0 < 0 && d1 < 0 && d2 < 0)) continue;
    const ids: number[] = [];
    if (d0 > 0 !== d1 > 0) ids.push(crossing(i0, i1));
    if (d1 > 0 !== d2 > 0) ids.push(crossing(i1, i2));
    if (d2 > 0 !== d0 > 0) ids.push(crossing(i2, i0));
    if (ids.length !== 2 || ids[0] === ids[1]) continue;
    segA.push(ids[0]);
    segB.push(ids[1]);
  }

  if (segA.length < 3) return null;

  /* ---- chain segments into closed loops through shared edge ids ---- */
  const adjacency = new Map<number, number[]>();
  for (let i = 0; i < segA.length; i++) {
    for (const id of [segA[i], segB[i]]) {
      const list = adjacency.get(id);
      if (list) list.push(i);
      else adjacency.set(id, [i]);
    }
  }
  const used = new Uint8Array(segA.length);
  const loops: THREE.Vector2[][] = [];
  for (let start = 0; start < segA.length; start++) {
    if (used[start]) continue;
    used[start] = 1;
    const first = segA[start];
    const ids: number[] = [first];
    let tail = segB[start];
    for (let guard = 0; guard <= segA.length; guard++) {
      if (tail === first) break;
      ids.push(tail);
      const cands = adjacency.get(tail);
      let next = -1;
      if (cands) for (const c of cands) if (!used[c]) { next = c; break; }
      if (next < 0) break;
      used[next] = 1;
      tail = segA[next] === tail ? segB[next] : segA[next];
    }
    if (ids.length >= 3) loops.push(ids.map((id) => points.get(id)!.clone()));
  }
  if (!loops.length) return null;

  // Largest loop is the outline; anything smaller is a hole in the cut face.
  loops.sort((x, y) => Math.abs(signedArea(y)) - Math.abs(signedArea(x)));
  const outline = loops[0];
  if (signedArea(outline) < 0) outline.reverse();
  const holes = loops.slice(1).filter((l) => Math.abs(signedArea(l)) > 1e-9);
  for (const h of holes) if (signedArea(h) > 0) h.reverse();

  // Trim to the half plane the knife travelled before triangulating.
  let outlineTrimmed = outline;
  let holesTrimmed = holes;
  if (opts.trim) {
    const rel = opts.trim.axis.clone().sub(origin);
    const a2 = new THREE.Vector2(rel.dot(u), rel.dot(v));
    const d = new THREE.Vector2(opts.trim.outward.dot(u), opts.trim.outward.dot(v));
    if (d.lengthSq() > 1e-12) {
      d.normalize();
      outlineTrimmed = clipHalfPlane(outline, a2, d);
      if (outlineTrimmed.length < 3) return null;
      holesTrimmed = holes
        .map((h) => clipHalfPlane(h, a2, d))
        .filter((h) => h.length >= 3);
    }
  }

  const tris = THREE.ShapeUtils.triangulateShape(outlineTrimmed, holesTrimmed);
  if (!tris.length) return null;

  const all = [...outlineTrimmed, ...holesTrimmed.flat()];
  const flip = opts.flip === true;
  // Signed by the caller: always nudged into the solid it belongs to.
  const off = opts.offset ?? 0;
  const box = opts.uvBox;
  const bw = box.max.x - box.min.x;
  const bh = box.max.y - box.min.y;

  const pos = new Float32Array(all.length * 3);
  const nor = new Float32Array(all.length * 3);
  const uv = new Float32Array(all.length * 2);
  const centroid = new THREE.Vector3();
  const min = new THREE.Vector2(Infinity, Infinity);
  const max = new THREE.Vector2(-Infinity, -Infinity);

  all.forEach((q, i) => {
    const local = origin
      .clone()
      .addScaledVector(u, q.x)
      .addScaledVector(v, q.y)
      .addScaledVector(n, off);
    pos[i * 3] = local.x;
    pos[i * 3 + 1] = local.y;
    pos[i * 3 + 2] = local.z;
    nor[i * 3] = flip ? -n.x : n.x;
    nor[i * 3 + 1] = flip ? -n.y : n.y;
    nor[i * 3 + 2] = flip ? -n.z : n.z;
    // Sample the berry's own painted interior in its (width, length) frame,
    // shifted slightly by depth: a cut across the slab reads a column through
    // the pith, a cut along it reads the whole silhouette with its skin ring.
    const su = (local.x + 0.35 * local.z - box.min.x) / bw;
    const sv = (local.y - box.min.y) / bh;
    uv[i * 2] = flip ? 1 - su : su;
    uv[i * 2 + 1] = sv;
    centroid.add(local);
    min.min(q);
    max.max(q);
  });
  centroid.multiplyScalar(1 / all.length);

  const idx: number[] = [];
  for (const t of tris) {
    if (flip) idx.push(t[2], t[1], t[0]);
    else idx.push(t[0], t[1], t[2]);
  }

  let area = Math.abs(signedArea(outlineTrimmed));
  for (const h of holesTrimmed) area -= Math.abs(signedArea(h));

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geom.setIndex(idx);
  geom.computeBoundingSphere();

  return {
    geometry: geom,
    area: Math.max(0, area),
    centroid,
    extent: new THREE.Vector2(max.x - min.x, max.y - min.y),
    loops: [outlineTrimmed, ...holesTrimmed],
  };
}

/** World-space plane pulled back into an object's local frame. */
export function localPlane(plane: THREE.Plane, object: THREE.Object3D): THREE.Plane {
  object.updateWorldMatrix(true, false);
  const inv = new THREE.Matrix4().copy(object.matrixWorld).invert();
  return plane.clone().applyMatrix4(inv);
}
