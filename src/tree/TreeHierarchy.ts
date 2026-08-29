import {
  CircleGeometry,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  Vector3,
} from 'three';
import { Rng } from '../core/Rng';
import { AngularSpring } from '../core/Spring';
import { clamp, damp, lerp } from '../core/math';
import type { MaterialLibrary } from '../materials/MaterialLibrary';
import type { QualityProfile } from '../core/AdaptiveQuality';
import { buildLimbGeometry, buildSprigGeometry, buildTrunkGeometry } from './TreeGeometry';

export interface BranchInfo {
  /** Height of the whorl on the stem, in metres. */
  height: number;
  azimuth: number;
  /** Natural pitch when the transport straps are off (positive = upward). */
  naturalPitch: number;
  innerLength: number;
  outerLength: number;
  rootRadius: number;
  swing: Object3D;
  tip: Object3D;
  spring: AngularSpring;
  tipSpring: AngularSpring;
  /** 1 while strapped for transport, 0 once the band is released. */
  bundle: number;
  bundleTarget: number;
}

/** How far the transport straps rotate each limb up towards the stem. */
export const BUNDLE_PITCH_OFFSET = 1.35;

const SPRIG_SCALE_MIN = 0.32;
const SPRIG_SCALE_MAX = 0.62;

/**
 * The tree itself.
 *
 * The stem is a controlled kinematic body: nothing integrates it, the raising
 * rig sets its angle. Everything hanging off it is dynamic — heavy limbs on a
 * slow spring, outer thirds on a faster one — and both are driven by the
 * angular acceleration of the stem, which is what makes the tree read as mass
 * on a crane rather than a rubber stick or a weightless prop.
 */
export class TreeHierarchy {
  readonly root = new Group();
  readonly stem = new Group();
  readonly height: number;
  readonly buttRadius: number;
  readonly branches: BranchInfo[] = [];

  private readonly limbs: InstancedMesh;
  private readonly foliage: InstancedMesh;
  private readonly limbParents: Object3D[] = [];
  private readonly limbLocals: Matrix4[] = [];
  private readonly sprigParents: Object3D[] = [];
  private readonly sprigLocals: Matrix4[] = [];
  private readonly sprigCount: number;

  /** Stem rotation about the butt pivot: 0 = lying down, PI/2 = plumb. */
  private raise = 0;
  private raiseVel = 0;
  private raiseAccel = 0;
  private leanX = 0;
  private leanZ = 0;
  private detail = 1;
  private restTimer = 0;
  private canopy = 0;

  private readonly tmpM = new Matrix4();
  private readonly rootInverse = new Matrix4();
  private readonly tmpQ = new Quaternion();

