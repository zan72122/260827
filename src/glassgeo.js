import * as THREE from 'three';
import { polygonArea, polygonCentroid } from './curve2d.js';

// Builds a closed extruded mesh for a glass piece described by a 2D polygon on
// the sheet plane (u -> local x, v -> local z), extruded from y=0 to y=thickness.
// Material groups: 0 = faces (top/bottom), 1 = factory edges, 2 = cut faces.
//
// The polygon is not assumed to have a particular winding; triangle and quad
// orientation is enforced explicitly (top +y, bottom -y, sides outward).

export function buildPieceGeometry({ poly, cutEdges, thickness, uvRect }) {
  const n = poly.length;
  const ccw = polygonArea(poly) > 0; // interior lies to the left of each directed edge
  const contour = poly.map(p => new THREE.Vector2(p.x, p.y));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);

  const positions = [];
  const normals = [];
  const uvs = [];
  const groups = []; // {start, count, mat}

  const uvOf = (p) => [
    (p.x + uvRect.hw) / (2 * uvRect.hw),
    (p.y + uvRect.hh) / (2 * uvRect.hh)
  ];

  function pushTri(pa, pb, pc, ny, y) {
    // enforce winding so the face normal points along ny (+1 top / -1 bottom)
    const ux = pb.x - pa.x, uz = pb.y - pa.y;
    const vx = pc.x - pa.x, vz = pc.y - pa.y;
    const crossY = uz * vx - ux * vz; // y component of (u x v) with u=(ux,0,uz)
    let A = pa, B = pb, C = pc;
    if (Math.sign(crossY) !== Math.sign(ny)) { B = pc; C = pb; }
    for (const p of [A, B, C]) {
      positions.push(p.x, y, p.y);
      normals.push(0, ny, 0);
      const [uu, vv] = uvOf(p);
      uvs.push(uu, vv);
    }
  }

  let start = 0;

  // group 0: top and bottom faces
  for (const t of tris) pushTri(poly[t[0]], poly[t[1]], poly[t[2]], 1, thickness);
  for (const t of tris) pushTri(poly[t[0]], poly[t[1]], poly[t[2]], -1, 0);
  groups.push({ start, count: positions.length / 3 - start, mat: 0 });
  start = positions.length / 3;

  // side faces: first `cutEdges` polygon edges are the score cut, rest factory
  function pushSide(i0, i1, arc0, arc1) {
    const a = poly[i0], b = poly[i1];
    const ex = b.x - a.x, ez = b.y - a.y;
    const el = Math.hypot(ex, ez);
    if (el < 1e-7) return;
    // outward normal: perpendicular of the directed edge, on the exterior side
    let nx, nz;
    if (ccw) { nx = ez / el; nz = -ex / el; }
    else { nx = -ez / el; nz = ex / el; }
    // two triangles of the quad, wound so their geometric normal matches (nx,0,nz)
    const A = [a.x, 0, a.y], B = [b.x, 0, b.y];
    const A2 = [a.x, thickness, a.y], B2 = [b.x, thickness, b.y];
    const quad = [A, B, B2, A, B2, A2];
    // check winding of first tri: (B-A) x (B2-A) should align with (nx,0,nz)
    const w1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
    const w2 = [B2[0] - A[0], B2[1] - A[1], B2[2] - A[2]];
    const cx = w1[1] * w2[2] - w1[2] * w2[1];
    const cz = w1[0] * w2[1] - w1[1] * w2[0];
    let order = quad;
    if (cx * nx + cz * nz < 0) order = [A, B2, B, A, A2, B2];
    const uvA0 = arc0, uvA1 = arc1;
    const uvY = (p) => p[1] / thickness;
    const uvX = (p) => (p === A || p === A2 ? uvA0 : uvA1);
    for (const p of order) {
      positions.push(p[0], p[1], p[2]);
      normals.push(nx, 0, nz);
      uvs.push(uvX(p), uvY(p));
    }
  }

  // cut faces (group 2 comes after factory group 1 in draw order; collect separately)
  const factoryIdx = [];
  const cutIdx = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (i < cutEdges) cutIdx.push([i, j]);
    else factoryIdx.push([i, j]);
  }

  let arc = 0;
  for (const [i, j] of factoryIdx) {
    const l = Math.hypot(poly[j].x - poly[i].x, poly[j].y - poly[i].y);
    pushSide(i, j, arc * 2.0, (arc + l) * 2.0);
    arc += l;
  }
  if (positions.length / 3 > start) {
    groups.push({ start, count: positions.length / 3 - start, mat: 1 });
    start = positions.length / 3;
  }

  arc = 0;
  for (const [i, j] of cutIdx) {
    const l = Math.hypot(poly[j].x - poly[i].x, poly[j].y - poly[i].y);
    pushSide(i, j, arc * 3.0, (arc + l) * 3.0);
    arc += l;
  }
  if (positions.length / 3 > start) {
    groups.push({ start, count: positions.length / 3 - start, mat: 2 });
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  for (const g of groups) geo.addGroup(g.start, g.count, g.mat);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

// Diagnostic: verify a piece geometry is a closed manifold with sane triangles
// and correctly oriented top/bottom faces. Returns a report object.
export function validatePieceGeometry(geo, thickness) {
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const triCount = pos.count / 3;
  const edgeMap = new Map();
  let degenerate = 0;
  let badTop = 0, badBottom = 0;
  const key = (x, y, z) => `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;

  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), cr = new THREE.Vector3();
  for (let t = 0; t < triCount; t++) {
    va.fromBufferAttribute(pos, t * 3);
    vb.fromBufferAttribute(pos, t * 3 + 1);
    vc.fromBufferAttribute(pos, t * 3 + 2);
    e1.subVectors(vb, va); e2.subVectors(vc, va); cr.crossVectors(e1, e2);
    const area2 = cr.length();
    if (area2 < 1e-10) {
      degenerate++;
    } else {
      cr.normalize();
      const ny = nrm.getY(t * 3);
      if (Math.abs(ny) > 0.9) {
        // top/bottom face: geometric normal must match the stored one
        if (cr.y * ny < 0.9) { if (ny > 0) badTop++; else badBottom++; }
      }
    }
    const ka = key(va.x, va.y, va.z), kb = key(vb.x, vb.y, vb.z), kc = key(vc.x, vc.y, vc.z);
    for (const [k1, k2] of [[ka, kb], [kb, kc], [kc, ka]]) {
      const ek = k1 < k2 ? k1 + '|' + k2 : k2 + '|' + k1;
      edgeMap.set(ek, (edgeMap.get(ek) || 0) + 1);
    }
  }
  let openEdges = 0, overSharedEdges = 0;
  for (const c of edgeMap.values()) {
    if (c === 1) openEdges++;
    else if (c > 2) overSharedEdges++;
  }
  return { triCount, degenerate, badTop, badBottom, openEdges, overSharedEdges };
}

export { polygonArea, polygonCentroid };
