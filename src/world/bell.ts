import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  SphereGeometry,
  CylinderGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MaterialLibrary } from './materials';
import type { Strap, StrapFrame } from './strap';

/**
 * Crotal ("sleigh") bells: a stamped brass shell crimped at its equator, a
 * cross-shaped slit in the lower half, two sound holes, and a riveted shank
 * that passes through the strap.
 *
 * Geometry is authored once at unit radius with the pivot at the strap face,
 * then instanced. The slit is a genuine hole in the shell, so the loose ball
 * inside is actually visible - and its collisions with the shell wall are what
 * schedule the audio, rather than a metronome tied to the horse's stride.
 */

export type BellSize = 0 | 1 | 2;

export const BELL_RADIUS: Record<BellSize, number> = { 0: 0.019, 1: 0.027, 2: 0.037 };
/** relative mass hung on the strap by one bell */
export const BELL_LOAD: Record<BellSize, number> = { 0: 0.65, 1: 1.5, 2: 2.9 };

export interface BellStrike {
  size: BellSize;
  /** 0..1 */
  intensity: number;
  index: number;
  /** cents of detune unique to this shell */
  detune: number;
  pos: Vector3;
}

interface BellState {
  size: BellSize;
  radius: number;
  socket: number;
  u: number;
  hero: boolean;
  detune: number;
  /** rivet compliance, radians */
  ax: number;
  avx: number;
  az: number;
  avz: number;
  /** loose ball: centre offset from the shell centre, and its velocity */
  ball: Vector3;
  ballVel: Vector3;
  quietFor: number;
  seat: number;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _s = new Vector3();
const _p = new Vector3();
const _acc = new Vector3();
const _local = new Vector3();
const _basis = new Matrix4();
const _emitM = new Matrix4();
const _keeperQ = new Quaternion();
const _turn = new Quaternion();
const _inv = new Quaternion();
const _flex = new Quaternion();
const _tmpQ = new Quaternion();
const _gLocal = new Vector3();
const _aLocal = new Vector3();
const _n = new Vector3();
const _axisX = new Vector3(1, 0, 0);
const _axisY = new Vector3(0, 1, 0);
const _axisZ = new Vector3(0, 0, 1);

// ------------------------------------------------------------- geometry ----

/**
 * A UV sphere whose faces are dropped wherever `hole` reports true, giving the
 * shell a genuine opening instead of a dark decal pretending to be one.
 */
function piercedSphere(
  radius: number,
  segW: number,
  segH: number,
  flattenY: number,
  hole: (dir: Vector3) => boolean,
  inward: boolean,
): BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const dir = new Vector3();
  const grid: Vector3[][] = [];
  const norms: Vector3[][] = [];
  for (let iy = 0; iy <= segH; iy++) {
    const row: Vector3[] = [];
    const nrow: Vector3[] = [];
    const v = iy / segH;
    const theta = v * Math.PI;
    for (let ix = 0; ix <= segW; ix++) {
      const u = ix / segW;
      const phi = u * Math.PI * 2;
      const d = new Vector3(
        -Math.sin(theta) * Math.cos(phi),
        Math.cos(theta),
        Math.sin(theta) * Math.sin(phi),
      );
      const p = d.clone().multiplyScalar(radius);
      p.y *= flattenY;
      row.push(p);
      const n = d.clone();
      n.y /= flattenY;
      n.normalize();
      if (inward) n.negate();
      nrow.push(n);
    }
    grid.push(row);
    norms.push(nrow);
  }

  const push = (iy: number, ix: number) => {
    const p = grid[iy][ix];
    const n = norms[iy][ix];
    pos.push(p.x, p.y, p.z);
    nor.push(n.x, n.y, n.z);
    uv.push(ix / segW, 1 - iy / segH);
  };

