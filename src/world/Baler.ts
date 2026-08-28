import * as THREE from 'three';
import { lerp } from '../core/rng';
import type { WorldMaterials } from '../core/materials';
import { beam, boltRing, boltRow, weldRing } from './props';

const R_IN = 0.98;
const R_OUT = 0.3;
const LENGTH = 3.0;

/**
 * Painted steel cone with plate thickness, ribs, welds, feet and rubber feed
 * rollers. Only the mouth ring, the liner and the rollers are worn - those are
 * the surfaces a tree actually touches.
 */
export class Baler {
  readonly group = new THREE.Group();
  readonly length = LENGTH;
  private readonly rollers: THREE.Mesh[] = [];
  private readonly spool: THREE.Group = new THREE.Group();
  private readonly lamp: THREE.Mesh;
  private readonly disposables: Array<{ dispose(): void }> = [];
  private spin = 0;

  /** Radians per second on the feed rollers. */
  rollerSpeed = 0;

  constructor(mats: WorldMaterials, axisHeight: number) {
    const coneGeo = new THREE.CylinderGeometry(R_OUT, R_IN, LENGTH, 32, 1, true);
    coneGeo.rotateZ(-Math.PI / 2);
    coneGeo.translate(LENGTH / 2, 0, 0);
    const cone = new THREE.Mesh(coneGeo, mats.paintGreen);
    cone.castShadow = true;
    cone.receiveShadow = true;
    this.group.add(cone);

    // liner: bare steel, polished by every tree that has gone through
    const linerGeo = new THREE.CylinderGeometry(R_OUT - 0.014, R_IN - 0.014, LENGTH * 0.998, 32, 1, true);
    linerGeo.rotateZ(-Math.PI / 2);
    linerGeo.translate(LENGTH / 2, 0, 0);
    // clone: flipping the side must not leak into every other steel surface
    const linerMat = (mats.steel as THREE.MeshStandardMaterial).clone();
    linerMat.side = THREE.BackSide;
    linerMat.color.setHex(0x8e8b84);
    const liner = new THREE.Mesh(linerGeo, linerMat);
    this.group.add(liner);
    this.disposables.push(coneGeo, linerGeo, linerMat);

    // plate edges
    for (const [x, r, tube] of [
      [0, R_IN, 0.017],
      [LENGTH, R_OUT, 0.014],
    ] as const) {
      const rim = weldRing(r, mats.steel, tube);
      rim.rotation.y = Math.PI / 2;
      rim.position.x = x;
      this.group.add(rim);
      this.disposables.push(rim.geometry);
    }
    // weld seams between rolled plates
    for (const t of [0.34, 0.68]) {
      const seam = weldRing(lerp(R_IN, R_OUT, t) + 0.004, mats.steelDark, 0.008);
      seam.rotation.y = Math.PI / 2;
      seam.position.x = t * LENGTH;
      this.group.add(seam);
      this.disposables.push(seam.geometry);
    }

    // external ribs following the cone slope
    const slope = Math.atan2(R_IN - R_OUT, LENGTH);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.26;
      const rib = beam(LENGTH * 0.96, 0.045, 0.075, mats.paintGreen);
      const rMid = (R_IN + R_OUT) / 2 + 0.03;
      rib.position.set(LENGTH / 2, Math.sin(a) * rMid, Math.cos(a) * rMid);
      rib.rotation.x = -a;
      rib.rotation.z = slope;
      this.group.add(rib);
      this.disposables.push(rib.geometry);
    }

    // legs down to the yard surface
    const groundY = -axisHeight;
    for (const [x, sz] of [
      [0.45, -1],
      [0.45, 1],
      [2.45, -1],
      [2.45, 1],
    ] as const) {
      const rHere = lerp(R_IN, R_OUT, x / LENGTH);
      const top = -rHere * 0.72;
      const h = top - groundY;
      const leg = beam(0.13, 0.13, h, mats.paintGreen);
      leg.position.set(x, groundY + h / 2, sz * (rHere * 0.7));
      leg.rotation.x = sz * 0.16;
      this.group.add(leg);
      const plate = beam(0.34, 0.34, 0.03, mats.steelDark);
      plate.position.set(x, groundY + 0.015, sz * (rHere * 0.82));
      this.group.add(plate);
      const bolts = boltRow(4, 0.1, mats.steel);
      bolts.position.set(x, groundY + 0.04, sz * (rHere * 0.82) + 0.11);
      this.group.add(bolts);
      this.disposables.push(leg.geometry, plate.geometry, bolts.geometry);
    }
    for (const x of [0.45, 2.45]) {
      const rHere = lerp(R_IN, R_OUT, x / LENGTH);
      const brace = beam(rHere * 1.5, 0.08, 0.08, mats.paintGreen);
      brace.rotation.y = Math.PI / 2;
      brace.position.set(x, groundY + 0.42, 0);
      this.group.add(brace);
      this.disposables.push(brace.geometry);
    }

