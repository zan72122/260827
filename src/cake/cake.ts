import * as THREE from 'three';
import { CAKE, SLOTS, type Design, type Placement, placementMatrix } from './design';
import { buildSector, filletRing, rosetteGeometry } from './geometry';
import { Berry, makeBerryParams } from './berry';
import { berrySection, CutPlane, type BerryInstance } from './crossSection';
import { makeBerryCutMaterial, type MaterialSet } from '../materials';
import { Rng } from '../util/rng';
import { Noise } from '../util/noise';

const TWO_PI = Math.PI * 2;

interface BerryNode {
  placement: Placement;
  rim: THREE.BufferGeometry;
  faces: THREE.BufferGeometry;
  matrix: THREE.Matrix4;
  sink: number;
}

interface TopBerry {
  berry: Berry;
  body: THREE.BufferGeometry;
  achenes: THREE.BufferGeometry;
  hull: THREE.BufferGeometry;
  matrix: THREE.Matrix4;
  seed: number;
}

/**
 * One cake. The placement list is the single source of truth: the meshes the
 * player sees while building and the faces revealed by the cut are generated
 * from the same data, so they cannot disagree.
 */
export class Cake {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly wedge = new THREE.Group();
  readonly remainder = new THREE.Group();

  readonly design: Design;
  private mats: MaterialSet;
  private coat: import('../materials').CoatSet;
  private berryNodes: BerryNode[] = [];
  private topBerries: TopBerry[] = [];
  private noise = new Noise(3);

  private fillMesh: THREE.Mesh | null = null;
  private fillAmount = 0;
  private blobs: THREE.InstancedMesh | null = null;
  private blobCount = 0;
  private topSpongeGroup = new THREE.Group();
  private coatGroup = new THREE.Group();
  private decorGroup = new THREE.Group();
  private scoreGroup = new THREE.Group();
  private clipMaterials: THREE.Material[] = [];
  private planeSets: { planes: THREE.Plane[]; local: THREE.Plane[]; owner: THREE.Object3D }[] = [];

  isSplit = false;
  cutAngle = 0;

  constructor(mats: MaterialSet, design: Design) {
    this.mats = mats;
    this.coat = mats.makeCoat();
    this.design = design;
    this.root.add(this.body, this.wedge, this.remainder);
    this.body.add(this.topSpongeGroup, this.coatGroup, this.decorGroup, this.scoreGroup);
    this.wedge.visible = false;
    this.remainder.visible = false;
  }

  /* ------------------------------------------------------------------ base */

  buildBoardAndBase() {
    const s = CAKE.sponge1;
    const parts = buildSector(
      { rOuter: CAKE.coreRadius, y0: s.y0, y1: s.y1, a0: 0, a1: TWO_PI, uvScale: 4.5 },
      ['outer', 'top', 'bottom']
    );
    const g = new THREE.Group();
    for (const key of ['outer', 'top', 'bottom'] as const) {
      const geo = parts[key];
      if (!geo) continue;
      const m = new THREE.Mesh(geo, this.mats.spongeBake);
      m.castShadow = key !== 'bottom';
      m.receiveShadow = true;
      g.add(m);
    }
    g.name = 'baseSponge';
    this.body.add(g);

    // Thin skim of cream the slices are set into, with a lightly worked surface.
    const skim = this.skimGeometry();
    const skimMesh = new THREE.Mesh(skim, this.mats.cream);
    skimMesh.receiveShadow = true;
    skimMesh.name = 'skim';
    this.body.add(skimMesh);
  }

