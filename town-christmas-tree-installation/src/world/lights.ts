import * as THREE from 'three';
import { Rng } from '../core/rng';
import { Materials } from './materials';
import { Cable, catenaryPoints, ropeGeometry } from '../game/geom';
import type { ConiferTree } from './tree';

export interface StarDesign {
  points: number;
  innerRatio: number;
  radius: number;
  gold: boolean;
}

/**
 * The festoon: a real spline cord that rests on branches with local sag, and
 * two instanced bulb meshes (dark bodies always, warm lit bodies revealed in
 * sequence). No per-bulb dynamic lights.
 */
export class TreeLights {
  readonly group = new THREE.Group();
  readonly bulbAnchors: THREE.Vector3[] = [];
  readonly spiral: THREE.Vector3[] = [];
  private cordMesh: THREE.Mesh;
  private cordIndexCount = 0;
  private darkBulbs: THREE.InstancedMesh;
  private litBulbs: THREE.InstancedMesh;
  private litMat: THREE.MeshBasicMaterial;
  private anchorHeights: number[] = [];
  private turns: number;
  private topY: number;
  private bottomY: number;

  constructor(m: Materials, tree: ConiferTree, rng: Rng, bulbCount: number) {
    this.turns = Math.round(rng.range(6.5, 8.5));
    this.bottomY = 1.15;
    this.topY = tree.spec.height * 0.945;

    // ---- spiral path resting on the branches ----------------------------
    const steps = 260;
    const raw: THREE.Vector3[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const y = THREE.MathUtils.lerp(this.bottomY, this.topY, t);
      const a = t * this.turns * Math.PI * 2;
      const r = tree.crownRadiusAt(y) * 0.82 + 0.06;
      const c = tree.trunkPointLocal(y);
      raw.push(new THREE.Vector3(c.x + Math.cos(a) * r, y, c.z + Math.sin(a) * r));
    }
    // Anchor every few samples; between anchors the cord hangs slightly.
    const anchorEvery = Math.max(3, Math.round(steps / bulbCount));
    const path: THREE.Vector3[] = [];
    for (let i = 0; i < raw.length - anchorEvery; i += anchorEvery) {
      const a = raw[i];
      const b = raw[Math.min(raw.length - 1, i + anchorEvery)];
      const sag = 0.035 + rng.range(0, 0.075);
      const seg = catenaryPoints(a, b, sag, 3);
      for (let k = 0; k < seg.length - 1; k++) path.push(seg[k]);
      this.bulbAnchors.push(a.clone().add(new THREE.Vector3(0, -0.03, 0)));
      this.anchorHeights.push(a.y);
      this.spiral.push(a.clone());
    }
    path.push(raw[raw.length - 1]);

    const cordGeo = ropeGeometry(path, 0.022, 5);
    this.cordMesh = new THREE.Mesh(cordGeo, m.cord);
    this.cordMesh.frustumCulled = false;
    const index = cordGeo.getIndex();
    this.cordIndexCount = index ? index.count : 0;
    cordGeo.setDrawRange(0, 0);
    this.group.add(this.cordMesh);

    // ---- bulbs -----------------------------------------------------------
    const n = this.bulbAnchors.length;
    const bulbGeo = new THREE.SphereGeometry(0.075, 8, 6);
    bulbGeo.scale(1, 1.28, 1);
    const capGeo = new THREE.CylinderGeometry(0.032, 0.038, 0.05, 6);
    capGeo.translate(0, 0.085, 0);
    const body = mergeTwo(bulbGeo, capGeo);

    this.darkBulbs = new THREE.InstancedMesh(body, m.bulbOff, n);
    this.litMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const litGeo = body.clone();
    litGeo.scale(1.06, 1.06, 1.06);
    this.litBulbs = new THREE.InstancedMesh(litGeo, this.litMat, n);
    this.darkBulbs.frustumCulled = false;
    this.litBulbs.frustumCulled = false;

    // Warm, slightly varied bulb colours from a seeded palette.
    const palettes: [number, number, number][] = [
      [0xffd9a0, 0xffc27a, 0xfff0cf],
      [0xffd9a0, 0xffb4b4, 0xa8d8ff],
      [0xfff2c8, 0xffcf8a, 0xffe6b0],
      [0xffcf9a, 0xbfe6b0, 0xffb0c0],
    ];
    const pal = palettes[rng.int(0, palettes.length - 1)];
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    this.bulbAnchors.forEach((p, i) => {
      q.setFromEuler(new THREE.Euler(rng.jitter(0.4), rng.range(0, 6.3), rng.jitter(0.4)));
      mtx.compose(p, q, one);
      this.darkBulbs.setMatrixAt(i, mtx);
      this.litBulbs.setMatrixAt(i, mtx);
      this.litBulbs.setColorAt(i, new THREE.Color(pal[i % pal.length]));
    });
    this.darkBulbs.instanceMatrix.needsUpdate = true;
    this.litBulbs.instanceMatrix.needsUpdate = true;
    if (this.litBulbs.instanceColor) this.litBulbs.instanceColor.needsUpdate = true;
    this.darkBulbs.count = 0;
    this.litBulbs.count = 0;
    this.group.add(this.darkBulbs, this.litBulbs);
  }

