import * as THREE from 'three';
import { Materials } from './materials';
import { Cable, Inertial, Spring } from '../game/geom';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function box(
  mat: THREE.Material,
  sx: number,
  sy: number,
  sz: number,
  pos: THREE.Vector3,
  parent: THREE.Object3D,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  m.position.copy(pos);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function cyl(
  mat: THREE.Material,
  r1: number,
  r2: number,
  h: number,
  pos: THREE.Vector3,
  parent: THREE.Object3D,
  radial = 14,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, radial), mat);
  m.position.copy(pos);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** One outrigger: telescoping beam, two-stage jack, float and timber cribbing. */
class Outrigger {
  readonly housing = new THREE.Group();
  private beam: THREE.Group;
  private jackRod: THREE.Mesh;
  private float: THREE.Group;
  private jackRoot: THREE.Group;
  private sideSign: number;
  private tmp = new THREE.Vector3();
  private mat: THREE.Mesh;
  private matBase: number;
  readonly reach: number;
  extend = new Inertial(0, 1.4, 0.62);
  jack = new Inertial(0, 1.1, 0.44);

  constructor(m: Materials, parent: THREE.Object3D, at: THREE.Vector3, sideSign: number, reach: number) {
    this.reach = reach;
    this.sideSign = sideSign;
    this.housing.position.copy(at);
    parent.add(this.housing);

    // Fixed box housing bolted through the carrier frame.
    box(m.craneAccent, 1.15, 0.52, 1.5, V(0, 0, sideSign * 0.55), this.housing);
    for (const z of [0.2, 0.95]) {
      box(m.steelDark, 1.2, 0.09, 0.1, V(0, 0.31, sideSign * z), this.housing);
    }

    this.beam = new THREE.Group();
    this.housing.add(this.beam);
    // Sliding beam: rectangular section sized to carry the machine.
    box(m.craneBody, 0.92, 0.44, reach + 0.9, V(0, 0, (sideSign * (reach + 0.9)) / 2), this.beam);
    box(m.craneAccent, 0.96, 0.1, 0.6, V(0, 0.24, sideSign * (reach + 0.5)), this.beam);
    // Warning stripes at the beam end.
    for (let i = 0; i < 3; i++) {
      box(m.paintYellow, 0.94, 0.13, 0.12, V(0, 0.235, sideSign * (reach + 0.15 + i * 0.22)), this.beam);
    }

    const jackRoot = new THREE.Group();
    this.jackRoot = jackRoot;
    jackRoot.position.set(0, -0.1, sideSign * (reach + 0.45));
    this.beam.add(jackRoot);
    // Jack cylinder body stands proud above the beam, as on a real carrier.
    cyl(m.craneAccent, 0.24, 0.26, 1.25, V(0, 0.52, 0), jackRoot);
    cyl(m.steelDark, 0.28, 0.28, 0.16, V(0, 1.16, 0), jackRoot, 12);
    box(m.craneAccent, 0.5, 0.24, 0.5, V(0, -0.06, 0), jackRoot);
    // Chrome rod: a unit cylinder scaled along its stroke.
    this.jackRod = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 1, 12), m.chrome);
    this.jackRod.castShadow = true;
    jackRoot.add(this.jackRod);
    // Hydraulic feed lines running down the leg.
    for (const s2 of [-1, 1]) {
      cyl(m.rubber, 0.035, 0.035, 1.0, V(s2 * 0.27, 0.5, -0.1), jackRoot, 6);
    }

    this.float = new THREE.Group();
    jackRoot.add(this.float);
    cyl(m.steel, 0.4, 0.46, 0.16, V(0, 0, 0), this.float, 18);
    cyl(m.steelDark, 0.19, 0.19, 0.12, V(0, 0.13, 0), this.float, 12);

    this.mat = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.12, 1.7), m.timber);
    this.mat.receiveShadow = true;
    this.mat.castShadow = true;
    parent.add(this.mat);
    this.matBase = 0.06;
    this.mat.visible = false;
  }

  /** World-space ground position the pad will land on. */
  private padWorld(out: THREE.Vector3): THREE.Vector3 {
    this.jackRoot.updateWorldMatrix(true, false);
    return out.set(0, 0, 0).applyMatrix4(this.jackRoot.matrixWorld);
  }

  step(targetExtend: number, targetJack: number, dt: number, groundY: number): { moving: boolean } {
    this.extend.step(targetExtend, dt);
    this.jack.step(targetJack, dt);

    // Beam slides out of its housing along the carrier's transverse axis.
    this.beam.position.z = this.sideSign * this.extend.value * this.reach;

    // Jack rod extends, carrying the float down onto the cribbing mat.
    const drop = this.jack.value;
    const rodLen = 0.12 + drop * 0.6;
    this.jackRod.scale.y = rodLen;
    this.jackRod.position.y = -0.12 - rodLen / 2;
    this.float.position.y = -0.12 - rodLen - 0.08;

    // The mat is set by the crew once the beam is out; it dishes slightly
    // into the setts as the leg takes weight.
    const p = this.padWorld(this.tmp);
    this.mat.visible = this.extend.value > 0.08;
    this.mat.position.set(p.x, groundY + this.matBase - this.padContact * 0.035, p.z);

    return { moving: Math.abs(this.extend.velocity) > 0.01 || Math.abs(this.jack.velocity) > 0.01 };
  }

  get padContact(): number {
    return THREE.MathUtils.clamp((this.jack.value - 0.7) / 0.3, 0, 1);
  }
}

