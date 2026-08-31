import * as THREE from 'three';
import { ROWS, GLUE_BAND } from '../config';
import { radiusAbove, radiusBelow, rowY } from './profile';

/**
 * A solid cardboard cover cut to the same tree silhouette as the leaves.
 * Local frame: x = radius from the spine, y = height, z = across the board.
 * Placed by the caller with rotation.y = -theta and a z offset, so it lines up
 * exactly with the leaf it is glued to.
 */
export function makeCoverGeometry(halfThickness: number): THREE.BufferGeometry {
  const half = GLUE_BAND * 0.5;
  const outline: { y: number; r: number }[] = [];
  for (let j = 0; j < ROWS; j++) {
    const y = rowY(j);
    outline.push({ y: y - half, r: radiusBelow(j) });
    outline.push({ y: y + half, r: radiusAbove(j) });
  }

  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];

  const push = (x: number, y: number, z: number, n: THREE.Vector3, u: number, v: number) => {
    const id = pos.length / 3;
    pos.push(x, y, z);
    nrm.push(n.x, n.y, n.z);
    uv.push(u, v);
    return id;
  };
  const quad = (a: number, b: number, c: number, d: number) => idx.push(a, b, c, a, c, d);

  const nz = new THREE.Vector3(0, 0, 1);
  const nzn = new THREE.Vector3(0, 0, -1);
  const nx = new THREE.Vector3(-1, 0, 0);
  const nyUp = new THREE.Vector3(0, 1, 0);
  const nyDn = new THREE.Vector3(0, -1, 0);

  for (let i = 0; i < outline.length - 1; i++) {
    const a = outline[i];
    const b = outline[i + 1];
    const v0 = a.y * 8;
    const v1 = b.y * 8;

    // front / back faces
    const f0 = push(0, a.y, halfThickness, nz, 0, v0);
    const f1 = push(a.r, a.y, halfThickness, nz, 1, v0);
    const f2 = push(b.r, b.y, halfThickness, nz, 1, v1);
    const f3 = push(0, b.y, halfThickness, nz, 0, v1);
    quad(f0, f1, f2, f3);

    const g0 = push(0, a.y, -halfThickness, nzn, 0, v0);
    const g1 = push(a.r, a.y, -halfThickness, nzn, 1, v0);
    const g2 = push(b.r, b.y, -halfThickness, nzn, 1, v1);
    const g3 = push(0, b.y, -halfThickness, nzn, 0, v1);
    quad(g0, g3, g2, g1);

    // cut edge along the silhouette
    const dx = b.r - a.r;
    const dy = b.y - a.y;
    const en = new THREE.Vector3(dy, -dx, 0).normalize();
    const e0 = push(a.r, a.y, -halfThickness, en, 0, v0);
    const e1 = push(b.r, b.y, -halfThickness, en, 0, v1);
    const e2 = push(b.r, b.y, halfThickness, en, 1, v1);
    const e3 = push(a.r, a.y, halfThickness, en, 1, v0);
    quad(e0, e1, e2, e3);

    // spine edge
    const s0 = push(0, a.y, -halfThickness, nx, 0, v0);
    const s1 = push(0, b.y, -halfThickness, nx, 0, v1);
    const s2 = push(0, b.y, halfThickness, nx, 1, v1);
    const s3 = push(0, a.y, halfThickness, nx, 1, v0);
    quad(s0, s3, s2, s1);
  }

  const cap = (o: { y: number; r: number }, n: THREE.Vector3, flip: boolean) => {
    const a = push(0, o.y, -halfThickness, n, 0, 0);
    const b = push(o.r, o.y, -halfThickness, n, 1, 0);
    const c = push(o.r, o.y, halfThickness, n, 1, 1);
    const d = push(0, o.y, halfThickness, n, 0, 1);
    if (flip) quad(a, d, c, b);
    else quad(a, b, c, d);
  };
  cap(outline[0], nyDn, false);
  cap(outline[outline.length - 1], nyUp, true);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}
