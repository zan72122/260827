import * as THREE from 'three';
import { Rng, clamp, lerp } from '../core/rng';
import { barkSurface, cutFaceTexture } from '../core/textures';
import type { QualitySettings } from '../core/renderer';
import type { TreeSpec } from './TreeSpec';

interface ShakeNode {
  bone: THREE.Bone;
  depth: number;
  gain: number;
  k: number;
  c: number;
  phase: number;
  ax: number;
  az: number;
  vx: number;
  vz: number;
}

interface Branch {
  bones: THREE.Bone[];
  azimuth: number;
  tiltRest: number;
  tiltFold: number;
  bendRest: number[];
  bendFold: number[];
  twist: number[];
  heightFrac: number;
  length: number;
  whorl: number;
  fold: number;
  foldVel: number;
  foldTarget: number;
  /** Underdamped only while the net lets go - that is the "basa!" moment. */
  releasing: boolean;
  releaseArmed: boolean;
  releaseDelay: number;
  radius: number;
}

interface Sprig {
  bone: THREE.Bone;
  branch: Branch;
  local: THREE.Matrix4;
  dry: boolean;
  hidden: boolean;
  heightFrac: number;
}

export interface TreeMetrics {
  height: number;
  /** Half-width of the natural silhouette, metres. */
  naturalRadius: number;
  /** Half-width once fully folded by the baler. */
  compressedRadius: number;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpV = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class TreeRig {
  readonly object = new THREE.Group();
  readonly root = new THREE.Group();
  readonly spec: TreeSpec;
  readonly metrics: TreeMetrics;

  private readonly rng: Rng;
  private readonly quality: QualitySettings;
  private readonly trunkBones: THREE.Bone[] = [];
  private readonly trunkHeights: number[] = [];
  private readonly trunkRest: Array<{ x: number; z: number }> = [];
  private readonly branches: Branch[] = [];
  private readonly nodes: ShakeNode[] = [];
  private readonly sprigs: Sprig[] = [];
  private readonly disposables: Array<{ dispose(): void }> = [];

  private wood!: THREE.SkinnedMesh;
  private needles!: THREE.InstancedMesh;
  private skeleton!: THREE.Skeleton;

  /** 0..1 motor amplitude coming from the safety lever. */
  shakeDrive = 0;
  /** How much dry material has already been shaken free, 0..1. */
  shedProgress = 0;
  /** 0..1 net release front travelling up the trunk. */
  releaseFront = 0;
  /** Spreads the per-branch release delays; set by where the child grabs the net. */
  releaseSpread = 1;
  private time = 0;
  private dryOrder: number[] = [];
  private hiddenDry = 0;

  constructor(spec: TreeSpec, quality: QualitySettings) {
    this.spec = spec;
    this.quality = quality;
    this.rng = new Rng(spec.seed);
    this.object.matrixAutoUpdate = false;
    this.object.add(this.root);

    this.buildSkeleton();
    this.object.updateMatrixWorld(true);
    this.buildWood();
    this.buildNeedles();

    const bottom = this.branches.filter((b) => b.whorl === 0);
    const natural = bottom.length ? Math.max(...bottom.map((b) => b.length * Math.sin(b.tiltRest))) : 1;
    this.metrics = {
      height: spec.height,
      naturalRadius: natural + 0.12,
      compressedRadius: spec.trunkRadius * 2.6 + 0.1,
    };
  }

  // ---------------------------------------------------------------- skeleton

  private buildSkeleton(): void {
    const spec = this.spec;
    const rng = this.rng;
    const segs = 6;
    let parent: THREE.Object3D = this.root;
    for (let i = 0; i <= segs; i++) {
      const h = spec.height * Math.pow(i / segs, 0.96);
      const bone = new THREE.Bone();
      bone.position.y = i === 0 ? 0 : h - this.trunkHeights[i - 1];
      // a real stem is never perfectly straight
      const restX = i > 0 ? rng.jitter(0.016) : 0;
      const restZ = i > 0 ? rng.jitter(0.016) : 0;
      bone.rotation.set(restX, 0, restZ);
      this.trunkRest.push({ x: restX, z: restZ });
      parent.add(bone);
      parent = bone;
      this.trunkBones.push(bone);
      this.trunkHeights.push(h);
      this.nodes.push({
        bone,
        depth: i * 0.28,
        gain: 0.1 + i * 0.055,
        k: 1500 - i * 90,
        c: 34 - i * 1.6,
        phase: rng.range(0, Math.PI * 2),
        ax: 0,
        az: 0,
        vx: 0,
        vz: 0,
      });
    }

    const golden = 2.399963;
    for (let w = 0; w < spec.whorls; w++) {
      const wf = spec.whorls === 1 ? 0 : w / (spec.whorls - 1);
      const hFrac = lerp(0.21, 0.94, Math.pow(wf, 1.02));
      const y = hFrac * spec.height;
      let ti = 0;
      while (ti < this.trunkHeights.length - 2 && this.trunkHeights[ti + 1] <= y) ti++;
      const trunk = this.trunkBones[ti];
      const localY = y - this.trunkHeights[ti];
      const count = Math.max(3, Math.round(spec.branchesPerWhorl - wf * 1.2));
      for (let b = 0; b < count; b++) {
        const azimuth = (b / count) * Math.PI * 2 + w * golden + rng.jitter(0.22);
        const lengthScale = (1 - 0.72 * Math.pow(wf, 1.1)) * rng.range(0.86, 1.12);
        const length = spec.branchLength * lengthScale;
        const tiltRest =
          lerp(spec.tiltBottom, spec.tiltTop, wf) + rng.jitter(0.09) + spec.droop * 0.22 * (1 - wf);
        const radius = spec.trunkRadius * lerp(0.34, 0.16, wf) * rng.range(0.85, 1.12);

        const pivot = new THREE.Bone();
        pivot.position.y = localY + rng.jitter(0.02);
        trunk.add(pivot);

        const segLen = [length * 0.4, length * 0.34, length * 0.26];
        const bones: THREE.Bone[] = [pivot];
        let cur: THREE.Bone = pivot;
        for (let s = 1; s < 3; s++) {
          const nb = new THREE.Bone();
          nb.position.y = segLen[s - 1];
          cur.add(nb);
          bones.push(nb);
          cur = nb;
        }
        const tip = new THREE.Bone();
        tip.position.y = segLen[2];
        cur.add(tip);

        // rest curvature: gravity droop plus a slight upward sweep at the tip
        const bendRest = [
          spec.droop * 0.3 * rng.range(0.7, 1.25) - 0.06,
          spec.droop * 0.42 * rng.range(0.7, 1.3) - 0.12,
        ];
        const branch: Branch = {
          bones,
          azimuth,
          tiltRest,
          tiltFold: 0.085 + rng.jitter(0.024) + wf * 0.028,
          bendRest,
          bendFold: [-0.1 + rng.jitter(0.04), -0.06 + rng.jitter(0.04)],
          twist: [rng.jitter(0.12), rng.jitter(0.18)],
          heightFrac: hFrac,
          length,
          whorl: w,
          fold: 0,
          foldVel: 0,
          foldTarget: 0,
          releasing: false,
          releaseArmed: false,
          releaseDelay: rng.range(0.0, 0.16),
          radius,
        };
        this.branches.push(branch);

        const baseDepth = ti * 0.28;
        bones.forEach((bone, s) => {
          this.nodes.push({
            bone,
            depth: baseDepth + 0.5 + s * 0.42,
            gain: 0.5 + s * 0.85,
            k: 620 - s * 150,
            c: 15 - s * 3.4,
            phase: rng.range(0, Math.PI * 2),
            ax: 0,
            az: 0,
            vx: 0,
            vz: 0,
          });
        });
        // store the extra tip bone for foliage without giving it its own spring
        (branch.bones as THREE.Bone[]).push(tip);
      }
    }

    this.applyPose(0);
  }

  // -------------------------------------------------------------------- wood

  private buildWood(): void {
    const detail = this.quality.geoDetail;
    const positions: number[] = [];
    const uvs: number[] = [];
    const colors: number[] = [];
    const skinIndex: number[] = [];
    const skinWeight: number[] = [];
    const indices: number[] = [];
    const allBones: THREE.Bone[] = [];
    const boneIndex = new Map<THREE.Bone, number>();
    this.root.traverse((o) => {
      if ((o as THREE.Bone).isBone) {
        boneIndex.set(o as THREE.Bone, allBones.length);
        allBones.push(o as THREE.Bone);
      }
    });

    const rng = new Rng(this.spec.seed ^ 0x9e37);
    const addTube = (
      bone: THREE.Bone,
      len: number,
      r0: number,
      r1: number,
      radialSegs: number,
      rings: number,
      uvRepeat: number,
      tint: number,
      flare: boolean,
    ) => {
      const bi = boneIndex.get(bone)!;
      const parent = bone.parent as THREE.Bone | null;
      const pi = parent && (parent as THREE.Bone).isBone ? boneIndex.get(parent as THREE.Bone)! : bi;
      const uRepeat = Math.max(1, Math.round(Math.PI * 2 * ((r0 + r1) / 2) * uvRepeat));
      const base = positions.length / 3;
      const world = bone.matrixWorld;
      for (let ri = 0; ri <= rings; ri++) {
        const t = ri / rings;
        const y = t * len;
        let r = lerp(r0, r1, Math.pow(t, 0.85));
        if (flare) r *= 1 + 0.55 * Math.exp(-t * 9);
        const wSelf = clamp(0.45 + (t / 0.32) * 0.55, 0, 1);
        for (let s = 0; s <= radialSegs; s++) {
          const a = (s / radialSegs) * Math.PI * 2;
          // irregular cross-section: no perfect cylinders anywhere
          const lump = 1 + (rng.next() - 0.5) * 0.09 + Math.sin(a * 3 + t * 5) * 0.035;
          tmpV.set(Math.cos(a) * r * lump, y, Math.sin(a) * r * lump).applyMatrix4(world);
          positions.push(tmpV.x, tmpV.y, tmpV.z);
          uvs.push((s / radialSegs) * uRepeat, t * len * uvRepeat);
          const shade = tint * (0.9 + rng.next() * 0.2);
          colors.push(shade, shade * 0.99, shade * 0.97);
          skinIndex.push(bi, pi, 0, 0);
          skinWeight.push(wSelf, 1 - wSelf, 0, 0);
        }
      }
      for (let ri = 0; ri < rings; ri++) {
        for (let s = 0; s < radialSegs; s++) {
          const a = base + ri * (radialSegs + 1) + s;
          const b = a + 1;
          const c = a + radialSegs + 1;
          const d = c + 1;
          indices.push(a, c, b, b, c, d);
        }
      }
    };

    // trunk
    const trunkRadial = Math.max(7, Math.round(12 * detail));
    for (let i = 0; i < this.trunkBones.length - 1; i++) {
      const len = this.trunkHeights[i + 1] - this.trunkHeights[i];
      const t0 = this.trunkHeights[i] / this.spec.height;
      const t1 = this.trunkHeights[i + 1] / this.spec.height;
      const rad = (t: number) => this.spec.trunkRadius * (1 - 0.86 * Math.pow(t, 0.9)) + 0.008;
      addTube(
        this.trunkBones[i],
        len,
        rad(t0),
        rad(t1),
        trunkRadial,
        Math.max(2, Math.round(4 * detail)),
        1.35,
        this.spec.barkTone,
        i === 0,
      );
    }

    // branches
    const brRadial = Math.max(4, Math.round(6 * detail));
    for (const br of this.branches) {
      for (let s = 0; s < 3; s++) {
        const bone = br.bones[s];
        const len = br.bones[s + 1].position.y;
        const r0 = br.radius * (1 - s * 0.3);
        const r1 = br.radius * (1 - (s + 1) * 0.3);
        addTube(bone, len, r0, Math.max(0.004, r1), brRadial, s === 0 ? 3 : 2, 5.5, this.spec.barkTone * 0.94, false);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const bark = barkSurface(this.quality.textureSize);
    const mat = new THREE.MeshStandardMaterial({
      map: bark.map,
      normalMap: bark.normalMap,
      roughnessMap: bark.roughnessMap,
      normalScale: new THREE.Vector2(1.1, 1.1),
      roughness: 1,
      metalness: 0,
      vertexColors: true,
    });
    this.wood = new THREE.SkinnedMesh(geo, mat);
    this.wood.castShadow = true;
    this.wood.receiveShadow = true;
    this.wood.frustumCulled = false;
    this.root.add(this.wood);
    this.skeleton = new THREE.Skeleton(allBones);
    this.wood.bind(this.skeleton);
    this.disposables.push(geo, mat);

    // sawn butt end
    const cut = new THREE.Mesh(
      new THREE.CircleGeometry(this.spec.trunkRadius * 1.5, 20),
      new THREE.MeshStandardMaterial({ map: cutFaceTexture(256), roughness: 0.82, metalness: 0 }),
    );
    cut.rotation.x = Math.PI / 2;
    cut.position.y = 0.004;
    cut.castShadow = false;
    this.trunkBones[0].add(cut);
    this.disposables.push(cut.geometry, cut.material as THREE.Material);
  }

  // ----------------------------------------------------------------- needles

  private buildNeedles(): void {
    const geo = makeSprigGeometry(this.spec.needleSize, new Rng(this.spec.seed ^ 0x55aa));
    const budget = Math.round(this.quality.sprigCount * this.spec.needleDensity);
    const perBranch = Math.max(4, Math.floor(budget / Math.max(1, this.branches.length)));
    const rng = new Rng(this.spec.seed ^ 0x1234);

    for (const br of this.branches) {
      const n = Math.round(perBranch * (0.72 + (1 - br.heightFrac) * 0.6));
      for (let i = 0; i < n; i++) {
        // A primary branch carries a flat spray of branchlets. Sprigs are placed
        // across that spray, not strung along a single line, which is what makes a
        // fir read as dense instead of whiskery.
        const along = 0.12 + Math.pow(rng.next(), 0.72) * 0.86;
        const seg = along < 0.4 ? 0 : along < 0.74 ? 1 : 2;
        const segStart = seg === 0 ? 0 : seg === 1 ? 0.4 : 0.74;
        const segSpan = seg === 0 ? 0.4 : seg === 1 ? 0.34 : 0.26;
        const bone = br.bones[seg];
        const segLen = br.bones[seg + 1].position.y;
        const t = clamp((along - segStart) / segSpan, 0, 0.99);

        // fan half-width tapers toward the tip
        const fan = br.length * 0.42 * (1 - along * 0.5);
        const side = rng.next() < 0.5 ? -1 : 1;
        const frac = Math.pow(rng.next(), 0.7);
        const lateral = side * frac * fan;
        const droop = -frac * fan * (0.12 + this.spec.droop * 0.25);
        const r = br.radius * (1 - seg * 0.22);
        const pos = new THREE.Vector3(lateral, t * segLen + rng.jitter(0.02), droop + rng.jitter(0.03) + r * 0.6);

        // branchlets point outward along the spray, tilted up toward the light
        const dir = new THREE.Vector3(
          side * (0.55 + rng.range(0, 0.4)),
          0.42 + rng.jitter(0.22),
          0.35 + rng.jitter(0.3),
        ).normalize();
        const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        quat.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng.range(0, Math.PI * 2), 0)));
        const scale = 0.85 + rng.next() * 0.85;
        const local = new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(scale, scale, scale));
        const dry = rng.next() < 0.15 && br.heightFrac < 0.82;
        this.sprigs.push({ bone, branch: br, local, dry, hidden: false, heightFrac: br.heightFrac });
      }
    }

