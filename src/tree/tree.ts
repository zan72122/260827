/**
 * The hero tree.
 *
 * Structure: a bone rig (trunk chain -> main branches -> sub branches). Wood is
 * one InstancedMesh, needle sprays are another, so the whole tree costs three
 * draw calls plus the trunk sections. Nothing here is a soft-body sim:
 *   shake   = a travelling envelope with a per-bone delay,
 *   fold    = a target angle driven by how far into the cone the bone has gone,
 *   release = an under-damped spring per branch, delayed up the trunk.
 */
import * as THREE from 'three';
import { clamp, lerp, mulberry32, range, type Rng } from '../core/rand';
import type { QualityBudget } from '../core/quality';
import { makeTrunkSection, makeTuftGeometry, makeWoodGeometry } from './geom';
import type { TreeVariant } from './variants';

export interface TreeMaterials {
  bark: THREE.Material;
  branch: THREE.Material;
  needle: THREE.Material;
  cut: THREE.Material;
}

interface Node {
  obj: THREE.Object3D;
  /** the main branch this bone belongs to; null on the trunk chain */
  branch: Branch | null;
  restX: number;
  restY: number;
  restZ: number;
  foldZ: number;
  fold: number;
  foldLambda: number;
  flex: number;
  phase: number;
  delay: number;
  woodIndex: number;
  len: number;
  rad: number;
}

interface Branch {
  /** height of the branch collar up the trunk, metres */
  baseHeight: number;
  /** 0 = at rest, 1 = folded back along the trunk */
  fold: number;
  vel: number;
  target: number;
  /** per-branch scatter, so no two ranks let go at the same instant */
  jitter: number;
  released: boolean;
  /** crown radius this branch reaches at rest and fully folded */
  reach0: number;
  reach1: number;
}

interface Tuft {
  node: Node;
  local: THREE.Matrix4;
  branch: Branch;
  /** baked occlusion: sprays buried inside the crown never see the sky */
  ao: number;
  /** height bin this spray sits in when the tree is at rest */
  binRest: number;
}

export const PROFILE_BINS = 18;

const HIST = 128;
const HIST_STEP = 1 / 60;

export class Tree {
  readonly group = new THREE.Group();
  readonly variant: TreeVariant;
  readonly height: number;

  readonly wood: THREE.InstancedMesh;
  readonly tufts: THREE.InstancedMesh;

  /** radial extent of the crown per height bin, metres (rig space) */
  readonly profile = new Float32Array(PROFILE_BINS);
  private profileRest = new Float32Array(PROFILE_BINS);
  private profileFold = new Float32Array(PROFILE_BINS);
  private binFold = new Float32Array(PROFILE_BINS);
  private binCount = new Float32Array(PROFILE_BINS);

  /** 0..1 remaining dry old foliage */
  dryReserve = 1;
  /** aggregate |angular velocity| of the crown, for the rub voice */
  rubEnergy = 0;
  /** 0..1 the travelling shake envelope at the trunk right now */
  get shakeLevel(): number {
    return this.history[this.histIndex];
  }

  /** 0..1 how much of the crown is still held by the net */
  get foldAverage(): number {
    let s = 0;
    for (const b of this.branches) s += b.fold;
    return this.branches.length ? s / this.branches.length : 0;
  }

  private rig = new THREE.Group();
  private nodes: Node[] = [];
  private branches: Branch[] = [];
  private tuftList: Tuft[] = [];
  private trunkNodes: Node[] = [];

  private history = new Float32Array(HIST);
  private histIndex = 0;
  private histAcc = 0;
  private shakeEnergy = 0;
  private time = 0;
  private prevFoldSum = 0;

  private stiff = false;
  private tmpM = new THREE.Matrix4();
  private tmpV = new THREE.Vector3();
  private tmpColor = new THREE.Color();
  private tuftDryness = 1;
  private tuftBoost = 1;
  private lastTintDryness = -1;

