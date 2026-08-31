import * as THREE from 'three';
import { CAKE_TOP } from './CakeSurfaceContact';
import type { CakeSurfaceContact } from './CakeSurfaceContact';
import { makeRng, clamp } from '../util/math';

/**
 * Three strawberries, no two alike, parked near the rim so the middle of the
 * cake stays free for piping. Deep red, matte-ish skin with seed pits — never
 * emissive.
 */
export function buildStrawberries(contact: CakeSurfaceContact): THREE.Group {
  const group = new THREE.Group();
  const skin = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.455, 0.055, 0.062),
    roughness: 0.38,
    metalness: 0,
    clearcoat: 0.35,
    clearcoatRoughness: 0.38,
    sheen: 0.15,
    sheenColor: new THREE.Color(0.7, 0.25, 0.22),
    vertexColors: true,
  });
  const leaf = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.20, 0.30, 0.13),
    roughness: 0.74,
    metalness: 0,
    side: THREE.DoubleSide,
  });

  const layout = [
    { a: 0.62, r: 0.0505, s: 1.0, seed: 11 },
    { a: 2.55, r: 0.0555, s: 0.86, seed: 27 },
    { a: 4.55, r: 0.0480, s: 1.12, seed: 43 },
  ];

  for (const it of layout) {
    const rng = makeRng(it.seed);
    const h = 0.0225 * it.s * (0.92 + rng() * 0.2);
    const rad = 0.0112 * it.s * (0.92 + rng() * 0.18);
    const segs = 26;
    const rows = 20;
    const g = new THREE.BufferGeometry();
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const lean = (rng() - 0.5) * 0.5;
    const squash = 0.86 + rng() * 0.3;
    for (let j = 0; j <= rows; j++) {
      const v = j / rows;
      // strawberry silhouette: broad shoulders, tapered tip
      const prof = Math.pow(Math.sin(Math.pow(v, 0.78) * Math.PI * 0.94), 0.62);
      const y = h * (1 - v);
      for (let i = 0; i <= segs; i++) {
        const th = (i / segs) * Math.PI * 2;
        const lobes = 1 + Math.sin(th * 3 + it.seed) * 0.035 + Math.sin(th * 7) * 0.018;
        // seed pits, real geometry not just shading
        const pit = Math.sin(th * 11 + v * 34) * Math.sin(v * 27) ;
        const pitD = clamp(pit, 0, 1) * 0.00028;
        const r = rad * prof * lobes * (1 - pitD / rad) * (i % 2 === 0 ? 1 : 1);
        const x = Math.cos(th) * r * squash + lean * y;
        const z = Math.sin(th) * r;
        pos.push(x, y - pitD * 0.4, z);
        const seedTint = clamp(pit, 0, 1);
        col.push(1 - seedTint * 0.18, 1 + seedTint * 0.22, 1 - seedTint * 0.25);
      }
    }
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < segs; i++) {
        const a = j * (segs + 1) + i;
        const b = a + 1;
        const c = (j + 1) * (segs + 1) + i + 1;
        const d = (j + 1) * (segs + 1) + i;
        idx.push(a, b, c, a, c, d);
      }
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();

    const berry = new THREE.Mesh(g, skin);
    berry.castShadow = true;
    berry.receiveShadow = true;

    const holder = new THREE.Group();
    const x = Math.cos(it.a) * it.r;
    const z = Math.sin(it.a) * it.r;
    holder.position.set(x, contact.surfaceY(x, z) - 0.0012, z);
    holder.rotation.y = rng() * Math.PI * 2;
    holder.rotation.z = (rng() - 0.5) * 0.22;
    holder.add(berry);

    // calyx: a few small leaves, not a fan disc
    const nLeaf = 5 + Math.floor(rng() * 2);
    for (let k = 0; k < nLeaf; k++) {
      const lg = new THREE.BufferGeometry();
      const len = rad * (1.25 + rng() * 0.6);
      const wid = rad * 0.34;
      const lp: number[] = [];
      const li: number[] = [];
      const steps = 5;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const w = wid * Math.sin(Math.PI * Math.pow(t, 0.7)) * (1 - t * 0.4);
        const droop = -Math.pow(t, 2) * len * 0.28;
        lp.push(-w, droop, t * len);
        lp.push(w, droop, t * len);
      }
      for (let s = 0; s < steps; s++) {
        const a = s * 2;
        li.push(a, a + 1, a + 3, a, a + 3, a + 2);
      }
      lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
      lg.setIndex(li);
      lg.computeVertexNormals();
      const lm = new THREE.Mesh(lg, leaf);
      lm.position.y = h * 0.985;
      lm.rotation.y = (k / nLeaf) * Math.PI * 2 + rng() * 0.4;
      lm.rotation.x = -0.5 - rng() * 0.35;
      lm.castShadow = true;
      holder.add(lm);
    }

    group.add(holder);
    // the cake knows the berries are there, so cream can be piped onto them
    contact.addDeposit(x, z, rad * 1.15, h * 0.82 + (CAKE_TOP - contact.surfaceY(x, z)));
  }

  return group;
}
