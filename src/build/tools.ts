import * as THREE from 'three';
import { DIM, mm } from '../core/units';
import { TAU, lerp, makeRandom } from '../util/math';
import { circleRing, loft, mergeAll, orientOutward, revolve, roundedBox } from './geometry';
import type { Materials } from '../render/materials';
import type { CreamColorId } from '../core/FlowerRecord';

/**
 * The hand tools. All of them are thin pressed steel, so they are built as
 * surfaces with a real wall rather than as solid blocks: you can see the edge
 * of the sheet on the scraper, the lifter and the nail's disc.
 */

/** Flower nail: a small steel disc on a shaft, held in the left hand. */
export function buildFlowerNail(materials: Materials): THREE.Group {
  const g = new THREE.Group();
  g.name = 'flowerNail';

  const R = DIM.nailDiscRadius;
  const T = DIM.nailDiscThickness;
  const bevel = mm(0.35);
  const profile = [
    new THREE.Vector2(0.00001, 0),
    new THREE.Vector2(R - bevel, 0),
    new THREE.Vector2(R, bevel),
    new THREE.Vector2(R, T - bevel),
    new THREE.Vector2(R - bevel, T),
    new THREE.Vector2(0.00001, T),
  ];
  const disc = new THREE.Mesh(orientOutward(revolve(profile, 72, {})), materials.steel);
  disc.castShadow = true;
  disc.receiveShadow = true;
  g.add(disc);

  // Shaft, tapering to a blunt point, welded under the disc.
  const shaftRings: THREE.Vector3[][] = [];
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = -t * DIM.nailShaftLength;
    let r = lerp(DIM.nailShaftRadius, DIM.nailShaftRadius * 0.62, t);
    if (t < 0.06) r = lerp(DIM.nailShaftRadius * 2.4, DIM.nailShaftRadius, t / 0.06);
    if (t > 0.965) r *= Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.965) / 0.035, 2)));
    shaftRings.push(circleRing(Math.max(r, 0.00004), y, 20));
  }
  const shaft = new THREE.Mesh(
    orientOutward(loft(shaftRings, { capStart: true, capEnd: true })),
    materials.steelDark,
  );
  shaft.castShadow = true;
  g.add(shaft);
  return g;
}

/** A cut square of parchment, with the curl a cut square actually has. */
export function buildPaperSquare(materials: Materials): THREE.Mesh {
  const h = DIM.paperHalf;
  const t = DIM.paperThickness;
  const n = 12;
  const rnd = makeRandom(3311);
  // Scissor-cut edges are never quite straight.
  const edgeJitter = (u: number) => (Math.sin(u * 13.7) * 0.3 + Math.sin(u * 31.1) * 0.15) * mm(0.4);

  const height = (x: number, z: number) => {
    const nx = x / h;
    const nz = z / h;
    return (
      mm(0.9) * (nx * nx * 0.55 + nz * nz * 0.75) +
      mm(0.35) * Math.sin(nx * 2.1 + 0.6) * Math.cos(nz * 1.7)
    );
  };

  const top: number[] = [];
  const bottom: number[] = [];
  const uv: number[] = [];
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const v = j / n;
      let x = lerp(-h, h, u);
      let z = lerp(-h, h, v);
      if (i === 0 || i === n) x += (i === 0 ? 1 : -1) * edgeJitter(v);
      if (j === 0 || j === n) z += (j === 0 ? 1 : -1) * edgeJitter(u);
      const y = height(x, z) + (rnd() - 0.5) * mm(0.05);
      top.push(x, y + t / 2, z);
      bottom.push(x, y - t / 2, z);
      uv.push(u, v);
    }
  }

  const positions: number[] = [...top, ...bottom];
  const uvs: number[] = [...uv, ...uv];
  const index: number[] = [];
  const topAt = (i: number, j: number) => j * (n + 1) + i;
  const botAt = (i: number, j: number) => (n + 1) * (n + 1) + j * (n + 1) + i;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = topAt(i, j), b = topAt(i + 1, j), c = topAt(i + 1, j + 1), d = topAt(i, j + 1);
      index.push(a, c, b, a, d, c);
      const e = botAt(i, j), f = botAt(i + 1, j), gg = botAt(i + 1, j + 1), hh = botAt(i, j + 1);
      index.push(e, f, gg, e, gg, hh);
    }
  }
  // Skirt around the four edges so the sheet has a visible thickness.
  const edge: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) edge.push([i, 0]);
  for (let j = 0; j < n; j++) edge.push([n, j]);
  for (let i = n; i > 0; i--) edge.push([i, n]);
  for (let j = n; j > 0; j--) edge.push([0, j]);
  for (let k = 0; k < edge.length; k++) {
    const [i0, j0] = edge[k];
    const [i1, j1] = edge[(k + 1) % edge.length];
    const a = topAt(i0, j0), b = topAt(i1, j1);
    const c = botAt(i1, j1), d = botAt(i0, j0);
    index.push(a, b, c, a, c, d);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, materials.paper);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'paperSquare';
  return mesh;
}