  constructor(
    variant: TreeVariant,
    budget: QualityBudget,
    mats: TreeMaterials,
    private onShed: (pos: THREE.Vector3, energy: number) => void,
  ) {
    this.variant = variant;
    this.height = variant.height;
    const rng = mulberry32(variant.seed);
    this.group.add(this.rig);

    // ---- trunk chain ----
    const trunkSegs = Math.max(9, Math.round(variant.whorls * 1.05));
    const segLen = variant.height / trunkSegs;
    let parent: Node | null = null;
    const trunkRadial = budget.radialSegments;
    for (let i = 0; i < trunkSegs; i++) {
      const t = i / trunkSegs;
      const t1 = (i + 1) / trunkSegs;
      const r0 = variant.buttRadius * (1 - t) ** 1.35 + 0.012;
      const r1 = variant.buttRadius * (1 - t1) ** 1.35 + 0.01;
      const obj = new THREE.Object3D();
      obj.rotation.order = 'XYZ';
      const lean = (rng() - 0.5) * 0.028;
      const twist = (rng() - 0.5) * 0.05;
      obj.position.set(0, parent ? segLen : 0, 0);
      const node: Node = {
        obj,
        branch: null,
        restX: lean,
        restY: twist,
        restZ: (rng() - 0.5) * 0.026,
        foldZ: (rng() - 0.5) * 0.026,
        fold: 0,
        foldLambda: 20,
        flex: 0.004 + t * 0.02,
        phase: rng() * Math.PI * 2,
        delay: (t * variant.height) / 18,
        woodIndex: -1,
        len: segLen,
        rad: r0,
      };
      obj.rotation.set(node.restX, node.restY, node.restZ);
      (parent ? parent.obj : this.rig).add(obj);
      const geo = makeTrunkSection(r0, r1, segLen * 1.02, trunkRadial, t * 4, t1 * 4, variant.seed + i);
      const mesh = new THREE.Mesh(geo, mats.bark);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      obj.add(mesh);
      this.nodes.push(node);
      this.trunkNodes.push(node);
      parent = node;
    }

    // fresh saw cut at the butt
    const cut = new THREE.Mesh(new THREE.CircleGeometry(variant.buttRadius * 1.02, 20), mats.cut);
    cut.rotation.x = Math.PI / 2;
    cut.position.y = 0.002;
    this.trunkNodes[0].obj.add(cut);

    // ---- branches ----
    const woodGeo = makeWoodGeometry(Math.max(4, budget.radialSegments - 2));
    let woodCount = 0;
    const pushWood = (n: Node) => {
      n.woodIndex = woodCount++;
    };

    for (let w = 0; w < variant.whorls; w++) {
      const wt = w / (variant.whorls - 1); // 0 bottom .. 1 top
      // whorls run from just above the handle to just under the leader, so the
      // trunk is never a bare pole sticking out of the crown
      const baseHeight =
        variant.height * (0.075 + wt * 0.895) + (rng() - 0.5) * segLen * 0.35;
      const trunkIndex = clamp(Math.floor(baseHeight / segLen), 0, trunkSegs - 1);
      const host = this.trunkNodes[trunkIndex];
      const localY = baseHeight - trunkIndex * segLen;
      const count = Math.round(range(rng, variant.branchesMin, variant.branchesMax + 0.99));
      const azOffset = rng() * Math.PI * 2;
      // crown taper: long at the bottom, short at the top
      const hFrac = baseHeight / variant.height;
      const lengthFactor = (1 - hFrac) ** 0.62 * 0.93 + 0.07;
      for (let b = 0; b < count; b++) {
        const az = azOffset + (b / count) * Math.PI * 2 + (rng() - 0.5) * 0.5;
        const elev = lerp(variant.elevBottom, variant.elevTop, wt) + (rng() - 0.5) * 0.16;
        const branchLen = variant.spread * lengthFactor * range(rng, 0.82, 1.06);
        const branch: Branch = {
          baseHeight,
          fold: 0,
          vel: 0,
          target: 0,
          jitter: rng(),
          released: false,
          reach0: 0,
          reach1: 0,
        };
        this.buildBranch(rng, host, branch, localY, az, elev, branchLen, variant, pushWood, budget);
        this.branches.push(branch);
      }
    }

    // ---- instanced wood ----
    this.wood = new THREE.InstancedMesh(woodGeo, mats.branch, woodCount);
    this.wood.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.wood.castShadow = true;
    this.wood.receiveShadow = false;
    this.wood.frustumCulled = false;

    // ---- needle sprays ----
    const tuftGeo = makeTuftGeometry(13, variant.seed + 5);
    const keep = Math.max(0.3, budget.sprayDensity);
    // thinning the sprays would open holes in the silhouette, so what is left
    // grows to keep the crown reading the same from a distance
    this.tuftBoost = 1 / Math.sqrt(keep);
    const kept: Tuft[] = [];
    for (const t of this.tuftList) {
      if (rng() >= keep) continue;
      if (this.tuftBoost !== 1) t.local.scale(new THREE.Vector3(this.tuftBoost, this.tuftBoost, this.tuftBoost));
      kept.push(t);
    }
    this.tuftList = kept;
    this.tufts = new THREE.InstancedMesh(tuftGeo, mats.needle, this.tuftList.length);
    this.tufts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tufts.castShadow = false;
    this.tufts.receiveShadow = false;
    this.tufts.frustumCulled = false;

    // leader: the top of the trunk carries its own spray so nothing pokes out
    {
      const leader = this.trunkNodes[this.trunkNodes.length - 1];
      const fake: Branch = {
        baseHeight: variant.height,
        fold: 0,
        vel: 0,
        target: 0,
        jitter: rng(),
        released: true,
        reach0: 0.1,
        reach1: 0.1,
      };
      for (let i = 0; i < 4; i++) {
        this.tuftList.push({
          node: leader,
          local: new THREE.Matrix4().compose(
            new THREE.Vector3(0, segLen * (0.4 + i * 0.22), 0),
            new THREE.Quaternion().setFromEuler(
              new THREE.Euler(rng() * 6.28, -1.35 + (rng() - 0.5) * 0.5, 0, 'XYZ'),
            ),
            new THREE.Vector3(0.85, 0.85, 0.85).multiplyScalar(variant.tuftScale),
          ),
          branch: fake,
          ao: 1,
          binRest: PROFILE_BINS - 1,
        });
      }
    }

    this.measureProfiles();
    this.bakeOcclusion();
    this.refreshTint(true);
  }

