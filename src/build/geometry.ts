import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TAU, clamp } from '../util/math';

/**
 * Shared geometry helpers. Everything in this project is built from real
 * surfaces rather than cards, so these are the building blocks: lofting rings
 * of points into a skin, and closing that skin off with caps.
 */

export interface LoftOptions {
  /** Close the first ring with a triangle fan. */
  capStart?: boolean;
  /** Close the last ring with a triangle fan. */
  capEnd?: boolean;
  /** Rings are closed loops (a tube) rather than open strips. */
  closedRings?: boolean;
  /**
   * Flip the winding. The default produces outward-facing normals for rings
   * that run anticlockwise in their own plane and are stacked along the
   * surface's forward direction.
   */
  flip?: boolean;
}

/**
 * Loft a stack of equally sized rings into a surface.
 *
 * `rings[i][j]` is vertex j of ring i. Every ring must have the same length.
 */
export function loft(rings: THREE.Vector3[][], opts: LoftOptions = {}): THREE.BufferGeometry {
  const { capStart = false, capEnd = false, closedRings = true, flip = false } = opts;
  const rows = rings.length;
  if (rows < 2) throw new Error('loft needs at least two rings');
  const cols = rings[0].length;

  const capVerts = (capStart ? 1 : 0) + (capEnd ? 1 : 0);
  const vertexCount = rows * cols + capVerts;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  for (let i = 0; i < rows; i++) {
    const ring = rings[i];
    for (let j = 0; j < cols; j++) {
      const p = ring[j];
      const o = (i * cols + j) * 3;
      positions[o] = p.x;
      positions[o + 1] = p.y;
      positions[o + 2] = p.z;
      const u = (i * cols + j) * 2;
      uvs[u] = j / (closedRings ? cols : cols - 1);
      uvs[u + 1] = i / (rows - 1);
    }
  }

  const index: number[] = [];
  const span = closedRings ? cols : cols - 1;
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < span; j++) {
      const j2 = (j + 1) % cols;
      const a = i * cols + j;
      const b = i * cols + j2;
      const c = (i + 1) * cols + j2;
      const d = (i + 1) * cols + j;
      if (flip) index.push(a, b, c, a, c, d);
      else index.push(a, c, b, a, d, c);
    }
  }

  let next = rows * cols;
  const centre = new THREE.Vector3();

  if (capStart) {
    centre.set(0, 0, 0);
    for (const p of rings[0]) centre.add(p);
    centre.multiplyScalar(1 / cols);
    const ci = next++;
    positions[ci * 3] = centre.x;
    positions[ci * 3 + 1] = centre.y;
    positions[ci * 3 + 2] = centre.z;
    uvs[ci * 2] = 0.5;
    uvs[ci * 2 + 1] = 0;
    for (let j = 0; j < cols; j++) {
      const j2 = (j + 1) % cols;
      if (flip) index.push(ci, j2, j);
      else index.push(ci, j, j2);
    }
  }

  if (capEnd) {
    const last = rings[rows - 1];
    centre.set(0, 0, 0);
    for (const p of last) centre.add(p);
    centre.multiplyScalar(1 / cols);
    const ci = next++;
    positions[ci * 3] = centre.x;
    positions[ci * 3 + 1] = centre.y;
    positions[ci * 3 + 2] = centre.z;
    uvs[ci * 2] = 0.5;
    uvs[ci * 2 + 1] = 1;
    const base = (rows - 1) * cols;
    for (let j = 0; j < cols; j++) {
      const j2 = (j + 1) % cols;
      if (flip) index.push(ci, base + j, base + j2);
      else index.push(ci, base + j2, base + j);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/** A ring of points on a circle in the XZ plane at height y. */
export function circleRing(radius: number, y: number, segments: number): THREE.Vector3[] {
  const ring: THREE.Vector3[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * TAU;
    ring.push(new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius));
  }
  return ring;
}

/**
 * Revolve a 2D profile (x = radius, y = height) around the Y axis. Unlike
 * THREE.LatheGeometry this keeps the profile's own arc-length in the V
 * coordinate, which matters for the wear streaks on the metal.
 */
export function revolve(
  profile: THREE.Vector2[],
  segments: number,
  opts: LoftOptions = {},
): THREE.BufferGeometry {
  const rings = profile.map((p) => circleRing(Math.max(p.x, 1e-6), p.y, segments));
  return loft(rings, { closedRings: true, ...opts });
}

/**
 * A box with rounded edges, built by inflating a subdivided cube.
 *
 * `steps` has to be high enough that each face keeps vertices away from the
 * rounded border — otherwise every vertex on the face sits on the fillet, the
 * averaged normals tilt the whole face, and a flat plate ends up shading as a
 * cushion. Thin plates in particular need a good number of steps.
 */
export function roundedBox(
  width: number,
  height: number,
  depth: number,
  radius: number,
  steps = 3,
): THREE.BufferGeometry {
  const r = Math.min(radius, width / 2, height / 2, depth / 2);
  const geo = new THREE.BoxGeometry(
    width,
    height,
    depth,
    Math.max(1, steps),
    Math.max(1, steps),
    Math.max(1, steps),
  );
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const hx = width / 2 - r;
  const hy = height / 2 - r;
  const hz = depth / 2 - r;
  const v = new THREE.Vector3();
  const inner = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    inner.set(clamp(v.x, -hx, hx), clamp(v.y, -hy, hy), clamp(v.z, -hz, hz));
    const dir = v.clone().sub(inner);
    const len = dir.length();
    if (len > 1e-9) dir.multiplyScalar(r / len);
    else dir.set(0, 0, 0);
    v.copy(inner).add(dir);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * A tapered capsule between two points, used for finger segments. Radii are
 * the start and end radii; the caps are hemispherical.
 */
export function taperedCapsule(
  a: THREE.Vector3,
  b: THREE.Vector3,
  ra: number,
  rb: number,
  radial = 12,
  rings = 5,
): THREE.BufferGeometry {
  const axis = b.clone().sub(a);
  const len = axis.length();
  axis.normalize();
  const up = Math.abs(axis.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(up, axis).normalize();
  const w = new THREE.Vector3().crossVectors(axis, u).normalize();

  const stack: THREE.Vector3[][] = [];
  const push = (centre: THREE.Vector3, radius: number, bulge: number) => {
    const ring: THREE.Vector3[] = [];
    for (let i = 0; i < radial; i++) {
      const ang = (i / radial) * TAU;
      ring.push(
        centre
          .clone()
          .addScaledVector(u, Math.cos(ang) * radius)
          .addScaledVector(w, Math.sin(ang) * radius)
          .addScaledVector(axis, bulge),
      );
    }
    return ring;
  };

  // start hemisphere
  for (let i = rings; i >= 1; i--) {
    const t = i / rings;
    const ang = (t * Math.PI) / 2;
    stack.push(push(a, Math.cos(ang) * ra, -Math.sin(ang) * ra));
  }
  // shaft
  const shaft = 6;
  for (let i = 0; i <= shaft; i++) {
    const t = i / shaft;
    const c = a.clone().addScaledVector(axis, t * len);
    stack.push(push(c, ra + (rb - ra) * t, 0));
  }
  // end hemisphere
  for (let i = 1; i <= rings; i++) {
    const t = i / rings;
    const ang = (t * Math.PI) / 2;
    stack.push(push(b, Math.cos(ang) * rb, Math.sin(ang) * rb));
  }

  return loft(stack, { closedRings: true });
}

export function mergeAll(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const cleaned = geos.map((g) => {
    const c = g.clone();
    // mergeGeometries needs matching attribute sets
    for (const name of Object.keys(c.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') c.deleteAttribute(name);
    }
    if (!c.attributes.uv) {
      const n = c.attributes.position.count;
      c.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    }
    if (!c.attributes.normal) c.computeVertexNormals();
    return c;
  });
  const merged = mergeGeometries(cleaned, false);
  for (const c of cleaned) c.dispose();
  if (!merged) throw new Error('failed to merge geometry');
  return merged;
}

/** Recursively free everything owned by a subtree. */
export function disposeSubtree(root: THREE.Object3D, disposeMaterials = false): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    if (disposeMaterials && mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) m.dispose();
    }
  });
  root.parent?.remove(root);
}

/**
 * Flip a closed geometry's winding if its signed volume came out negative, so
 * lofted solids end up facing outwards no matter which way the profile ran.
 */
export function orientOutward(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const idx = geo.getIndex();
  if (!idx) return geo;
  let vol = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(pos, idx.getX(i));
    b.fromBufferAttribute(pos, idx.getX(i + 1));
    c.fromBufferAttribute(pos, idx.getX(i + 2));
    vol += a.dot(b.clone().cross(c));
  }
  if (vol < 0) {
    const arr = idx.array as ArrayLike<number>;
    const out = new Uint32Array(idx.count);
    for (let i = 0; i < idx.count; i += 3) {
      out[i] = arr[i];
      out[i + 1] = arr[i + 2];
      out[i + 2] = arr[i + 1];
    }
    geo.setIndex(new THREE.BufferAttribute(out, 1));
    geo.computeVertexNormals();
  }
  return geo;
}
