import * as THREE from 'three';
import { M } from '../mat/materials';
import { lathe, setShadow } from './geo';
import { damp } from '../util/math';

/* ------------------------------------------------------------------ *
 * The adult who owns this shop.  He stands in the middle ground, mostly a
 * warm silhouette against the window, and he is the reason the long
 * lighter is on the bench at all.  He breathes, shifts his weight, and
 * turns his head toward whatever is being worked on.
 * ------------------------------------------------------------------ */

export class Craftsman {
  readonly group = new THREE.Group();
  private torso: THREE.Object3D;
  private head: THREE.Object3D;
  private armR: THREE.Object3D;
  private lookTarget = new THREE.Vector3(0, 1.0, 0.1);
  private headYaw = 0;
  private headPitch = 0;
  private phase = 0;

  constructor(shadows: boolean) {
    const m = M();
    const g = this.group;
    const skin = new THREE.MeshStandardMaterial({
      color: 0x8a6047, roughness: 0.88, metalness: 0,
    });
    skin.envMap = m.apron.envMap;
    skin.envMapIntensity = 0.28;

    const trousers = m.cloth;
    const shirt = new THREE.MeshStandardMaterial({
      color: 0x413a31, roughness: 0.97, metalness: 0,
    });
    shirt.envMap = m.apron.envMap;
    shirt.envMapIntensity = 0.3;

    // legs
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(lathe([
        [0.062, 0], [0.070, 0.06], [0.062, 0.32], [0.070, 0.46],
        [0.078, 0.72], [0.082, 0.86],
      ], 12), trousers);
      leg.position.set(s * 0.085, 0, 0);
      g.add(leg);
      const boot = new THREE.Mesh(lathe([
        [0, 0], [0.072, 0], [0.078, 0.03], [0.070, 0.085], [0.062, 0.10], [0, 0.10],
      ], 12), new THREE.MeshStandardMaterial({ color: 0x2e2620, roughness: 0.95 }));
      boot.position.set(s * 0.085, 0, 0.012);
      boot.scale.z = 1.5;
      g.add(boot);
    }

    // torso: a real turned mass, wider at the chest
    this.torso = new THREE.Group();
    this.torso.position.y = 0.86;
    g.add(this.torso);
    const body = new THREE.Mesh(lathe([
      [0.135, 0], [0.152, 0.10], [0.170, 0.26], [0.178, 0.38],
      [0.172, 0.44], [0.120, 0.475], [0.078, 0.495], [0.062, 0.50],
    ], 16), shirt);
    body.scale.z = 0.72;
    this.torso.add(body);

    // leather apron, hanging from a neck strap, slightly askew
    const apron = new THREE.Mesh(lathe([
      [0.145, 0], [0.152, 0.14], [0.140, 0.30], [0.108, 0.40], [0.082, 0.45],
    ], 16, Math.PI * 1.05), m.apron);
    apron.rotation.y = -Math.PI * 0.52;
    apron.scale.set(1.03, 1.0, 0.79);
    apron.position.y = -0.20;
    this.torso.add(apron);
    const strap = new THREE.Mesh(
      new THREE.TorusGeometry(0.075, 0.008, 5, 14, Math.PI), m.apron);
    strap.position.set(0, 0.46, -0.01);
    strap.rotation.set(0.25, 0, 0);
    this.torso.add(strap);

