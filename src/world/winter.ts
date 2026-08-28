import {
  AdditiveBlending,
  SphereGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  Points,
  PointsMaterial,
  Quaternion,
  Scene,
  BoxGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MaterialLibrary } from './materials';
import type { QualitySettings } from '../core/quality';

/**
 * Scene 6: the winter outdoors.
 *
 * The ground is one displaced plane, the route is a spline the sleigh rides
 * on rails, and everything else - trees, the village, falling snow, the
 * compressed tracks left behind - is instanced or ring-buffered so a phone
 * can carry the whole valley at once.
 */

const ROUTE_POINTS: Array<[number, number]> = [
  [0, -14],
  [0, 2],
  [0.6, 18],
  [2.6, 34],
  [3.0, 50],
  [0.5, 66],
  [-3.2, 80],
  [-3.6, 96],
  [-1.0, 110],
  [1.8, 124],
  [2.0, 140],
  [0.4, 154],
  [-1.4, 168],
  [-0.6, 182],
  [0.4, 196],
];

/** The four staged beats of the ride, as distances along the route. */
export const BEATS = {
  barnExit: 16,
  trees: 52,
  hillTop: 104,
  hillFoot: 138,
  village: 178,
};

const _bank = new Vector3();

function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm2(x: number, y: number, octaves = 4): number {
  let s = 0;
  let amp = 0.5;
  let f = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    s += valueNoise(x * f, y * f) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return s / norm;
}

/** A single low hill the route climbs and then runs down. */
function hillHeight(x: number, z: number): number {
  const a = 5.0 * Math.exp(-((z - 108) ** 2) / (2 * 30 * 30)) * Math.exp(-(x * x) / (2 * 90 * 90));
  const ridge = 9 * Math.exp(-((z - 250) ** 2) / (2 * 90 * 90));
  return a + ridge;
}

function baseHeight(x: number, z: number): number {
  return (
    hillHeight(x, z) +
    fbm2(x * 0.011 + 40, z * 0.011 + 40, 4) * 3.2 -
    1.4 +
    fbm2(x * 0.09, z * 0.09, 3) * 0.28
  );
}

export class Winter {
  readonly group = new Group();
  readonly route: CatmullRomCurve3;
  readonly routeLength: number;
  readonly sun: DirectionalLight;
  readonly hemi: HemisphereLight;
  readonly villageLights: PointLight[] = [];

  private terrain!: Mesh;
  private roadMesh!: Mesh;
  private trunks: InstancedMesh | null = null;
  private canopies: InstancedMesh | null = null;
  private farTrees: InstancedMesh | null = null;
  private snow: Points | null = null;
  private snowVel: Float32Array | null = null;
  private routeSamples: Vector3[] = [];
  private time = 0;
  private mats: MaterialLibrary;
  private haloes: Mesh[] = [];