/**
 * The piping bag. Local frame: the coupler sits at the origin and the bag runs
 * up +Y, so it can simply be parented to the back of the tip.
 */
export function buildPipingBag(materials: Materials, color: CreamColorId): THREE.Group {
  const g = new THREE.Group();
  g.name = 'pipingBag';

  const profile: Array<[number, number]> = [
    [0.0105, 0.0], [0.0135, 0.014], [0.0215, 0.046], [0.0295, 0.086],
    [0.0335, 0.128], [0.0330, 0.172], [0.0262, 0.212], [0.0296, 0.244],
    [0.0150, 0.286], [0.0072, 0.302], [0.0038, 0.316],
  ];
  const seg = 30;
  const rings: THREE.Vector3[][] = [];
  for (const [r, y] of profile) {
    // The hand's grip flattens the bag through the middle; the gathered top is
    // twisted rather than round.
    const grip = Math.exp(-Math.pow((y - 0.205) / 0.05, 2));
    const twist = Math.max(0, (y - 0.27) / 0.05);
    const ring: THREE.Vector3[] = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * TAU;
      const squash = 1 - 0.22 * grip * Math.abs(Math.cos(a));
      const flute = 1 + 0.16 * twist * Math.sin(a * 6 + y * 40);
      const rr = r * squash * flute;
      ring.push(new THREE.Vector3(Math.cos(a) * rr, y, Math.sin(a) * rr));
    }
    rings.push(ring);
  }
  const bag = new THREE.Mesh(orientOutward(loft(rings, { capEnd: true })), materials.bagFabric);
  bag.castShadow = true;
  g.add(bag);

  // Cream sitting inside the bag, seen dimly through the fabric.
  const fillRings: THREE.Vector3[][] = [];
  for (const [r, y] of profile) {
    if (y > 0.25) break;
    fillRings.push(circleRing(Math.max(r - 0.0016, 0.0004), y, 20));
  }
  const fill = new THREE.Mesh(loft(fillRings, { capStart: true, capEnd: true }), materials.cream[color]);
  fill.name = 'bagFill';
  g.add(fill);

  return g;
}

/** Straight-sided bench scraper for evening the side of the cake. */
export function buildScraper(materials: Materials): THREE.Group {
  const g = new THREE.Group();
  g.name = 'scraper';
  // Satin stainless rather than a mirror, which is what a working bench
  // scraper actually is.
  const blade = new THREE.Mesh(roundedBox(mm(102), mm(76), mm(0.9), mm(0.4), 10), materials.brushedAlloy);
  blade.position.set(0, mm(38), 0);
  blade.castShadow = true;
  blade.receiveShadow = true;
  g.add(blade);
  // Rolled handle along the top edge.
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(mm(5), mm(5), mm(96), 18, 1, false),
    materials.paintedWood,
  );
  handle.rotation.z = Math.PI / 2;
  handle.position.set(0, mm(80), mm(3));
  handle.castShadow = true;
  g.add(handle);
  return g;
}

