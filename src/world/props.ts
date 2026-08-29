/** Small reusable pieces of yard hardware. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32, range } from '../core/rand';
import type { Materials } from './materials';

export function box(w: number, h: number, d: number, x = 0, y = 0, z = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

export function tube(
  r: number,
  len: number,
  seg: number,
  axis: 'x' | 'y' | 'z',
  x = 0,
  y = 0,
  z = 0,
  rTop = r,
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, r, len, seg, 1, false);
  if (axis === 'x') g.rotateZ(-Math.PI / 2);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

// The detail that says a thing was assembled rather than modelled.
/** A ring of hex bolt heads in the YZ plane at `x`. */
export function boltRing(
  radius: number,
  count: number,
  head: number,
  x: number,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const g = new THREE.CylinderGeometry(head, head, head * 0.9, 6);
    g.rotateZ(-Math.PI / 2);
    g.translate(x, Math.cos(a) * radius, Math.sin(a) * radius);
    parts.push(g);
  }
  return mergeGeometries(parts, false)!;
}

export function boltRow(
  count: number,
  head: number,
  from: THREE.Vector3,
  to: THREE.Vector3,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const p = from.clone().lerp(to, t);
    const g = new THREE.CylinderGeometry(head, head, head * 0.9, 6);
    g.rotateX(Math.PI / 2);
    g.translate(p.x, p.y, p.z);
    parts.push(g);
  }
  return mergeGeometries(parts, false)!;
}

/** Weld bead: a slightly lumpy ring where two rolled panels meet. */
export function weldRing(radius: number, x: number, bead = 0.016): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(radius, bead, 5, 44);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const k = 1 + Math.sin(i * 2.7) * 0.16;
    pos.setXYZ(i, pos.getX(i) * 1, pos.getY(i) * 1, pos.getZ(i) * k);
  }
  g.rotateY(Math.PI / 2);
  g.translate(x, 0, 0);
  g.computeVertexNormals();
  return g;
}

/** A yard worker: no face, correct proportions, there to give the tree a scale. */
export function makeWorker(mats: Materials, seed: number): THREE.Group {
  const rng = mulberry32(seed);
  const g = new THREE.Group();
  const h = range(rng, 1.68, 1.79);
  const jacket = new THREE.MeshStandardMaterial({
    color: rng() < 0.5 ? 0x2f4a5c : 0x3d4a3a,
    roughness: 0.9,
    metalness: 0,
  });
  const hiVis = new THREE.MeshStandardMaterial({ color: 0xc8c23a, roughness: 0.85, metalness: 0 });

  const legs = mergeGeometries(
    [
      tube(0.075, h * 0.28, 8, 'y', -0.085, h * 0.14, 0, 0.06),
      tube(0.075, h * 0.28, 8, 'y', 0.085, h * 0.14, 0, 0.06),
      tube(0.085, h * 0.18, 8, 'y', -0.085, h * 0.37, 0, 0.078),
      tube(0.085, h * 0.18, 8, 'y', 0.085, h * 0.37, 0, 0.078),
    ],
    false,
  )!;
  const legMesh = new THREE.Mesh(legs, mats.cloth);
  legMesh.castShadow = true;
  g.add(legMesh);

  const boots = new THREE.Mesh(
    mergeGeometries([box(0.11, 0.09, 0.24, -0.085, 0.045, 0.02), box(0.11, 0.09, 0.24, 0.085, 0.045, 0.02)], false)!,
    mats.darkSteel,
  );
  g.add(boots);

  const torso = new THREE.Mesh(
    mergeGeometries(
      [
        tube(0.19, h * 0.3, 10, 'y', 0, h * 0.61, 0, 0.175),
        tube(0.062, h * 0.28, 7, 'y', -0.2, h * 0.62, 0, 0.055),
        tube(0.062, h * 0.28, 7, 'y', 0.2, h * 0.62, 0, 0.055),
      ],
      false,
    )!,
    jacket,
  );
  torso.castShadow = true;
  g.add(torso);

  const vest = new THREE.Mesh(tube(0.196, h * 0.09, 12, 'y', 0, h * 0.66, 0, 0.19), hiVis);
  g.add(vest);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.096, 12, 10), mats.skin);
  head.position.y = h * 0.84;
  head.castShadow = true;
  g.add(head);
  const hat = new THREE.Mesh(new THREE.SphereGeometry(0.104, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), jacket);
  hat.position.y = h * 0.845;
  g.add(hat);

  g.rotation.y = range(rng, -Math.PI, Math.PI);
  return g;
}

/**
 * Background conifer: layered skirts, dark and unfussy. These live at 15 m+ and
 * exist to build silhouette density, so they are instanced, not rigged.
 */
export function makeFarConiferGeometry(seed: number): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  const layers = 13;
  const parts: THREE.BufferGeometry[] = [];
  const height = 5.4;
  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1);
    const y = 0.75 + t * (height - 1.1);
    const r = (1 - t) ** 0.72 * 1.3 + 0.1;
    const c = new THREE.ConeGeometry(r * range(rng, 0.8, 1.15), 0.95 - t * 0.4, 8, 1, true);
    // each skirt sags and leans a little; nothing is a clean cone
    const cp = c.attributes.position as THREE.BufferAttribute;
    for (let v = 0; v < cp.count; v++) {
      const py = cp.getY(v);
      if (py < 0) cp.setY(v, py - r * 0.22 * range(rng, 0.6, 1.4));
    }
    c.rotateZ(range(rng, -0.05, 0.05));
    c.translate(range(rng, -0.1, 0.1), y, range(rng, -0.1, 0.1));
    parts.push(c);
  }
  parts.push(tube(0.09, 1.3, 6, 'y', 0, 0.65, 0, 0.06));
  const g = mergeGeometries(parts, false)!;
  const pos = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const shade = 0.5 + (y / height) * 0.62 + (i % 11) * 0.008;
    col[i * 3] = 0.66 * shade;
    col[i * 3 + 1] = shade;
    col[i * 3 + 2] = 0.74 * shade;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** A finished bale: what the tree becomes. Stacked on the truck as cargo. */
export function makeBaleGeometry(len: number, seed: number): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  const seg = 14;
  const g = new THREE.CylinderGeometry(0.13, 0.3, len, 10, seg, false);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k = 1 + Math.sin(v.y * 9 + rng() * 0.4) * 0.05;
    v.x *= k;
    v.z *= k;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.rotateZ(Math.PI / 2);
  g.computeVertexNormals();
  return g;
}