    // the leader carries foliage too, otherwise the top reads as a bare spike
    const topBone = this.trunkBones[this.trunkBones.length - 2];
    const topLen = this.trunkBones[this.trunkBones.length - 1].position.y;
    const topCount = Math.max(10, Math.round(perBranch * 0.7));
    for (let i = 0; i < topCount; i++) {
      const t = Math.pow(rng.next(), 0.6);
      const phi = rng.range(0, Math.PI * 2);
      const r = this.spec.trunkRadius * 0.35;
      const pos = new THREE.Vector3(Math.cos(phi) * r, t * topLen * 0.98, Math.sin(phi) * r);
      const dir = new THREE.Vector3(Math.cos(phi) * 0.7, 0.72 + rng.jitter(0.14), Math.sin(phi) * 0.7).normalize();
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      const scale = 0.55 + rng.next() * 0.45;
      const local = new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(scale, scale, scale));
      this.sprigs.push({
        bone: topBone,
        branch: this.branches[this.branches.length - 1],
        local,
        dry: false,
        hidden: false,
        heightFrac: 0.97,
      });
    }

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.72,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    this.needles = new THREE.InstancedMesh(geo, mat, this.sprigs.length);
    this.needles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.needles.frustumCulled = false;
    this.needles.castShadow = false;
    this.needles.receiveShadow = this.quality.tier !== 'low';
    const col = new THREE.Color();
    const hue = this.spec.needleHue;
    const rng2 = new Rng(this.spec.seed ^ 0xbeef);
    this.sprigs.forEach((s, i) => {
      if (s.dry) {
        col.setHSL(0.09 + rng2.jitter(0.012), 0.42, 0.24 + rng2.jitter(0.04));
      } else {
        col.setHSL(0.288 + hue * 0.03 + rng2.jitter(0.016), 0.42 + rng2.jitter(0.07), 0.235 + rng2.jitter(0.05));
      }
      this.needles.setColorAt(i, col);
    });
    if (this.needles.instanceColor) this.needles.instanceColor.needsUpdate = true;
    this.object.add(this.needles);
    this.disposables.push(geo, mat);

    // dry needles leave from the bottom of the tree upward, as a shaker actually works
    this.dryOrder = this.sprigs
      .map((s, i) => (s.dry ? i : -1))
      .filter((i) => i >= 0)
      .sort((a, b) => this.sprigs[a].heightFrac - this.sprigs[b].heightFrac);

    this.syncNeedles();
  }

  private syncNeedles(): void {
    for (let i = 0; i < this.sprigs.length; i++) {
      const s = this.sprigs[i];
      if (s.hidden) {
        this.needles.setMatrixAt(i, ZERO);
        continue;
      }
      // the net squeezes the foliage flat and pulls each spray in against the
      // branch, it does not merely fold the branches
      const f = clamp(s.branch.fold, 0, 1);
      tmpM.copy(s.local);
      if (f > 0.02) {
        const k = 1 - 0.36 * f;
        tmpM.scale(tmpV.set(k, 1 - 0.18 * f, k));
        const e = tmpM.elements;
        const kp = 1 - 0.62 * f;
        e[12] *= kp;
        e[14] *= kp;
      }
      tmpM.premultiply(s.bone.matrixWorld);
      this.needles.setMatrixAt(i, tmpM);
    }
    this.needles.instanceMatrix.needsUpdate = true;
  }

  // --------------------------------------------------------------- animation

  /**
   * Feed progress measured in tree-heights travelled past the cone mouth. A branch
   * folds only once the cone has actually reached it, so compression reads as a
   * wave running from the butt to the tip.
   */
  setFoldFromFeed(progress: number): void {
    for (const br of this.branches) {
      const local = (progress - br.heightFrac + 0.13 - br.releaseDelay * 0.12) / 0.6;
      br.foldTarget = clamp(local, 0, 1);
      br.releasing = false;
    }
  }

  setFoldImmediate(v: number): void {
    for (const br of this.branches) {
      br.foldTarget = v;
      br.fold = v;
      br.foldVel = 0;
      br.releasing = false;
      br.releaseArmed = false;
    }
    this.applyPose(0);
  }

  /** The net release front, 0 at the butt, 1 at the top. */
  setReleaseFront(front: number): void {
    this.releaseFront = Math.max(this.releaseFront, front);
    for (const br of this.branches) {
      if (!br.releaseArmed && this.releaseFront > br.heightFrac * 0.94 + br.releaseDelay * this.releaseSpread * 0.22) {
        br.releaseArmed = true;
        br.releasing = true;
        br.foldTarget = 0;
        // a touch of stored energy, so the branch springs rather than eases
        br.foldVel = 0.3 + br.heightFrac * 0.25 + br.releaseDelay * 0.8;
      }
    }
  }

  /** Branches that have just been let go, for sound and dust cues. */
  consumePops(): number {
    let n = 0;
    for (const br of this.branches) {
      if (br.releasing && br.fold < 0.55) {
        br.releasing = false;
        n++;
      }
    }
    return n;
  }

  get foldAverage(): number {
    let s = 0;
    for (const br of this.branches) s += br.fold;
    return s / Math.max(1, this.branches.length);
  }

  /** Silhouette half-width at a height fraction, including foliage - fits the net. */
  radiusAt(hf: number): number {
    let best = this.spec.trunkRadius * 1.6;
    for (const br of this.branches) {
      const d = Math.abs(br.heightFrac - hf);
      if (d > 0.16) continue;
      const tilt = lerp(br.tiltRest, br.tiltFold, br.fold);
      const margin = lerp(0.16, 0.095, br.fold) * this.spec.needleSize;
      const r = br.length * Math.sin(clamp(tilt, 0, Math.PI / 2)) * (1 - d * 1.8) + margin;
      if (r > best) best = r;
    }
    return best;
  }

  update(dt: number): void {
    this.time += dt;
    const h = Math.min(dt, 1 / 45);

    // fold springs: forced and calm going in, loose and springy coming out
    for (const br of this.branches) {
      const k = br.releasing || br.foldTarget === 0 ? 38 : 120;
      const c = br.releasing || br.foldTarget === 0 ? 6.4 : 22;
      const acc = (br.foldTarget - br.fold) * k - br.foldVel * c;
      br.foldVel += acc * h;
      br.fold += br.foldVel * h;
      if (br.fold < -0.12) {
        br.fold = -0.12;
        br.foldVel *= -0.3;
      }
      if (br.fold > 1.05) {
        br.fold = 1.05;
        br.foldVel *= -0.3;
      }
    }

    // shake springs, driven with a per-depth delay so motion travels outward
    const drive = this.shakeDrive;
    const idle = 0.035;
    for (const n of this.nodes) {
      const td = this.time - n.depth * 0.045;
      const wave =
        Math.sin(td * 2 * Math.PI * 11.5 + n.phase) * 0.72 + Math.sin(td * 2 * Math.PI * 6.3 + n.phase * 1.7) * 0.28;
      const wave2 =
        Math.cos(td * 2 * Math.PI * 11.5 + n.phase * 0.6) * 0.6 + Math.sin(td * 2 * Math.PI * 4.1 + n.phase) * 0.4;
      const breeze = Math.sin(this.time * 0.7 + n.phase) * idle * n.gain;
      const amp = drive * n.gain * 0.09;
      const tx = wave * amp + breeze * 0.5;
      const tz = wave2 * amp * 0.8 + breeze;
      n.vx += ((tx - n.ax) * n.k - n.vx * n.c) * h;
      n.vz += ((tz - n.az) * n.k - n.vz * n.c) * h;
      n.ax += n.vx * h;
      n.az += n.vz * h;
    }

    this.applyPose(1);
    this.root.updateMatrixWorld(true);
    this.syncNeedles();
  }

  /** Writes fold + shake state into bone rotations. */
  private applyPose(shakeMix: number): void {
    let ni = 0;
    for (let i = 0; i < this.trunkBones.length; i++) {
      const n = this.nodes[ni++];
      const rest = this.trunkRest[i];
      this.trunkBones[i].rotation.set(rest.x + n.ax * shakeMix, 0, rest.z + n.az * shakeMix);
    }
    for (const br of this.branches) {
      const f = br.fold;
      const tilt = lerp(br.tiltRest, br.tiltFold, f);
      const pivot = br.bones[0];
      const np = this.nodes[ni++];
      tmpQ.setFromEuler(tmpE.set(tilt, br.azimuth, 0, 'YXZ'));
      pivot.quaternion.copy(tmpQ);
      if (shakeMix > 0) {
        tmpQ.setFromEuler(tmpE.set(np.ax, 0, np.az, 'XYZ'));
        pivot.quaternion.multiply(tmpQ);
      }
      for (let s = 1; s < 3; s++) {
        const bone = br.bones[s];
        const nb = this.nodes[ni++];
        const bend = lerp(br.bendRest[s - 1], br.bendFold[s - 1], f);
        tmpQ.setFromEuler(tmpE.set(bend, 0, br.twist[s - 1], 'XYZ'));
        bone.quaternion.copy(tmpQ);
        if (shakeMix > 0) {
          tmpQ.setFromEuler(tmpE.set(nb.ax, 0, nb.az, 'XYZ'));
          bone.quaternion.multiply(tmpQ);
        }
      }
    }
  }

  /** Hides dry needles as they are shaken loose; returns how many left this frame. */
  shedDry(amount: number): number {
    const want = Math.min(this.dryOrder.length, Math.floor(clamp(amount, 0, 1) * this.dryOrder.length));
    let shed = 0;
    while (this.hiddenDry < want) {
      const idx = this.dryOrder[this.hiddenDry++];
      this.sprigs[idx].hidden = true;
      shed++;
    }
    this.shedProgress = this.dryOrder.length ? this.hiddenDry / this.dryOrder.length : 1;
    return shed;
  }

  /** World-space sample inside the canopy, for debris and dust spawning. */
  sampleFoliage(rng: Rng, out: THREE.Vector3, maxHeightFrac = 1): boolean {
    if (!this.sprigs.length) return false;
    for (let attempt = 0; attempt < 8; attempt++) {
      const s = this.sprigs[Math.floor(rng.next() * this.sprigs.length)];
      if (s.heightFrac > maxHeightFrac) continue;
      tmpM.multiplyMatrices(s.bone.matrixWorld, s.local);
      out.setFromMatrixPosition(tmpM);
      return true;
    }
    return false;
  }

  setVisible(v: boolean): void {
    this.object.visible = v;
  }

  dispose(): void {
    this.object.removeFromParent();
    for (const d of this.disposables) d.dispose();
    this.skeleton.dispose();
  }
}