/** Flower lifter: a thin steel blade that slides under a finished flower. */
export function buildLifter(materials: Materials): THREE.Group {
  const g = new THREE.Group();
  g.name = 'lifter';

  // Blade: 78 mm long, curved up a little at the leading edge.
  const nx = 10;
  const nz = 6;
  const L = mm(78);
  const W = mm(24);
  const T = mm(0.7);
  const positions: number[] = [];
  const uvs: number[] = [];
  const top: number[][] = [];
  const height = (t: number) => -mm(1.6) * Math.pow(Math.max(0, t - 0.55) / 0.45, 2);
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const t = i / nx;
      const x = lerp(-L * 0.35, L * 0.65, t);
      const halfW = (W / 2) * lerp(0.75, 1.0, Math.min(1, t * 1.6));
      const z = lerp(-halfW, halfW, j / nz);
      const y = height(t);
      top.push([x, y, z]);
      uvs.push(t, j / nz);
    }
  }
  for (const p of top) positions.push(p[0], p[1] + T / 2, p[2]);
  for (const p of top) positions.push(p[0], p[1] - T / 2, p[2]);
  const uvAll = [...uvs, ...uvs];
  const index: number[] = [];
  const A = (i: number, j: number) => j * (nx + 1) + i;
  const B = (i: number, j: number) => (nx + 1) * (nz + 1) + j * (nx + 1) + i;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      index.push(A(i, j), A(i + 1, j + 1), A(i + 1, j), A(i, j), A(i, j + 1), A(i + 1, j + 1));
      index.push(B(i, j), B(i + 1, j), B(i + 1, j + 1), B(i, j), B(i + 1, j + 1), B(i, j + 1));
    }
  }
  const rim: Array<[number, number]> = [];
  for (let i = 0; i < nx; i++) rim.push([i, 0]);
  for (let j = 0; j < nz; j++) rim.push([nx, j]);
  for (let i = nx; i > 0; i--) rim.push([i, nz]);
  for (let j = nz; j > 0; j--) rim.push([0, j]);
  for (let k = 0; k < rim.length; k++) {
    const [i0, j0] = rim[k];
    const [i1, j1] = rim[(k + 1) % rim.length];
    index.push(A(i0, j0), A(i1, j1), B(i1, j1), A(i0, j0), B(i1, j1), B(i0, j0));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvAll, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const blade = new THREE.Mesh(geo, materials.steel);
  blade.castShadow = true;
  blade.receiveShadow = true;
  g.add(blade);

  const shank = new THREE.Mesh(
    new THREE.CylinderGeometry(mm(2.4), mm(3.4), mm(64), 14),
    materials.steelDark,
  );
  shank.rotation.z = Math.PI / 2;
  shank.position.set(-L * 0.35 - mm(30), 0, 0);
  shank.castShadow = true;
  g.add(shank);
  return g;
}

/** Cake knife: a long, slightly flexible blade with a plain handle. */
export function buildKnife(materials: Materials): THREE.Group {
  const g = new THREE.Group();
  g.name = 'knife';
  const L = mm(190);
  const rings: THREE.Vector3[][] = [];
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = lerp(0, L, t);
    const halfH = mm(11) * lerp(1, 0.35, Math.pow(t, 2.2));
    const halfT = mm(0.55) * lerp(1, 0.35, Math.pow(t, 1.5));
    const ring: THREE.Vector3[] = [];
    const n = 12;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU;
      // lens cross-section: thin at the cutting edge, thicker at the spine
      const cz = Math.cos(a);
      const sy = Math.sin(a);
      const edgeFade = Math.pow(Math.max(0, -sy), 1.6);
      ring.push(new THREE.Vector3(x, sy * halfH, cz * halfT * (1 - 0.85 * edgeFade)));
    }
    rings.push(ring);
  }
  const blade = new THREE.Mesh(
    orientOutward(loft(rings, { capStart: true, capEnd: true })),
    materials.steel,
  );
  blade.castShadow = true;
  g.add(blade);

  const handle = new THREE.Mesh(roundedBox(mm(108), mm(22), mm(15), mm(6), 3), materials.paintedWood);
  handle.position.set(mm(-58), 0, 0);
  handle.castShadow = true;
  g.add(handle);
  const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(mm(9), mm(9), mm(5), 16), materials.steelDark);
  ferrule.rotation.z = Math.PI / 2;
  ferrule.position.set(mm(-3), 0, 0);
  g.add(ferrule);
  return g;
}