    // arms
    const upperGeo = lathe([[0.046, 0], [0.050, 0.06], [0.042, 0.22], [0.038, 0.24]], 10);
    const foreGeo = lathe([[0.040, 0], [0.043, 0.05], [0.031, 0.21], [0.029, 0.23]], 10);
    const handGeo = new THREE.SphereGeometry(0.036, 10, 8);
    const mkArm = (side: number) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.163, 0.425, 0);
      const upper = new THREE.Mesh(upperGeo, shirt);
      upper.rotation.x = Math.PI;
      shoulder.add(upper);
      const elbow = new THREE.Group();
      elbow.position.y = -0.24;
      shoulder.add(elbow);
      const fore = new THREE.Mesh(foreGeo, skin);
      fore.rotation.x = Math.PI;
      elbow.add(fore);
      // the shirt sleeve runs past the elbow, as a work shirt does
      const cuff = new THREE.Mesh(lathe([
        [0.046, 0], [0.049, 0.02], [0.042, 0.10], [0.040, 0.115],
      ], 10), shirt);
      cuff.rotation.x = Math.PI;
      elbow.add(cuff);
      const hand = new THREE.Mesh(handGeo, skin);
      hand.position.y = -0.245;
      hand.scale.set(1, 1.15, 0.75);
      elbow.add(hand);
      this.torso.add(shoulder);
      return { shoulder, elbow };
    };
    const left = mkArm(-1);
    const right = mkArm(1);
    // left hand rests on the bench, right hangs relaxed
    left.shoulder.rotation.set(-0.62, 0, -0.30);
    left.elbow.rotation.set(0.55, 0, 0);
    right.shoulder.rotation.set(0.10, 0, 0.16);
    right.elbow.rotation.set(0.30, 0, 0);
    this.armR = right.shoulder;

    // head
    this.head = new THREE.Group();
    this.head.position.y = 0.53;
    this.torso.add(this.head);
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.042, 0.05, 0.06, 10), skin);
    neck.position.y = -0.03;
    this.head.add(neck);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.093, 14, 12), skin);
    skull.scale.set(0.92, 1.08, 1.0);
    skull.position.y = 0.075;
    this.head.add(skull);
    const hair = new THREE.Mesh(lathe([
      [0, 0.10], [0.06, 0.098], [0.092, 0.06], [0.098, 0.0],
      [0.096, -0.05], [0.088, -0.075],
    ], 14), new THREE.MeshStandardMaterial({ color: 0x3b3029, roughness: 1 }));
    hair.position.y = 0.075;
    hair.rotation.y = 0.4;
    this.head.add(hair);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.032, 8), skin);
    nose.rotation.x = Math.PI / 2 + 0.35;
    nose.position.set(0, 0.078, 0.086);
    this.head.add(nose);
    const browGeo = new THREE.BoxGeometry(0.030, 0.008, 0.010);
    const browMat = new THREE.MeshStandardMaterial({ color: 0x3b3029, roughness: 1 });
    for (const s2 of [-1, 1]) {
      const brow = new THREE.Mesh(browGeo, browMat);
      brow.position.set(s2 * 0.034, 0.106, 0.078);
      brow.rotation.z = s2 * 0.12;
      this.head.add(brow);
    }
    // a flat workshop cap: without it his pale crown pulls the eye in the wide shot
    const cap = new THREE.Mesh(lathe([
      [0, 0.168], [0.070, 0.164], [0.098, 0.140], [0.104, 0.116],
      [0.100, 0.104], [0.086, 0.100], [0.030, 0.098],
    ], 16), new THREE.MeshStandardMaterial({ color: 0x33302b, roughness: 1 }));
    cap.position.y = 0.020;
    this.head.add(cap);
    const peak = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.088, 0.010, 14, 1, false,
      -0.9, 1.8), new THREE.MeshStandardMaterial({ color: 0x2b2823, roughness: 1 }));
    peak.position.set(0, 0.124, 0.030);
    peak.scale.z = 1.35;
    this.head.add(peak);

    const beard = new THREE.Mesh(lathe([
      [0.092, 0.030], [0.100, -0.015], [0.086, -0.060], [0.048, -0.092], [0, -0.100],
    ], 14, Math.PI * 1.0), new THREE.MeshStandardMaterial({ color: 0x4a3c31, roughness: 1 }));
    beard.rotation.y = -Math.PI * 0.5;
    beard.position.set(0, 0.055, 0.006);
    beard.scale.z = 0.85;
    this.head.add(beard);

    g.position.set(-1.16, 0, -0.625);
    g.rotation.y = 0.30;
    g.scale.setScalar(1.0);
    setShadow(g, shadows, false);
  }

  lookAt(p: THREE.Vector3) { this.lookTarget.copy(p); }

  update(dt: number, time: number) {
    this.phase = time;
    // breathing
    const breath = 1 + Math.sin(time * 1.05) * 0.011;
    this.torso.scale.set(breath, 1 + Math.sin(time * 1.05) * 0.006, breath);
    // slow weight shift
    this.group.rotation.z = Math.sin(time * 0.23) * 0.012;
    this.group.position.x = -1.16 + Math.sin(time * 0.19) * 0.008;
    // relaxed arm sway
    this.armR.rotation.x = 0.10 + Math.sin(time * 0.6) * 0.05;

    // head follows the work, but slowly and never all the way
    const local = this.group.worldToLocal(this.lookTarget.clone());
    const yaw = Math.atan2(local.x, local.z) - Math.PI / 2;
    const pitch = -Math.atan2(local.y - 1.39, Math.hypot(local.x, local.z));
    this.headYaw = damp(this.headYaw, THREE.MathUtils.clamp(yaw, -0.75, 0.75), 2.0, dt);
    this.headPitch = damp(this.headPitch, THREE.MathUtils.clamp(pitch, -0.5, 0.45), 2.0, dt);
    this.head.rotation.y = this.headYaw + Math.sin(this.phase * 0.31) * 0.03;
    this.head.rotation.x = this.headPitch;
  }
}
