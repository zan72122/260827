import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  TorusGeometry,
  Vector3,
} from 'three';
import type { MaterialLibrary } from '../materials/MaterialLibrary';
import type { QualityProfile } from '../core/AdaptiveQuality';
import { clamp, damp, moveTowards } from '../core/math';

const DEG = Math.PI / 180;

export interface CraneLimits {
  minBoomAngle: number;
  maxBoomAngle: number;
  minBoomLength: number;
  maxBoomLength: number;
  minRope: number;
  maxRope: number;
  slewRate: number;
  luffRate: number;
  telescopeRate: number;
  hoistRate: number;
}

/**
 * Telescopic mobile crane.
 *
 * Only the parts that carry load exist: outriggers on spreader mats, a slew
 * ring, a four-section boom, reeved wire rope and a hook block. Nothing
 * decorative is bolted on, because a four-year-old reading "what holds the
 * tree up" needs the load path to be the only thing there is to read.
 */
export class CraneKinematics {
  readonly root = new Group();
  readonly limits: CraneLimits = {
    minBoomAngle: 26 * DEG,
    maxBoomAngle: 78 * DEG,
    minBoomLength: 16,
    maxBoomLength: 42,
    minRope: 1.6,
    maxRope: 34,
    // Deliberately slow: a big input never turns into a fast swing.
    slewRate: 0.16,
    luffRate: 0.1,
    telescopeRate: 2.4,
    hoistRate: 2.2,
  };

  slew = 0;
  boomAngle = 52 * DEG;
  boomLength = 24;
  ropeLength = 12;

  private readonly slewGroup = new Group();
  private readonly boomPivot = new Group();
  private readonly sections: Object3D[] = [];
  private readonly sectionBase: number[] = [];
  private readonly hookBlock = new Group();
  private readonly ropeLines: LineSegments;
  private readonly ropeGeometry = new BufferGeometry();
  private readonly boomHeadLocal = new Vector3();
  private readonly headWorld = new Vector3();
  private readonly hookWorld = new Vector3();
  private hookSwing = 0;
  private hookSwingVel = 0;