  /** How much of the cord has been laid, 0..1 (drives the reveal). */
  setInstalled(t: number): void {
    const f = THREE.MathUtils.clamp(t, 0, 1);
    this.cordMesh.geometry.setDrawRange(0, Math.round(this.cordIndexCount * f));
    const n = Math.round(this.bulbAnchors.length * f);
    this.darkBulbs.count = n;
    if (this.litBulbs.count > n) this.litBulbs.count = n;
  }

  /** Light everything below `height` metres. */
  setLitBelow(height: number): void {
    let n = 0;
    for (let i = 0; i < this.anchorHeights.length; i++) {
      if (this.anchorHeights[i] <= height) n = i + 1;
      else break;
    }
    this.litBulbs.count = Math.min(n, this.darkBulbs.count);
  }

  get maxHeight(): number {
    return this.topY;
  }

  get minHeight(): number {
    return this.bottomY;
  }

  setBrightness(v: number): void {
    this.litMat.color.setScalar(v);
  }

  /** World position of the point currently being wired. */
  pointAt(t: number, tree: ConiferTree, out = new THREE.Vector3()): THREE.Vector3 {
    const i = THREE.MathUtils.clamp(Math.round(t * (this.spiral.length - 1)), 0, this.spiral.length - 1);
    return out.copy(this.spiral[i]).applyMatrix4(tree.root.matrixWorld);
  }
}

function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let off = 0;
  for (const g of [a, b]) {
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const n = g.getAttribute('normal') as THREE.BufferAttribute;
    const u = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
    }
    const ix = g.getIndex();
    if (ix) for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + off);
    off += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  a.dispose();
  b.dispose();
  return out;
}

/** Topping-out star: a real fabricated fitting with a mast, collar and bolts. */
export class TopStar {
  readonly group = new THREE.Group();
  readonly design: StarDesign;
  private litMat: THREE.MeshBasicMaterial;
  private bodyMat: THREE.MeshStandardMaterial;
  private starMesh: THREE.Mesh;
  private glowMesh: THREE.Mesh;

  constructor(m: Materials, rng: Rng) {
    const design: StarDesign = {
      points: rng.pick([5, 5, 6, 8]),
      innerRatio: rng.range(0.4, 0.52),
      radius: rng.range(0.46, 0.62),
      gold: rng.bool(0.65),
    };
    this.design = design;

    const shape = new THREE.Shape();
    const n = design.points * 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const r = design.radius * (i % 2 === 0 ? 1 : design.innerRatio);
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.075,
      bevelEnabled: true,
      bevelThickness: 0.03,
      bevelSize: 0.035,
      bevelSegments: 2,
    });
    geo.translate(0, 0, -0.0375);

    this.bodyMat = new THREE.MeshStandardMaterial({
      color: design.gold ? 0xd8a63f : 0xc8ccd2,
      roughness: 0.34,
      metalness: 0.92,
    });
    this.starMesh = new THREE.Mesh(geo, this.bodyMat);
    this.starMesh.castShadow = true;
    this.starMesh.position.y = 0.95;
    this.group.add(this.starMesh);

    this.litMat = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false });
    this.glowMesh = new THREE.Mesh(geo.clone().scale(1.03, 1.03, 0.7), this.litMat);
    this.glowMesh.position.y = 0.95;
    this.group.add(this.glowMesh);

    // Mast, collar and fixings — the star has to be held up by something.
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 1.25, 10), m.steelDark);
    mast.position.y = 0.42;
    mast.castShadow = true;
    this.group.add(mast);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.16, 12), m.steel);
    collar.position.y = -0.08;
    this.group.add(collar);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.3, 6), m.steel);
      bolt.rotation.z = Math.PI / 2;
      bolt.rotation.y = a;
      bolt.position.set(Math.cos(a) * 0.13, -0.08, Math.sin(a) * 0.13);
      this.group.add(bolt);
      const stay = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.75, 6), m.steel);
      stay.position.set(Math.cos(a) * 0.13, 0.32, Math.sin(a) * 0.13);
      stay.rotation.set(Math.sin(a) * 0.22, 0, -Math.cos(a) * 0.22);
      this.group.add(stay);
    }
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.34), m.steelDark);
    plate.position.y = 0.86;
    this.group.add(plate);
    this.group.visible = false;
  }

  setLit(v: number): void {
    const c = this.design.gold ? new THREE.Color(0xffdd94) : new THREE.Color(0xdfeaff);
    this.litMat.color.copy(c).multiplyScalar(v);
    this.bodyMat.emissive.copy(c).multiplyScalar(v * 0.28);
  }
}