  private buildBranch(
    rng: Rng,
    host: Node,
    branch: Branch,
    localY: number,
    az: number,
    elev: number,
    length: number,
    variant: TreeVariant,
    pushWood: (n: Node) => void,
    budget: QualityBudget,
  ): void {
    const segs = 3;
    const trunkDelay = host.delay;
    let parent = host;
    let node: Node | null = null;
    let travelled = 0;
    for (let s = 0; s < segs; s++) {
      const st = s / segs;
      const segLen = (length / segs) * (1 - st * 0.22);
      const obj = new THREE.Object3D();
      obj.rotation.order = 'XYZ';
      obj.position.set(s === 0 ? 0 : (parent.len ?? 0), s === 0 ? localY : 0, 0);
      if (s > 0) obj.position.set(parent.len, 0, 0);
      const restZ =
        s === 0 ? elev : -variant.droop * range(rng, 0.6, 1.4) - 0.02;
      const foldZ =
        s === 0 ? 1.55 + (rng() - 0.5) * 0.08 : restZ * 0.14 + 0.01;
      const n: Node = {
        obj,
        branch,
        restX: 0,
        restY: s === 0 ? az : (rng() - 0.5) * 0.22,
        restZ,
        foldZ,
        fold: 0,
        foldLambda: s === 0 ? 30 : 15 - s * 2,
        flex: s === 0 ? 0.05 : 0.075 + s * 0.02,
        phase: rng() * Math.PI * 2,
        delay: trunkDelay + travelled / 5.5,
        woodIndex: -1,
        len: segLen,
        rad: 0.017 * (1 - st * 0.5) * (0.6 + length * 0.3),
      };
      obj.rotation.set(n.restX, n.restY, n.restZ);
      parent.obj.add(obj);
      pushWood(n);
      this.nodes.push(n);
      travelled += segLen;

      // needle sprays ride the outer half of every segment
      const tuftsHere = s === 0 ? 2 : s === 1 ? 3 : 4;
      for (let k = 0; k < tuftsHere; k++) {
        this.addTuft(rng, n, branch, range(rng, 0.35, 0.95), variant, 1);
      }

      // sub branches
      const subs = s < 2 ? variant.subPerSegment : 1;
      for (let i = 0; i < subs; i++) {
        this.buildSub(rng, n, branch, range(rng, 0.3, 0.9), segLen, variant, pushWood, travelled, budget);
      }
      parent = n;
      node = n;
    }
    if (node) this.addTuft(rng, node, branch, 1.0, variant, 1.1);
  }

