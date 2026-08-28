import * as THREE from 'three';
import type { DispatchKind } from '../types';
import type { MaterialLibrary } from './materials';

const RADIAL = 24;
const RINGS = 14;

interface Profile {
  height: number;
  bottom: number;
  mid: number;
  mouth: number;
  slump: number;
}

const EMPTY: Profile = { height: 0.44, bottom: 0.15, mid: 0.115, mouth: 0.095, slump: 0.05 };
const HALF: Profile = { height: 0.5, bottom: 0.21, mid: 0.175, mouth: 0.1, slump: 0.03 };
const FULL: Profile = { height: 0.56, bottom: 0.25, mid: 0.225, mouth: 0.105, slump: 0.012 };

function radiusAt(p: Profile, t: number): number {
  // t: 0 bottom .. 1 mouth. Round bottom, waisted middle, gathered mouth.
  const bottomFall = Math.sqrt(Math.max(0, 1 - (1 - Math.min(t / 0.22, 1)) ** 2));
  const body = t < 0.22 ? p.bottom * bottomFall : p.bottom + (p.mid - p.bottom) * ((t - 0.22) / 0.5);
  const upper = t < 0.72 ? body : p.mid + (p.mouth - p.mid) * ((t - 0.72) / 0.28);
  return t < 0.72 ? body : upper;
}

/** Deterministic canvas folds so the sack never reads as a box. */
function foldOffset(t: number, a: number): number {
  return (
    Math.sin(a * 5 + t * 3.1) * 0.011 +
    Math.sin(a * 9 - t * 5.4) * 0.006 +
    Math.sin(a * 3 + t * 1.7) * 0.008
  ) * (0.35 + 0.65 * t);
}

function writeProfile(target: Float32Array, p: Profile, gathered: boolean): void {
  let i = 0;
  for (let r = 0; r <= RINGS; r++) {
    const t = r / RINGS;
    for (let s = 0; s <= RADIAL; s++) {
      const a = (s / RADIAL) * Math.PI * 2;
      let rad = radiusAt(p, t) + foldOffset(t, a);
      let y = t * p.height;
      if (gathered && t > 0.68) {
        const k = (t - 0.68) / 0.32;
        rad = rad * (1 - k) + 0.022 * k;
        y += k * 0.02;
      }
      // the sack leans on its own weight
      const lean = p.slump * (t * t);
      target[i++] = Math.cos(a) * rad + lean;
      target[i++] = y;
      target[i++] = Math.sin(a) * rad;
    }
  }
}