  constructor(mats: MaterialLibrary, quality: QualitySettings) {
    this.mats = mats;

    // ---- route ---------------------------------------------------------
    const pts = ROUTE_POINTS.map(([x, z]) => new Vector3(x, 0, z));
    const flat = new CatmullRomCurve3(pts, false, 'catmullrom', 0.4);
    const N = 340;
    const lifted: Vector3[] = [];
    for (let i = 0; i <= N; i++) {
      const p = flat.getPoint(i / N);
      p.y = baseHeight(p.x, p.z);
      lifted.push(p);
    }
    // Smooth the vertical profile so the sleigh never gets a kink in the road.
    for (let pass = 0; pass < 5; pass++) {
      for (let i = 1; i < lifted.length - 1; i++) {
        lifted[i].y = (lifted[i - 1].y + lifted[i].y * 2 + lifted[i + 1].y) / 4;
      }
    }
    this.routeSamples = lifted;
    this.route = new CatmullRomCurve3(lifted, false, 'catmullrom', 0.5);
    this.routeLength = this.route.getLength();

    this.buildTerrain();
    this.buildRoad();
    this.buildBanks();
    this.buildTrees(quality.treeCount);
    this.buildBarn();
    this.buildVillage();
    this.buildSnow(quality.snowFlakes);

    // ---- light ---------------------------------------------------------
    // A low winter sun: long shadows, warm-white light, and a strong blue
    // sky term so the shadow side of the snow goes grey-blue, not black.
    // A low winter sun with a hard ratio against the sky term: this is what
    // makes lit snow read as white and shadowed snow as blue-grey, instead of
    // the whole field flattening into one value.
    this.sun = new DirectionalLight(0xffe7c4, 3.2);
    this.sun.position.set(38, 15, -62);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
    this.sun.shadow.bias = -0.0012;
    this.sun.shadow.normalBias = 0.03;
    const cam = this.sun.shadow.camera;
    cam.near = 1;
    cam.far = 70;
    cam.left = -11;
    cam.right = 11;
    cam.top = 11;
    cam.bottom = -11;
    cam.updateProjectionMatrix();
    this.group.add(this.sun);
    this.group.add(this.sun.target);

    this.hemi = new HemisphereLight(0x6c92c8, 0xcfdae6, 0.62);
    this.group.add(this.hemi);
  }

  heightAt(x: number, z: number): number {
    return baseHeight(x, z);
  }

  /** Ground height including the flattened road corridor. */
  groundAt(x: number, z: number): number {
    const near = this.nearestRoute(x, z);
    const w = Math.max(0, 1 - near.dist / 4.2);
    return baseHeight(x, z) * (1 - w) + near.y * w;
  }

  private nearestRoute(x: number, z: number): { dist: number; y: number; t: number } {
    let best = Infinity;
    let by = 0;
    let bt = 0;
    const s = this.routeSamples;
    for (let i = 0; i < s.length; i += 1) {
      const dx = s[i].x - x;
      const dz = s[i].z - z;
      const d = dx * dx + dz * dz;
      if (d < best) {
        best = d;
        by = s[i].y;
        bt = i / (s.length - 1);
      }
    }
    return { dist: Math.sqrt(best), y: by, t: bt };
  }

  // ------------------------------------------------------------ terrain --

  private buildTerrain(): void {
    const size = 460;
    const seg = 150;
    const geo = new PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, 90);
    const pos = geo.getAttribute('position') as BufferAttribute;
    const arr = pos.array as Float32Array;

    // A coarse route lookup grid: exact enough for flattening, and fast.
    for (let i = 0; i < pos.count; i++) {
      const x = arr[i * 3];
      const z = arr[i * 3 + 2];
      let y = baseHeight(x, z) + fbm2(x * 0.33 + 11, z * 0.33 + 7, 2) * 0.09;
      if (Math.abs(x) < 26 && z > -30 && z < 215) {
        const near = this.nearestRoute(x, z);
        if (near.dist < 6.5) {
          // The road is compressed and slightly dished by generations of use.
          const w = Math.pow(Math.max(0, 1 - near.dist / 6.5), 1.7);
          y = y * (1 - w) + (near.y - 0.06) * w;
        }
      }
      arr[i * 3 + 1] = y;
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();

    // Wind-carved drifts and shallow hollows, so the field has silhouette
    // even where nothing stands on it.
    this.terrain = new Mesh(geo, this.mats.snow);
    this.terrain.receiveShadow = true;
    this.group.add(this.terrain);
  }