/** Small offset palette knife used to smear the dab of cream on the cake. */
export function buildPalette(materials: Materials): THREE.Group {
  const g = new THREE.Group();
  const blade = new THREE.Mesh(roundedBox(mm(70), mm(0.7), mm(14), mm(0.3), 8), materials.steel);
  blade.position.set(mm(35), 0, 0);
  g.add(blade);
  const handle = new THREE.Mesh(roundedBox(mm(70), mm(13), mm(13), mm(5), 3), materials.paintedWood);
  handle.position.set(mm(-38), mm(6), 0);
  g.add(handle);
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.castShadow = true;
  });
  return g;
}

/** A birthday candle in a small holder, plus its flame. */
export function buildCandle(materials: Materials): {
  group: THREE.Group;
  flame: THREE.Group;
  light: THREE.PointLight;
} {
  const group = new THREE.Group();
  group.name = 'candle';

  const seg = 20;
  const rings: THREE.Vector3[][] = [];
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = t * DIM.candleHeight;
    let r = DIM.candleRadius * (1 - 0.06 * t);
    if (t > 0.93) r *= Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.93) / 0.07, 2))) * 0.9 + 0.1;
    const ring: THREE.Vector3[] = [];
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * TAU;
      // spiral stripe pressed into the wax
      const groove = 1 - 0.06 * Math.max(0, Math.sin(a * 6 + t * 26));
      ring.push(new THREE.Vector3(Math.cos(a) * r * groove, y, Math.sin(a) * r * groove));
    }
    rings.push(ring);
  }
  const wax = new THREE.Mesh(orientOutward(loft(rings, { capStart: true, capEnd: true })), materials.wax);
  wax.castShadow = true;
  group.add(wax);

  const wick = new THREE.Mesh(
    new THREE.CylinderGeometry(mm(0.32), mm(0.45), mm(6), 6),
    materials.wick,
  );
  wick.position.y = DIM.candleHeight + mm(2);
  group.add(wick);

  const flame = new THREE.Group();
  const flameGeo = (() => {
    const fr: THREE.Vector3[][] = [];
    const fs = 12;
    for (let i = 0; i <= fs; i++) {
      const t = i / fs;
      const y = t * mm(16);
      const r = mm(3.4) * Math.sin(Math.pow(t, 0.55) * Math.PI) * (1 - 0.25 * t);
      fr.push(circleRing(Math.max(r, 0.00004), y, 12));
    }
    return loft(fr, { capStart: true, capEnd: true });
  })();
  const flameMesh = new THREE.Mesh(flameGeo, materials.flame);
  flame.add(flameMesh);
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(mm(1.5), 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xfff6e2 }),
  );
  core.position.y = mm(5);
  core.scale.set(1, 2.2, 1);
  flame.add(core);
  flame.position.y = DIM.candleHeight + mm(3);
  group.add(flame);

  // Candela: what lands on the icing a few centimetres away is this divided by
  // the square of that distance. A candle is a small light seen very close to.
  const light = new THREE.PointLight(0xffb46a, 0.014, 0.6, 2);
  light.position.y = DIM.candleHeight + mm(10);
  group.add(light);

  return { group, flame, light };
}

/** Porcelain plate, thrown as a real lathe so the rim has thickness. */
export function buildPlate(materials: Materials): THREE.Mesh {
  const R = DIM.plateRadius;
  const profile: Array<[number, number]> = [
    [0.0, 0.0],
    [R * 0.42, 0.0],
    [R * 0.62, mm(1.4)],
    [R * 0.82, mm(6.0)],
    [R * 0.96, mm(11.0)],
    [R, mm(12.6)],
    [R * 0.995, mm(14.6)],
    [R * 0.9, mm(13.4)],
    [R * 0.74, mm(8.6)],
    [R * 0.56, mm(4.0)],
    [R * 0.4, mm(2.6)],
    [R * 0.34, mm(2.6)],
    [R * 0.33, mm(0.4)],
    [R * 0.3, mm(0.0)],
    [0.0, mm(0.0)],
  ];
  const geo = orientOutward(
    revolve(profile.map(([x, y]) => new THREE.Vector2(Math.max(x, 0.00001), y)), 96, {}),
  );
  const mesh = new THREE.Mesh(geo, materials.porcelain);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'plate';
  return mesh;
}