  for (let iy = 0; iy < segH; iy++) {
    for (let ix = 0; ix < segW; ix++) {
      // A quad is dropped only when its centre is inside the cut.
      dir.copy(grid[iy][ix]).add(grid[iy + 1][ix + 1]).multiplyScalar(0.5).normalize();
      if (hole(dir)) continue;
      const a: Array<[number, number]> = [
        [iy, ix],
        [iy + 1, ix],
        [iy + 1, ix + 1],
        [iy, ix],
        [iy + 1, ix + 1],
        [iy, ix + 1],
      ];
      const order = inward ? [a[0], a[2], a[1], a[3], a[5], a[4]] : a;
      for (const [y, x] of order) push(y, x);
    }
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  return g;
}

/** True inside the cross-shaped slit and the two sound holes. */
function bellCut(d: Vector3): boolean {
  if (d.y > -0.18) return false;
  const down = -d.y;
  // main slit: a band through the lower pole running along X
  const slitA = Math.abs(d.z) < 0.12 && down > 0.28 && Math.abs(d.x) < 0.92;
  // short cross arms at the ends of the main slit
  const slitB = Math.abs(d.x) < 0.12 && down > 0.5;
  return slitA || slitB;
}

function soundHoles(radius: number, flattenY: number): BufferGeometry[] {
  const out: BufferGeometry[] = [];
  for (const [ax, az] of [
    [0.62, 0.62],
    [-0.62, -0.62],
  ]) {
    const g = new SphereGeometry(radius * 0.13, 8, 6);
    const d = new Vector3(ax, -0.42, az).normalize();
    g.translate(d.x * radius * 0.93, d.y * radius * flattenY * 0.93, d.z * radius * 0.93);
    out.push(g);
  }
  return out;
}

interface BellGeometry {
  shell: BufferGeometry;
  inner: BufferGeometry;
  clapper: BufferGeometry;
}

/**
 * Everything is authored with the pivot (the point where the rivet meets the
 * outer face of the leather) at the origin and the bell hanging down -Y.
 */
function buildBellGeometry(): BellGeometry {
  const flat = 0.94;
  const centre = -1.42;

  const shellParts: BufferGeometry[] = [];

  const shell = piercedSphere(1, 22, 16, flat, bellCut, false);
  shell.translate(0, centre, 0);
  shellParts.push(shell);

  // equator crimp, where the two stamped halves are joined
  const rim = new TorusGeometry(1.0, 0.052, 6, 22);
  rim.rotateX(Math.PI / 2);
  rim.translate(0, centre, 0);
  shellParts.push(rim);

  // petal foot plate + shank rivet
  // A flat stamped foot where the shell meets the leather, and the shank that
  // goes through it. Nothing decorative: this is the joint that carries the
  // bell's weight.
  const petal = new CylinderGeometry(0.46, 0.4, 0.09, 14);
  petal.translate(0, centre + flat * 0.93, 0);
  shellParts.push(petal);

  const shank = new CylinderGeometry(0.13, 0.15, 0.42, 8);
  shank.translate(0, centre + flat * 0.93 + 0.24, 0);
  shellParts.push(shank);

  // the flattened rivet head that stops the shank pulling back out
  const pin = new CylinderGeometry(0.22, 0.18, 0.07, 10);
  pin.translate(0, 0.055, 0);
  shellParts.push(pin);

  const holes = soundHoles(1, flat);
  for (const h of holes) {
    h.translate(0, centre, 0);
    shellParts.push(h);
  }

  // piercedSphere is non-indexed by construction, the primitives are indexed:
  // flatten everything before merging.
  const merged = mergeGeometries(
    shellParts.map((g) => (g.index ? g.toNonIndexed() : g)),
    false,
  )!;
  // Authored hanging downwards for readability, then turned over: the shank
  // passes through the leather and the shell stands proud of the outer face.
  merged.rotateX(Math.PI);

  // The inside of the shell, seen through the slit: dark, and lit from behind
  // only by whatever squeezes past the ball.
  const inner = piercedSphere(0.9, 16, 12, flat, () => false, true);
  inner.translate(0, centre, 0);
  inner.rotateX(Math.PI);

  const clapper = new SphereGeometry(0.34, 10, 8);

  return { shell: merged, inner, clapper };
}

let sharedGeometry: BellGeometry | null = null;

function geometry(): BellGeometry {
  if (!sharedGeometry) sharedGeometry = buildBellGeometry();
  return sharedGeometry;
}

/**
 * A single loose bell, for the tray and for the one being carried. Same
 * geometry as the fitted bells, so nothing changes shape when it seats.
 */
export function makeLooseBell(mats: MaterialLibrary, size: BellSize): Group {
  const g = geometry();
  const grp = new Group();
  const shell = new Mesh(g.shell, mats.brass);
  shell.castShadow = true;
  const inner = new Mesh(g.inner, mats.bellMouth);
  const ball = new Mesh(g.clapper, mats.steel);
  ball.position.y = 1.42 - 0.42;
  grp.add(shell, inner, ball);
  grp.scale.setScalar(BELL_RADIUS[size]);
  grp.userData.size = size;
  grp.userData.ball = ball;
  return grp;
}

// ----------------------------------------------------------------- field ---

export class BellField {
  readonly group = new Group();
  readonly bells: BellState[] = [];