  private buildRoad(): void {
    const steps = 260;
    const halfW = 1.85;
    const pos = new Float32Array((steps + 1) * 2 * 3);
    const uv = new Float32Array((steps + 1) * 2 * 2);
    const idx: number[] = [];
    const p = new Vector3();
    const tan = new Vector3();
    const side = new Vector3();
    const up = new Vector3(0, 1, 0);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.route.getPointAt(t, p);
      this.route.getTangentAt(t, tan);
      side.copy(tan).cross(up).normalize();
      for (let s = 0; s < 2; s++) {
        const w = s === 0 ? -halfW : halfW;
        const k = (i * 2 + s) * 3;
        pos[k] = p.x + side.x * w;
        pos[k + 1] = p.y + 0.035;
        pos[k + 2] = p.z + side.z * w;
        const j = (i * 2 + s) * 2;
        uv[j] = s;
        uv[j + 1] = t * 90;
      }
      if (i < steps) {
        const a = i * 2;
        idx.push(a, a + 2, a + 3, a, a + 3, a + 1);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('uv', new BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();

    // alpha ramp so the compacted strip fades into the loose snow
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 4;
    const ctx = c.getContext('2d')!;
    // alphaMap samples the green channel, so the ramp is written as
    // greyscale rather than as canvas alpha.
    const grad = ctx.createLinearGradient(0, 0, 32, 0);
    grad.addColorStop(0, '#000000');
    grad.addColorStop(0.2, '#e6e6e6');
    grad.addColorStop(0.8, '#e6e6e6');
    grad.addColorStop(1, '#000000');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 4);
    const alpha = new CanvasTexture(c);

    const mat = this.mats.packedSnow.clone();
    mat.alphaMap = alpha;
    mat.transparent = true;
    mat.depthWrite = false;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    this.roadMesh = new Mesh(g, mat);
    this.roadMesh.receiveShadow = true;
    this.group.add(this.roadMesh);
  }

  // -------------------------------------------------------------- trees --

  /** Ploughed banks either side of the road: the near-band relief. */
  private buildBanks(): void {
    const geo = new SphereGeometry(1, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2);
    const mat = this.mats.snow.clone();
    mat.color = new Color(0xeef3f8);
    const count = 175;
    const banks = new InstancedMesh(geo, mat, count * 2);
    banks.receiveShadow = true;
    const m = new Matrix4();
    const q = new Quaternion();
    const sc = new Vector3();
    const p = new Vector3();
    const tan = new Vector3();
    const side = new Vector3();
    const up = new Vector3(0, 1, 0);
    let n = 0;
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      this.route.getPointAt(t, p);
      this.route.getTangentAt(t, tan);
      side.copy(tan).cross(up).normalize();
      for (const s of [-1, 1]) {
        const w = 2.2 + hash2(i * 3.1, s) * 0.35;
        // Kept shallow and overlapping, so the banks merge into one berm
        // instead of reading as a row of broken slabs.
        const h = 0.11 + hash2(i * 7.7, s * 2) * 0.05;
        sc.set(0.85 + hash2(i, s) * 0.2, h, 2.2 + hash2(i * 2.2, s) * 0.5);
        q.setFromAxisAngle(up, Math.atan2(tan.x, tan.z));
        m.compose(
          _bank.copy(p).addScaledVector(side, w * s).setY(p.y - 0.06),
          q,
          sc,
        );
        banks.setMatrixAt(n++, m);
      }
    }
    banks.count = n;
    this.group.add(banks);
  }

