import * as THREE from 'three';
import { TAU } from '../core/rng';

export type Field = number | ((angle: number, radius: number) => number);

export interface PolarSolidOptions {
  rOuter: number;
  rInner?: number;
  bottom: Field;
  top: Field;
  a0: number;
  a1: number;
  angularSegments: number;
  radialSegments: number;
  /** World size, in metres, covered by one tile of the surface texture. */
  uvScale: number;
}

const evalField = (f: Field, a: number, r: number): number =>
  typeof f === 'number' ? f : f(a, r);

const isClosed = (o: PolarSolidOptions): boolean => Math.abs(o.a1 - o.a0) >= TAU - 1e-6;

function vertexCount(o: PolarSolidOptions): number {
  const na = Math.max(3, o.angularSegments);
  const nr = Math.max(1, o.radialSegments);
  let n = 2 * (na + 1) * (nr + 1) + (na + 1) * 2;
  if (!isClosed(o)) n += 2 * (nr + 1) * 2;
  return n;
}

/**
 * Writes positions, normals and UVs for a cake layer expressed as an angular
 * sector of a solid of revolution. Vertex order is fixed, so the same layout can
 * be rewritten in place while the cream height field is being piped or levelled
 * without rebuilding a single index.
 */
function emitVertices(
  o: PolarSolidOptions,
  pos: Float32Array,
  nor: Float32Array,
  uv: Float32Array,
): void {
  const { rOuter, rInner = 0, bottom, top, a0, a1, uvScale } = o;
  const na = Math.max(3, o.angularSegments);
  const nr = Math.max(1, o.radialSegments);
  let w = 0;
  const put = (
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    u: number,
    v: number,
  ): void => {
    pos[w * 3] = x;
    pos[w * 3 + 1] = y;
    pos[w * 3 + 2] = z;
    nor[w * 3] = nx;
    nor[w * 3 + 1] = ny;
    nor[w * 3 + 2] = nz;
    uv[w * 2] = u;
    uv[w * 2 + 1] = v;
    w++;
  };

  const angleAt = (i: number) => a0 + ((a1 - a0) * i) / na;
  const radiusAt = (j: number) => rInner + ((rOuter - rInner) * j) / nr;
  const tA = new THREE.Vector3();
  const tR = new THREE.Vector3();
  const nv = new THREE.Vector3();

  for (const isTop of [true, false]) {
    const f = isTop ? top : bottom;
    const sign = isTop ? 1 : -1;
    for (let i = 0; i <= na; i++) {
      const a = angleAt(i);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      for (let j = 0; j <= nr; j++) {
        const r = radiusAt(j);
        const y = evalField(f, a, r);
        // Real slope from the field, so a piped mound shades like a mound.
        const dr = 0.0015;
        const da = 0.012;
        const hR = evalField(f, a, Math.min(rOuter, r + dr));
        const hA = evalField(f, a + da, r);
        tR.set(ca * dr, hR - y, sa * dr);
        tA.set(
          Math.cos(a + da) * r - ca * r,
          hA - y,
          Math.sin(a + da) * r - sa * r,
        );
        nv.crossVectors(tA, tR).normalize().multiplyScalar(sign);
        if (!Number.isFinite(nv.x) || nv.lengthSq() < 0.5) nv.set(0, sign, 0);
        put(ca * r, y, sa * r, nv.x, nv.y, nv.z, (ca * r) / uvScale, (sa * r) / uvScale);
      }
    }
  }

  for (let i = 0; i <= na; i++) {
    const a = angleAt(i);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const yt = evalField(top, a, rOuter);
    const yb = evalField(bottom, a, rOuter);
    const u = (a * rOuter) / uvScale;
    put(ca * rOuter, yt, sa * rOuter, ca, 0, sa, u, yt / uvScale);
    put(ca * rOuter, yb, sa * rOuter, ca, 0, sa, u, yb / uvScale);
  }

  if (!isClosed(o)) {
    for (const [a, flip] of [
      [a0, true],
      [a1, false],
    ] as [number, boolean][]) {
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      // The face normal is tangential: this is the plane the blade travelled.
      const nx = flip ? sa : -sa;
      const nz = flip ? -ca : ca;
      for (let j = 0; j <= nr; j++) {
        const r = radiusAt(j);
        const yt = evalField(top, a, r);
        const yb = evalField(bottom, a, r);
        // Metric UVs: crumb pores stay round instead of smearing along the cut.
        put(ca * r, yt, sa * r, nx, 0, nz, r / uvScale, yt / uvScale);
        put(ca * r, yb, sa * r, nx, 0, nz, r / uvScale, yb / uvScale);
      }
    }
  }
}