  private shellMesh: InstancedMesh;
  private innerMesh: InstancedMesh;
  private clapperMesh: InstancedMesh;
  private keeperMesh: InstancedMesh;
  private capacity: number;
  private frame: StrapFrame = {
    pos: new Vector3(),
    tangent: new Vector3(),
    normal: new Vector3(),
    binormal: new Vector3(),
  };
  private heroLimit: number;

  constructor(mats: MaterialLibrary, capacity = 16, heroLimit = 3) {
    if (!sharedGeometry) sharedGeometry = buildBellGeometry();
    this.capacity = capacity;
    this.heroLimit = heroLimit;

    this.shellMesh = new InstancedMesh(sharedGeometry.shell, mats.brass, capacity);
    this.innerMesh = new InstancedMesh(sharedGeometry.inner, mats.bellMouth, capacity);
    this.clapperMesh = new InstancedMesh(sharedGeometry.clapper, mats.steel, capacity);
    // The keeper on the back of the leather: it turns a quarter turn once, as
    // the shank seats, and then never moves again.
    const keeperGeo = new TorusGeometry(0.3, 0.075, 5, 10);
    keeperGeo.scale(1, 1, 0.5);
    keeperGeo.rotateX(Math.PI / 2);
    this.keeperMesh = new InstancedMesh(keeperGeo, mats.iron, capacity);
    for (const m of [this.shellMesh, this.innerMesh, this.clapperMesh, this.keeperMesh]) {
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      m.castShadow = m === this.shellMesh;
      this.group.add(m);
    }

    // Small colour drift between shells: no two are aged alike.
    const c = new Color();
    for (let i = 0; i < capacity; i++) {
      const t = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      const k = 0.86 + Math.abs(t) * 0.28;
      c.setRGB(k, k * (0.97 + Math.abs(t) * 0.05), k * 0.93);
      this.shellMesh.setColorAt(i, c);
    }
    if (this.shellMesh.instanceColor) this.shellMesh.instanceColor.needsUpdate = true;
  }

  setHeroLimit(n: number): void {
    this.heroLimit = n;
    this.bells.forEach((b, i) => (b.hero = i < n));
  }

  get count(): number {
    return this.bells.length;
  }

  clear(): void {
    this.bells.length = 0;
    this.sync();
  }

  add(size: BellSize, socket: number, u: number): number {
    if (this.bells.length >= this.capacity) return -1;
    const idx = this.bells.length;
    const seed = Math.abs(Math.sin((socket + 1) * 91.7) * 1000) % 1;
    this.bells.push({
      size,
      radius: BELL_RADIUS[size],
      socket,
      u,
      hero: false,
      detune: (seed - 0.5) * 46,
      ax: 0,
      avx: 0,
      az: 0,
      avz: 0,
      ball: new Vector3((seed - 0.5) * 0.004, -0.004, 0),
      ballVel: new Vector3(),
      quietFor: 10,
      seat: 0,
    });
    this.sync();
    return idx;
  }

  removeAt(index: number): void {
    this.bells.splice(index, 1);
    this.sync();
  }

  hasSocket(socket: number): boolean {
    return this.bells.some((b) => b.socket === socket);
  }

  /** Re-pick which bells are close enough to deserve a simulated ball. */
  private sync(): void {
    const n = this.bells.length;
    this.shellMesh.count = n;
    this.innerMesh.count = n;
    this.clapperMesh.count = n;
    this.keeperMesh.count = n;
    this.bells.forEach((b, i) => (b.hero = i < this.heroLimit));
  }

  loadsPerSocket(socketCount: number): number[] {
    const out = new Array<number>(socketCount).fill(0);
    for (const b of this.bells) {
      if (b.socket >= 0 && b.socket < socketCount) out[b.socket] += BELL_LOAD[b.size] * b.seat;
    }
    return out;
  }

  /** Kick every bell, as though the whole strap had just been jolted. */
  jolt(strength: number): void {
    for (const b of this.bells) {
      b.avx += (Math.random() - 0.5) * strength * 5;
      b.avz += (Math.random() - 0.5) * strength * 4;
      b.ballVel.x += (Math.random() - 0.5) * strength * 2.4;
      b.ballVel.y += (Math.random() - 0.5) * strength * 1.8;
      b.ballVel.z += (Math.random() - 0.5) * strength * 2.0;
    }
  }