  constructor(materials: MaterialLibrary, profile: QualityProfile, position: Vector3) {
    this.root.position.copy(position);

    const shadow = profile.shadows;
    const add = (parent: Object3D, geo: BufferGeometry, mat: MeshStandardMaterial, x = 0, y = 0, z = 0) => {
      const m = new Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = shadow;
      m.receiveShadow = shadow;
      parent.add(m);
      return m;
    };

    // ---- carrier ---------------------------------------------------------
    const carrier = new Group();
    this.root.add(carrier);
    add(carrier, new BoxGeometry(12.4, 1.15, 3.0), materials.craneDark, 0, 1.5, 0);
    add(carrier, new BoxGeometry(3.1, 1.6, 2.7), materials.craneEnamel, -4.4, 2.6, 0);
    // Wheels: four axles, dual tyres on the rear pairs.
    const tyre = new CylinderGeometry(0.62, 0.62, 0.42, 12);
    for (let axle = 0; axle < 4; axle++) {
      const x = -4.6 + axle * 2.7;
      for (const side of [-1, 1]) {
        const dual = axle >= 2 ? [0, 0.44] : [0];
        for (const off of dual) {
          const w = add(carrier, tyre, materials.rubber, x, 0.62, side * (1.36 + off));
          w.rotation.x = Math.PI / 2;
        }
      }
    }

    // ---- outriggers on spreader mats ------------------------------------
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const beam = new Group();
        beam.position.set(sx * 3.6, 1.45, sz * 1.4);
        carrier.add(beam);
        const span = 3.2;
        const arm = add(beam, new BoxGeometry(0.55, 0.5, span), materials.craneEnamel, 0, 0, (sz * span) / 2);
        arm.receiveShadow = shadow;
        const jack = add(beam, new CylinderGeometry(0.22, 0.22, 1.5, 10), materials.galvanised, 0, -0.75, sz * span);
        jack.castShadow = shadow;
        add(beam, new CylinderGeometry(0.62, 0.62, 0.16, 12), materials.craneDark, 0, -1.52, sz * span);
        // Load-spreading mat under each pad, protecting the stone setts.
        add(beam, new BoxGeometry(2.2, 0.1, 2.2), materials.matPlate, 0, -1.6, sz * span);
      }
    }

    // ---- slewing superstructure ------------------------------------------
    this.slewGroup.position.set(-0.4, 2.1, 0);
    this.root.add(this.slewGroup);
    add(this.slewGroup, new CylinderGeometry(1.5, 1.6, 0.32, 18), materials.galvanised, 0, 0, 0);
    add(this.slewGroup, new BoxGeometry(4.4, 1.9, 2.6), materials.craneEnamel, -0.6, 1.15, 0);
    // Operator cab, glazed, set to the side of the boom foot.
    add(this.slewGroup, new BoxGeometry(1.3, 1.6, 1.2), materials.craneDark, 1.4, 1.2, -1.5);
    // Counterweight slabs balance the load moment.
    for (let i = 0; i < 3; i++) {
      add(this.slewGroup, new BoxGeometry(0.5, 1.5, 2.4), materials.craneDark, -3.1 - i * 0.52, 1.2, 0);
    }

    // ---- boom -------------------------------------------------------------
    this.boomPivot.position.set(0.9, 1.5, 0);
    this.slewGroup.add(this.boomPivot);
    const sectionCount = 4;
    for (let i = 0; i < sectionCount; i++) {
      const s = new Group();
      const w = 1.25 - i * 0.17;
      const h = 1.35 - i * 0.19;
      const len = 12;
      const mesh = add(s, new BoxGeometry(len, h, w), i % 2 === 0 ? materials.craneEnamel : materials.craneDark, len / 2, 0, 0);
      mesh.castShadow = shadow;
      this.boomPivot.add(s);
      this.sections.push(s);
      this.sectionBase.push(len);
    }
    // Boom head with its sheave pack.
    const head = new Group();
    this.sections[sectionCount - 1].add(head);
    const sheave = new CylinderGeometry(0.42, 0.42, 0.12, 14);
    for (let i = 0; i < 3; i++) {
      const m = add(head, sheave, materials.galvanised, 0, 0, -0.24 + i * 0.24);
      m.rotation.x = Math.PI / 2;
    }
    add(head, new BoxGeometry(0.5, 1.0, 0.95), materials.craneDark, -0.35, 0, 0);
    this.headNode = head;

    // ---- hook block -------------------------------------------------------
    this.root.add(this.hookBlock);
    add(this.hookBlock, new BoxGeometry(0.7, 0.95, 0.9), materials.craneDark, 0, 0.45, 0);
    for (let i = 0; i < 3; i++) {
      const m = add(this.hookBlock, sheave, materials.galvanised, 0, 0.62, -0.24 + i * 0.24);
      m.rotation.x = Math.PI / 2;
    }
    const shank = add(this.hookBlock, new CylinderGeometry(0.16, 0.16, 0.5, 10), materials.galvanised, 0, -0.05, 0);
    shank.castShadow = shadow;
    const hook = add(this.hookBlock, new TorusGeometry(0.34, 0.11, 8, 14, Math.PI * 1.45), materials.galvanised, 0, -0.5, 0);
    hook.rotation.set(Math.PI / 2, 0, Math.PI * 0.25);

    // ---- reeved wire rope --------------------------------------------------
    const falls = 4;
    const positions = new Float32Array(falls * 6);
    this.ropeGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.ropeLines = new LineSegments(
      this.ropeGeometry,
      new LineBasicMaterial({ color: 0x3a3d42 }),
    );
    this.ropeLines.frustumCulled = false;
    this.root.parent?.add(this.ropeLines);
    this.rope = this.ropeLines;

    this.applyPose(0);
  }

  private readonly headNode: Object3D;
  /** Wire rope lines; the scene adds this at world level. */
  readonly rope: LineSegments;

  /** Boom head position in world space. */
  getHeadWorld(out = new Vector3()): Vector3 {
    return out.copy(this.headWorld);
  }

  /** Hook (load) position in world space. */
  getHookWorld(out = new Vector3()): Vector3 {
    return out.copy(this.hookWorld);
  }

  /**
   * Drive slew, luff, telescope and hoist so the hook approaches `target`.
   * Every axis is rate-limited to a safe crane speed, so however hard the
   * child pushes, the machine simply moves at the speed it is allowed to.
   */
  trackHook(target: Vector3, dt: number): void {
    const local = target.clone().sub(this.root.position);
    const desiredSlew = Math.atan2(local.z, local.x);
    // Pivot of the boom foot in the slew frame.
    const footHeight = this.root.position.y + 3.6;
    const horiz = Math.hypot(local.x, local.z) - 0.9;
    const rise = target.y - footHeight;

    // Choose a rope length that keeps the hook clear of the boom head, then
    // solve boom angle and length for the resulting head position.
    const rope = clamp(this.ropeLength, this.limits.minRope, this.limits.maxRope);
    const headRise = rise + rope;
    const length = clamp(Math.hypot(horiz, headRise), this.limits.minBoomLength, this.limits.maxBoomLength);
    const angle = clamp(Math.atan2(headRise, Math.max(2, horiz)), this.limits.minBoomAngle, this.limits.maxBoomAngle);

    this.slew = moveTowards(this.slew, desiredSlew, this.limits.slewRate * dt);
    this.boomAngle = moveTowards(this.boomAngle, angle, this.limits.luffRate * dt);
    this.boomLength = moveTowards(this.boomLength, length, this.limits.telescopeRate * dt);

    this.applyPose(dt);
    // Rope length is then whatever is needed to put the hook on the target.
    const desiredRope = clamp(this.headWorld.y - target.y, this.limits.minRope, this.limits.maxRope);
    this.ropeLength = moveTowards(this.ropeLength, desiredRope, this.limits.hoistRate * dt * 3);
    this.applyPose(dt);
  }

  /**
   * Stow to travel position once the lift work is done: boom retracted and
   * lowered onto its rest, hook block pulled up, superstructure squared away.
   */
  stow(dt: number): void {
    this.slew = moveTowards(this.slew, Math.PI, this.limits.slewRate * dt * 1.4);
    this.boomAngle = moveTowards(this.boomAngle, 0.06, this.limits.luffRate * dt * 1.6);
    this.boomLength = moveTowards(this.boomLength, this.limits.minBoomLength, this.limits.telescopeRate * dt);
    this.ropeLength = moveTowards(this.ropeLength, this.limits.minRope, this.limits.hoistRate * dt * 2);
    this.applyPose(dt);
  }

  /** Direct hoist control for the rigging phase. */
  payOut(delta: number): void {
    this.ropeLength = clamp(this.ropeLength + delta, this.limits.minRope, this.limits.maxRope);
  }

  applyPose(dt: number): void {
    this.slewGroup.rotation.y = -this.slew;
    this.boomPivot.rotation.z = this.boomAngle;

    // Telescope: sections slide out proportionally, overlapping at the joints.
    const total = this.boomLength;
    const per = total / this.sections.length;
    for (let i = 0; i < this.sections.length; i++) {
      const s = this.sections[i];
      s.position.x = i * per * 0.92;
      s.scale.x = per / this.sectionBase[i];
    }
    this.headNode.position.set(this.sectionBase[this.sections.length - 1], 0, 0);
    this.headNode.scale.x = 1 / Math.max(0.001, this.sections[this.sections.length - 1].scale.x);

    this.root.updateWorldMatrix(true, true);
    this.headNode.getWorldPosition(this.headWorld);

    // Hook block hangs plumb under the head, with a small damped pendulum so
    // it never looks welded in place.
    if (dt > 0) {
      const swingTarget = 0;
      this.hookSwingVel += (swingTarget - this.hookSwing) * 6 * dt - this.hookSwingVel * 1.6 * dt;
      this.hookSwing = damp(this.hookSwing + this.hookSwingVel * dt, 0, 0.8, dt);
    }
    this.hookWorld.set(
      this.headWorld.x + Math.sin(this.hookSwing) * this.ropeLength * 0.12,
      this.headWorld.y - this.ropeLength,
      this.headWorld.z,
    );
    this.hookBlock.position.copy(this.hookWorld).sub(this.root.position);

    const pos = this.ropeGeometry.getAttribute('position') as Float32BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < 4; i++) {
      const off = (i - 1.5) * 0.24;
      arr[i * 6 + 0] = this.headWorld.x;
      arr[i * 6 + 1] = this.headWorld.y;
      arr[i * 6 + 2] = this.headWorld.z + off;
      arr[i * 6 + 3] = this.hookWorld.x;
      arr[i * 6 + 4] = this.hookWorld.y + 0.62;
      arr[i * 6 + 5] = this.hookWorld.z + off;
    }
    pos.needsUpdate = true;
    this.boomHeadLocal.copy(this.headWorld);
  }
}