    // flare bars guiding the tree into the mouth
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const bar = beam(0.62, 0.05, 0.05, mats.paintYellow);
      bar.position.set(-0.3, Math.sin(a) * (R_IN + 0.16), Math.cos(a) * (R_IN + 0.16));
      bar.rotation.x = -a;
      bar.rotation.z = -0.42;
      this.group.add(bar);
      this.disposables.push(bar.geometry);
    }

    // ---- feed rollers ----------------------------------------------------
    const rollerGeo = new THREE.CylinderGeometry(0.18, 0.18, 1.34, 20, 1);
    for (const sy of [-1, 1]) {
      const roller = new THREE.Mesh(rollerGeo, mats.rubber);
      roller.rotation.x = Math.PI / 2;
      roller.position.set(-0.42, sy * 0.62, 0);
      roller.castShadow = true;
      this.rollers.push(roller);
      this.group.add(roller);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.7, 10), mats.steel);
      shaft.rotation.x = Math.PI / 2;
      shaft.position.copy(roller.position);
      this.group.add(shaft);
      for (const sz of [-1, 1]) {
        const bearing = beam(0.16, 0.14, 0.18, mats.paintGreen);
        bearing.position.set(-0.42, sy * 0.62, sz * 0.79);
        this.group.add(bearing);
        const post = beam(0.1, 0.1, 0.62, mats.paintGreen);
        post.position.set(-0.42, sy * 0.34, sz * 0.79);
        this.group.add(post);
        this.disposables.push(bearing.geometry, post.geometry);
      }
      this.disposables.push(shaft.geometry);
    }
    this.disposables.push(rollerGeo);
    // chain drive
    const sprocket = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.03, 14), mats.steelDark);
    sprocket.rotation.x = Math.PI / 2;
    sprocket.position.set(-0.42, -0.62, 0.84);
    this.group.add(sprocket);
    this.disposables.push(sprocket.geometry);

    // ---- in-feed trestle: the trunk rides in on a V roller ---------------
    const vRollGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.42, 12);
    for (const sy of [-1, 1]) {
      const vr = new THREE.Mesh(vRollGeo, mats.rubber);
      vr.position.set(-1.15, -0.36, sy * 0.19);
      vr.rotation.x = Math.PI / 2;
      vr.rotation.z = sy * 0.42;
      this.rollers.push(vr);
      this.group.add(vr);
    }
    const trestle = beam(0.12, 0.12, groundY * -1 - 0.45, mats.paintGreen);
    trestle.position.set(-1.15, (groundY - 0.45) / 2, 0);
    this.group.add(trestle);
    const trestlePlate = beam(0.34, 0.34, 0.03, mats.steelDark);
    trestlePlate.position.set(-1.15, groundY + 0.015, 0);
    this.group.add(trestlePlate);
    this.disposables.push(vRollGeo, trestle.geometry, trestlePlate.geometry);

    // ---- net dispenser at the exit ---------------------------------------
    this.spool.position.set(LENGTH + 0.16, 0.42, 0);
    const spoolBody = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.5, 16), mats.paintYellow);
    spoolBody.rotation.x = Math.PI / 2;
    this.spool.add(spoolBody);
    for (const sz of [-1, 1]) {
      const cheek = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.02, 16), mats.steelDark);
      cheek.rotation.x = Math.PI / 2;
      cheek.position.z = sz * 0.26;
      this.spool.add(cheek);
    }
    this.group.add(this.spool);
    const bracket = beam(0.1, 0.1, 0.8, mats.paintGreen);
    bracket.position.set(LENGTH + 0.16, 0.05, 0.3);
    this.group.add(bracket);
    const guide = weldRing(R_OUT + 0.06, mats.steel, 0.02);
    guide.rotation.y = Math.PI / 2;
    guide.position.x = LENGTH + 0.1;
    this.group.add(guide);
    this.disposables.push(bracket.geometry, guide.geometry, spoolBody.geometry);

    // ---- control box -----------------------------------------------------
    const boxPost = beam(0.09, 0.09, 1.1, mats.steelDark);
    boxPost.position.set(0.1, -0.55, 1.15);
    this.group.add(boxPost);
    const box = beam(0.3, 0.22, 0.34, mats.paintYellow);
    box.position.set(0.1, 0.12, 1.15);
    this.group.add(box);
    this.lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x2a3a26, emissive: 0x3fbf4a, emissiveIntensity: 0.6 }),
    );
    this.lamp.position.set(0.1, 0.24, 1.29);
    this.group.add(this.lamp);
    this.disposables.push(boxPost.geometry, box.geometry, this.lamp.geometry);
    const railBolts = boltRing(R_IN + 0.03, 12, mats.steel, 0.014);
    railBolts.rotation.z = Math.PI / 2;
    railBolts.position.x = 0.02;
    this.group.add(railBolts);
    this.disposables.push(railBolts.geometry);

    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.receiveShadow = true;
    });
  }

  /** Cone radius at travel fraction t (0 = mouth, 1 = exit). */
  radiusAt(t: number): number {
    return lerp(R_IN, R_OUT, Math.min(1, Math.max(0, t)));
  }

  get mouthRadius(): number {
    return R_IN;
  }

  update(dt: number, wrapping: boolean): void {
    this.spin += this.rollerSpeed * dt;
    for (let i = 0; i < this.rollers.length; i++) {
      this.rollers[i].rotation.y = i === 0 ? this.spin : -this.spin;
    }
    if (wrapping) this.spool.rotation.z -= dt * 6;
    const mat = this.lamp.material as THREE.MeshStandardMaterial;
    mat.emissiveIntensity = this.rollerSpeed > 0.4 ? 1.8 : 0.5;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