export interface CraneState {
  hook: THREE.Vector3;
  boomTip: THREE.Vector3;
  ropeLength: number;
  outriggerAvg: number;
  levelled: boolean;
}

/**
 * Telescopic mobile crane. Everything that moves is driven from the geometry:
 * the luffing cylinder solves to the boom angle, the rope runs drum → head →
 * hook, and the carrier settles onto its outriggers before it can lift.
 */
export class MobileCrane {
  readonly root = new THREE.Group();
  readonly carrier = new THREE.Group();
  readonly turret = new THREE.Group();
  readonly boomPivot = new THREE.Group();
  readonly outriggers: Outrigger[] = [];

  private sections: THREE.Group[] = [];
  private sectionLen = [11.5, 8.4, 8.4];
  private headSheave = new THREE.Group();
  private hookBlock = new THREE.Group();
  private cylBody: THREE.Mesh;
  private cylRod: THREE.Mesh;
  private cylRoot = new THREE.Group();
  private cylAnchorLocal = V(3.4, 0.55, 0);
  private wheels: THREE.Group[] = [];
  private rope: Cable;
  private ropeBack: Cable;
  private drum = new THREE.Group();

  private slew = new Inertial(0, 0.5, 0.34);
  private luff = new Inertial(1.05, 0.35, 0.24);
  private tele = new Inertial(0, 1.2, 0.9);
  private ropeLen = new Inertial(6, 1.1, 1.15);
  private bodyLift = new Spring(0, 22, 8.6);
  private levelRoll = new Spring(0, 18, 7);

  readonly boomBaseHeight = 2.62;
  private groundY: number;