  constructor(
    private readonly materials: MaterialLibrary,
    profile: QualityProfile,
    seed = 1337,
  ) {
    const rng = new Rng(seed);
    this.height = 21.5;
    this.buttRadius = 0.46;

    this.root.add(this.stem);

    const trunkRings = profile.tier === 'low' ? 26 : 44;
    const trunkRadial = profile.tier === 'low' ? 10 : 16;
    const trunkGeo = buildTrunkGeometry(this.height, this.buttRadius, 0.045, trunkRings, trunkRadial, rng);
    const trunk = new Mesh(trunkGeo, materials.trunkBark);
    trunk.castShadow = profile.shadows;
    trunk.receiveShadow = profile.shadows;
    this.stem.add(trunk);

    // Sawn butt end, with the drilled centre that takes the socket spike.
    const cut = new Mesh(new CircleGeometry(this.buttRadius * 0.99, 24), materials.cutFace);
    cut.rotation.x = Math.PI / 2;
    cut.position.y = 0.002;
    this.stem.add(cut);

    // ---- branch skeleton -------------------------------------------------
    const whorlCount = 15;
    // Limbed up enough that the socket, the collar and the base indicator stay
    // readable from the console.
    const lowest = 3.5;
    const highest = this.height - 0.35;
    let goldenPhase = rng.range(0, Math.PI * 2);

    for (let w = 0; w < whorlCount; w++) {
      const t = w / (whorlCount - 1);
      const h = lerp(lowest, highest, Math.pow(t, 1.04)) + rng.jitter(0.22);
      const norm = clamp(h / this.height, 0, 1);
      // Fewer, longer limbs low down; more, shorter ones towards the leader.
      const count = Math.max(5, Math.round(lerp(11, 6, norm) + rng.jitter(1.2)));
      goldenPhase += 2.39996 + rng.jitter(0.5);
      for (let b = 0; b < count; b++) {
        // A real tree loses limbs: skip some, and shorten the ones that were
        // damaged in handling, so the crown is never a symmetric cone.
        if (rng.chance(0.08)) continue;
        const azimuth = goldenPhase + (b / count) * Math.PI * 2 + rng.jitter(0.28);
        const full = lerp(4.35, 0.95, Math.pow(norm, 0.86)) * rng.range(0.82, 1.12);
        const length = rng.chance(0.12) ? full * rng.range(0.5, 0.72) : full;
        const naturalPitch = lerp(-0.2, 0.34, Math.pow(norm, 1.15)) + rng.jitter(0.09);
        const rootRadius = clamp(0.019 + length * 0.0155, 0.012, 0.085);

        const base = new Object3D();
        base.position.set(0, h, 0);
        base.rotation.y = azimuth;
        this.stem.add(base);

        const swing = new Object3D();
        base.add(swing);

        const innerLength = length * 0.62;
        const outerLength = length * 0.38;
        const tip = new Object3D();
        tip.position.set(innerLength, 0, 0);
        swing.add(tip);

        // Big limbs are slow and heavily damped; the outer third is light and
        // lags behind, which is what the eye reads as "this thing is huge".
        const massFactor = clamp(length / 4.35, 0.25, 1);
        const spring = new AngularSpring(
          naturalPitch,
          lerp(26, 9, massFactor),
          lerp(4.4, 2.2, massFactor),
          1.6,
        );
        const tipSpring = new AngularSpring(0, lerp(120, 52, massFactor), lerp(5.5, 3.0, massFactor), 0.5);

        this.branches.push({
          height: h,
          azimuth,
          naturalPitch,
          innerLength,
          outerLength,
          rootRadius,
          swing,
          tip,
          spring,
          tipSpring,
          bundle: 1,
          bundleTarget: 1,
        });
      }
    }

    // ---- instanced limb tubes -------------------------------------------
    const limbGeo = buildLimbGeometry(profile.tier === 'low' ? 3 : 5, profile.tier === 'low' ? 5 : 7, 0.5);
    const limbTotal = this.branches.length * 2;
    this.limbs = new InstancedMesh(limbGeo, materials.limbBark, limbTotal);
    this.limbs.castShadow = profile.shadows;
    this.limbs.frustumCulled = false;
    this.root.add(this.limbs);

    for (const br of this.branches) {
      this.limbParents.push(br.swing);
      this.limbLocals.push(new Matrix4().makeScale(br.innerLength, br.rootRadius, br.rootRadius));
      this.limbParents.push(br.tip);
      this.limbLocals.push(
        new Matrix4().makeScale(br.outerLength, br.rootRadius * 0.5, br.rootRadius * 0.5),
      );
    }

    // ---- instanced needle sprigs ----------------------------------------
    const sprigGeo = buildSprigGeometry(profile.tier === 'low' ? 5 : 7, new Rng(seed + 5));
    const parents: Object3D[] = [];
    const locals: Matrix4[] = [];
    const q = new Quaternion();
    const scale = new Vector3();
    const pos = new Vector3();

    // Needle mass scales with branch area, not branch length: without this the
    // long lower limbs read as bare sticks next to the dense leader. The raw
    // demand is then scaled to a fixed instance budget for the quality tier.
    const rawDensity = this.branches.map((br) => clamp(br.innerLength * br.innerLength * 32, 26, 260));
    const rawTotal = rawDensity.reduce((a, b) => a + b * 1.8, 0);
    const budget = 26000 * profile.foliageDensity;
    const densityScale = Math.min(1, budget / Math.max(1, rawTotal));

    this.branches.forEach((br, bi) => {
      const density = rawDensity[bi] * densityScale;
      const innerN = Math.max(4, Math.round(density));
      const outerN = Math.max(3, Math.round(density * 0.8));
      // A conifer branch is a flat spray, widest near the stem. Placing the
      // sprigs across that spray rather than along a line is what gives the
      // crown volume from every angle.
      const spray = (parent: Object3D, segLength: number, n: number, halfWidth: number) => {
        for (let i = 0; i < n; i++) {
          const t = (i + rng.range(0.1, 0.9)) / n;
          const side = (i % 2 === 0 ? 1 : -1) * rng.range(0.12, 1) * halfWidth * (1 - t * 0.45);
          const up = rng.jitter(halfWidth * 0.42) - t * halfWidth * 0.1;
          pos.set(t * segLength, up, side);
          const yaw = Math.atan2(side, Math.max(0.35, segLength * 0.35));
          q.setFromEuler(new Euler(rng.jitter(0.7), yaw, rng.jitter(0.35), 'YXZ'));
          const s = rng.range(SPRIG_SCALE_MIN, SPRIG_SCALE_MAX);
          scale.set(s, s, s);
          parents.push(parent);
          locals.push(new Matrix4().compose(pos, q, scale));
        }
      };
      spray(br.swing, br.innerLength, innerN, br.innerLength * 0.46);
      spray(br.tip, br.outerLength, outerN, br.outerLength * 0.52);
    });

    // Shuffle deterministically so any prefix of the instance list is still an
    // even covering of the crown — that is what makes the LOD cut invisible.
    const order = parents.map((_, i) => i);
    const shuffleRng = new Rng(seed + 99);
    for (let i = order.length - 1; i > 0; i--) {
      const j = shuffleRng.int(0, i);
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const idx of order) {
      this.sprigParents.push(parents[idx]);
      this.sprigLocals.push(locals[idx]);
    }
    this.sprigCount = this.sprigParents.length;

    this.foliage = new InstancedMesh(sprigGeo, materials.foliage, this.sprigCount);
    this.foliage.castShadow = profile.shadows;
    this.foliage.frustumCulled = false;
    this.root.add(this.foliage);

    this.applyBranchPose(0);
    this.writeInstances(true);
  }