  update(dt: number, strap: Strap, out: BellStrike[]): void {
    const h = Math.min(dt, 1 / 45);
    for (let i = 0; i < this.bells.length; i++) {
      const b = this.bells[i];
      b.seat = Math.min(1, b.seat + h * 4.2);
      strap.frameAtParam(b.u, this.frame);
      strap.accelAtParam(b.u, _acc);

      // Orientation: the shell's own axis is the strap's outward normal.
      _basis.makeBasis(this.frame.binormal, this.frame.normal, this.frame.tangent);
      _q.setFromRotationMatrix(_basis);

      // The rivet is not a hinge - it flexes a few degrees and springs back.
      _inv.copy(_q).invert();
      _local.copy(_acc).applyQuaternion(_inv);
      const stiff = 260;
      const damp = 15;
      b.avx += (-_local.x * 5.5 - stiff * b.ax - damp * b.avx) * h;
      b.avz += (-_local.z * 5.5 - stiff * b.az - damp * b.avz) * h;
      b.ax = Math.max(-0.2, Math.min(0.2, b.ax + b.avx * h));
      b.az = Math.max(-0.2, Math.min(0.2, b.az + b.avz * h));
      _flex.setFromAxisAngle(_axisZ, -b.ax);
      _flex.multiply(_tmpQ.setFromAxisAngle(_axisX, b.az));
      _q.multiply(_flex);
      _inv.copy(_q).invert();

      // ---- the loose ball -------------------------------------------
      // A point mass inside the shell, feeling gravity and the strap's own
      // acceleration as a pseudo-force. Its collisions with the wall are the
      // only thing that schedules a bell sound.
      const clearance = b.radius * 0.5;
      _gLocal.set(0, -9.81, 0).applyQuaternion(_inv);
      _aLocal.copy(_acc).multiplyScalar(-1).applyQuaternion(_inv);
      _gLocal.add(_aLocal);
      if (!b.hero) {
        // Cheaper bells run the same solver in the plane the strap swings in.
        _gLocal.z = 0;
        b.ball.z = 0;
        b.ballVel.z = 0;
      }
      b.ballVel.addScaledVector(_gLocal, h);
      b.ballVel.multiplyScalar(Math.exp(-2.6 * h));
      b.ball.addScaledVector(b.ballVel, h);

      const d = b.ball.length();
      if (d > clearance) {
        _n.copy(b.ball).divideScalar(d);
        const vn = b.ballVel.dot(_n);
        b.ball.copy(_n).multiplyScalar(clearance);
        if (vn > 0) {
          b.ballVel.addScaledVector(_n, -vn * 1.34);
          this.emit(out, b, i, vn);
        }
      }

      b.quietFor += h;

      // ---- transforms ------------------------------------------------
      _p.copy(this.frame.pos).addScaledVector(this.frame.normal, 0.0006);
      // Seating: the shank slides down through the hole over ~0.25 s.
      _p.addScaledVector(this.frame.normal, (1 - b.seat) * b.radius * 0.9);
      _s.setScalar(b.radius);
      _m.compose(_p, _q, _s);
      this.shellMesh.setMatrixAt(i, _m);
      this.innerMesh.setMatrixAt(i, _m);

      _local.set(0, b.radius * 1.42, 0).add(b.ball).applyQuaternion(_q).add(_p);
      _m.compose(_local, _q, _s);
      this.clapperMesh.setMatrixAt(i, _m);

      // keeper: behind the leather, turning through the seating moment
      _basis.makeBasis(this.frame.binormal, this.frame.normal, this.frame.tangent);
      _keeperQ.setFromRotationMatrix(_basis);
      _keeperQ.multiply(
        _turn.setFromAxisAngle(_axisY, Math.min(1, b.seat * 1.6) * Math.PI * 0.5),
      );
      _local.copy(this.frame.pos).addScaledVector(this.frame.normal, -0.009);
      _m.compose(_local, _keeperQ, _s.setScalar(b.radius * 0.9));
      this.keeperMesh.setMatrixAt(i, _m);
    }

    this.shellMesh.instanceMatrix.needsUpdate = true;
    this.innerMesh.instanceMatrix.needsUpdate = true;
    this.clapperMesh.instanceMatrix.needsUpdate = true;
    this.keeperMesh.instanceMatrix.needsUpdate = true;
  }

  private emit(out: BellStrike[], b: BellState, index: number, impact: number): void {
    if (impact < 0.14 || b.quietFor < 0.026) return;
    b.quietFor = 0;
    const pos = new Vector3();
    this.shellMesh.getMatrixAt(index, _emitM);
    pos.setFromMatrixPosition(_emitM);
    this.group.localToWorld(pos);
    out.push({
      size: b.size,
      intensity: Math.min(1, (impact - 0.1) / 1.5),
      index,
      detune: b.detune,
      pos,
    });
  }

  addTo(parent: Object3D): void {
    parent.add(this.group);
  }
}