  private buildTrees(count: number): void {
    const trunkGeo = new CylinderGeometry(0.13, 0.2, 1.6, 5);
    trunkGeo.translate(0, 0.8, 0);

    const cones: BufferGeometry[] = [];
    for (let i = 0; i < 3; i++) {
      const r = 1.5 - i * 0.42;
      const h = 2.1 - i * 0.35;
      const cone = new ConeGeometry(r, h, 7);
      cone.translate(0, 1.35 + i * 1.15, 0);
      cones.push(cone);
    }
    const canopyGeo = mergeGeometries(cones, false)!;

    const farGeo = new ConeGeometry(1.5, 4.6, 5);
    farGeo.translate(0, 2.3, 0);

    const near = Math.floor(count * 0.42);
    const far = count - near;
    this.trunks = new InstancedMesh(trunkGeo, this.mats.bark, near);
    this.canopies = new InstancedMesh(canopyGeo, this.mats.needle, near);
    this.farTrees = new InstancedMesh(farGeo, this.mats.needleFar, far);
    this.trunks.castShadow = false;
    this.canopies.castShadow = false;

    const m = new Matrix4();
    const q = new Quaternion();
    const s = new Vector3();
    const p = new Vector3();

    let placedNear = 0;
    let placedFar = 0;
    let guard = 0;
    while ((placedNear < near || placedFar < far) && guard < count * 60) {
      guard++;
      const rn = hash2(guard * 3.7, guard * 1.9);
      const rz = hash2(guard * 5.1, guard * 7.3);
      const rx = hash2(guard * 9.3, guard * 2.1);
      const wantNear = placedNear < near && (placedFar >= far || rn < 0.42);

      // Near trees hug the corridor; far trees fill the valley walls.
      const z = -40 + rz * 300;
      const lateral = wantNear ? 6 + rx * 22 : 26 + rx * 150;
      const sideSign = hash2(guard * 1.13, guard * 4.4) > 0.5 ? 1 : -1;
      const routeX = this.routeXAt(z);
      const x = routeX + lateral * sideSign;
      if (Math.abs(x) > 220) continue;
      const dist = this.nearestRoute(x, z).dist;
      if (dist < 7.2) continue;
      // A clearing where the village stands
      if (z > 168 && z < 210 && Math.abs(x - routeX) < 22) continue;

      p.set(x, baseHeight(x, z) - 0.15, z);
      const scale = 0.6 + Math.pow(hash2(guard * 8.8, guard * 6.2), 1.7) * (wantNear ? 1.35 : 2.1);
      q.setFromAxisAngle(new Vector3(0, 1, 0), hash2(guard, guard * 2) * Math.PI * 2);
      // spruces are not all the same cone: vary the slenderness and lean
      s.set(scale * (0.78 + hash2(guard * 4.2, guard) * 0.5), scale, scale * (0.78 + hash2(guard * 4.2, guard) * 0.5));
      m.compose(p, q, s);
      if (wantNear) {
        this.trunks.setMatrixAt(placedNear, m);
        this.canopies.setMatrixAt(placedNear, m);
        placedNear++;
      } else {
        this.farTrees.setMatrixAt(placedFar, m);
        placedFar++;
      }
    }
    this.trunks.count = placedNear;
    this.canopies.count = placedNear;
    this.farTrees.count = placedFar;
    this.group.add(this.trunks, this.canopies, this.farTrees);
  }

  private routeXAt(z: number): number {
    const s = this.routeSamples;
    let best = Infinity;
    let bx = 0;
    for (let i = 0; i < s.length; i++) {
      const d = Math.abs(s[i].z - z);
      if (d < best) {
        best = d;
        bx = s[i].x;
      }
    }
    return bx;
  }

  setTreeCount(count: number): void {
    if (!this.trunks || !this.canopies || !this.farTrees) return;
    const near = Math.min(this.trunks.instanceMatrix.count, Math.floor(count * 0.42));
    const far = Math.min(this.farTrees.instanceMatrix.count, count - near);
    this.trunks.count = near;
    this.canopies.count = near;
    this.farTrees.count = far;
  }

  // --------------------------------------------------------- structures --

