import * as THREE from 'three';
import { TAU } from '../core/rng';
import type { Materials } from './Materials';

/**
 * Real patisserie tools, built to size: a star nozzle you could pipe with, a
 * palette knife with a spring in it, a slicing knife that is a wedge in section,
 * and a server with a triangular blade. Nothing here is a toy shape.
 */

type Edge = (u: number) => number;

/**
 * A blade as a true wedge: a flat spine at full thickness narrowing to a single
 * line at the cutting edge. This is what makes steel read as steel when the
 * light runs along it.
 */
export function bladeGeometry(
  length: number,
  thickness: number,
  spine: Edge,
  edge: Edge,
  segments = 48,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const half = thickness / 2;
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const x = u * length;
    pos.push(x, spine(u), half);
    pos.push(x, spine(u), -half);
    pos.push(x, edge(u), 0);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 3;
    const b = (i + 1) * 3;
    idx.push(a, b, b + 1, a, b + 1, a + 1); // spine face
    idx.push(a, a + 2, b + 2, a, b + 2, b); // front bevel
    idx.push(a + 1, b + 1, b + 2, a + 1, b + 2, a + 2); // back bevel
  }
  idx.push(0, 1, 2);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geom.setIndex(idx);
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
  return geom;
}

/** Six-point star tip, tapering to the coupler flange. */
export function starNozzleGeometry(
  mouth: number,
  top: number,
  height: number,
): THREE.BufferGeometry {
  const rings = 10;
  const around = 48;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const base = mouth + (top - mouth) * t;
    const star = 0.3 * (1 - t) ** 1.4;
    for (let a = 0; a <= around; a++) {
      const ang = (a / around) * TAU;
      const rad = base * (1 + star * Math.cos(6 * ang));
      pos.push(Math.cos(ang) * rad, t * height, Math.sin(ang) * rad);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let a = 0; a < around; a++) {
      const i0 = r * (around + 1) + a;
      const i1 = i0 + 1;
      const i2 = i0 + around + 1;
      const i3 = i2 + 1;
      idx.push(i0, i2, i3, i0, i3, i1);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geom.setIndex(idx);
  geom.computeVertexNormals();
  return geom;
}

function handle(materials: Materials, length: number, radius: number): THREE.Mesh {
  const geom = new THREE.CapsuleGeometry(radius, length, 6, 14);
  const mesh = new THREE.Mesh(geom, materials.steelDark);
  mesh.castShadow = true;
  return mesh;
}

/** Slicing knife: 22 cm blade, riveted handle. */
export function makeChefKnife(materials: Materials): THREE.Group {
  const g = new THREE.Group();
  const blade = new THREE.Mesh(
    bladeGeometry(
      0.22,
      0.0017,
      (u) => 0.018 * (1 - u ** 7),
      (u) => -0.001 - 0.017 * (1 - u ** 2.1),
    ),
    materials.steel,
  );
  blade.castShadow = true;
  g.add(blade);
  const h = handle(materials, 0.1, 0.0105);
  h.rotation.z = Math.PI / 2;
  h.position.set(-0.062, 0.004, 0);
  g.add(h);
  const bolster = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0108, 0.0108, 0.008, 16),
    materials.steel,
  );
  bolster.rotation.z = Math.PI / 2;
  bolster.position.set(-0.006, 0.004, 0);
  g.add(bolster);
  return g;
}

/** Palette knife: flexible, round ended, offset handle. */
export function makePaletteKnife(materials: Materials): THREE.Group {
  const g = new THREE.Group();
  const blade = new THREE.Mesh(
    bladeGeometry(
      0.105,
      0.0011,
      (u) => 0.011 * Math.sqrt(Math.max(0, 1 - Math.max(0, (u - 0.9) / 0.1) ** 2)),
      (u) => -0.011 * Math.sqrt(Math.max(0, 1 - Math.max(0, (u - 0.9) / 0.1) ** 2)),
    ),
    materials.steel,
  );
  blade.castShadow = true;
  g.add(blade);
  const h = handle(materials, 0.085, 0.0095);
  h.rotation.z = Math.PI / 2;
  h.position.set(-0.055, 0.004, 0);
  g.add(h);
  return g;
}

