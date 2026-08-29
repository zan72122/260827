/** Reusable geometry for the hero tree: wood segments and needle sprays. */
import * as THREE from 'three';
import { mulberry32, range } from '../core/rand';

/**
 * Unit branch/twig: a tapered, slightly irregular tube running along +X from
 * x=0 to x=1 with radius 1 at the base and `tipRatio` at the tip. Instances
 * scale it to length and radius, so every branch shares one draw call.
 */
export function makeWoodGeometry(radial: number, tipRatio = 0.58): THREE.BufferGeometry {
  const rows = 3;
  const rng = mulberry32(4711);
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const bulge: number[] = [];
  for (let i = 0; i <= radial; i++) bulge.push(1 + (rng() - 0.5) * 0.16);
  bulge[radial] = bulge[0];

  for (let r = 0; r <= rows; r++) {
    const t = r / rows;
    const rad = (1 - t) + tipRatio * t;
    for (let i = 0; i <= radial; i++) {
      const a = (i / radial) * Math.PI * 2;
      const wob = bulge[i] * (1 + Math.sin(t * 7.3 + i) * 0.035);
      const y = Math.cos(a) * rad * wob;
      const z = Math.sin(a) * rad * wob;
      pos.push(t, y, z);
      // X is left at zero on purpose: instance matrices carry a strong
      // non-uniform scale (length vs radius) and three.js applies it straight
      // to the normal, so a purely radial normal is the one that survives it.
      nor.push(0, Math.cos(a), Math.sin(a));
      uv.push(i / radial, t);
    }
  }
  const stride = radial + 1;
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < radial; i++) {
      const a = r * stride + i;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/**
 * One needle spray: real blade geometry, not a billboard. Needles leave a short
 * rachis in a flattened fan, all pointing the same way along +X, so a branch
 * built from many sprays reads as one continuous, non-symmetric frond.
 */
export function makeTuftGeometry(needles: number, seed: number): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const rachis = 0.115;
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tmpN = new THREE.Vector3();

  for (let i = 0; i < needles; i++) {
    const t = i / (needles - 1);
    const base = new THREE.Vector3(t * rachis, 0, 0);
    // alternate sides, fan flattened around the spray plane
    const side = i % 2 === 0 ? 1 : -1;
    const roll = side * range(rng, 0.55, 1.32) + (rng() - 0.5) * 0.5;
    const sweep = range(rng, 0.62, 1.15) * (1 - t * 0.35); // needles lie back toward the tip
    const len = range(rng, 0.052, 0.094) * (1 - t * 0.28);
    const dir = new THREE.Vector3(Math.cos(sweep), Math.sin(sweep) * Math.cos(roll), Math.sin(sweep) * Math.sin(roll)).normalize();
    const upRef = Math.abs(dir.y) > 0.9 ? tmpA.set(1, 0, 0) : tmpA.set(0, 1, 0);
    const sideVec = tmpB.copy(dir).cross(upRef).normalize().multiplyScalar(0.0055);
    const tip = base.clone().addScaledVector(dir, len);
    // gentle droop toward the tip
    tip.y -= len * range(rng, 0.05, 0.22);
    tmpN.copy(dir).cross(sideVec).normalize();

    const v0 = base.clone().add(sideVec);
    const v1 = base.clone().sub(sideVec);
    const v2 = tip.clone().addScaledVector(sideVec, 0.34);
    const v3 = tip.clone().addScaledVector(sideVec, -0.34);
    const start = pos.length / 3;
    for (const v of [v0, v1, v2, v3]) {
      pos.push(v.x, v.y, v.z);
      // shading normal blends the blade face with the outward direction of the spray
      const n = new THREE.Vector3(dir.x * 0.25 + tmpN.x, dir.y * 0.25 + tmpN.y, dir.z * 0.25 + tmpN.z).normalize();
      nor.push(n.x, n.y, n.z);
    }
    // dark, waxy at the base -> lighter and cooler at the tip
    const shade = 0.78 + rng() * 0.3;
    const baseC = new THREE.Color(0.026 * shade, 0.062 * shade, 0.031 * shade);
    const tipC = new THREE.Color(0.062 * shade, 0.138 * shade, 0.062 * shade);
    col.push(baseC.r, baseC.g, baseC.b, baseC.r, baseC.g, baseC.b);
    col.push(tipC.r, tipC.g, tipC.b, tipC.r, tipC.g, tipC.b);
    idx.push(start, start + 2, start + 1, start + 1, start + 2, start + 3);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Trunk section with bark UVs continuous along the whole trunk. */
export function makeTrunkSection(
  r0: number,
  r1: number,
  len: number,
  radial: number,
  v0: number,
  v1: number,
  seed: number,
): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  const rows = 3;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const wob: number[] = [];
  for (let i = 0; i <= radial; i++) wob.push(1 + (rng() - 0.5) * 0.085);
  wob[radial] = wob[0];

  for (let r = 0; r <= rows; r++) {
    const t = r / rows;
    const rad = r0 + (r1 - r0) * t;
    for (let i = 0; i <= radial; i++) {
      const a = (i / radial) * Math.PI * 2;
      const k = wob[i] * (1 + Math.sin(t * 5.1 + i * 1.7) * 0.03);
      pos.push(Math.cos(a) * rad * k, t * len, Math.sin(a) * rad * k);
      nor.push(Math.cos(a), (r0 - r1) / len, Math.sin(a));
      uv.push(i / radial, v0 + (v1 - v0) * t);
    }
  }
  const stride = radial + 1;
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < radial; i++) {
      const a = r * stride + i;
      idx.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