  private buildBarn(): void {
    const barn = new Group();
    const x0 = this.routeXAt(-8);
    barn.position.set(x0 - 9.5, baseHeight(x0 - 9.5, -18), -18);

    const body = new Mesh(new BoxGeometry(9, 4.4, 7.2), this.mats.woodDark);
    body.position.y = 2.2;
    body.castShadow = true;
    body.receiveShadow = true;
    barn.add(body);

    const roofMat = this.mats.snow.clone();
    (roofMat as MeshStandardMaterial).map = null;
    (roofMat as MeshStandardMaterial).normalMap = null;
    roofMat.color = new Color(0xe6ecf3);
    for (const side of [-1, 1]) {
      const slab = new Mesh(new BoxGeometry(5.9, 0.3, 8.4), roofMat);
      slab.position.set(side * 2.5, 5.35, 0);
      slab.rotation.z = -side * 0.6;
      slab.castShadow = true;
      barn.add(slab);
    }
    for (const z of [-3.6, 3.6]) {
      const gable = new Mesh(new CylinderGeometry(0.001, 4.5, 2.7, 3), this.mats.woodDark);
      gable.rotation.y = Math.PI / 2;
      gable.rotation.z = Math.PI;
      gable.position.set(0, 5.15, z);
      gable.scale.set(1.02, 1, 0.06);
      barn.add(gable);
    }

    // the open doorway the sleigh comes out of
    const doorway = new Mesh(new BoxGeometry(3.1, 3.3, 0.3), new MeshBasicMaterial({ color: 0x1a1611 }));
    doorway.position.set(3.1, 1.65, 3.6);
    barn.add(doorway);
    for (const dx of [-1.8, 1.8]) {
      const post = new Mesh(new BoxGeometry(0.24, 3.4, 0.32), this.mats.wood);
      post.position.set(3.1 + dx, 1.7, 3.68);
      barn.add(post);
    }
    // a warm lamp over the door, the only light source out here besides the sun
    const lamp = new PointLight(0xffc179, 5.5, 12, 2);
    lamp.position.set(3.1, 3.5, 4.1);
    barn.add(lamp);
    this.villageLights.push(lamp);
    const lampMesh = new Mesh(new BoxGeometry(0.22, 0.26, 0.22), this.mats.windowGlow);
    lampMesh.position.copy(lamp.position);
    barn.add(lampMesh);

    this.group.add(barn);
  }