function buildSackGeometry(): THREE.BufferGeometry {
  const vertCount = (RINGS + 1) * (RADIAL + 1);
  const pos = new Float32Array(vertCount * 3);
  const uv = new Float32Array(vertCount * 2);
  writeProfile(pos, EMPTY, false);

  let ui = 0;
  for (let r = 0; r <= RINGS; r++) {
    for (let s = 0; s <= RADIAL; s++) {
      uv[ui++] = s / RADIAL;
      uv[ui++] = r / RINGS;
    }
  }

  const index: number[] = [];
  for (let r = 0; r < RINGS; r++) {
    for (let s = 0; s < RADIAL; s++) {
      const a = r * (RADIAL + 1) + s;
      const b = a + RADIAL + 1;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(index);

  const half = new Float32Array(vertCount * 3);
  writeProfile(half, HALF, false);
  const full = new Float32Array(vertCount * 3);
  writeProfile(full, FULL, false);
  const closed = new Float32Array(vertCount * 3);
  writeProfile(closed, FULL, true);

  geo.morphAttributes.position = [
    new THREE.BufferAttribute(half, 3),
    new THREE.BufferAttribute(full, 3),
    new THREE.BufferAttribute(closed, 3),
  ];
  geo.computeVertexNormals();
  return geo;
}

let sharedGeo: THREE.BufferGeometry | null = null;

export interface BagOptions {
  dark?: boolean;
  withClasp?: boolean;
  snow?: boolean;
}

/**
 * A canvas mail bag: woven, creased, dirty at the foot, bulging by load stage.
 * Not a cloth simulation - discrete load morphs, which is what a 4 year old reads anyway.
 */
export class PostalBag {
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh;
  readonly claspGroup: THREE.Group | null = null;
  readonly mouthAnchor = new THREE.Object3D();

  private load = 0;
  private closedAmount = 0;
  private snowPatches: THREE.Mesh[] = [];
  private drawstring: THREE.Mesh;
  readonly cordHit: THREE.Mesh;
  private seal: THREE.Group | null = null;
  private mats: MaterialLibrary;

  constructor(mats: MaterialLibrary, opts: BagOptions = {}) {
    this.mats = mats;
    if (!sharedGeo) sharedGeo = buildSackGeometry();

    this.mesh = new THREE.Mesh(sharedGeo, opts.dark ? mats.bagCanvasDark : mats.bagCanvas);
    this.mesh.material = (this.mesh.material as THREE.MeshStandardMaterial).clone();
    (this.mesh.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.morphTargetInfluences = [0, 0, 0];
    this.group.add(this.mesh);

    // the draw cord sits in the gather groove
    const cord = new THREE.Mesh(new THREE.TorusGeometry(0.098, 0.006, 6, 22), mats.rope);
    cord.rotation.x = Math.PI / 2;
    cord.position.y = EMPTY.height * 0.86;
    this.drawstring = cord;
    this.group.add(cord);

    this.mouthAnchor.position.y = EMPTY.height;
    this.group.add(this.mouthAnchor);

    // a generous invisible grip so small fingers can find the cord
    this.cordHit = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.26, 0.34),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    this.cordHit.position.y = EMPTY.height * 0.86;
    this.group.add(this.cordHit);

    if (opts.withClasp) {
      const g = new THREE.Group();
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.016, 0.02), mats.brass);
      g.add(bar);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.005, 6, 16), mats.brass);
      ring.position.set(0.108, 0, 0);
      ring.rotation.y = Math.PI / 2;
      g.add(ring);
      for (const x of [-0.06, 0.02]) {
        const lug = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.03, 0.024), mats.brass);
        lug.position.set(x, -0.012, 0);
        g.add(lug);
      }
      g.position.y = EMPTY.height + 0.005;
      this.claspGroup = g;
      this.group.add(g);
    }

    if (opts.snow) this.addSnow();
  }

  addSnow(): void {
    const geo = new THREE.SphereGeometry(0.035, 10, 7);
    const seedPts: [number, number, number][] = [
      [0.05, 0.4, 0.06],
      [-0.07, 0.33, -0.03],
      [0.02, 0.44, -0.08],
      [0.1, 0.26, -0.02],
      [-0.04, 0.2, 0.1],
    ];
    for (const [x, y, z] of seedPts) {
      const m = new THREE.Mesh(geo, this.mats.snow);
      m.position.set(x, y, z);
      m.scale.set(1, 0.42, 1);
      this.snowPatches.push(m);
      this.group.add(m);
    }
  }

  /** Snow gives up quickly in a heated hall. */
  meltSnow(dt: number): void {
    if (!this.snowPatches.length) return;
    let alive = false;
    for (const p of this.snowPatches) {
      p.scale.multiplyScalar(Math.max(0, 1 - dt * 0.55));
      if (p.scale.x > 0.02) alive = true;
      else p.visible = false;
    }
    if (!alive) {
      for (const p of this.snowPatches) this.group.remove(p);
      this.snowPatches = [];
    }
  }

  /** 0..1 across the two load morphs; the sack visibly takes weight. */
  setLoad(v: number): void {
    this.load = THREE.MathUtils.clamp(v, 0, 1);
    const inf = this.mesh.morphTargetInfluences;
    if (!inf) return;
    inf[0] = THREE.MathUtils.clamp(this.load * 2, 0, 1) * (1 - this.closedAmount);
    inf[1] = THREE.MathUtils.clamp(this.load * 2 - 1, 0, 1) * (1 - this.closedAmount);
    inf[2] = this.closedAmount;
    const h = EMPTY.height + (FULL.height - EMPTY.height) * this.load;
    this.drawstring.position.y = h * 0.86;
    this.cordHit.position.y = h * 0.86;
    this.mouthAnchor.position.y = h;
  }

  get cordMesh(): THREE.Mesh {
    return this.drawstring;
  }

  get loadAmount(): number {
    return this.load;
  }

  setClosed(v: number): void {
    this.closedAmount = THREE.MathUtils.clamp(v, 0, 1);
    // the cord gathers rather than being rebuilt every frame
    const k = 1 - 0.7 * this.closedAmount;
    this.drawstring.scale.set(k, k, 1);
    this.setLoad(this.load);
  }

  get closed(): boolean {
    return this.closedAmount > 0.98;
  }

  /** Two different seal tags stand in for the two dispatch methods. */
  attachSeal(kind: DispatchKind): THREE.Group {
    if (this.seal) return this.seal;
    const g = new THREE.Group();
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 0.06, 5), this.mats.rope);
    string.position.y = -0.03;
    g.add(string);

    let plate: THREE.Mesh;
    if (kind === 'today') {
      plate = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.005, 18), this.mats.paintedRed);
      plate.rotation.x = Math.PI / 2;
    } else {
      const shape = new THREE.Shape();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
        const r = i % 2 === 0 ? 0.036 : 0.017;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
      }
      shape.closePath();
      plate = new THREE.Mesh(
        new THREE.ExtrudeGeometry(shape, { depth: 0.005, bevelEnabled: false }),
        this.mats.paintedBlue,
      );
    }
    plate.position.y = -0.075;
    plate.castShadow = true;
    g.add(plate);

    g.position.copy(this.mouthAnchor.position);
    g.position.x += 0.045;
    this.seal = g;
    this.group.add(g);
    return g;
  }

  get sealed(): boolean {
    return this.seal !== null;
  }

  dispose(): void {
    (this.mesh.material as THREE.Material).dispose();
    this.drawstring.geometry.dispose();
  }
}