/** Three guy wires with independent tension and real slack. */
export class GuyWires {
  readonly cables: Cable[] = [];
  readonly tension: number[] = [0, 0, 0];
  private anchors: THREE.Vector3[];
  private tree: ConiferTree;
  private attachHeight: number;
  private turnbuckles: THREE.Group[] = [];

  constructor(m: Materials, tree: ConiferTree, anchors: THREE.Vector3[], scene: THREE.Object3D) {
    this.tree = tree;
    this.anchors = anchors;
    this.attachHeight = tree.spec.height * 0.6;
    for (let i = 0; i < anchors.length; i++) {
      const c = new Cable(m.wireRope, 0.026, 5);
      c.mesh.visible = false;
      scene.add(c.mesh);
      this.cables.push(c);

      const tb = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.42, 8), m.steel);
      body.rotation.z = Math.PI / 2;
      tb.add(body);
      for (const s of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.02, 5, 10), m.steelDark);
        eye.position.x = s * 0.26;
        eye.rotation.y = Math.PI / 2;
        tb.add(eye);
      }
      tb.visible = false;
      scene.add(tb);
      this.turnbuckles.push(tb);
    }
  }

  show(v: boolean): void {
    for (const c of this.cables) c.mesh.visible = v;
    for (const t of this.turnbuckles) t.visible = v;
  }

  setTension(i: number, t: number): void {
    this.tension[i] = THREE.MathUtils.clamp(t, 0, 1);
  }

  update(): void {
    const top = new THREE.Vector3();
    for (let i = 0; i < this.anchors.length; i++) {
      const a = (i / this.anchors.length) * Math.PI * 2 + 0.9;
      this.tree.worldTrunkPoint(this.attachHeight, top);
      const off = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(this.tree.trunkRadiusAt(this.attachHeight) + 0.05);
      const from = top.clone().add(off);
      const to = this.anchors[i];
      const t = this.tension[i];
      const sag = (1 - t) * 2.4 + 0.05;
      this.cables[i].update(catenaryPoints(from, to, sag, 20));
      const tb = this.turnbuckles[i];
      tb.position.copy(from.clone().lerp(to, 0.86));
      tb.position.y -= sag * 0.32;
      tb.lookAt(to);
      tb.rotateY(Math.PI / 2);
    }
  }

  get averageTension(): number {
    return this.tension.reduce((a, b) => a + b, 0) / this.tension.length;
  }
}

/** A few wrapped parcels round the base — placed once the tree is standing. */
export function buildGifts(m: Materials, rng: Rng): THREE.Group {
  const g = new THREE.Group();
  const colors = [0xa8302c, 0x2f5d3a, 0x2b4a78, 0xbf8b2a, 0x7a3560];
  for (let i = 0; i < 9; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(1.5, 3.1);
    const w = rng.range(0.4, 0.85);
    const h = rng.range(0.3, 0.62);
    const d = rng.range(0.4, 0.85);
    const mat = new THREE.MeshStandardMaterial({ color: colors[rng.int(0, colors.length - 1)], roughness: 0.72 });
    const bx = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    bx.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
    bx.rotation.y = rng.range(0, 3.14);
    bx.castShadow = true;
    bx.receiveShadow = true;
    g.add(bx);
    const ribbonMat = new THREE.MeshStandardMaterial({ color: 0xf0e3c4, roughness: 0.6 });
    const r1 = new THREE.Mesh(new THREE.BoxGeometry(w * 0.14, h + 0.01, d + 0.01), ribbonMat);
    r1.position.copy(bx.position);
    r1.rotation.copy(bx.rotation);
    g.add(r1);
    const r2 = new THREE.Mesh(new THREE.BoxGeometry(w + 0.01, h + 0.01, d * 0.14), ribbonMat);
    r2.position.copy(bx.position);
    r2.rotation.copy(bx.rotation);
    g.add(r2);
  }
  void m;
  g.visible = false;
  return g;
}