  private buildVillage(): void {
    const village = new Group();
    // Every house is turned to face the road, so its lit windows are what the
    // sleigh sees on the way in.
    const houses: Array<[number, number, number, number]> = [
      [-9.5, 184, 0.22, 1.1],
      [9.0, 190, -0.18, 1.25],
      [-7.2, 199, -0.15, 0.95],
      [11.5, 203, 0.2, 1.05],
      [-13.5, 210, 0.1, 0.85],
    ];
    for (const [dx, z, rot, scale] of houses) {
      const x = this.routeXAt(z) + dx;
      const h = new Group();
      h.position.set(x, baseHeight(x, z), z);
      h.rotation.y = (dx < 0 ? Math.PI / 2 : -Math.PI / 2) + rot;
      h.scale.setScalar(scale);

      const walls = new Mesh(new BoxGeometry(4.6, 2.9, 4.0), this.mats.wood);
      walls.position.y = 1.45;
      walls.castShadow = true;
      walls.receiveShadow = true;
      h.add(walls);

      // A gable roof built from two slabs: snow on top, dark boards beneath,
      // so the eaves read as a real edge and not a paper triangle.
      const roofMat = this.mats.snow.clone();
      roofMat.map = null;
      roofMat.normalMap = null;
      roofMat.color = new Color(0xe6ecf3);
      const pitch = 0.62;
      for (const side of [-1, 1]) {
        const slab = new Mesh(new BoxGeometry(3.1, 0.22, 4.9), roofMat);
        slab.position.set(side * 1.28, 3.75, 0);
        slab.rotation.z = -side * pitch;
        slab.castShadow = true;
        slab.receiveShadow = true;
        h.add(slab);
        const soffit = new Mesh(new BoxGeometry(3.06, 0.09, 4.7), this.mats.woodDark);
        soffit.position.set(side * 1.27, 3.63, 0);
        soffit.rotation.z = -side * pitch;
        h.add(soffit);
      }
      // gable ends fill the triangle above the walls
      for (const z of [-2.0, 2.0]) {
        const gable = new Mesh(new CylinderGeometry(0.001, 2.35, 1.55, 3), this.mats.wood);
        gable.rotation.y = Math.PI / 2;
        gable.rotation.z = Math.PI;
        gable.position.set(0, 3.65, z);
        gable.scale.set(1.02, 1, 0.06);
        h.add(gable);
      }

      const chimney = new Mesh(new BoxGeometry(0.5, 1.3, 0.5), this.mats.woodDark);
      chimney.position.set(1.15, 4.1, -0.9);
      h.add(chimney);

      // Windows are the warm light in the far band: they must read at 100 m.
      for (const [wx, wz, ry] of [
        [0, 2.05, 0],
        [-2.35, 0.4, Math.PI / 2],
      ] as Array<[number, number, number]>) {
        const win = new Mesh(new PlaneGeometry(0.95, 0.8), this.mats.windowGlow);
        win.position.set(wx, 1.55, wz);
        win.rotation.y = ry;
        h.add(win);
        // a soft halo so the lit window still reads from a hundred metres
        const halo = new Mesh(
          new PlaneGeometry(2.3, 2.0),
          new MeshBasicMaterial({
            map: this.mats.tex.puff,
            color: new Color(0xffcf8e),
            transparent: true,
            opacity: 0.5,
            depthWrite: false,
            blending: AdditiveBlending,
          }),
        );
        halo.position.set(wx * 1.06, 1.55, wz * 1.06);
        halo.rotation.y = ry;
        halo.renderOrder = 4;
        h.add(halo);
        const frame = new Mesh(new BoxGeometry(1.1, 0.95, 0.08), this.mats.woodDark);
        frame.position.set(wx * 1.02, 1.55, wz * 1.02);
        frame.rotation.y = ry;
        h.add(frame);
      }

      const glow = new PointLight(0xffbe7a, 4.2, 11, 2);
      glow.position.set(0, 1.7, 2.4);
      h.add(glow);
      this.villageLights.push(glow);

      // A porch lamp beside the door: the warm point the arrival aims at.
      const lamp = new Mesh(new BoxGeometry(0.26, 0.32, 0.26), this.mats.windowGlow);
      lamp.position.set(1.5, 2.15, 2.12);
      h.add(lamp);
      const lampHalo = new Mesh(
        new PlaneGeometry(1.8, 1.8),
        new MeshBasicMaterial({
          map: this.mats.tex.puff,
          color: new Color(0xffc386),
          transparent: true,
          opacity: 0.6,
          depthWrite: false,
          blending: AdditiveBlending,
        }),
      );
      lampHalo.position.copy(lamp.position);
      lampHalo.renderOrder = 4;
      h.add(lampHalo);
      this.haloes.push(lampHalo);
      const lampLight = new PointLight(0xffc07a, 3.0, 8, 2);
      lampLight.position.copy(lamp.position);
      h.add(lampLight);
      this.villageLights.push(lampLight);
      village.add(h);
    }

    // lantern posts along the last stretch of road
    for (let i = 0; i < 4; i++) {
      const z = 176 + i * 11;
      const x = this.routeXAt(z) + (i % 2 === 0 ? 3.1 : -3.1);
      const post = new Group();
      post.position.set(x, baseHeight(x, z), z);
      const pole = new Mesh(new CylinderGeometry(0.06, 0.08, 2.9, 6), this.mats.woodDark);
      pole.position.y = 1.45;
      post.add(pole);
      const head = new Mesh(new BoxGeometry(0.3, 0.36, 0.3), this.mats.windowGlow);
      head.position.y = 3.0;
      post.add(head);
      const halo = new Mesh(
        new PlaneGeometry(1.5, 1.5),
        new MeshBasicMaterial({
          map: this.mats.tex.puff,
          color: new Color(0xffc98c),
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
          blending: AdditiveBlending,
        }),
      );
      halo.position.y = 3.0;
      halo.renderOrder = 4;
      post.add(halo);
      this.haloes.push(halo);
      const cap = new Mesh(new ConeGeometry(0.28, 0.22, 4), this.mats.iron);
      cap.position.y = 3.28;
      post.add(cap);
      const l = new PointLight(0xffc98c, 3.4, 9, 2);
      l.position.y = 3.0;
      post.add(l);
      this.villageLights.push(l);
      village.add(post);
    }

    // A rail fence along the road: near-band detail with a readable rhythm.
    for (let i = 0; i < 22; i++) {
      const z = 174 + i * 1.9;
      const x = this.routeXAt(z) - 3.6;
      const y = baseHeight(x, z);
      const post = new Mesh(new BoxGeometry(0.1, 1.0, 0.1), this.mats.woodDark);
      post.position.set(x, y + 0.5, z);
      post.rotation.z = (hash2(i, 3) - 0.5) * 0.1;
      village.add(post);
      if (i === 0) continue;
      for (const ry of [0.78, 0.42]) {
        const rail = new Mesh(new BoxGeometry(0.07, 0.07, 1.95), this.mats.woodDark);
        rail.position.set(x, y + ry, z - 0.95);
        rail.rotation.x = (hash2(i, ry) - 0.5) * 0.06;
        village.add(rail);
      }
    }

    this.group.add(village);
  }

