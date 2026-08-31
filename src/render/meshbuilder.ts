import * as THREE from 'three';

/** Minimal indexed-triangle builder. Positions are in metres. */
export class MeshBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];
  private idx: number[] = [];

  get triangleCount() {
    return this.idx.length / 3;
  }

  private vertex(p: THREE.Vector3, n: THREE.Vector3, u: number, v: number): number {
    const i = this.pos.length / 3;
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    return i;
  }

  /**
   * Quad a-b-c-d.  If a normal is given, the winding is corrected to match it,
   * so a face can never end up back-facing and let the eye through the timber.
   */
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, normal?: THREE.Vector3) {
    const geo = new THREE.Vector3()
      .subVectors(b, a)
      .cross(new THREE.Vector3().subVectors(d, a));
    let p = b;
    let q = d;
    if (normal && geo.dot(normal) < 0) {
      p = d;
      q = b;
    }
    const n = normal ? normal.clone().normalize() : geo.normalize();
    const i0 = this.vertex(a, n, 0, 0);
    const i1 = this.vertex(p, n, 1, 0);
    const i2 = this.vertex(c, n, 1, 1);
    const i3 = this.vertex(q, n, 0, 1);
    this.idx.push(i0, i1, i2, i0, i2, i3);
  }

  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, normal?: THREE.Vector3) {
    const geo = new THREE.Vector3()
      .subVectors(b, a)
      .cross(new THREE.Vector3().subVectors(c, a));
    let p = b;
    let q = c;
    if (normal && geo.dot(normal) < 0) {
      p = c;
      q = b;
    }
    const n = normal ? normal.clone().normalize() : geo.normalize();
    const i0 = this.vertex(a, n, 0, 0);
    const i1 = this.vertex(p, n, 1, 0);
    const i2 = this.vertex(q, n, 0.5, 1);
    this.idx.push(i0, i1, i2);
  }

  /** Convex fan from the first point. */
  fan(points: THREE.Vector3[], normal: THREE.Vector3) {
    for (let i = 1; i + 1 < points.length; i++) {
      this.tri(points[0], points[i], points[i + 1], normal);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * A rectangular panel lying in a plane, with rectangular openings cut out of it.
 * `frame(u, v)` maps panel coordinates to world space.  Openings are given in
 * panel coordinates.  The panel is split into a grid of bands so that the
 * openings are genuine holes, not painted-on rectangles.
 */
export function panelWithOpenings(
  mb: MeshBuilder,
  uMin: number,
  uMax: number,
  vMin: number,
  vMax: number,
  openings: Array<{ u0: number; u1: number; v0: number; v1: number }>,
  frame: (u: number, v: number) => THREE.Vector3,
  normal: THREE.Vector3,
) {
  const vCuts = [vMin, vMax];
  for (const o of openings) vCuts.push(o.v0, o.v1);
  vCuts.sort((a, b) => a - b);
  const bands: Array<[number, number]> = [];
  for (let i = 0; i + 1 < vCuts.length; i++) {
    if (vCuts[i + 1] - vCuts[i] > 1e-9) bands.push([vCuts[i], vCuts[i + 1]]);
  }
  for (const [v0, v1] of bands) {
    const mid = (v0 + v1) / 2;
    const inBand = openings
      .filter((o) => o.v0 < mid && mid < o.v1)
      .sort((a, b) => a.u0 - b.u0);
    const uCuts: number[] = [uMin];
    for (const o of inBand) uCuts.push(Math.max(uMin, o.u0), Math.min(uMax, o.u1));
    uCuts.push(uMax);
    for (let i = 0; i + 1 < uCuts.length; i += 2) {
      const a = uCuts[i];
      const b = uCuts[i + 1];
      if (b - a <= 1e-9) continue;
      mb.quad(frame(a, v0), frame(b, v0), frame(b, v1), frame(a, v1), normal);
    }
  }
}

/**
 * Make sure a geometry's triangles wind the way its normals point, so nothing
 * disappears when it is viewed from the side it is supposed to face.
 */
export function orientFaces(geo: THREE.BufferGeometry, desired: THREE.Vector3): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  const index = geo.getIndex();
  if (!index) return geo;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let sum = 0;
  for (let i = 0; i < index.count; i += 3) {
    a.fromBufferAttribute(pos, index.getX(i));
    b.fromBufferAttribute(pos, index.getX(i + 1));
    c.fromBufferAttribute(pos, index.getX(i + 2));
    b.sub(a).cross(c.sub(a));
    sum += b.dot(desired);
  }
  if (sum < 0) {
    const arr = index.array as unknown as number[];
    for (let i = 0; i < index.count; i += 3) {
      const t = arr[i + 1];
      arr[i + 1] = arr[i + 2];
      arr[i + 2] = t;
    }
    index.needsUpdate = true;
    geo.computeVertexNormals();
  }
  return geo;
}
