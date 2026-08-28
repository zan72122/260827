import * as THREE from 'three';
import { makeContactShadow } from '../mat/textures';

/* Small geometry helpers shared by every machine. */

export type Profile = [number, number][]; // [radius, y]

export function lathe(profile: Profile, segments = 32, phiLength = Math.PI * 2) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-5), y));
  const g = new THREE.LatheGeometry(pts, segments, 0, phiLength);
  g.computeVertexNormals();
  return g;
}

/**
 * A genuinely hollow turning: the profile climbs the outside, crosses the
 * rim and comes back down the inside, so a section cut shows a real wall
 * thickness and a real cavity - not a shell with a painted hole.
 */
export function hollowLathe(outer: Profile, inner: Profile, segments = 32) {
  const pts: THREE.Vector2[] = [];
  for (const [r, y] of outer) pts.push(new THREE.Vector2(Math.max(r, 1e-5), y));
  for (let i = inner.length - 1; i >= 0; i--)
    pts.push(new THREE.Vector2(Math.max(inner[i][0], 1e-5), inner[i][1]));
  const g = new THREE.LatheGeometry(pts, segments);
  g.computeVertexNormals();
  return g;
}

/**
 * Re-project UVs onto a box-shaped geometry, face by face.  ExtrudeGeometry
 * hands out raw world coordinates, which stretches a grain texture into
 * blobs; this gives every face a clean 0..1 span in its own two axes.
 */
export function boxUV(geo: THREE.BufferGeometry, w: number, h: number, d: number) {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nor = geo.getAttribute('normal') as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    let u: number, v: number;
    if (nz >= nx && nz >= ny) { u = x / w + 0.5; v = y / h + 0.5; }
    else if (nx >= ny) { u = z / d + 0.5; v = y / h + 0.5; }
    else { u = x / w + 0.5; v = z / d + 0.5; }
    uv[i * 2] = u; uv[i * 2 + 1] = v;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

export function bevelBox(w: number, h: number, d: number, bevel = 0.0015, seg = 1) {
  const shape = new THREE.Shape();
  const x = w / 2 - bevel, y = h / 2 - bevel;
  shape.moveTo(-x, -y); shape.lineTo(x, -y); shape.lineTo(x, y); shape.lineTo(-x, y);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: d - bevel * 2, bevelEnabled: true, bevelThickness: bevel,
    bevelSize: bevel, bevelSegments: seg, curveSegments: 1,
  });
  g.translate(0, 0, -(d - bevel * 2) / 2);
  g.computeVertexNormals();
  boxUV(g, w, h, d);
  return g;
}

let shadowTex: THREE.Texture | null = null;
/** Soft dark blob so a part reads as sitting on the bench, not hovering. */
export function contactShadow(radius: number, opacity = 0.5) {
  if (!shadowTex) shadowTex = makeContactShadow();
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2),
    new THREE.MeshBasicMaterial({
      map: shadowTex, transparent: true, opacity, depthWrite: false,
      color: 0x000000, blending: THREE.NormalBlending,
    }),
  );
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 2;
  return m;
}

/** Wide, forgiving pick target. Invisible but raycastable. */
export function hitProxy(radius: number, name: string) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 8, 6),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  m.name = name;
  m.userData.hit = name;
  return m;
}

export function hitBox(w: number, h: number, d: number, name: string) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  m.name = name;
  m.userData.hit = name;
  return m;
}

export function setShadow(o: THREE.Object3D, cast: boolean, receive: boolean) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh) { m.castShadow = cast; m.receiveShadow = receive; }
  });
  return o;
}

/** A curved, tapered vane blade with real thickness. */
export function vaneGeometry(len: number, wid: number, thick: number, curve = 0.16) {
  const segsU = 8, segsV = 3;
  const g = new THREE.BufferGeometry();
  const pos: number[] = [], idx: number[] = [], uv: number[] = [];
  const rows = segsV + 1, cols = segsU + 1;
  for (let side = 0; side < 2; side++) {
    const s = side === 0 ? 1 : -1;
    for (let j = 0; j < rows; j++) {
      const v = j / segsV;
      for (let i = 0; i < cols; i++) {
        const u = i / segsU;
        const taper = 1 - u * 0.22;
        const x = u * len;
        const y = (v - 0.5) * wid * taper;
        // the blade dishes slightly along its length: that is what catches air
        const z = s * thick * 0.5 + Math.sin(u * Math.PI) * curve * wid * 0.5 * (v - 0.5) * 2 * 0.5;
        pos.push(x, y, z);
        uv.push(u, v);
      }
    }
  }
  const quad = (a: number, b: number, c: number, d: number) => idx.push(a, b, c, a, c, d);
  for (let side = 0; side < 2; side++) {
    const off = side * rows * cols;
    for (let j = 0; j < segsV; j++)
      for (let i = 0; i < segsU; i++) {
        const a = off + j * cols + i, b = a + 1, c = a + cols + 1, d = a + cols;
        if (side === 0) quad(a, b, c, d); else quad(a, d, c, b);
      }
  }
  // close the rim so the blade has an edge you can see end grain on
  for (let i = 0; i < segsU; i++) {
    const t0 = i, t1 = i + 1;
    const b0 = rows * cols + i, b1 = rows * cols + i + 1;
    quad(t0, b0, b1, t1);
    const t0b = (rows - 1) * cols + i, t1b = t0b + 1;
    const b0b = rows * cols + (rows - 1) * cols + i, b1b = b0b + 1;
    quad(t1b, b1b, b0b, t0b);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