  // ------------------------------------------------------------- snowfall --

  private buildSnow(count: number): void {
    const geo = new BufferGeometry();
    const pos = new Float32Array(count * 3);
    this.snowVel = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 44;
      pos[i * 3 + 1] = Math.random() * 16;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 44;
      this.snowVel[i * 3] = (Math.random() - 0.5) * 0.35;
      this.snowVel[i * 3 + 1] = -(0.35 + Math.random() * 0.5);
      this.snowVel[i * 3 + 2] = (Math.random() - 0.5) * 0.35;
    }
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    const mat = new PointsMaterial({
      size: 0.055,
      map: this.mats.tex.flake,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      sizeAttenuation: true,
      blending: AdditiveBlending,
    });
    this.snow = new Points(geo, mat);
    this.snow.frustumCulled = false;
    this.group.add(this.snow);
  }

  setSnowCount(count: number): void {
    if (!this.snow) return;
    const geo = this.snow.geometry;
    geo.setDrawRange(0, Math.min(count, geo.getAttribute('position').count));
  }

  // --------------------------------------------------------------- frame --

  update(dt: number, focus: Vector3, wind: number): void {
    this.time += dt;

    if (this.snow && this.snowVel) {
      const attr = this.snow.geometry.getAttribute('position') as BufferAttribute;
      const arr = attr.array as Float32Array;
      const n = attr.count;
      const gust = Math.sin(this.time * 0.35) * 0.5 + Math.sin(this.time * 0.13) * 0.5;
      for (let i = 0; i < n; i++) {
        const k = i * 3;
        arr[k] += (this.snowVel[k] + gust * wind * 1.4) * dt;
        arr[k + 1] += this.snowVel[k + 1] * dt;
        arr[k + 2] += (this.snowVel[k + 2] + wind * 0.6) * dt;
        // wrap around the camera so the field always looks full
        const dx = arr[k] - focus.x;
        const dz = arr[k + 2] - focus.z;
        if (arr[k + 1] < focus.y - 3) {
          arr[k + 1] = focus.y + 13;
          arr[k] = focus.x + (Math.random() - 0.5) * 40;
          arr[k + 2] = focus.z + (Math.random() - 0.5) * 40;
        }
        if (dx > 22) arr[k] -= 44;
        else if (dx < -22) arr[k] += 44;
        if (dz > 22) arr[k + 2] -= 44;
        else if (dz < -22) arr[k + 2] += 44;
      }
      attr.needsUpdate = true;
    }

    // Keep the shadow volume tight around the horse: sharp where it matters,
    // and nowhere near the distant forest.
    this.sun.position.set(focus.x + 22, focus.y + 20, focus.z - 34);
    this.sun.target.position.copy(focus);
    this.sun.target.updateMatrixWorld();

    // Lamp haloes always face the viewer.
    for (const h of this.haloes) h.lookAt(focus.x, h.getWorldPosition(_bank).y, focus.z);
  }

  applyQuality(q: QualitySettings): void {
    this.setSnowCount(q.snowFlakes);
    this.setTreeCount(q.treeCount);
    if (q.shadowSize > 0) {
      this.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      if (this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null as never;
      }
    }
    this.sun.castShadow = q.shadowSize > 0;
  }

  applyFog(scene: Scene): void {
    scene.fog = new Fog(0xccdae8, 60, 560);
  }

  addTo(parent: Object3D): void {
    parent.add(this.group);
  }
}