  private buildSub(
    rng: Rng,
    host: Node,
    branch: Branch,
    at: number,
    hostLen: number,
    variant: TreeVariant,
    pushWood: (n: Node) => void,
    travelled: number,
    budget: QualityBudget,
  ): void {
    const side = rng() < 0.5 ? 1 : -1;
    const roll = side * range(rng, 0.35, 1.5);
    const segs = 2;
    let parent = host;
    let dist = travelled;
    for (let s = 0; s < segs; s++) {
      const segLen = range(rng, 0.16, 0.3) * (1 - s * 0.25) * (0.6 + variant.spread * 0.35);
      const obj = new THREE.Object3D();
      obj.rotation.order = 'XYZ';
      obj.position.set(s === 0 ? at * hostLen : parent.len, 0, 0);
      const restZ = s === 0 ? range(rng, 0.42, 0.86) : range(rng, -0.24, 0.1);
      const n: Node = {
        obj,
        branch,
        restX: s === 0 ? roll : (rng() - 0.5) * 0.3,
        restY: s === 0 ? range(rng, -0.2, 0.2) : (rng() - 0.5) * 0.3,
        restZ,
        foldZ: restZ * 0.12,
        fold: 0,
        foldLambda: s === 0 ? 13 : 9,
        flex: 0.1 + s * 0.05,
        phase: rng() * Math.PI * 2,
        delay: host.delay + dist / 4.6,
        woodIndex: -1,
        len: segLen,
        rad: 0.0075 * (1 - s * 0.35),
      };
      obj.rotation.set(n.restX, n.restY, n.restZ);
      parent.obj.add(obj);
      pushWood(n);
      this.nodes.push(n);
      dist += segLen;
      const tuftCount = budget.tier === 'low' ? 2 : 3;
      for (let k = 0; k < tuftCount; k++) {
        this.addTuft(rng, n, branch, range(rng, 0.25, 1.0), variant, 0.92);
      }
      parent = n;
    }
  }