function emitIndices(o: PolarSolidOptions): { outer: number[]; cut: number[] } {
  const na = Math.max(3, o.angularSegments);
  const nr = Math.max(1, o.radialSegments);
  const outer: number[] = [];
  const cut: number[] = [];
  const face = (na + 1) * (nr + 1);

  for (let s = 0; s < 2; s++) {
    const start = s * face;
    const isTop = s === 0;
    for (let i = 0; i < na; i++) {
      for (let j = 0; j < nr; j++) {
        const a = start + i * (nr + 1) + j;
        const b = start + (i + 1) * (nr + 1) + j;
        const c = start + (i + 1) * (nr + 1) + j + 1;
        const d = start + i * (nr + 1) + j + 1;
        if (isTop) outer.push(a, b, c, a, c, d);
        else outer.push(a, c, b, a, d, c);
      }
    }
  }

  const rim = 2 * face;
  for (let i = 0; i < na; i++) {
    // Vertices alternate top, bottom around the ring; wound so the rim faces
    // out of the cake. Wound the other way it is culled and you see straight
    // through the side of the cake to the inside of the far wall.
    const a = rim + i * 2;
    outer.push(a, a + 3, a + 1, a, a + 2, a + 3);
  }

  if (!isClosed(o)) {
    const base = rim + (na + 1) * 2;
    for (let f = 0; f < 2; f++) {
      const flip = f === 0;
      const start = base + f * (nr + 1) * 2;
      for (let j = 0; j < nr; j++) {
        const i0 = start + j * 2;
        if (flip) cut.push(i0, i0 + 2, i0 + 3, i0, i0 + 3, i0 + 1);
        else cut.push(i0, i0 + 1, i0 + 3, i0, i0 + 3, i0 + 2);
      }
    }
  }
  return { outer, cut };
}

/**
 * A cake layer as an angular sector, with the two radial knife faces built into
 * the mesh as their own material group. Group 0 is the outside (top, bottom,
 * rim); group 1 is the cut.
 */
export function buildPolarSolid(o: PolarSolidOptions): THREE.BufferGeometry {
  const n = vertexCount(o);
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  emitVertices(o, pos, nor, uv);
  const { outer, cut } = emitIndices(o);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geom.setIndex([...outer, ...cut]);
  geom.addGroup(0, outer.length, 0);
  if (cut.length) geom.addGroup(outer.length, cut.length, 1);
  geom.computeBoundingSphere();
  geom.computeBoundingBox();
  geom.userData.polar = o;
  return geom;
}

/**
 * Rewrite an existing layer in place. Used while the piping bag and the palette
 * knife are changing the cream height field, so the surface follows the tool at
 * frame rate without churning geometry.
 */
export function updatePolarSolid(geom: THREE.BufferGeometry, o: PolarSolidOptions): boolean {
  const pos = geom.getAttribute('position') as THREE.BufferAttribute;
  if (pos.count !== vertexCount(o)) return false;
  const nor = geom.getAttribute('normal') as THREE.BufferAttribute;
  const uv = geom.getAttribute('uv') as THREE.BufferAttribute;
  emitVertices(
    o,
    pos.array as Float32Array,
    nor.array as Float32Array,
    uv.array as Float32Array,
  );
  pos.needsUpdate = true;
  nor.needsUpdate = true;
  uv.needsUpdate = true;
  geom.computeBoundingSphere();
  return true;
}
