import * as THREE from 'three';
import { Rng } from '../core/rng';

/** Box beam with a real section, used for machine frames and gantries. */
export function beam(
  len: number,
  w: number,
  h: number,
  mat: THREE.Material,
  cast = true,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(len, h, w), mat);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

/** Hex-head bolts around a flange; the small stuff that makes steel read as built. */
export function boltRing(
  radius: number,
  count: number,
  mat: THREE.Material,
  size = 0.016,
): THREE.InstancedMesh {
  const geo = new THREE.CylinderGeometry(size, size, size * 0.7, 6);
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    p.set(Math.cos(a) * radius, 0, Math.sin(a) * radius);
    q.setFromEuler(new THREE.Euler(0, a, 0));
    mesh.setMatrixAt(i, m.compose(p, q, s));
  }
  mesh.castShadow = false;
  return mesh;
}

/** Bolts along a straight line (base plates, splice plates). */
export function boltRow(count: number, spacing: number, mat: THREE.Material, size = 0.014): THREE.InstancedMesh {
  const geo = new THREE.CylinderGeometry(size, size, size * 0.8, 6);
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < count; i++) {
    p.set((i - (count - 1) / 2) * spacing, 0, 0);
    mesh.setMatrixAt(i, m.compose(p, q, s));
  }
  mesh.castShadow = false;
  return mesh;
}

/** Weld bead running around a seam. */
export function weldRing(radius: number, mat: THREE.Material, tube = 0.009): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 4, 26), mat);
  m.castShadow = false;
  return m;
}

/** Truck / trailer wheel: rubber tyre, steel rim, a little road dirt. */
export function wheel(radius: number, width: number, tyre: THREE.Material, rim: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const t = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 18, 1), tyre);
  t.rotation.x = Math.PI / 2;
  t.castShadow = true;
  g.add(t);
  const r = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.56, radius * 0.56, width * 1.04, 14), rim);
  r.rotation.x = Math.PI / 2;
  g.add(r);
  const hub = boltRing(radius * 0.34, 8, rim, 0.018);
  hub.rotation.x = Math.PI / 2;
  hub.position.z = width * 0.53;
  g.add(hub);
  return g;
}

/** Corrugated sheet roof built from real ribs rather than a flat plane. */
export function corrugatedSlab(
  width: number,
  depth: number,
  mat: THREE.Material,
  ribs = 22,
): THREE.Group {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(width, 0.03, depth), mat);
  base.castShadow = true;
  base.receiveShadow = true;
  g.add(base);
  const ribGeo = new THREE.BoxGeometry(width * 0.995, 0.035, depth / ribs / 2.4);
  const inst = new THREE.InstancedMesh(ribGeo, mat, ribs);
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < ribs; i++) {
    p.set(0, 0.028, (i / (ribs - 1) - 0.5) * depth * 0.98);
    inst.setMatrixAt(i, m.compose(p, q, s));
  }
  inst.castShadow = false;
  g.add(inst);
  return g;
}

/** Loose stones and litter scattered by traffic, not by uniform noise. */
export function scatterStones(
  count: number,
  mat: THREE.Material,
  seed: number,
  place: (rng: Rng, out: THREE.Vector3) => number,
): THREE.InstancedMesh {
  const geo = new THREE.DodecahedronGeometry(1, 0);
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const rng = new Rng(seed);
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const scale = place(rng, p);
    q.setFromEuler(new THREE.Euler(rng.range(0, 6.3), rng.range(0, 6.3), rng.range(0, 6.3)));
    s.set(scale, scale * rng.range(0.4, 0.7), scale * rng.range(0.7, 1.2));
    mesh.setMatrixAt(i, m.compose(p, q, s));
  }
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}