  private addTuft(
    rng: Rng,
    node: Node,
    branch: Branch,
    at: number,
    variant: TreeVariant,
    scale: number,
  ): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(range(rng, 0, Math.PI * 2), range(rng, -0.4, 0.4), range(rng, -0.35, 0.35), 'XYZ'),
    );
    const s = variant.tuftScale * scale * range(rng, 0.78, 1.24);
    m.compose(
      new THREE.Vector3(at * node.len, 0, 0),
      q,
      new THREE.Vector3(s, s, s),
    );
    this.tuftList.push({ node, local: m, branch, ao: 1, binRest: 0 });
  }

  /** Rest / fully folded crown radii, measured once from the rig itself. */
  private measureProfiles(): void {
    const measure = (fold: number, out: Float32Array): void => {
      for (const n of this.nodes) n.fold = n.branch ? fold : 0;
      for (const b of this.branches) b.fold = fold;
      this.poseRig(0);
      this.rig.updateMatrixWorld(true);
      out.fill(0);
      const reach = new Map<Branch, number>();
      const squash = 1 - 0.3 * fold;
      for (const t of this.tuftList) {
        this.tmpM.multiplyMatrices(t.node.obj.matrixWorld, t.local);
        this.tmpV.setFromMatrixPosition(this.tmpM);
        // the outermost point of a compressed spray, not just its origin
        const reachOut = 0.19 * squash * this.tmpM.getMaxScaleOnAxis();
        const r = Math.hypot(this.tmpV.x, this.tmpV.z) + reachOut;
        const bin = clamp(Math.floor((this.tmpV.y / this.height) * PROFILE_BINS), 0, PROFILE_BINS - 1);
        if (r > out[bin]) out[bin] = r;
        const prev = reach.get(t.branch) ?? 0;
        if (r > prev) reach.set(t.branch, r);
      }
      for (const b of this.branches) {
        const r = reach.get(b) ?? 0;
        if (fold === 0) b.reach0 = r;
        else b.reach1 = r;
      }
    };
    measure(0, this.profileRest);
    measure(1, this.profileFold);
    for (const n of this.nodes) n.fold = 0;
    for (const b of this.branches) b.fold = 0;
    this.profile.set(this.profileRest);
    this.poseRig(0);
  }

  /**
   * Conifer crowns read dark because the inside of the crown is in its own
   * shadow. The sprays never cast into the shadow map, so that depth is baked
   * here instead, from how far each spray sits inside the rest silhouette.
   */
  private bakeOcclusion(): void {
    this.rig.updateMatrixWorld(true);
    for (const t of this.tuftList) {
      this.tmpV.setFromMatrixPosition(this.tmpM.multiplyMatrices(t.node.obj.matrixWorld, t.local));
      const r = Math.hypot(this.tmpV.x, this.tmpV.z);
      const bin = clamp(Math.floor((this.tmpV.y / this.height) * PROFILE_BINS), 0, PROFILE_BINS - 1);
      const surf = Math.max(0.2, this.profileRest[bin]);
      const k = clamp(r / surf, 0, 1);
      const up = clamp(this.tmpV.y / this.height, 0, 1);
      t.ao = (0.34 + 0.66 * k * k) * (0.82 + 0.18 * up);
      t.binRest = bin;
    }
  }

  /** widest crown radius right now, metres */
  get halfWidth(): number {
    let m = 0;
    for (let i = 0; i < PROFILE_BINS; i++) if (this.profile[i] > m) m = this.profile[i];
    return m;
  }

  /** Pull every bone to its current pose: rest + fold + travelling shake. */
  private poseRig(time: number): void {
    for (const n of this.nodes) {
      const f = n.fold;
      let x = n.restX;
      let y = n.restY;
      let z = n.restZ + (n.foldZ - n.restZ) * f;
      if (n.flex > 0) {
        const env = this.sampleHistory(n.delay);
        if (env > 0.0004) {
          const p = time - n.delay;
          const a = env * n.flex;
          const s1 = Math.sin(p * 46.5 + n.phase);
          const s2 = Math.sin(p * 108.7 + n.phase * 1.7);
          z += a * (s1 * 0.86 + s2 * 0.34);
          x += a * (Math.sin(p * 39.1 + n.phase * 2.3) * 0.55);
          y += a * 0.25 * s2;
        }
      }
      n.obj.rotation.set(x, y, z);
    }
  }

  private sampleHistory(delay: number): number {
    const back = Math.round(delay / HIST_STEP);
    if (back >= HIST) return 0;
    const i = (this.histIndex - back + HIST * 2) % HIST;
    return this.history[i];
  }

  /** 0..1 from the safety lever. */
  setShakeInput(energy: number): void {
    this.shakeEnergy = clamp(energy, 0, 1);
  }

  /** Track the cone: `allowed(height)` returns the radius the tree may occupy. */
  applyCone(allowed: (heightAlongTrunk: number) => number): void {
    this.stiff = true;
    for (const b of this.branches) {
      const a = allowed(b.baseHeight);
      if (a >= b.reach0) {
        b.target = Math.min(b.target, 0);
        continue;
      }
      const span = Math.max(0.01, b.reach0 - b.reach1);
      const need = clamp((b.reach0 - a) / span, 0, 1);
      // once folded by the cone the netting keeps it folded
      if (need > b.target) b.target = need;
    }
  }

  /** Force the whole crown to a fold value (used while netted in transit). */
  holdFolded(): void {
    this.stiff = true;
    for (const b of this.branches) b.target = Math.max(b.target, 0);
  }

  /**
   * The net is off up to `frontHeight` metres of trunk: every branch below that
   * is free and springs outward, bottom rank first.
   */
  releaseTo(frontHeight: number): void {
    this.stiff = false;
    for (const b of this.branches) {
      if (!b.released && b.baseHeight <= frontHeight - b.jitter * 0.06) {
        b.released = true;
        b.target = 0;
        b.vel = -1.7 - b.jitter * 0.9; // the branch is under load; it snaps out
      }
    }
  }

  get releasedFraction(): number {
    let n = 0;
    for (const b of this.branches) if (b.released) n++;
    return this.branches.length ? n / this.branches.length : 0;
  }

  resetRelease(): void {
    for (const b of this.branches) {
      b.released = false;
      b.vel = 0;
    }
  }

  update(dt: number, sheddingAllowed: boolean): void {
    this.time += dt;

    // ---- shake envelope history ----
    this.histAcc += dt;
    let guard = 0;
    while (this.histAcc >= HIST_STEP && guard++ < 8) {
      this.histAcc -= HIST_STEP;
      this.histIndex = (this.histIndex + 1) % HIST;
      const prev = this.history[(this.histIndex - 1 + HIST) % HIST];
      const target = this.shakeEnergy;
      const lambda = target > prev ? 7.5 : 3.1; // rings down after the lever is let go
      this.history[this.histIndex] = prev + (target - prev) * (1 - Math.exp(-lambda * HIST_STEP));
    }

    // ---- fold springs ----
    const k = this.stiff ? 190 : 54;
    const c = this.stiff ? 27 : 6.3;
    let foldSum = 0;
    for (const b of this.branches) {
      const acc = -k * (b.fold - b.target) - c * b.vel;
      b.vel += acc * dt;
      b.fold += b.vel * dt;
      if (b.fold < -0.16) {
        b.fold = -0.16;
        b.vel *= -0.25;
      } else if (b.fold > 1.05) {
        b.fold = 1.05;
        b.vel *= -0.2;
      }
      foldSum += b.fold;
    }
    // per-bone lag so the fold and the release travel out along each branch
    for (const n of this.nodes) {
      if (!n.branch) continue;
      const a = 1 - Math.exp(-n.foldLambda * dt);
      n.fold += (n.branch.fold - n.fold) * a;
    }

    const env = this.history[this.histIndex];
    this.rubEnergy = clamp(env * 1.1 + Math.abs(foldSum - this.prevFoldSum) / Math.max(1, this.branches.length) / dt * 0.5, 0, 1);
    this.prevFoldSum = foldSum;

    this.poseRig(this.time);
    // Update from the group, not the rig: the instanced wood and sprays are
    // parented to the scene root, so they would otherwise trail the tree's own
    // movement by a frame while the netting (a real child) kept up.
    this.group.updateMatrixWorld(true);
    this.syncInstances();

    // ---- shedding: dry material only, and only while it is being shaken ----
    if (sheddingAllowed && env > 0.06 && this.dryReserve > 0.002 && this.tuftList.length) {
      const rate = env * env * 62 * this.dryReserve * this.variant.dryness;
      let n = rate * dt;
      while (n > 0) {
        if (n < 1 && Math.random() > n) break;
        n -= 1;
        const t = this.tuftList[(Math.random() * this.tuftList.length) | 0];
        this.tmpV.setFromMatrixPosition(
          this.tmpM.multiplyMatrices(t.node.obj.matrixWorld, t.local),
        );
        this.onShed(this.tmpV, env);
        this.dryReserve = Math.max(0, this.dryReserve - 0.0022);
      }
      this.tuftDryness = this.dryReserve;
      this.refreshTint(false);
    }
  }

  private syncInstances(): void {
    const wm = this.wood.instanceMatrix.array as Float32Array;
    for (const n of this.nodes) {
      if (n.woodIndex < 0) continue;
      this.tmpM.makeScale(n.len, n.rad, n.rad);
      this.tmpM.premultiply(n.obj.matrixWorld);
      this.tmpM.toArray(wm, n.woodIndex * 16);
    }
    this.wood.instanceMatrix.needsUpdate = true;

    const tm = this.tufts.instanceMatrix.array as Float32Array;
    this.profile.fill(0);
    this.binFold.fill(0);
    this.binCount.fill(0);
    for (let i = 0; i < this.tuftList.length; i++) {
      const t = this.tuftList[i];
      this.tmpM.multiplyMatrices(t.node.obj.matrixWorld, t.local);
      // netting presses the needles flat against the branch; they spring back
      // with it when the tension goes
      const k = 1 - 0.3 * clamp(t.node.fold, 0, 1);
      if (k < 0.999) this.tmpM.scale(this.tmpV.set(k, k, k));
      this.tmpM.toArray(tm, i * 16);
    }
    this.tufts.instanceMatrix.needsUpdate = true;

    // Crown profile: blend each bin's rest and folded radius by the fold of the
    // sprays that actually occupy it, so the silhouette (and the net that has
    // to grip it) follows the real shape rather than a branch-base average.
    let globalFold = 0;
    for (const t of this.tuftList) {
      this.binFold[t.binRest] += t.branch.fold;
      this.binCount[t.binRest] += 1;
      globalFold += t.branch.fold;
    }
    globalFold = this.tuftList.length ? globalFold / this.tuftList.length : 0;
    for (let i = 0; i < PROFILE_BINS; i++) {
      const f = this.binCount[i] > 0 ? this.binFold[i] / this.binCount[i] : globalFold;
      this.profile[i] = lerp(this.profileRest[i], this.profileFold[i], clamp(f, 0, 1));
    }
  }

  /** Tint the sprays as the dry material leaves; the green needles stay. */
  private refreshTint(force: boolean): void {
    if (!force && Math.abs(this.tuftDryness - this.lastTintDryness) < 0.03) return;
    this.lastTintDryness = this.tuftDryness;
    const d = clamp(this.tuftDryness, 0, 1) * this.variant.dryness * 0.42;
    for (let i = 0; i < this.tuftList.length; i++) {
      const wobble = ((i * 2654435761) % 1000) / 1000;
      const dd = d * (0.3 + wobble * 0.95);
      const ao = this.tuftList[i].ao;
      this.tmpColor.setRGB(
        (lerp(1, 1.34, dd) + this.variant.needleTint) * ao,
        lerp(1, 1.04, dd) * ao,
        lerp(1, 0.72, dd) * ao,
      );
      this.tufts.setColorAt(i, this.tmpColor);
    }
    if (this.tufts.instanceColor) this.tufts.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.wood.geometry.dispose();
    this.tufts.geometry.dispose();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.wood.dispose();
    this.tufts.dispose();
  }
}
