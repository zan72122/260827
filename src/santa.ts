import * as THREE from 'three';
import { lerp } from './util';

/**
 * Stylized but grounded Santa standing behind the sack.
 * Arms are articulated at the shoulders so the mitten hands can
 * hold the sack mouth open a crack (the "invitation" gesture)
 * and later grab + lift the whole sack.
 */
export class Santa {
  group = new THREE.Group();
  private armL: THREE.Group;
  private armR: THREE.Group;
  private forearmL: THREE.Group;
  private forearmR: THREE.Group;
  private body: THREE.Group;
  private time = 0;
  /** 0 = arms resting, 1 = holding mouth open */
  hold = 0;
  /** 0..1 lift animation blend */
  lift = 0;

  constructor() {
    const red = new THREE.MeshStandardMaterial({ color: 0x9e2427, roughness: 0.85 });
    const white = new THREE.MeshStandardMaterial({ color: 0xd8cfc0, roughness: 0.95 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xdca887, roughness: 0.7 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2e2019, roughness: 0.6 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xb08b3e, roughness: 0.4, metalness: 0.4 });

    this.body = new THREE.Group();
    this.group.add(this.body);

    // boots
    for (const s of [-1, 1]) {
      const boot = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.1, 6, 12), dark);
      boot.position.set(s * 0.18, 0.13, 0.05);
      boot.scale.set(1, 0.9, 1.4);
      boot.castShadow = true;
      this.body.add(boot);
    }
    // coat: belly-heavy capsule
    const coat = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.55, 8, 20), red);
    coat.position.y = 0.78;
    coat.scale.set(1, 1, 0.88);
    coat.castShadow = true;
    this.body.add(coat);
    // coat hem fur
    const hem = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.05, 8, 24), white);
    hem.rotation.x = Math.PI / 2;
    hem.position.y = 0.38;
    this.body.add(hem);
    // belt + buckle
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.345, 0.035, 8, 24), dark);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 0.8;
    belt.scale.set(1, 0.88, 1);
    this.body.add(belt);
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.02), gold);
    buckle.position.set(0, 0.8, 0.33);
    this.body.add(buckle);
    // head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 16), skin);
    head.position.y = 1.42;
    head.castShadow = true;
    this.body.add(head);
    // beard
    const beard = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), white);
    beard.position.set(0, 1.33, 0.06);
    beard.scale.set(1.05, 1.1, 0.85);
    this.body.add(beard);
    // nose
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), skin);
    nose.position.set(0, 1.43, 0.15);
    this.body.add(nose);
    // hat
    const hatBase = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.045, 8, 20), white);
    hatBase.rotation.x = Math.PI / 2 - 0.15;
    hatBase.position.y = 1.53;
    this.body.add(hatBase);
    const hatCone = new THREE.Mesh(new THREE.ConeGeometry(0.145, 0.3, 16), red);
    hatCone.position.set(0.03, 1.66, -0.02);
    hatCone.rotation.z = -0.3;
    this.body.add(hatCone);
    const pom = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), white);
    pom.position.set(0.14, 1.76, -0.02);
    this.body.add(pom);

    // arms: shoulder pivot -> upper arm -> elbow pivot -> forearm -> mitten
    const mkArm = (side: number) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.3, 1.18, 0.05);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.24, 6, 10), red);
      upper.position.y = -0.16;
      upper.castShadow = true;
      shoulder.add(upper);
      const elbow = new THREE.Group();
      elbow.position.y = -0.31;
      shoulder.add(elbow);
      const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.2, 6, 10), red);
      fore.position.y = -0.13;
      fore.castShadow = true;
      elbow.add(fore);
      const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.03, 6, 14), white);
      cuff.rotation.x = Math.PI / 2;
      cuff.position.y = -0.24;
      elbow.add(cuff);
      const mitt = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), dark);
      mitt.position.y = -0.31;
      mitt.scale.set(1, 1.15, 0.8);
      mitt.castShadow = true;
      elbow.add(mitt);
      this.body.add(shoulder);
      return { shoulder, elbow };
    };
    const L = mkArm(-1);
    const R = mkArm(1);
    this.armL = L.shoulder; this.forearmL = L.elbow;
    this.armR = R.shoulder; this.forearmR = R.elbow;
  }

  update(dt: number) {
    this.time += dt;
    // gentle breathing
    this.body.scale.y = 1 + Math.sin(this.time * 1.3) * 0.006;
    // pulse the "holding the mouth open" gesture
    const holdNow = this.hold * (0.75 + Math.sin(this.time * 1.1) * 0.25);
    const liftPose = this.lift;
    // resting: arms hang. holding: arms reach forward-down toward the rim, spread.
    const reach = lerp(0.25, 1.05, Math.max(holdNow, liftPose));
    const spread = lerp(0.12, 0.55, holdNow) - liftPose * 0.25;
    this.armL.rotation.x = -reach;
    this.armR.rotation.x = -reach;
    this.armL.rotation.z = -spread;
    this.armR.rotation.z = spread;
    this.forearmL.rotation.x = lerp(-0.2, -0.5, Math.max(holdNow, liftPose));
    this.forearmR.rotation.x = lerp(-0.2, -0.5, Math.max(holdNow, liftPose));
    // lift: lean back a little, knees take the weight
    this.body.rotation.x = liftPose * 0.14;
    this.body.position.y = -liftPose * 0.05;
  }
}