  constructor(m: Materials, groundY: number) {
    this.groundY = groundY;
    this.root.add(this.carrier);

    // ---- carrier ---------------------------------------------------------
    const frame = new THREE.Group();
    this.carrier.add(frame);
    box(m.craneAccent, 12.6, 0.62, 2.5, V(0, 1.06, 0), frame);
    box(m.craneBody, 12.2, 0.5, 2.66, V(0, 1.5, 0), frame);
    // Deck plating and kerb rails read as a real walkable deck.
    box(m.craneAccent, 11.8, 0.06, 2.72, V(0, 1.77, 0), frame);
    for (const s of [-1, 1]) {
      box(m.steel, 11.6, 0.07, 0.07, V(0, 2.2, s * 1.3), frame);
      for (let i = -5; i <= 5; i++) box(m.steel, 0.07, 0.45, 0.07, V(i * 1.05, 1.98, s * 1.3), frame);
    }

    // Cab.
    const cab = new THREE.Group();
    cab.position.set(4.55, 1.78, 0);
    frame.add(cab);
    box(m.craneBody, 2.5, 1.7, 2.5, V(0, 0.85, 0), cab);
    box(m.windowGlass, 0.1, 0.95, 2.2, V(1.27, 1.2, 0), cab);
    for (const s of [-1, 1]) box(m.windowGlass, 1.6, 0.8, 0.1, V(-0.2, 1.2, s * 1.27), cab);
    box(m.craneAccent, 2.6, 0.16, 2.6, V(0, 1.76, 0), cab);
    for (const s of [-1, 1]) box(m.paintYellow, 0.3, 0.18, 0.3, V(1.1, 1.8, s * 0.9), cab);
    box(m.steelDark, 0.5, 0.3, 2.3, V(1.4, 0.2, 0), cab);

    // Wheels: four axles, tyres and hubs.
    for (const x of [4.9, 3.2, -2.5, -4.2]) {
      for (const s of [-1, 1]) {
        const w = new THREE.Group();
        w.position.set(x, 0.66, s * 1.32);
        frame.add(w);
        const tyre = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.66, 0.42, 18), m.rubber);
        tyre.rotation.x = Math.PI / 2;
        tyre.castShadow = true;
        w.add(tyre);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.46, 12), m.steel);
        hub.rotation.x = Math.PI / 2;
        w.add(hub);
        this.wheels.push(w);
      }
    }

    // Outriggers at the four corners.
    const reach = 3.15;
    for (const x of [3.9, -3.1]) {
      for (const s of [-1, 1]) {
        this.outriggers.push(new Outrigger(m, frame, V(x, 1.15, s * 1.25), s, reach));
      }
    }

    // ---- superstructure --------------------------------------------------
    this.turret.position.set(-0.45, 1.83, 0);
    this.carrier.add(this.turret);
    cyl(m.steelDark, 1.5, 1.6, 0.34, V(0, 0.05, 0), this.turret, 24);
    box(m.craneBody, 4.4, 1.5, 2.5, V(-0.9, 0.95, 0), this.turret);
    box(m.craneAccent, 1.6, 1.7, 2.7, V(-3.0, 1.0, 0), this.turret);
    // Counterweight slabs.
    for (let i = 0; i < 3; i++) box(m.steelDark, 0.42, 1.3, 2.9, V(-3.85 - i * 0.44, 0.9, 0), this.turret);
    // Operator cab on the right of the boom.
    const opCab = new THREE.Group();
    opCab.position.set(0.55, 1.05, 1.55);
    this.turret.add(opCab);
    box(m.craneBody, 2.3, 1.75, 1.35, V(0, 0.85, 0), opCab);
    box(m.windowGlass, 1.9, 1.3, 0.08, V(0.05, 0.95, 0.7), opCab);
    box(m.windowGlass, 0.08, 1.3, 1.1, V(1.18, 0.95, 0), opCab);
    box(m.craneAccent, 2.4, 0.1, 1.45, V(0, 1.78, 0), opCab);

    // Main hoist drum with visible rope spool.
    this.drum.position.set(-2.1, 1.5, 0);
    this.turret.add(this.drum);
    const spool = cyl(m.steelDark, 0.42, 0.42, 1.5, V(0, 0, 0), this.drum, 16);
    spool.rotation.x = Math.PI / 2;
    for (const s of [-1, 1]) {
      const flange = cyl(m.steel, 0.6, 0.6, 0.07, V(0, 0, s * 0.78), this.drum, 18);
      flange.rotation.x = Math.PI / 2;
    }

    // ---- boom ------------------------------------------------------------
    this.boomPivot.position.set(0.35, 0.79, 0);
    this.turret.add(this.boomPivot);
    let parent: THREE.Object3D = this.boomPivot;
    const sizes: [number, number][] = [
      [1.12, 1.24],
      [0.94, 1.05],
      [0.8, 0.9],
    ];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      parent.add(g);
      const [w, h] = sizes[i];
      const len = this.sectionLen[i];
      const bm = box(i === 0 ? m.craneBody : m.craneBody, len, h, w, V(len / 2, 0, 0), g);
      bm.name = `boom${i}`;
      // Slew/telescope hardware detail so sections do not read as bare boxes.
      box(m.craneAccent, len * 0.98, 0.05, w * 0.5, V(len / 2, h / 2 + 0.03, 0), g);
      box(m.craneAccent, 0.16, h * 0.92, w * 1.03, V(0.12, 0, 0), g);
      if (i < 2) box(m.steelDark, 0.2, h * 0.6, w * 0.7, V(len - 0.12, 0, 0), g);
      this.sections.push(g);
      parent = g;
    }
    // Boom head: sheave nest and rope guard.
    this.headSheave.position.set(this.sectionLen[2] - 0.1, 0, 0);
    parent.add(this.headSheave);
    box(m.craneAccent, 1.0, 0.9, 0.86, V(0.35, -0.05, 0), this.headSheave);
    for (const s of [-1, 1]) {
      const sh = cyl(m.steel, 0.34, 0.34, 0.12, V(0.55, -0.12, s * 0.2), this.headSheave, 16);
      sh.rotation.x = Math.PI / 2;
    }
    box(m.paintYellow, 0.12, 0.5, 0.9, V(0.86, -0.05, 0), this.headSheave);

    // Luffing cylinder: base on the turret, rod eye on the boom.
    this.cylRoot.position.set(-1.35, 0.25, 0);
    this.turret.add(this.cylRoot);
    this.cylBody = cyl(m.craneAccent, 0.31, 0.33, 3.6, V(0, 1.8, 0), this.cylRoot, 16);
    this.cylRod = cyl(m.chrome, 0.19, 0.19, 3.2, V(0, 5.0, 0), this.cylRoot, 14);
    for (const s of [-1, 1]) cyl(m.rubber, 0.05, 0.05, 2.4, V(s * 0.34, 1.4, 0.18), this.cylRoot, 6);

    // ---- hook block ------------------------------------------------------
    this.root.add(this.hookBlock);
    box(m.craneAccent, 0.5, 0.9, 0.66, V(0, -0.15, 0), this.hookBlock);
    for (const s of [-1, 1]) {
      const sh = cyl(m.steel, 0.3, 0.3, 0.11, V(0, 0.05, s * 0.16), this.hookBlock, 16);
      sh.rotation.x = Math.PI / 2;
    }
    box(m.steelDark, 0.62, 0.14, 0.78, V(0, -0.62, 0), this.hookBlock);
    const hookShank = cyl(m.steel, 0.11, 0.13, 0.5, V(0, -0.9, 0), this.hookBlock, 12);
    hookShank.castShadow = true;
    const hookCurve = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.1, 10, 22, Math.PI * 1.55), m.steel);
    hookCurve.position.set(0, -1.32, 0);
    hookCurve.rotation.set(Math.PI / 2, 0, Math.PI * 0.22);
    hookCurve.castShadow = true;
    this.hookBlock.add(hookCurve);
    box(m.steelDark, 0.06, 0.34, 0.24, V(0.2, -1.2, 0), this.hookBlock);

    // ---- ropes -----------------------------------------------------------
    this.rope = new Cable(m.wireRope, 0.045, 6);
    this.ropeBack = new Cable(m.wireRope, 0.04, 6);
    this.root.add(this.rope.mesh, this.ropeBack.mesh);
  }

  get outriggerAverage(): number {
    return this.outriggers.reduce((a, o) => a + Math.min(o.extend.value, o.jack.value), 0) / this.outriggers.length;
  }

  get outriggerExtendAverage(): number {
    return this.outriggers.reduce((a, o) => a + o.extend.value, 0) / this.outriggers.length;
  }

  get levelled(): boolean {
    return this.outriggers.every((o) => o.padContact > 0.85);
  }

  worldBoomTip(out = new THREE.Vector3()): THREE.Vector3 {
    this.headSheave.updateWorldMatrix(true, false);
    return out.set(0.55, -0.12, 0).applyMatrix4(this.headSheave.matrixWorld);
  }

  /**
   * Point the boom so the hook hangs at `target`. Returns the achievable hook
   * position, which the caller uses as the true load position.
   */
  aim(target: THREE.Vector3, dt: number, headroom = 4.2): CraneState {
    this.turret.updateWorldMatrix(true, false);
    const pivotWorld = new THREE.Vector3().setFromMatrixPosition(this.boomPivot.matrixWorld);
    const rootQuat = new THREE.Quaternion();
    this.root.getWorldQuaternion(rootQuat);

    const local = target.clone().sub(pivotWorld).applyQuaternion(rootQuat.clone().invert());
    const desiredAzim = Math.atan2(-local.z, local.x);
    this.slew.step(THREE.MathUtils.clamp(desiredAzim, -Math.PI * 0.9, Math.PI * 0.9), dt);

    const radius = Math.hypot(local.x, local.z);
    const tipY = Math.max(target.y + headroom, pivotWorld.y + 5.5);
    const rise = tipY - pivotWorld.y;
    const wanted = Math.hypot(radius, rise);
    const minLen = this.sectionLen[0] + 0.6;
    const maxLen = this.sectionLen[0] + this.sectionLen[1] + this.sectionLen[2] - 1.2;
    const len = THREE.MathUtils.clamp(wanted, minLen, maxLen);
    this.tele.step((len - minLen) / (maxLen - minLen), dt);
    this.luff.step(THREE.MathUtils.clamp(Math.atan2(rise, radius), 0.28, 1.32), dt);

    this.applyRig();

    const tip = this.worldBoomTip();
    const ropeTarget = THREE.MathUtils.clamp(tip.y - target.y, 1.2, 34);
    this.ropeLen.step(ropeTarget, dt);
    const hook = tip.clone();
    hook.y -= this.ropeLen.value;
    this.hookBlock.position.copy(hook);
    this.hookBlock.rotation.y = this.slew.value + this.root.rotation.y;

    this.updateRopes(tip, hook);

    return {
      hook,
      boomTip: tip,
      ropeLength: this.ropeLen.value,
      outriggerAvg: this.outriggerAverage,
      levelled: this.levelled,
    };
  }

  /** Applies slew / luff / telescope and solves the luffing cylinder. */
  private applyRig(): void {
    this.turret.rotation.y = this.slew.value;
    this.boomPivot.rotation.z = this.luff.value;

    const t = this.tele.value;
    // Sections extend in sequence, as real telescopes do.
    const s1 = THREE.MathUtils.clamp(t * 2, 0, 1);
    const s2 = THREE.MathUtils.clamp(t * 2 - 1, 0, 1);
    this.sections[1].position.x = 1.0 + s1 * (this.sectionLen[0] - 1.9);
    this.sections[2].position.x = 1.0 + s2 * (this.sectionLen[1] - 1.9);

    // Cylinder: aim the body at the boom-side eye, extend the rod to fit.
    this.boomPivot.updateWorldMatrix(true, true);
    this.cylRoot.updateWorldMatrix(true, false);
    const eyeWorld = this.cylAnchorLocal.clone().applyMatrix4(this.boomPivot.matrixWorld);
    const baseWorld = new THREE.Vector3().setFromMatrixPosition(this.cylRoot.matrixWorld);
    const dir = eyeWorld.clone().sub(baseWorld);
    const dist = dir.length();
    const parentQ = new THREE.Quaternion();
    this.turret.getWorldQuaternion(parentQ);
    const localDir = dir.clone().applyQuaternion(parentQ.invert()).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), localDir);
    this.cylRoot.quaternion.copy(q);
    this.cylBody.position.y = 1.8;
    this.cylRod.position.y = Math.max(2.6, dist - 1.6);
    this.cylRod.scale.y = THREE.MathUtils.clamp((dist - 1.8) / 3.2, 0.35, 1.5);
  }

  private updateRopes(tip: THREE.Vector3, hook: THREE.Vector3): void {
    this.drum.updateWorldMatrix(true, false);
    const drumWorld = new THREE.Vector3(0, 0.45, 0).applyMatrix4(this.drum.matrixWorld);
    this.boomPivot.updateWorldMatrix(true, true);
    const boomBase = new THREE.Vector3(1.5, 0.55, 0).applyMatrix4(this.boomPivot.matrixWorld);
    this.ropeBack.update([drumWorld, boomBase, tip.clone().add(new THREE.Vector3(0, 0.2, 0))]);
    const mid = tip.clone().lerp(hook, 0.5);
    mid.x += 0.02;
    this.rope.update([tip, mid, hook.clone().add(new THREE.Vector3(0, 0.35, 0))]);
  }

  /**
   * Outrigger deployment. `targets` are per-leg extend/jack goals in 0..1.
   * Returns per-frame telemetry the director turns into sound and camera cues.
   */
  stepOutriggers(
    targets: { extend: number; jack: number }[],
    dt: number,
  ): { moving: boolean; newContacts: number[]; settle: number } {
    let moving = false;
    const newContacts: number[] = [];
    this.outriggers.forEach((o, i) => {
      const before = o.padContact;
      const r = o.step(targets[i].extend, targets[i].jack, dt, this.groundY);
      moving = moving || r.moving;
      if (before < 0.5 && o.padContact >= 0.5) newContacts.push(i);
    });

    // Load transfers off the tyres: first the suspension squats, then the
    // whole carrier is jacked clear and levels itself.
    const contact = this.outriggers.reduce((a, o) => a + o.padContact, 0) / 4;
    const squat = Math.min(contact * 2, 1) * -0.05;
    const lift = Math.max(0, contact - 0.5) * 2 * 0.16;
    this.bodyLift.step(squat + lift, dt);
    this.carrier.position.y = this.bodyLift.value;
    const uneven = (this.outriggers[0].padContact - this.outriggers[3].padContact) * 0.02;
    this.levelRoll.step(uneven * (1 - contact), dt);
    this.carrier.rotation.z = this.levelRoll.value;
    this.wheels.forEach((w, i) => {
      w.position.y = 0.66 - squat * 0.6 - lift * (0.35 + (i % 3) * 0.03);
    });
    return { moving, newContacts, settle: contact };
  }

  hookWorld(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.hookBlock.position);
  }

  dispose(): void {
    this.rope.dispose();
    this.ropeBack.dispose();
  }
}