/** Cake server: triangular blade with a slight offset crank. */
export function makeServer(materials: Materials): THREE.Group {
  const g = new THREE.Group();
  const blade = new THREE.Mesh(
    bladeGeometry(
      0.115,
      0.0012,
      (u) => 0.028 * (1 - u) + 0.004,
      (u) => -0.028 * (1 - u) - 0.004,
      36,
    ),
    materials.steel,
  );
  blade.castShadow = true;
  g.add(blade);
  const h = handle(materials, 0.08, 0.0092);
  h.rotation.z = Math.PI / 2;
  h.position.set(-0.05, 0.012, 0);
  g.add(h);
  return g;
}

/** Piping bag: cloth cone, coupler, star tip. Tip sits at the group origin. */
export function makePipingBag(materials: Materials): { group: THREE.Group; tip: THREE.Object3D } {
  const g = new THREE.Group();
  const nozzle = new THREE.Mesh(starNozzleGeometry(0.0062, 0.0115, 0.026), materials.steel);
  nozzle.castShadow = true;
  g.add(nozzle);

  const cloth = new THREE.MeshStandardMaterial({
    color: 0xf1eee7,
    roughness: 0.92,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const bagProfile: THREE.Vector2[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    // Only the working end of the bag is in frame; the rest is out of shot.
    bagProfile.push(new THREE.Vector2(0.0118 + 0.020 * Math.pow(t, 1.25), 0.026 + t * 0.085));
  }
  const bag = new THREE.Mesh(new THREE.LatheGeometry(bagProfile, 28), cloth);
  bag.castShadow = true;
  g.add(bag);

  const tip = new THREE.Object3D();
  g.add(tip);
  return { group: g, tip };
}

/** Turntable: cast base, spun steel top. */
export function makeTurntable(materials: Materials): THREE.Group {
  const g = new THREE.Group();
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(0.135, 0.135, 0.006, 64),
    materials.steelTiled(9),
  );
  top.position.y = -0.003;
  top.receiveShadow = true;
  g.add(top);
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.028, 0.05, 0.05, 32),
    materials.steelDark,
  );
  stem.position.y = -0.031;
  g.add(stem);
  const foot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.078, 0.084, 0.012, 40),
    materials.steelDark,
  );
  foot.position.y = -0.062;
  foot.receiveShadow = true;
  g.add(foot);
  return g;
}

/** Dessert plate for the lifted slice. */
export function makePlate(materials: Materials): THREE.Mesh {
  const profile: THREE.Vector2[] = [];
  for (let i = 0; i <= 22; i++) {
    const t = i / 22;
    const r = 0.098 * t;
    const y = 0.0042 * Math.pow(t, 3.2) + (t > 0.86 ? (t - 0.86) * 0.052 : 0);
    profile.push(new THREE.Vector2(r, y));
  }
  for (let i = 22; i >= 0; i--) {
    const t = i / 22;
    profile.push(new THREE.Vector2(0.098 * t, -0.0022 + 0.0042 * Math.pow(t, 3.2)));
  }
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(profile, 56), materials.porcelain);
  mesh.receiveShadow = true;
  return mesh;
}

/** Mixing bowl for the mid ground. */
export function makeBowl(materials: Materials): THREE.Mesh {
  const profile: THREE.Vector2[] = [];
  for (let i = 0; i <= 18; i++) {
    const a = (i / 18) * (Math.PI * 0.52);
    profile.push(new THREE.Vector2(Math.sin(a) * 0.088, 0.088 - Math.cos(a) * 0.088));
  }
  profile.push(new THREE.Vector2(0.0905, 0.088));
  for (let i = 18; i >= 0; i--) {
    const a = (i / 18) * (Math.PI * 0.52);
    profile.push(new THREE.Vector2(Math.sin(a) * 0.0905, 0.0895 - Math.cos(a) * 0.0895));
  }
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(profile, 40), materials.steel);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
