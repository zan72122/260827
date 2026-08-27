import * as THREE from 'three';
import { placeLimb, damp } from './util';

/**
 * Two adult firefighters in full turnout gear: the nozzle operator up
 * front (whose arm/nozzle rig follows the player's aim) and a backup
 * firefighter bracing the hose behind. Primitive-built but with real
 * gear reads: helmets with brims, reflective trim bands, gloves, boots,
 * SCBA bottle, and a brass smooth-bore nozzle with a bale handle.
 */

interface Materials {
  turnout: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  helmet: THREE.MeshStandardMaterial;
  helmetB: THREE.MeshStandardMaterial;
  visor: THREE.MeshStandardMaterial;
  glove: THREE.MeshStandardMaterial;
  boot: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  tank: THREE.MeshStandardMaterial;
}

function makeMats(): Materials {
  return {
    turnout: new THREE.MeshStandardMaterial({ color: 0x8c7a50, roughness: 0.85 }),
    trim: new THREE.MeshStandardMaterial({ color: 0xd8d43e, roughness: 0.45, emissive: 0x35340a, emissiveIntensity: 0.4 }),
    helmet: new THREE.MeshStandardMaterial({ color: 0xc8332a, roughness: 0.35, metalness: 0.15 }),
    helmetB: new THREE.MeshStandardMaterial({ color: 0xe8e2d2, roughness: 0.35, metalness: 0.1 }),
    visor: new THREE.MeshStandardMaterial({ color: 0x232a30, roughness: 0.15, metalness: 0.3 }),
    glove: new THREE.MeshStandardMaterial({ color: 0x3a2f24, roughness: 0.9 }),
    boot: new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.7 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xb08d3f, metalness: 0.9, roughness: 0.3 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x6a7076, metalness: 0.8, roughness: 0.4 }),
    tank: new THREE.MeshStandardMaterial({ color: 0xc7b332, metalness: 0.4, roughness: 0.45 }),
  };
}

function buildFigure(m: Materials, helmetMat: THREE.MeshStandardMaterial): {
  group: THREE.Group; head: THREE.Group; shoulderL: THREE.Vector3; shoulderR: THREE.Vector3;
} {
  const g = new THREE.Group();

  // legs (slight stagger set by caller via rotation)
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.1, 0.62, 10), m.turnout);
    leg.position.set(sx * 0.12, 0.44, 0);
    leg.castShadow = true;
    g.add(leg);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.06, 10), m.trim);
    cuff.position.set(sx * 0.12, 0.2, 0);
    g.add(cuff);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.16, 0.26), m.boot);
    boot.position.set(sx * 0.12, 0.08, 0.05);
    g.add(boot);
  }
  // coat
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.62, 12), m.turnout);
  torso.position.y = 1.05;
  torso.castShadow = true;
  g.add(torso);
  const hem = new THREE.Mesh(new THREE.CylinderGeometry(0.245, 0.245, 0.05, 12), m.trim);
  hem.position.y = 0.79;
  g.add(hem);
  const chestBand = new THREE.Mesh(new THREE.CylinderGeometry(0.215, 0.215, 0.05, 12), m.trim);
  chestBand.position.y = 1.18;
  g.add(chestBand);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.1, 10), m.turnout);
  collar.position.y = 1.4;
  g.add(collar);

  // head group (looks toward fire / aim)
  const head = new THREE.Group();
  head.position.y = 1.53;
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.105, 12, 10), m.visor);
  face.position.z = 0.01;
  head.add(face);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.135, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), helmetMat);
  dome.position.y = 0.02;
  head.add(dome);
  const brim = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.028, 8, 16), helmetMat);
  brim.rotation.x = Math.PI / 2;
  brim.position.y = 0.0;
  brim.scale.z = 1.35; // longer rear brim
  head.add(brim);
  const neckFlap = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.12, 10, 1, true), m.turnout);
  neckFlap.position.set(0, -0.07, -0.03);
  head.add(neckFlap);
  g.add(head);

  return {
    group: g,
    head,
    shoulderL: new THREE.Vector3(-0.21, 1.32, 0.02),
    shoulderR: new THREE.Vector3(0.21, 1.32, 0.02),
  };
}

export class Crew {
  readonly group = new THREE.Group();
  /** rotating rig holding the nozzle; world-facing along the launch direction */
  private aimPivot = new THREE.Group();
  private operator: ReturnType<typeof buildFigure>;
  private backup: ReturnType<typeof buildFigure>;
  private armL: THREE.Mesh;
  private armR: THREE.Mesh;
  private nozzleTipLocal = new THREE.Vector3(0, 0, 0.46);
  private nozzleButtLocal = new THREE.Vector3(0, -0.03, -0.16);
  private gripFrontLocal = new THREE.Vector3(0, -0.05, 0.16);
  private gripBackLocal = new THREE.Vector3(0, -0.08, -0.1);
  private lookTarget = new THREE.Vector3(0, 1, 10);
  private curDir = new THREE.Vector3(0, 0, 1);
  private tmp = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();