  /* ------------------------------------------------------------- control -- */

  /** Set by the raising rig. 0 = lying on the trailer, PI/2 = plumb. */
  setRaiseAngle(angle: number, dt: number): void {
    const clamped = clamp(angle, 0, Math.PI / 2);
    if (dt > 0) {
      const vel = (clamped - this.raise) / dt;
      this.raiseAccel = (vel - this.raiseVel) / dt;
      this.raiseVel = vel;
    }
    this.raise = clamped;
  }

  get raiseAngle(): number {
    return this.raise;
  }

  /** Lean in radians, as resolved by the guy-wire tension solver. */
  setLean(x: number, z: number): void {
    this.leanX = x;
    this.leanZ = z;
  }

  get lean(): { x: number; z: number } {
    return { x: this.leanX, z: this.leanZ };
  }

  /** 0..1 per branch band; BranchRelease drives this as straps come off. */
  setBundleForHeight(maxReleasedHeight: number): void {
    for (const br of this.branches) {
      br.bundleTarget = br.height <= maxReleasedHeight ? 0 : 1;
    }
  }

  releaseAll(): void {
    for (const br of this.branches) br.bundleTarget = 0;
  }

  get bundleAmount(): number {
    let sum = 0;
    for (const br of this.branches) sum += br.bundle;
    return sum / this.branches.length;
  }

  /**
   * Horizontal reach of the crown around a given height, using the pose the
   * limbs are actually in. The strap rig sizes its bands from this, so the
   * bands sit on the bundle instead of hovering around it.
   */
  reachAt(height: number, window = 2.4): number {
    let reach = this.radiusAt(clamp(height / this.height, 0, 1));
    for (const br of this.branches) {
      if (Math.abs(br.height - height) > window) continue;
      const r =
        Math.cos(br.spring.value) * br.innerLength +
        Math.cos(br.spring.value + br.tipSpring.value) * br.outerLength;
      reach = Math.max(reach, r);
    }
    return reach;
  }

  /** Current horizontal reach of the crown, in metres. */
  get canopyRadius(): number {
    return this.canopy;
  }

  /** LOD hook: 1 = full crown, 0.35 = distant silhouette. */
  setDetail(level: number): void {
    const l = clamp(level, 0.3, 1);
    if (Math.abs(l - this.detail) < 0.05) return;
    const raised = l > this.detail;
    this.detail = l;
    this.foliage.count = Math.max(64, Math.round(this.sprigCount * l));
    this.foliage.material = l < 0.55 ? this.materials.foliageFar : this.materials.foliage;
    // Instances that were outside the previous budget still hold stale
    // matrices, so a widening LOD has to rewrite before the next draw.
    if (raised) this.restTimer = 0;
  }

  /** Stem radius at `t` of the tree height, matching the trunk sweep. */
  radiusAt(t: number): number {
    const c = clamp(t, 0, 1);
    return Math.max(0.045, lerp(0.045, this.buttRadius, Math.pow(1 - c, 1.25)));
  }

  /** World point on the stem axis at `t` of the tree height. */
  pointOnStem(t: number, out = new Vector3()): Vector3 {
    out.set(0, t * this.height, 0);
    this.stem.updateWorldMatrix(true, false);
    return out.applyMatrix4(this.stem.matrixWorld);
  }

  /* ------------------------------------------------------------- stepping -- */

  /** Snap the crown to its current targets, e.g. when a replay restarts. */
  snapPose(): void {
    this.applyBranchPose(0);
    this.root.updateWorldMatrix(true, true);
    this.writeInstances(true);
  }