  private skimGeometry(): THREE.BufferGeometry {
    const R = CAKE.coreRadius;
    const rings = 22;
    const seg = 72;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const y0 = CAKE.filling.y0;
    for (let j = 0; j <= rings; j++) {
      const r = (R * j) / rings;
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * TWO_PI;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const spread = this.noise.fbm(x * 0.09 + 3, z * 0.09 + 5, 32, 3) * 0.09;
        // A shallow dip is pressed into the cream where each slice belongs.
        let dip = 0;
        for (const slot of SLOTS) {
          const dx = x - Math.cos(slot.angle) * slot.radius;
          const dz = z - Math.sin(slot.angle) * slot.radius;
          const d = Math.hypot(dx, dz) / 2.15;
          if (d < 1) dip = Math.max(dip, (1 - d * d) * (1 - d * d));
        }
        pos.push(x, y0 + CAKE.skim + spread - dip * 0.16, z);
        uv.push(x / 6 + 0.5, z / 6 + 0.5);
      }
    }
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < seg; i++) {
        const a = j * (seg + 1) + i;
        const b = a + 1;
        const c = a + seg + 1;
        const d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // Side wall of the skim so it is not a floating film.
    const side = buildSector(
      { rOuter: CAKE.coreRadius, y0, y1: y0 + CAKE.skim, a0: 0, a1: TWO_PI, uvScale: 6 },
      ['outer']
    ).outer!;
    return mergePair(g, side);
  }

  /* --------------------------------------------------------------- berries */

  private nodeFor(p: Placement, sink = 0): BerryNode {
    return {
      placement: p,
      rim: p.berry.buildSlabRim(p.slab),
      faces: p.berry.buildSlabFaces(p.slab),
      matrix: placementMatrix(p, sink),
      sink,
    };
  }

  /** Adds a slice to the filling and returns the group holding it. */
  addBerry(p: Placement, sink = 0): THREE.Group {
    const node = this.nodeFor(p, sink);
    this.berryNodes.push(node);
    const g = this.berryGroup(node, this.mats.berrySkin, this.mats.berryCut);
    g.name = `berry-${p.slot}`;
    this.body.add(g);
    return g;
  }

  get topSponge(): THREE.Group {
    return this.topSpongeGroup;
  }

  /** Changes the orientation of an already-placed slice. */
  setPose(slot: number, pose: import('./design').Pose) {
    const node = this.berryNodes.find((n) => n.placement.slot === slot);
    if (!node) return;
    node.placement.pose = pose;
    node.matrix = placementMatrix(node.placement, node.sink);
    const g = this.body.getObjectByName(`berry-${slot}`);
    if (g) {
      g.matrix.copy(node.matrix);
      g.updateMatrixWorld(true);
    }
  }

  hasSlot(slot: number): boolean {
    return this.berryNodes.some((n) => n.placement.slot === slot);
  }

  get placedCount(): number {
    return this.berryNodes.length;
  }

  berryGroups(): THREE.Object3D[] {
    return this.body.children.filter((c) => c.name.startsWith('berry-'));
  }

  /** Re-seats every slice as the piped cream supports it. */
  setBerrySink(fn: (p: Placement) => number) {
    for (const node of this.berryNodes) {
      node.sink = fn(node.placement);
      node.matrix = placementMatrix(node.placement, node.sink);
      const g = this.body.getObjectByName(`berry-${node.placement.slot}`);
      if (g) {
        g.matrix.copy(node.matrix);
        g.matrixAutoUpdate = false;
        g.updateMatrixWorld(true);
      }
    }
  }

  private berryGroup(
    node: BerryNode,
    skin: THREE.Material,
    cut: THREE.Material
  ): THREE.Group {
    const g = new THREE.Group();
    const rim = new THREE.Mesh(node.rim, skin);
    const faces = new THREE.Mesh(node.faces, cut);
    rim.castShadow = true;
    g.add(rim, faces);
    g.matrixAutoUpdate = false;
    g.matrix.copy(node.matrix);
    g.updateMatrixWorld(true);
    return g;
  }

  /* ------------------------------------------------------------------ fill */

  private fillGeometry(): THREE.BufferGeometry {
    const R = CAKE.coreRadius;
    const y0 = CAKE.filling.y0 + CAKE.skim;
    const h = CAKE.filling.y1 - y0;
    const rings = 20;
    const seg = 72;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j <= rings; j++) {
      const r = (R * j) / rings;
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * TWO_PI;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const lump = this.noise.fbm(x * 0.19 + 11, z * 0.19 + 7, 24, 3) * 0.24;
        pos.push(x, h - 0.06 + lump, z);
        uv.push(x / 6 + 0.5, z / 6 + 0.5);
      }
    }
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < seg; i++) {
        const a = j * (seg + 1) + i;
        const b = a + 1;
        const c = a + seg + 1;
        const d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const side = buildSector({ rOuter: R, y0: 0, y1: h, a0: 0, a1: TWO_PI, uvScale: 6 }, ['outer']).outer!;
    const merged = mergePair(g, side);
    merged.translate(0, y0, 0);
    return merged;
  }

  ensureFill() {
    if (this.fillMesh) return;
    const geo = this.fillGeometry();
    const m = new THREE.Mesh(geo, this.mats.cream);
    m.castShadow = true;
    m.receiveShadow = true;
    m.name = 'fill';
    // Grown from the base of the filling layer as cream is piped in.
    m.position.y = CAKE.filling.y0 + CAKE.skim;
    geo.translate(0, -(CAKE.filling.y0 + CAKE.skim), 0);
    m.scale.y = 0.02;
    this.body.add(m);
    this.fillMesh = m;
  }

  setFill(v: number) {
    this.fillAmount = v;
    this.ensureFill();
    if (this.fillMesh) this.fillMesh.scale.y = Math.max(0.02, v);
  }

  get fill() {
    return this.fillAmount;
  }

  /** Height of the cream surface the nozzle is laying on to. */
  get fillSurfaceY(): number {
    const base = CAKE.filling.y0 + CAKE.skim;
    return base + (CAKE.filling.y1 - base) * Math.max(0.02, this.fillAmount);
  }

  /** A dab of piped cream left where the player dragged the nozzle. */
  pipeBlob(x: number, z: number, rng: Rng) {
    if (!this.blobs) {
      const geo = new THREE.SphereGeometry(0.6, 12, 8);
      geo.scale(1, 0.58, 1);
      const im = new THREE.InstancedMesh(geo, this.mats.cream, 90);
      im.count = 0;
      im.castShadow = true;
      im.name = 'blobs';
      this.body.add(im);
      this.blobs = im;
    }
    if (this.blobCount >= 90) return;
    const m = new THREE.Matrix4();
    const s = rng.range(0.75, 1.25);
    m.compose(
      new THREE.Vector3(x, this.fillSurfaceY - 0.12 + rng.range(0, 0.14), z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, TWO_PI)),
      new THREE.Vector3(s, s * rng.range(0.8, 1.2), s)
    );
    this.blobs.setMatrixAt(this.blobCount++, m);
    this.blobs.count = this.blobCount;
    this.blobs.instanceMatrix.needsUpdate = true;
  }

  /* ------------------------------------------------------------ top sponge */

  addTopSponge(): THREE.Group {
    const s = CAKE.sponge2;
    const parts = buildSector(
      { rOuter: CAKE.coreRadius, y0: 0, y1: s.y1 - s.y0, a0: 0, a1: TWO_PI, uvScale: 4.5 },
      ['outer', 'top', 'bottom']
    );
    for (const key of ['outer', 'top', 'bottom'] as const) {
      const geo = parts[key];
      if (!geo) continue;
      const m = new THREE.Mesh(geo, this.mats.spongeBake);
      m.castShadow = true;
      m.receiveShadow = true;
      this.topSpongeGroup.add(m);
    }
    this.topSpongeGroup.position.y = s.y0;
    return this.topSpongeGroup;
  }

  /* ----------------------------------------------------------------- coats */

  buildCoat() {
    const yTop = CAKE.topCoat.y1;
    const wallY0 = -0.02;
    const under = new THREE.Group();
    const white = new THREE.Group();

    const underWall = buildSector(
      { rInner: CAKE.coreRadius - 0.02, rOuter: CAKE.coreRadius + 0.1, y0: wallY0, y1: CAKE.topCoat.y0 + 0.1, a0: 0, a1: TWO_PI, uvScale: 6 },
      ['outer']
    ).outer!;
    under.add(new THREE.Mesh(underWall, this.coat.underWall));
    const underTop = buildSector(
      { rOuter: CAKE.coreRadius + 0.1, y0: 0, y1: CAKE.topCoat.y0 + 0.08, a0: 0, a1: TWO_PI, uvScale: 6 },
      ['top']
    ).top!;
    under.add(new THREE.Mesh(underTop, this.coat.underTop));

    const wall = buildSector(
      { rOuter: CAKE.radius, y0: wallY0, y1: yTop, a0: 0, a1: TWO_PI, uvScale: 6 },
      ['outer']
    ).outer!;
    const wallMesh = new THREE.Mesh(wall, this.coat.wall);
    wallMesh.castShadow = true;
    white.add(wallMesh);
    const top = buildSector(
      { rOuter: CAKE.radius, y0: 0, y1: yTop, a0: 0, a1: TWO_PI, uvScale: 6 },
      ['top']
    ).top!;
    const topMesh = new THREE.Mesh(top, this.coat.top);
    topMesh.castShadow = true;
    white.add(topMesh);
    const fil = filletRing(CAKE.radius, wallY0, 0.34, 0, TWO_PI);
    white.add(new THREE.Mesh(fil, this.coat.top));

    this.coatGroup.add(under, white);
  }

  setCoat(under: number, white: number) {
    this.coat.u.underWall.uCoat.value = under;
    this.coat.u.underTop.uCoat.value = under;
    this.coat.u.wall.uCoat.value = white;
    this.coat.u.top.uCoat.value = white;
  }

  /* ------------------------------------------------------------ decoration */

  addDecoration(seed: number) {
    const rng = new Rng(seed);
    const y = CAKE.topCoat.y1;
    const count = 5;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TWO_PI + rng.range(-0.16, 0.16);
      const r = 5.05 + rng.range(-0.22, 0.22);
      const params = makeBerryParams(rng, 1);
      params.length = rng.range(3.1, 3.8);
      params.radius = rng.range(0.98, 1.2);
      const berry = new Berry(params);
      const body = berry.buildGeometry(false, 26, 20);
      const achenes = berry.buildAcheneGeometry(30, i);
      const hull = berry.buildHullGeometry();
      const lean = rng.range(0.72, 1.05);
      const q = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)),
        lean
      );
      q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, TWO_PI)));
      const pos = new THREE.Vector3(
        Math.cos(a) * r,
        y + berry.halfLength * Math.cos(lean) * 0.86,
        Math.sin(a) * r
      );
      const matrix = new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1));
      this.topBerries.push({ berry, body, achenes, hull, matrix, seed: params.seed });

      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      g.matrix.copy(matrix);
      const bm = new THREE.Mesh(body, this.mats.berrySkin);
      bm.castShadow = true;
      const am = new THREE.Mesh(achenes, this.mats.berrySkin);
      const hm = new THREE.Mesh(hull, this.mats.berryHull);
      g.add(bm, am, hm);
      g.updateMatrixWorld(true);
      this.decorGroup.add(g);

      // A single rosette tucked beside each berry, nothing more.
      const ra = a + 0.42;
      const ros = new THREE.Mesh(rosetteGeometry(0.9, 0.95), this.mats.cream);
      ros.position.set(Math.cos(ra) * (r - 0.4), y - 0.04, Math.sin(ra) * (r - 0.4));
      ros.castShadow = true;
      this.decorGroup.add(ros);
    }
  }

  /* --------------------------------------------------------------- scoring */

  /** The shallow line the blade leaves on the top as it goes in. */
  setScore(angle: number, progress: number, kind: 'a' | 'b' | 'guide' = 'a') {
    const name = `score-${kind}`;
    let mesh = this.scoreGroup.getObjectByName(name) as THREE.Mesh | undefined;
    const guide = kind === 'guide';
    if (!mesh) {
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.rotateX(-Math.PI / 2);
      geo.translate(0.5, 0, 0);
      const mat = new THREE.MeshStandardMaterial({
        color: guide ? 0xe4d7c6 : 0x9d8877,
        roughness: 0.55,
        transparent: true,
        opacity: guide ? 0.45 : 0.8,
        depthWrite: false,
      });
      mesh = new THREE.Mesh(geo, mat);
      mesh.name = name;
      mesh.renderOrder = 3;
      this.scoreGroup.add(mesh);
    }
    mesh.visible = progress > 0.001;
    // The blade enters at the rim and travels inward, so the line grows inward.
    const len = CAKE.radius * Math.min(1, progress);
    const start = CAKE.radius - len;
    mesh.position.set(Math.cos(angle) * start, CAKE.topCoat.y1 + 0.012, Math.sin(angle) * start);
    mesh.rotation.y = -angle;
    mesh.scale.set(len, 1, guide ? 0.07 : 0.13);
  }

  clearScore() {
    for (const c of [...this.scoreGroup.children]) {
      this.scoreGroup.remove(c);
      const m = c as THREE.Mesh;
      m.geometry?.dispose();
    }
  }

  /* ----------------------------------------------------------------- split */

  /** Every berry in the cake, expressed for the cross-section solver. */
  private instances(): BerryInstance[] {
    const list: BerryInstance[] = [];
    for (const n of this.berryNodes) {
      list.push({
        berry: n.placement.berry,
        matrix: n.matrix,
        inverse: new THREE.Matrix4().copy(n.matrix).invert(),
        slab: n.placement.slab,
        seed: n.placement.params.seed,
      });
    }
    for (const t of this.topBerries) {
      list.push({
        berry: t.berry,
        matrix: t.matrix,
        inverse: new THREE.Matrix4().copy(t.matrix).invert(),
        slab: 0,
        seed: t.seed,
      });
    }
    return list;
  }

  /**
   * Replaces the whole cake with a wedge and the remainder, generating the two
   * cut faces from the actual contents. Nothing inside is visible until this
   * runs and the wedge is drawn away.
   */
  split(angle: number) {
    this.cutAngle = angle;
    const w = CAKE.wedgeAngle;
    const a1 = angle;
    const a2 = angle + w;
    const p1 = new CutPlane(a1);
    const p2 = new CutPlane(a2);

    this.body.visible = false;
    this.disposeGroup(this.wedge);
    this.disposeGroup(this.remainder);
    for (const m of this.clipMaterials) m.dispose();
    this.clipMaterials = [];
    this.planeSets = [];

    const wedgePlanes = [new THREE.Plane(p1.normal.clone(), 0), new THREE.Plane(p2.normal.clone().negate(), 0)];
    const remAPlanes = [new THREE.Plane(p1.normal.clone().negate(), 0)];
    const remBPlanes = [new THREE.Plane(p1.normal.clone(), 0), new THREE.Plane(p2.normal.clone(), 0)];

    const mkSet = (local: THREE.Plane[], owner: THREE.Object3D) => {
      const planes = local.map((pl) => pl.clone());
      this.planeSets.push({ planes, local, owner });
      return planes;
    };
    const wedgeWorld = mkSet(wedgePlanes, this.wedge);
    const remAWorld = mkSet(remAPlanes, this.remainder);
    const remBWorld = mkSet(remBPlanes, this.remainder);

    const clip = (base: THREE.Material, planes: THREE.Plane[]) => {
      const m = base.clone();
      m.clippingPlanes = planes;
      m.clipShadows = true;
      this.clipMaterials.push(m);
      return m;
    };
    // The cross-section material carries a custom shader, which does not
    // survive Material.clone(); build each variant from the factory instead.
    const berryCut = (planes?: THREE.Plane[], side?: THREE.Side) => {
      const m = makeBerryCutMaterial();
      if (planes) {
        m.clippingPlanes = planes;
        m.clipShadows = true;
      }
      if (side) m.side = side;
      this.clipMaterials.push(m);
      return m;
    };

    this.buildSectorBody(this.wedge, a1, a2);
    this.buildSectorBody(this.remainder, a2, a1 + TWO_PI);

    const skinW = clip(this.mats.berrySkin, wedgeWorld);
    const cutW = berryCut(wedgeWorld);
    const hullW = clip(this.mats.berryHull, wedgeWorld);
    const skinA = clip(this.mats.berrySkin, remAWorld);
    const cutA = berryCut(remAWorld);
    const hullA = clip(this.mats.berryHull, remAWorld);
    const skinB = clip(this.mats.berrySkin, remBWorld);
    const cutB = berryCut(remBWorld);
    const hullB = clip(this.mats.berryHull, remBWorld);

    for (const node of this.berryNodes) {
      const c = new THREE.Vector3().setFromMatrixPosition(node.matrix);
      const bR = node.placement.berry.boundRadius;
      const d1 = p1.normal.dot(c);
      const d2 = p2.normal.dot(c);
      if (d1 > -bR && d2 < bR) this.wedge.add(this.berryGroup(node, skinW, cutW));
      if (d1 < bR) this.remainder.add(this.berryGroup(node, skinA, cutA));
      if (d1 > -bR && d2 > -bR) this.remainder.add(this.berryGroup(node, skinB, cutB));
    }

    for (const t of this.topBerries) {
      const c = new THREE.Vector3().setFromMatrixPosition(t.matrix);
      const bR = t.berry.boundRadius;
      const d1 = p1.normal.dot(c);
      const d2 = p2.normal.dot(c);
      const mk = (skin: THREE.Material, hull: THREE.Material) => {
        const g = new THREE.Group();
        g.matrixAutoUpdate = false;
        g.matrix.copy(t.matrix);
        g.add(new THREE.Mesh(t.body, skin), new THREE.Mesh(t.achenes, skin), new THREE.Mesh(t.hull, hull));
        g.updateMatrixWorld(true);
        return g;
      };
      if (d1 > -bR && d2 < bR) this.wedge.add(mk(skinW, hullW));
      if (d1 < bR) this.remainder.add(mk(skinA, hullA));
      if (d1 > -bR && d2 > -bR) this.remainder.add(mk(skinB, hullB));
    }

    // Decoration rosettes are small; assign each to whichever side it sits on.
    for (const child of this.decorGroup.children) {
      const ros = child as THREE.Mesh;
      if (!(ros.geometry instanceof THREE.BufferGeometry) || ros.type !== 'Mesh') continue;
      const c = ros.position;
      const inside = p1.normal.dot(c) >= 0 && p2.normal.dot(c) <= 0;
      const copy = new THREE.Mesh(ros.geometry, this.mats.cream);
      copy.position.copy(ros.position);
      copy.castShadow = true;
      (inside ? this.wedge : this.remainder).add(copy);
    }

    const cutFront = berryCut();
    const cutBack = berryCut(undefined, THREE.BackSide);

    const eps = 0.008;
    for (const inst of this.instances()) {
      const s1 = berrySection(inst, p1);
      if (s1) {
        const wm = new THREE.Mesh(s1.geometry, cutBack);
        wm.position.copy(p1.normal).multiplyScalar(-eps);
        wm.renderOrder = 2;
        this.wedge.add(wm);
        const rm = new THREE.Mesh(s1.geometry, cutFront);
        rm.position.copy(p1.normal).multiplyScalar(eps);
        rm.renderOrder = 2;
        this.remainder.add(rm);
      }
      const s2 = berrySection(inst, p2);
      if (s2) {
        const wm = new THREE.Mesh(s2.geometry, cutFront);
        wm.position.copy(p2.normal).multiplyScalar(eps);
        wm.renderOrder = 2;
        this.wedge.add(wm);
        const rm = new THREE.Mesh(s2.geometry, cutBack);
        rm.position.copy(p2.normal).multiplyScalar(-eps);
        rm.renderOrder = 2;
        this.remainder.add(rm);
      }
    }

    this.wedge.visible = true;
    this.remainder.visible = true;
    this.isSplit = true;
    this.updateClipping();
  }

  /**
   * Depth of the open crumb at a point on a cut face. The larger cells become
   * real dents in the mesh; the fine ones are left to the normal and AO maps.
   */
  private poreDepth(r: number, y: number): number {
    const warpU = r * 0.32 + this.noise.fbm(r * 0.5, y * 0.5, 16, 2) * 0.5;
    const warpV = y * 0.32 + this.noise.fbm(r * 0.5 + 4, y * 0.5 + 9, 16, 2) * 0.5;
    const big = this.noise.cell(warpU * 0.22, warpV * 0.22, 14);
    const size = 0.14 + 0.3 * (((Math.sin(big.id * 12.9898) * 43758.5453) % 1) + 1) * 0.5;
    const hole = Math.max(0, 1 - big.f1 / size);
    return Math.pow(hole, 0.7) * 0.13;
  }

  /** Layers of one angular sector, each surface with the material it deserves. */
  private buildSectorBody(target: THREE.Group, a0: number, a1: number) {
    const arcSeg = Math.max(6, Math.ceil(((a1 - a0) / TWO_PI) * 96));
    const add = (geo: THREE.BufferGeometry | undefined, mat: THREE.Material, shadow = true) => {
      if (!geo) return;
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = shadow;
      m.receiveShadow = true;
      target.add(m);
    };

    for (const layer of [CAKE.sponge1, CAKE.sponge2]) {
      const p = buildSector(
        {
          rOuter: CAKE.coreRadius,
          y0: layer.y0,
          y1: layer.y1,
          a0,
          a1,
          arcSeg,
          uvScale: 2.0,
          capRelief: { seg: [30, 14], depth: (r, y) => this.poreDepth(r, y) },
        },
        ['capStart', 'capEnd']
      );
      add(p.capStart, this.mats.spongeCut);
      add(p.capEnd, this.mats.spongeCut);
      const b = buildSector(
        { rOuter: CAKE.coreRadius, y0: layer.y0, y1: layer.y1, a0, a1, arcSeg, uvScale: 4.5 },
        layer === CAKE.sponge1 ? ['bottom'] : []
      );
      add(b.bottom, this.mats.spongeBake, false);
    }

    const fillCaps = buildSector(
      { rOuter: CAKE.coreRadius, y0: CAKE.filling.y0, y1: CAKE.filling.y1, a0, a1, arcSeg, uvScale: 3.4 },
      ['capStart', 'capEnd']
    );
    add(fillCaps.capStart, this.mats.creamCut);
    add(fillCaps.capEnd, this.mats.creamCut);

    const wall = buildSector(
      { rInner: CAKE.coreRadius, rOuter: CAKE.radius, y0: -0.02, y1: CAKE.topCoat.y1, a0, a1, arcSeg, uvScale: 6 },
      ['outer', 'capStart', 'capEnd']
    );
    add(wall.outer, this.mats.creamOuter);
    add(wall.capStart, this.mats.creamCut);
    add(wall.capEnd, this.mats.creamCut);

    const cap = buildSector(
      { rOuter: CAKE.coreRadius, y0: CAKE.topCoat.y0, y1: CAKE.topCoat.y1, a0, a1, arcSeg, uvScale: 6 },
      ['top', 'capStart', 'capEnd']
    );
    add(cap.top, this.mats.creamTop);
    add(cap.capStart, this.mats.creamCut);
    add(cap.capEnd, this.mats.creamCut);

    const fil = filletRing(CAKE.radius, -0.02, 0.34, a0, a1);
    add(fil, this.mats.creamOuter);
  }

  /** Clipping planes live in world space; refresh them from the group matrices. */
  updateClipping() {
    for (const set of this.planeSets) {
      set.owner.updateMatrixWorld();
      for (let i = 0; i < set.planes.length; i++) {
        set.planes[i].copy(set.local[i]).applyMatrix4(set.owner.matrixWorld);
      }
    }
  }

  private disposeGroup(g: THREE.Group) {
    for (const c of [...g.children]) g.remove(c);
  }

  dispose() {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    for (const m of this.clipMaterials) m.dispose();
    this.clipMaterials = [];
    this.root.removeFromParent();
  }
}

function mergePair(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const geos = [a, b];
  let vc = 0;
  let ic = 0;
  for (const g of geos) {
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    vc += g.getAttribute('position').count;
    ic += g.index!.count;
  }
  const pos = new Float32Array(vc * 3);
  const nor = new Float32Array(vc * 3);
  const uv = new Float32Array(vc * 2);
  const idx = vc > 65535 ? new Uint32Array(ic) : new Uint16Array(ic);
  let vo = 0;
  let io = 0;
  for (const g of geos) {
    const p = g.getAttribute('position');
    pos.set(p.array as Float32Array, vo * 3);
    nor.set(g.getAttribute('normal').array as Float32Array, vo * 3);
    const t = g.getAttribute('uv');
    if (t) uv.set(t.array as Float32Array, vo * 2);
    for (let i = 0; i < g.index!.count; i++) idx[io++] = g.index!.getX(i) + vo;
    vo += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}
