import {
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  RingGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { MaterialLibrary } from './materials';

/**
 * The sleigh-bell neck strap.
 *
 * It is a verlet chain, not a cloth solver: 26 nodes, distance constraints for
 * the leather's length, a second-neighbour constraint for its bending
 * stiffness, and per-node inverse mass so that a heavy bell genuinely drags
 * its part of the strap down further than a light one.
 *
 * The mesh is a rectangular tube, so the strap has a real thickness and a
 * visible cut edge at both ends - never a ribbon of zero depth.
 */

export const STRAP_NODES = 26;
export const STRAP_WIDTH = 0.058;
export const STRAP_THICK = 0.0115;

export interface StrapFrame {
  pos: Vector3;
  tangent: Vector3;
  /** points away from the wearer: the face the bells sit on */
  normal: Vector3;
  binormal: Vector3;
}

const _v = new Vector3();
const _v2 = new Vector3();
const _q = new Quaternion();
const _m = new Matrix4();

export class Strap {
  readonly group = new Group();
  readonly pos: Vector3[] = [];
  readonly prev: Vector3[] = [];
  readonly invMass: number[] = [];
  readonly baseInvMass: number[] = [];
  /** local inward dent under a fitted bell, 0..1 */
  readonly dimple: number[] = [];
  /** world-space acceleration per node, used to drive the bells and the audio */
  readonly accel: Vector3[] = [];

  segLen: number;
  private pins = new Map<number, Vector3>();
  private mesh: Mesh;
  private geom: BufferGeometry;
  private holes: InstancedMesh;
  private keepers: InstancedMesh;
  private frames: StrapFrame[] = [];
  private lastVel: Vector3[] = [];
  private refUp = new Vector3(0, 1, 0);
  /**
   * Where each node would sit if the strap were lying still on the animal.
   * The solver is pulled toward this path rather than being left to find it
   * by gravity alone: the leather then stays where a buckled strap stays,
   * while the slack in the pull is what lets it lag behind the stride.
   */
  private attach: Vector3[] | null = null;
  private attachStiff: number[] = [];
  /**
   * When the strap is laid out on a flat surface it should keep its line in
   * plan and sag only downwards. A chain of distance constraints has nothing
   * to resist buckling sideways, so the horizontal component is guided back
   * toward the straight run between the ends. Height is left alone, which is
   * what lets the bells' weight show as a dip.
   */
  private guideA: Vector3 | null = null;
  private guideB = new Vector3();
  private guideK = 0;

  /** soft body colliders the leather must lie on top of, never inside */
  readonly ellipsoids: Array<{ c: Vector3; r: Vector3 }> = [];
  /** horizontal surfaces (bench top, floor) the strap rests on */
  readonly planes: Array<{ y: number }> = [];
  private gravity = new Vector3(0, -9.81, 0);
  private holeCount = 0;

  constructor(
    mats: MaterialLibrary,
    length = 1.62,
    private socketParams: number[] = [],
  ) {
    this.segLen = length / (STRAP_NODES - 1);
    for (let i = 0; i < STRAP_NODES; i++) {
      const p = new Vector3(-length / 2 + i * this.segLen, 0, 0);
      this.pos.push(p.clone());
      this.prev.push(p.clone());
      this.invMass.push(1);
      this.baseInvMass.push(1);
      this.dimple.push(0);
      this.accel.push(new Vector3());
      this.lastVel.push(new Vector3());
      this.frames.push({
        pos: new Vector3(),
        tangent: new Vector3(1, 0, 0),
        normal: new Vector3(0, 0, 1),
        binormal: new Vector3(0, 1, 0),
      });
    }

    this.geom = this.buildGeometry();
    this.mesh = new Mesh(this.geom, mats.leather);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);

    // Punched holes: a stretched oval eyelet, darker at the rim where the
    // leather has been pushed open by years of use.
    const holeGeo = new RingGeometry(0.0055, 0.0092, 14, 1);
    this.holes = new InstancedMesh(holeGeo, mats.leatherEdge, Math.max(1, socketParams.length));
    this.holes.frustumCulled = false;
    this.holes.count = socketParams.length;
    this.holeCount = socketParams.length;
    this.group.add(this.holes);

    // Keeper loops: narrow bands of leather wrapped round the strap.
    // A keeper is a narrow band of hide wrapped round the strap: wide enough
    // to clear the width, squashed to the thickness.
    const keeperGeo = new TorusGeometry(STRAP_WIDTH * 0.56, 0.0042, 6, 16);
    keeperGeo.scale(1, 0.26, 1);
    this.keepers = new InstancedMesh(keeperGeo, mats.leather, 2);
    this.keepers.frustumCulled = false;
    this.group.add(this.keepers);
  }

  get length(): number {
    return this.segLen * (STRAP_NODES - 1);
  }

  setGravity(g: number): void {
    this.gravity.set(0, -g, 0);
  }

  /**
   * @param stiffness per node, 0 = free, 1 = welded. Roughly the fraction of
   *        the remaining error removed per 60 Hz step.
   */
  setAttach(targets: Vector3[] | null, stiffness: number[] | null = null): void {
    this.attach = targets;
    if (targets && stiffness) this.attachStiff = stiffness;
  }

  setGuide(a: Vector3 | null, b?: Vector3, stiffness = 0.5): void {
    if (!a || !b) {
      this.guideA = null;
      return;
    }
    this.guideA = (this.guideA ?? new Vector3()).copy(a);
    this.guideB.copy(b);
    this.guideK = stiffness;
  }

  pin(i: number, p: Vector3 | null): void {
    if (p === null) {
      this.pins.delete(i);
      return;
    }
    const prev = this.pins.get(i);
    // A pin that jumps (a scene change, a teleport) must not inject velocity
    // into the chain, or the whole strap whips.
    if (prev && prev.distanceToSquared(p) > 0.09) {
      this.pos[i].copy(p);
      this.prev[i].copy(p);
    }
    if (prev) prev.copy(p);
    else this.pins.set(i, p.clone());
  }

  clearPins(): void {
    this.pins.clear();
  }

  /** Distribute a bell's mass onto the two nodes either side of its socket. */
  setSocketLoad(loads: number[]): void {
    for (let i = 0; i < STRAP_NODES; i++) this.invMass[i] = this.baseInvMass[i];
    for (let s = 0; s < this.socketParams.length; s++) {
      const load = loads[s] ?? 0;
      if (load <= 0) continue;
      const f = this.socketParams[s] * (STRAP_NODES - 1);
      const i0 = Math.max(0, Math.min(STRAP_NODES - 1, Math.floor(f)));
      const i1 = Math.min(STRAP_NODES - 1, i0 + 1);
      const t = f - i0;
      // A fitted bell roughly triples the local mass of the strap.
      this.invMass[i0] = 1 / (1 / this.invMass[i0] + load * (1 - t));
      this.invMass[i1] = 1 / (1 / this.invMass[i1] + load * t);
    }
  }

  setDimple(socketIndex: number, amount: number): void {
    const f = this.socketParams[socketIndex] * (STRAP_NODES - 1);
    const i0 = Math.max(0, Math.min(STRAP_NODES - 1, Math.round(f)));
    for (let d = -1; d <= 1; d++) {
      const i = i0 + d;
      if (i < 0 || i >= STRAP_NODES) continue;
      const w = d === 0 ? 1 : 0.45;
      this.dimple[i] = Math.max(this.dimple[i], amount * w);
    }
  }

  resetDimples(): void {
    for (let i = 0; i < STRAP_NODES; i++) this.dimple[i] *= 0.9;
  }

  /** Lay the strap out flat along a line, at rest. */
  layout(a: Vector3, b: Vector3, sag = 0): void {
    for (let i = 0; i < STRAP_NODES; i++) {
      const t = i / (STRAP_NODES - 1);
      _v.lerpVectors(a, b, t);
      _v.y -= Math.sin(t * Math.PI) * sag;
      this.pos[i].copy(_v);
      this.prev[i].copy(_v);
      this.accel[i].set(0, 0, 0);
      this.lastVel[i].set(0, 0, 0);
    }
  }

  update(dt: number, damping = 0.985): void {
    const h = Math.min(dt, 1 / 50);
    const h2 = h * h;
    // Speed limit: nothing on this strap may cover more than 25 cm in one
    // step, whatever the input did. Rapid taps and reversed swipes cannot
    // teleport the leather or the bells.
    const maxStep = 0.25;
    for (let i = 0; i < STRAP_NODES; i++) {
      if (this.invMass[i] === 0) continue;
      _v.copy(this.pos[i]).sub(this.prev[i]).multiplyScalar(damping);
      const sp = _v.length();
      if (sp > maxStep) _v.multiplyScalar(maxStep / sp);
      this.prev[i].copy(this.pos[i]);
      this.pos[i].add(_v).addScaledVector(this.gravity, h2);
    }

    if (this.attach) {
      const k = Math.min(1, h * 60);
      for (let i = 0; i < STRAP_NODES; i++) {
        if (this.invMass[i] === 0) continue;
        const stiff = (this.attachStiff[i] ?? 0.18) * k;
        this.pos[i].lerp(this.attach[i], stiff);
      }
    }

    for (let it = 0; it < 6; it++) {
      // length
      for (let i = 0; i < STRAP_NODES - 1; i++) this.solve(i, i + 1, this.segLen, 1);
      // bending stiffness: leather resists folding sharply on itself
      for (let i = 0; i < STRAP_NODES - 2; i++) this.solve(i, i + 2, this.segLen * 1.97, 0.6);
      this.collide();
      this.applyGuide();
      for (const [i, target] of this.pins) {
        this.pos[i].copy(target);
        this.prev[i].lerp(target, 0.5);
      }
    }

    for (let i = 0; i < STRAP_NODES; i++) {
      _v.copy(this.pos[i]).sub(this.prev[i]).divideScalar(Math.max(1e-4, h));
      this.accel[i].copy(_v).sub(this.lastVel[i]).divideScalar(Math.max(1e-4, h));
      this.lastVel[i].copy(_v);
    }

    this.updateFrames();
    this.updateGeometry();
    this.updateDetails();
  }

  /**
   * Push the leather back out of the horse (and off the bench top). This is
   * what makes the strap read as lying *on* the body rather than through it.
   */
  private collide(): void {
    const skin = STRAP_THICK * 0.5 + 0.004;
    for (let i = 0; i < STRAP_NODES; i++) {
      if (this.invMass[i] === 0) continue;
      const p = this.pos[i];
      for (const e of this.ellipsoids) {
        _v.copy(p).sub(e.c);
        _v2.set(_v.x / e.r.x, _v.y / e.r.y, _v.z / e.r.z);
        const d = _v2.length();
        if (d >= 1 || d < 1e-5) continue;
        const push = (1 - d) / d;
        p.x += _v.x * push;
        p.y += _v.y * push;
        p.z += _v.z * push;
      }
      for (const pl of this.planes) {
        if (p.y < pl.y + skin) p.y = pl.y + skin;
      }
    }
  }

  private applyGuide(): void {
    const a = this.guideA;
    if (!a) return;
    _v2.copy(this.guideB).sub(a);
    _v2.y = 0;
    const len = _v2.length();
    if (len < 1e-5) return;
    _v2.divideScalar(len);
    for (let i = 0; i < STRAP_NODES; i++) {
      if (this.invMass[i] === 0) continue;
      const p = this.pos[i];
      _v.set(p.x - a.x, 0, p.z - a.z);
      const along = _v.dot(_v2);
      const tx = a.x + _v2.x * along;
      const tz = a.z + _v2.z * along;
      p.x += (tx - p.x) * this.guideK;
      p.z += (tz - p.z) * this.guideK;
    }
  }

  private solve(a: number, b: number, rest: number, stiff: number): void {
    const wa = this.invMass[a];
    const wb = this.invMass[b];
    const w = wa + wb;
    if (w === 0) return;
    _v.copy(this.pos[b]).sub(this.pos[a]);
    const d = _v.length();
    if (d < 1e-6) return;
    const diff = ((d - rest) / d) * stiff;
    this.pos[a].addScaledVector(_v, diff * (wa / w));
    this.pos[b].addScaledVector(_v, -diff * (wb / w));
  }

  private updateFrames(): void {
    // Parallel transport, so the strap does not spin about its own axis.
    let up = this.refUp.clone();
    for (let i = 0; i < STRAP_NODES; i++) {
      const f = this.frames[i];
      f.pos.copy(this.pos[i]);
      const a = this.pos[Math.max(0, i - 1)];
      const b = this.pos[Math.min(STRAP_NODES - 1, i + 1)];
      f.tangent.copy(b).sub(a);
      if (f.tangent.lengthSq() < 1e-10) f.tangent.set(1, 0, 0);
      f.tangent.normalize();
      _v.copy(up).addScaledVector(f.tangent, -up.dot(f.tangent));
      if (_v.lengthSq() < 1e-8) {
        _v.set(0, 1, 0).addScaledVector(f.tangent, -f.tangent.y);
        if (_v.lengthSq() < 1e-8) _v.set(0, 0, 1);
      }
      _v.normalize();
      f.normal.copy(_v);
      f.binormal.copy(f.tangent).cross(f.normal).normalize();
      up = f.normal;
    }
  }

  frameAt(i: number): StrapFrame {
    return this.frames[Math.max(0, Math.min(STRAP_NODES - 1, i))];
  }

  /** Interpolated frame at a 0..1 parameter along the strap. */
  frameAtParam(u: number, out: StrapFrame): StrapFrame {
    const f = Math.max(0, Math.min(1, u)) * (STRAP_NODES - 1);
    const i0 = Math.min(STRAP_NODES - 2, Math.floor(f));
    const t = f - i0;
    const a = this.frames[i0];
    const b = this.frames[i0 + 1];
    out.pos.lerpVectors(a.pos, b.pos, t);
    out.tangent.lerpVectors(a.tangent, b.tangent, t).normalize();
    out.normal.lerpVectors(a.normal, b.normal, t).normalize();
    out.binormal.copy(out.tangent).cross(out.normal).normalize();
    return out;
  }

  accelAtParam(u: number, out: Vector3): Vector3 {
    const f = Math.max(0, Math.min(1, u)) * (STRAP_NODES - 1);
    const i0 = Math.min(STRAP_NODES - 2, Math.floor(f));
    const t = f - i0;
    return out.lerpVectors(this.accel[i0], this.accel[i0 + 1], t);
  }

  // ------------------------------------------------------------ geometry --

  private buildGeometry(): BufferGeometry {
    // Eight vertices per ring - two per corner - so the top, both edges and
    // the underside each get their own flat normal and the strap reads as a
    // solid piece of hide rather than a shaded ribbon.
    const rings = STRAP_NODES;
    const perRing = 8;
    const count = rings * perRing + 8;
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const uv = new Float32Array(count * 2);
    const idx: number[] = [];

    for (let i = 0; i < rings - 1; i++) {
      const a = i * perRing;
      const b = (i + 1) * perRing;
      for (let f = 0; f < 4; f++) {
        const a0 = a + f * 2;
        const a1 = a0 + 1;
        const b0 = b + f * 2;
        const b1 = b0 + 1;
        idx.push(a0, b0, b1, a0, b1, a1);
      }
    }
    const capA = rings * perRing;
    idx.push(capA, capA + 1, capA + 2, capA, capA + 2, capA + 3);
    const capB = capA + 4;
    idx.push(capB + 2, capB + 1, capB, capB + 3, capB + 2, capB);

    for (let i = 0; i < rings; i++) {
      const u = (i / (rings - 1)) * 5;
      for (let k = 0; k < perRing; k++) {
        const j = (i * perRing + k) * 2;
        uv[j] = u;
        uv[j + 1] = k % 2 === 0 ? 0 : 1;
      }
    }

    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('normal', new BufferAttribute(nor, 3));
    g.setAttribute('uv', new BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }

  private updateGeometry(): void {
    const pos = this.geom.getAttribute('position') as BufferAttribute;
    const nor = this.geom.getAttribute('normal') as BufferAttribute;
    const arr = pos.array as Float32Array;
    const narr = nor.array as Float32Array;
    const hw = STRAP_WIDTH * 0.5;
    const ht = STRAP_THICK * 0.5;

    // corner offsets in (binormal, normal), then which face each pair serves
    const corner: Array<[number, number]> = [
      [-hw, 1],
      [hw, 1],
      [hw, -1],
      [-hw, -1],
    ];
    // face k joins corner k and corner (k+1)%4, with a normal of its own
    const faceNormal: Array<[number, number]> = [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ];

    for (let i = 0; i < STRAP_NODES; i++) {
      const f = this.frames[i];
      const dent = this.dimple[i] * STRAP_THICK * 0.5;
      const base = i * 8;
      for (let k = 0; k < 4; k++) {
        const c0 = corner[k];
        const c1 = corner[(k + 1) % 4];
        const [fb, fn] = faceNormal[k];
        _v2.copy(f.binormal).multiplyScalar(fb).addScaledVector(f.normal, fn).normalize();
        for (let e = 0; e < 2; e++) {
          const c = e === 0 ? c0 : c1;
          const bw = c[0];
          const nv = c[1] > 0 ? ht - dent : -ht;
          const vi = base + k * 2 + e;
          arr[vi * 3] = f.pos.x + f.binormal.x * bw + f.normal.x * nv;
          arr[vi * 3 + 1] = f.pos.y + f.binormal.y * bw + f.normal.y * nv;
          arr[vi * 3 + 2] = f.pos.z + f.binormal.z * bw + f.normal.z * nv;
          narr[vi * 3] = _v2.x;
          narr[vi * 3 + 1] = _v2.y;
          narr[vi * 3 + 2] = _v2.z;
        }
      }
    }

    // Caps: the raw cut edge at both ends of the strap.
    for (let c = 0; c < 2; c++) {
      const src = c === 0 ? 0 : STRAP_NODES - 1;
      const dst = STRAP_NODES * 8 + c * 4;
      const f = this.frames[src];
      const dent = this.dimple[src] * STRAP_THICK * 0.5;
      for (let k = 0; k < 4; k++) {
        const bw = corner[k][0];
        const nv = corner[k][1] > 0 ? ht - dent : -ht;
        const vi = dst + k;
        arr[vi * 3] = f.pos.x + f.binormal.x * bw + f.normal.x * nv;
        arr[vi * 3 + 1] = f.pos.y + f.binormal.y * bw + f.normal.y * nv;
        arr[vi * 3 + 2] = f.pos.z + f.binormal.z * bw + f.normal.z * nv;
        narr[vi * 3] = f.tangent.x * (c === 0 ? -1 : 1);
        narr[vi * 3 + 1] = f.tangent.y * (c === 0 ? -1 : 1);
        narr[vi * 3 + 2] = f.tangent.z * (c === 0 ? -1 : 1);
      }
    }

    pos.needsUpdate = true;
    nor.needsUpdate = true;
    this.geom.computeBoundingSphere();
  }

  private tmpFrame: StrapFrame = {
    pos: new Vector3(),
    tangent: new Vector3(),
    normal: new Vector3(),
    binormal: new Vector3(),
  };

  private updateDetails(): void {
    for (let s = 0; s < this.holeCount; s++) {
      const f = this.frameAtParam(this.socketParams[s], this.tmpFrame);
      _v.copy(f.pos).addScaledVector(f.normal, STRAP_THICK * 0.5 + 0.0004);
      _m.makeBasis(f.tangent, f.binormal, f.normal);
      _q.setFromRotationMatrix(_m);
      _m.compose(_v, _q, _v2.set(1, 1, 1));
      this.holes.setMatrixAt(s, _m);
    }
    this.holes.instanceMatrix.needsUpdate = true;

    for (let k = 0; k < 4; k++) {
      const u = 0.06 + k * 0.29;
      const f = this.frameAtParam(u, this.tmpFrame);
      _m.makeBasis(f.binormal, f.normal, f.tangent);
      _q.setFromRotationMatrix(_m);
      _m.compose(f.pos, _q, _v2.set(1, 1, 0.5));
      this.keepers.setMatrixAt(k, _m);
    }
    this.keepers.instanceMatrix.needsUpdate = true;
  }

  addTo(parent: Object3D): void {
    parent.add(this.group);
  }
}