/** The turntable the cake sits on. */
export function buildTurntable(materials: Materials): { group: THREE.Group; plate: THREE.Group } {
  const group = new THREE.Group();
  group.name = 'turntable';

  const baseProfile: Array<[number, number]> = [
    [0.0, 0.0], [DIM.turntableBaseRadius, 0.0],
    [DIM.turntableBaseRadius * 0.96, mm(6)],
    [DIM.turntableBaseRadius * 0.55, mm(20)],
    [DIM.turntableBaseRadius * 0.42, DIM.turntableBaseHeight],
    [0.0, DIM.turntableBaseHeight],
  ];
  const base = new THREE.Mesh(
    orientOutward(revolve(baseProfile.map(([x, y]) => new THREE.Vector2(Math.max(x, 0.00001), y)), 48, {})),
    materials.brushedAlloy,
  );
  base.receiveShadow = true;
  base.castShadow = true;
  group.add(base);

  const plate = new THREE.Group();
  plate.position.y = DIM.turntableBaseHeight;
  const R = DIM.turntableRadius;
  const T = DIM.turntablePlateThickness;
  const plateProfile: Array<[number, number]> = [
    [0.0, 0.0], [R - mm(3), 0.0], [R, mm(1.2)], [R, T - mm(1.2)], [R - mm(3), T],
    [R - mm(9), T], [R - mm(9), T - mm(0.6)], [0.0, T - mm(0.6)],
  ];
  const disc = new THREE.Mesh(
    orientOutward(revolve(plateProfile.map(([x, y]) => new THREE.Vector2(Math.max(x, 0.00001), y)), 96, {})),
    materials.brushedAlloy,
  );
  disc.castShadow = true;
  disc.receiveShadow = true;
  plate.add(disc);
  group.add(plate);

  return { group, plate };
}

/** A place card at each seat, told apart by a picture rather than a name. */
export function buildPlaceCard(materials: Materials, kind: 'petal' | 'leaf'): THREE.Group {
  const g = new THREE.Group();
  const card = new THREE.Mesh(roundedBox(mm(70), mm(48), mm(0.7), mm(2), 8), materials.card);
  card.castShadow = true;
  card.receiveShadow = true;
  g.add(card);

  const motifMat = new THREE.MeshStandardMaterial({
    color: kind === 'petal' ? 0xd98494 : 0x7fa06a,
    roughness: 0.7,
    metalness: 0,
  });
  const parts: THREE.BufferGeometry[] = [];
  if (kind === 'petal') {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      const petal = new THREE.SphereGeometry(mm(7), 12, 10);
      petal.scale(1, 1.5, 0.28);
      petal.translate(Math.cos(a) * mm(8), Math.sin(a) * mm(8), mm(0.9));
      parts.push(petal);
    }
    const centre = new THREE.SphereGeometry(mm(4), 12, 10);
    centre.scale(1, 1, 0.4);
    centre.translate(0, 0, mm(1.4));
    parts.push(centre);
  } else {
    const leaf = new THREE.SphereGeometry(mm(15), 14, 12);
    leaf.scale(0.5, 1.05, 0.12);
    leaf.translate(0, 0, mm(0.8));
    parts.push(leaf);
    const stem = new THREE.CylinderGeometry(mm(1.1), mm(1.1), mm(30), 8);
    stem.translate(0, mm(-4), mm(1.2));
    parts.push(stem);
  }
  const motif = new THREE.Mesh(mergeAll(parts), motifMat);
  motif.castShadow = true;
  for (const p of parts) p.dispose();
  g.add(motif);
  g.name = `placeCard:${kind}`;
  return g;
}