/** One conifer sprig: a short woody shoot with needles fanning forward. */
function makeSprigGeometry(sizeScale: number, rng: Rng): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const shootLen = 0.2 * sizeScale;
  const needles = 10;

  const push = (x: number, y: number, z: number, shade: number) => {
    positions.push(x, y, z);
    colors.push(shade, shade * 1.03, shade * 0.9);
    return positions.length / 3 - 1;
  };

  // shoot: a thin 3-sided stick so the sprig reads as attached, not floating
  const shootR = 0.005 * sizeScale;
  const ringA: number[] = [];
  const ringB: number[] = [];
  for (let s = 0; s < 3; s++) {
    const a = (s / 3) * Math.PI * 2;
    ringA.push(push(Math.cos(a) * shootR, 0, Math.sin(a) * shootR, 0.32));
    ringB.push(push(Math.cos(a) * shootR * 0.6, shootLen, Math.sin(a) * shootR * 0.6, 0.36));
  }
  for (let s = 0; s < 3; s++) {
    const n = (s + 1) % 3;
    indices.push(ringA[s], ringB[s], ringA[n], ringA[n], ringB[s], ringB[n]);
  }

  for (let i = 0; i < needles; i++) {
    const t = i / (needles - 1);
    const y = shootLen * (0.12 + t * 0.86);
    const around = t * 7.1 + rng.jitter(0.4);
    const pitch = 0.52 + rng.jitter(0.2) - t * 0.16;
    const len = (0.058 + rng.next() * 0.026) * sizeScale;
    const wid = 0.0034 * sizeScale;
    const dx = Math.cos(around);
    const dz = Math.sin(around);
    const ax = dx * Math.sin(pitch);
    const az = dz * Math.sin(pitch);
    const ay = Math.cos(pitch);
    // needle plane: axis + a perpendicular width vector
    const px = -dz;
    const pz = dx;
    const shade = 0.34 + rng.next() * 0.16;
    const bx = dx * 0.004 * sizeScale;
    const bz = dz * 0.004 * sizeScale;
    const a0 = push(bx + px * wid, y, bz + pz * wid, shade * 0.8);
    const a1 = push(bx - px * wid, y, bz - pz * wid, shade * 0.8);
    const mx = bx + ax * len * 0.55;
    const my = y + ay * len * 0.55;
    const mz = bz + az * len * 0.55;
    const a2 = push(mx + px * wid * 1.15, my, mz + pz * wid * 1.15, shade);
    const a3 = push(mx - px * wid * 1.15, my, mz - pz * wid * 1.15, shade);
    // needles bend slightly upward toward the light
    const a4 = push(bx + ax * len, y + ay * len + len * 0.16, bz + az * len, shade * 1.25);
    indices.push(a0, a2, a1, a1, a2, a3, a2, a4, a3);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}