/**
 * Compressed snow left behind: a ring buffer of quads, written as the runners
 * and hooves pass. No render targets, no decal projection.
 */
export class TrackRibbon {
  readonly mesh: Mesh;
  private geo: BufferGeometry;
  private capacity: number;
  private head = 0;
  private used = 0;
  private lastAt = new Vector3(0, -999, 0);

  constructor(mats: MaterialLibrary, capacity = 420) {
    this.capacity = capacity;
    this.geo = new BufferGeometry();
    const pos = new Float32Array(capacity * 4 * 3);
    const uv = new Float32Array(capacity * 4 * 2);
    const nor = new Float32Array(capacity * 4 * 3);
    const idx = new Uint16Array(capacity * 6);
    for (let i = 0; i < capacity; i++) {
      const a = i * 4;
      idx.set([a, a + 2, a + 1, a, a + 3, a + 2], i * 6);
      uv.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8);
      // The quads lie flat on the snow; without normals they shade black.
      for (let c = 0; c < 4; c++) nor.set([0, 1, 0], (a + c) * 3);
    }
    this.geo.setAttribute('position', new BufferAttribute(pos, 3));
    this.geo.setAttribute('normal', new BufferAttribute(nor, 3));
    this.geo.setAttribute('uv', new BufferAttribute(uv, 2));
    this.geo.setIndex(new BufferAttribute(idx, 1));
    this.geo.setDrawRange(0, 0);

    const mat = mats.packedSnow.clone();
    mat.normalMap = null;
    mat.color = new Color(0xa9b7c7);
    mat.opacity = 0.5;
    mat.transparent = true;
    mat.depthWrite = false;
    mat.side = DoubleSide;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -4;
    this.mesh = new Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  /** Stamp one quad centred on `p`, `w` wide, aligned to `dir`. */
  stamp(p: Vector3, dir: Vector3, w: number, len: number): void {
    if (p.distanceTo(this.lastAt) < len * 0.55) return;
    this.lastAt.copy(p);
    const side = new Vector3(-dir.z, 0, dir.x).normalize().multiplyScalar(w * 0.5);
    const fwd = new Vector3(dir.x, 0, dir.z).normalize().multiplyScalar(len * 0.5);
    const arr = this.geo.getAttribute('position').array as Float32Array;
    const base = this.head * 12;
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    for (let c = 0; c < 4; c++) {
      const [a, b] = corners[c];
      arr[base + c * 3] = p.x + side.x * a + fwd.x * b;
      arr[base + c * 3 + 1] = p.y + 0.012;
      arr[base + c * 3 + 2] = p.z + side.z * a + fwd.z * b;
    }
    this.head = (this.head + 1) % this.capacity;
    this.used = Math.min(this.capacity, this.used + 1);
    this.geo.setDrawRange(0, this.used * 6);
    this.geo.getAttribute('position').needsUpdate = true;
  }

  clear(): void {
    this.head = 0;
    this.used = 0;
    this.lastAt.set(0, -999, 0);
    this.geo.setDrawRange(0, 0);
  }
}