  update(dt: number): void {
    this.stem.rotation.z = -(Math.PI / 2 - this.raise);
    this.root.rotation.x = this.leanX;
    this.root.rotation.z = this.leanZ;

    this.applyBranchPose(dt);
    this.root.updateWorldMatrix(true, true);

    // Skip the foliage rewrite when the crown has settled: on a phone this is
    // the difference between a busy frame and an idle one.
    let maxVel = Math.abs(this.raiseVel);
    for (const br of this.branches) {
      maxVel = Math.max(maxVel, Math.abs(br.spring.velocity), Math.abs(br.tipSpring.velocity) * 0.4);
    }
    if (maxVel < 0.0025) this.restTimer += dt;
    else this.restTimer = 0;
    this.writeInstances(this.restTimer < 0.25);

    this.raiseVel = damp(this.raiseVel, 0, 6, dt);
    this.raiseAccel = damp(this.raiseAccel, 0, 10, dt);
  }

  private applyBranchPose(dt: number): void {
    let canopy = 0;
    // Gravity direction relative to the stem: when lying, the limbs hang
    // sideways; as it comes up they settle into their natural cone.
    const gravityAlong = Math.cos(this.raise);
    for (const br of this.branches) {
      br.bundle = dt > 0 ? damp(br.bundle, br.bundleTarget, 2.2, dt) : br.bundleTarget;

      // Strapped limbs are pulled up against the stem; released ones fall back
      // out to their natural pitch, which is what grows the crown diameter.
      // Straps never fold a limb past the stem itself.
      const bundledPitch = Math.min(br.naturalPitch + BUNDLE_PITCH_OFFSET, 1.36);
      const gravityDroop = -0.16 * (1 - gravityAlong) * (1 - br.bundle);
      const lyingDroop = -0.22 * gravityAlong * (1 - br.bundle);
      br.spring.target = lerp(br.naturalPitch + gravityDroop + lyingDroop, bundledPitch, br.bundle);
      br.tipSpring.target = lerp(-0.1 * (1 - br.bundle), 0.34, br.bundle);

      if (dt <= 0) {
        // Construction and resets snap straight to the pose: the tree arrives
        // already strapped, it does not settle into the straps on screen.
        br.spring.value = br.spring.target;
        br.spring.velocity = 0;
        br.tipSpring.value = br.tipSpring.target;
        br.tipSpring.velocity = 0;
      }
      if (dt > 0) {
        // The stem's angular acceleration is the only forcing term; a fast
        // hoist visibly whips the outer branches, a slow one barely does.
        const armFactor = clamp(br.height / this.height, 0.1, 1);
        const drive = -this.raiseAccel * armFactor * Math.cos(br.azimuth * 0.0 + 0) * 0.55;
        br.spring.step(dt, drive * 0.55);
        br.tipSpring.step(dt, drive * 1.5 + br.spring.velocity * 0.9);
      }
      br.swing.rotation.z = br.spring.value;
      br.tip.rotation.z = br.tipSpring.value;

      const reach =
        Math.cos(br.spring.value) * br.innerLength +
        Math.cos(br.spring.value + br.tipSpring.value) * br.outerLength;
      canopy = Math.max(canopy, reach);
    }
    this.canopy = canopy;
  }

  private writeInstances(includeFoliage: boolean): void {
    // The instanced limbs and needles live under `root`, so their instance
    // matrices have to be expressed in root space — otherwise the tree's own
    // placement is applied twice and the crown drifts off the stem.
    this.rootInverse.copy(this.root.matrixWorld).invert();
    for (let i = 0; i < this.limbParents.length; i++) {
      this.tmpM.multiplyMatrices(this.limbParents[i].matrixWorld, this.limbLocals[i]);
      this.tmpM.premultiply(this.rootInverse);
      this.limbs.setMatrixAt(i, this.tmpM);
    }
    this.limbs.instanceMatrix.needsUpdate = true;

    if (!includeFoliage) return;
    const count = this.foliage.count;
    for (let i = 0; i < count; i++) {
      this.tmpM.multiplyMatrices(this.sprigParents[i].matrixWorld, this.sprigLocals[i]);
      this.tmpM.premultiply(this.rootInverse);
      this.foliage.setMatrixAt(i, this.tmpM);
    }
    this.foliage.instanceMatrix.needsUpdate = true;
  }

  /** Convenience for the camera director: world position and up axis. */
  worldTip(out = new Vector3()): Vector3 {
    return this.pointOnStem(1, out);
  }

  worldAxis(out = new Vector3()): Vector3 {
    this.stem.updateWorldMatrix(true, false);
    this.stem.getWorldQuaternion(this.tmpQ);
    return out.set(0, 1, 0).applyQuaternion(this.tmpQ);
  }

  dispose(): void {
    this.limbs.geometry.dispose();
    this.foliage.geometry.dispose();
  }

  /** Used by the plumb indicator: signed lean magnitude in radians. */
  get leanMagnitude(): number {
    return Math.hypot(this.leanX, this.leanZ);
  }

  /** Needle-sprig instances actually built, for the quality read-out. */
  get foliageInstances(): number {
    return this.sprigCount;
  }
}