  constructor() {
    const m = makeMats();

    // --- nozzle operator (front)
    this.operator = buildFigure(m, m.helmet);
    const op = this.operator.group;
    op.position.set(0, 0, 0.55);
    // athletic stance: left leg forward, slight forward lean
    op.children[0].rotation.x = -0.18; // legs adjusted below via index; keep subtle
    op.rotation.x = 0.06;
    this.group.add(op);

    // aim pivot sits at chest height in front of the operator
    this.aimPivot.position.set(0.02, 1.28, 0.75);
    this.group.add(this.aimPivot);

    // nozzle: brass smooth-bore + shutoff bale + black bumper
    const nozzleBody = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.062, 0.34, 12), m.brass);
    nozzleBody.rotation.x = Math.PI / 2;
    nozzleBody.position.z = 0.12;
    this.aimPivot.add(nozzleBody);
    const nozzleTipMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.048, 0.16, 12), m.steel);
    nozzleTipMesh.rotation.x = Math.PI / 2;
    nozzleTipMesh.position.z = 0.36;
    this.aimPivot.add(nozzleTipMesh);
    const bumper = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.016, 8, 14), m.boot);
    bumper.position.z = 0.44;
    this.aimPivot.add(bumper);
    const bale = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.014, 8, 14, Math.PI), m.helmet);
    bale.rotation.z = Math.PI;
    bale.position.set(0, 0.01, -0.05);
    this.aimPivot.add(bale);
    const butt = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 12), m.brass);
    butt.rotation.x = Math.PI / 2;
    butt.position.z = -0.12;
    this.aimPivot.add(butt);
    // gloved hands on the nozzle
    for (const local of [this.gripFrontLocal, this.gripBackLocal]) {
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.062, 10, 8), m.glove);
      hand.position.copy(local);
      this.aimPivot.add(hand);
    }

    // arms are stretched between shoulders and grips every frame
    const armGeo = new THREE.CylinderGeometry(0.055, 0.05, 1, 8);
    this.armL = new THREE.Mesh(armGeo, m.turnout);
    this.armR = new THREE.Mesh(armGeo, m.turnout);
    this.armL.castShadow = this.armR.castShadow = true;
    this.group.add(this.armL, this.armR);

    // --- backup firefighter bracing the hose
    this.backup = buildFigure(m, m.helmetB);
    const bk = this.backup.group;
    bk.position.set(-0.38, 0, -0.62);
    bk.rotation.y = 0.28;
    bk.rotation.x = 0.05;
    this.group.add(bk);
    // SCBA bottle on the backup's back
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.42, 12), m.tank);
    tank.position.set(0, 1.1, -0.24);
    bk.add(tank);
    const tankValve = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.08, 8), m.steel);
    tankValve.position.set(0, 1.33, -0.24);
    bk.add(tankValve);
    // backup's arms brace the hose low in front
    const bArmGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 8);
    const bHandPos = new THREE.Vector3(0.02, 0.58, 0.1); // world-ish, under his chest
    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(bArmGeo, m.turnout);
      const sh = (sx < 0 ? this.backup.shoulderL : this.backup.shoulderR).clone();
      const hand = bHandPos.clone().add(new THREE.Vector3(sx * 0.07, 0, 0));
      placeLimb(arm, sh, hand);
      bk.add(arm);
      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), m.glove);
      glove.position.copy(hand);
      bk.add(glove);
    }
  }

  /** world position of the nozzle tip (stream origin) */
  getNozzleTip(out: THREE.Vector3): THREE.Vector3 {
    this.aimPivot.updateWorldMatrix(true, false);
    return this.aimPivot.localToWorld(out.copy(this.nozzleTipLocal));
  }

  /** world position of the hose attachment behind the nozzle */
  getNozzleButt(out: THREE.Vector3): THREE.Vector3 {
    return this.aimPivot.localToWorld(out.copy(this.nozzleButtLocal));
  }

  /** smoothly point the nozzle along `dir` (world) */
  aim(dir: THREE.Vector3, dt: number): void {
    this.curDir.lerp(dir, 1 - Math.exp(-14 * dt)).normalize();
    this.tmp.copy(this.aimPivot.position).add(this.curDir);
    this.tmpM.lookAt(this.tmp, this.aimPivot.position, this.tmpB.set(0, 1, 0));
    this.tmpQ.setFromRotationMatrix(this.tmpM);
    this.aimPivot.quaternion.copy(this.tmpQ);

    // stretch operator arms shoulder → grip (both in crew-group space)
    const shL = this.tmp.copy(this.operator.shoulderL).add(this.operator.group.position);
    const gripF = this.group.worldToLocal(this.aimPivot.localToWorld(this.tmpB.copy(this.gripFrontLocal)));
    placeLimb(this.armL, shL, gripF);
    const shR = this.tmp.copy(this.operator.shoulderR).add(this.operator.group.position);
    const gripB = this.group.worldToLocal(this.aimPivot.localToWorld(this.tmpB.copy(this.gripBackLocal)));
    placeLimb(this.armR, shR, gripB);
  }

  /** the operator's head tracks the fire / aim point — a wordless cue */
  setLookTarget(p: THREE.Vector3): void {
    this.lookTarget.copy(p);
  }

  update(dt: number): void {
    const head = this.operator.head;
    this.tmp.copy(this.lookTarget);
    this.operator.group.worldToLocal(this.tmp);
    this.tmp.sub(head.position);
    const yaw = Math.atan2(this.tmp.x, this.tmp.z);
    const pitch = Math.atan2(-this.tmp.y, Math.hypot(this.tmp.x, this.tmp.z));
    head.rotation.y = damp(head.rotation.y, THREE.MathUtils.clamp(yaw, -0.7, 0.7), 6, dt);
    head.rotation.x = damp(head.rotation.x, THREE.MathUtils.clamp(pitch * 0.5, -0.35, 0.4), 6, dt);
  }
}
