import * as THREE from 'three';
import { Materials } from './materials';
import { Inertial } from '../game/geom';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function box(mat: THREE.Material, sx: number, sy: number, sz: number, p: THREE.Vector3, parent: THREE.Object3D) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  m.position.copy(p);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function cyl(mat: THREE.Material, r: number, h: number, p: THREE.Vector3, parent: THREE.Object3D, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
  m.position.copy(p);
  m.castShadow = true;
  parent.add(m);
  return m;
}

/**
 * Articulating boom lift. The basket is driven by a two-link IK solve, so the
 * booms, their lift cylinders and the levelling basket all follow one target.
 */
export class Mewp {
  readonly root = new THREE.Group();
  readonly basket = new THREE.Group();
  readonly basketFloor = new THREE.Group();

  private turret = new THREE.Group();
  private lower = new THREE.Group();
  private upper = new THREE.Group();
  private jib = new THREE.Group();
  private lowerCyl = new THREE.Group();
  private lowerRod: THREE.Mesh;
  private upperCyl = new THREE.Group();
  private upperRod: THREE.Mesh;

  private readonly L1 = 8.6;
  private readonly L2 = 7.4;
  private readonly jibLen = 1.5;
  private readonly pivotY = 1.85;

  private yaw = new Inertial(0, 0.9, 0.5);
  private a1 = new Inertial(0.35, 0.9, 0.42);
  private a2 = new Inertial(-0.9, 1.1, 0.5);

  constructor(m: Materials) {
    // ---- chassis ---------------------------------------------------------
    const chassis = new THREE.Group();
    this.root.add(chassis);
    box(m.paintYellow, 5.6, 0.7, 2.3, V(0, 0.75, 0), chassis);
    box(m.craneAccent, 5.9, 0.26, 2.5, V(0, 1.16, 0), chassis);
    box(m.craneAccent, 1.1, 0.5, 2.2, V(2.6, 1.5, 0), chassis);
    for (const x of [2.0, -2.0]) {
      for (const s of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.44, 14), m.rubber);
        w.rotation.x = Math.PI / 2;
        w.position.set(x, 0.62, s * 1.16);
        w.castShadow = true;
        chassis.add(w);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.46, 10), m.steel);
        hub.rotation.x = Math.PI / 2;
        hub.position.copy(w.position);
        chassis.add(hub);
      }
    }
    // Stabiliser feet, down while working.
    for (const x of [2.3, -2.3]) {
      for (const s of [-1, 1]) {
        box(m.craneAccent, 0.5, 0.24, 1.5, V(x, 0.9, s * 1.5), chassis);
        cyl(m.chrome, 0.11, 0.9, V(x, 0.45, s * 2.05), chassis, 8);
        const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.36, 0.12, 14), m.steel);
        pad.position.set(x, 0.06, s * 2.05);
        pad.receiveShadow = true;
        chassis.add(pad);
      }
    }

    // ---- turret ----------------------------------------------------------
    this.turret.position.set(-0.3, this.pivotY - 0.5, 0);
    chassis.add(this.turret);
    box(m.paintYellow, 1.9, 1.3, 1.9, V(0, 0.2, 0), this.turret);
    box(m.craneAccent, 1.2, 0.7, 2.0, V(-1.0, 0.2, 0), this.turret);

    // ---- lower boom ------------------------------------------------------
    this.lower.position.set(0.2, 0.5, 0);
    this.turret.add(this.lower);
    box(m.paintYellow, this.L1, 0.62, 0.56, V(this.L1 / 2, 0, 0), this.lower);
    box(m.craneAccent, 0.3, 0.72, 0.66, V(0.08, 0, 0), this.lower);
    this.lowerCyl.position.set(0.6, -0.55, 0);
    this.turret.add(this.lowerCyl);
    cyl(m.craneAccent, 0.16, 2.2, V(0, 1.1, 0), this.lowerCyl, 10);
    this.lowerRod = cyl(m.chrome, 0.1, 2.0, V(0, 3.0, 0), this.lowerCyl, 10);

    // ---- upper boom ------------------------------------------------------
    this.upper.position.set(this.L1, 0, 0);
    this.lower.add(this.upper);
    box(m.paintYellow, this.L2, 0.5, 0.46, V(this.L2 / 2, 0, 0), this.upper);
    box(m.craneAccent, 0.28, 0.6, 0.56, V(0.06, 0, 0), this.upper);
    this.upperCyl.position.set(0.7, -0.42, 0);
    this.lower.add(this.upperCyl);
    cyl(m.craneAccent, 0.13, 1.9, V(0, 0.95, 0), this.upperCyl, 10);
    this.upperRod = cyl(m.chrome, 0.08, 1.7, V(0, 2.6, 0), this.upperCyl, 10);

    // ---- jib and basket --------------------------------------------------
    this.jib.position.set(this.L2, 0, 0);
    this.upper.add(this.jib);
    box(m.craneAccent, this.jibLen, 0.3, 0.3, V(this.jibLen / 2, 0, 0), this.jib);
    this.basket.position.set(this.jibLen, 0, 0);
    this.jib.add(this.basket);
    this.basket.add(this.basketFloor);
    // Basket: floor plate, toe boards, handrails, control box.
    const floor = box(m.steelDark, 1.5, 0.08, 0.95, V(0.55, -0.62, 0), this.basketFloor);
    floor.receiveShadow = true;
    for (const s of [-1, 1]) {
      box(m.paintYellow, 1.5, 0.22, 0.05, V(0.55, -0.48, s * 0.47), this.basketFloor);
      box(m.steel, 1.5, 0.05, 0.05, V(0.55, 0.5, s * 0.47), this.basketFloor);
      box(m.steel, 1.5, 0.05, 0.05, V(0.55, 0.02, s * 0.47), this.basketFloor);
    }
    for (const [x, z] of [
      [-0.15, -0.47],
      [-0.15, 0.47],
      [1.25, -0.47],
      [1.25, 0.47],
    ] as [number, number][]) {
      box(m.steel, 0.06, 1.2, 0.06, V(x, -0.03, z), this.basketFloor);
    }
    box(m.paintYellow, 0.05, 1.0, 0.9, V(1.28, -0.05, 0), this.basketFloor);
    box(m.craneAccent, 0.26, 0.3, 0.4, V(1.0, 0.18, -0.3), this.basketFloor);
  }

  /** Basket attachment point in world space. */
  basketWorld(out = new THREE.Vector3()): THREE.Vector3 {
    this.basketFloor.updateWorldMatrix(true, false);
    return out.set(0.55, -0.5, 0).applyMatrix4(this.basketFloor.matrixWorld);
  }

  /** Drives the booms so the basket reaches `target`. */
  solve(target: THREE.Vector3, dt: number): void {
    this.root.updateWorldMatrix(true, false);
    const local = this.root.worldToLocal(target.clone());
    const base = new THREE.Vector3(-0.3, this.pivotY, 0);
    const dx = local.x - base.x;
    const dz = local.z - base.z;
    const dy = local.y - base.y;
    const desiredYaw = Math.atan2(-dz, dx);
    this.yaw.step(desiredYaw, dt);

    const reach = Math.hypot(dx, dz) - this.jibLen;
    const d = THREE.MathUtils.clamp(
      Math.hypot(reach, dy),
      Math.abs(this.L1 - this.L2) + 0.4,
      this.L1 + this.L2 - 0.35,
    );
    const cosE = THREE.MathUtils.clamp((this.L1 * this.L1 + this.L2 * this.L2 - d * d) / (2 * this.L1 * this.L2), -1, 1);
    const elbow = Math.PI - Math.acos(cosE);
    const cosS = THREE.MathUtils.clamp((d * d + this.L1 * this.L1 - this.L2 * this.L2) / (2 * d * this.L1), -1, 1);
    const shoulder = Math.atan2(dy, reach) + Math.acos(cosS);

    this.a1.step(THREE.MathUtils.clamp(shoulder, -0.15, 1.35), dt);
    this.a2.step(THREE.MathUtils.clamp(-elbow, -2.3, 0.1), dt);

    this.turret.rotation.y = this.yaw.value;
    this.lower.rotation.z = this.a1.value;
    this.upper.rotation.z = this.a2.value;
    this.jib.rotation.z = -(this.a1.value + this.a2.value) * 0.35;
    // Keep the basket level whatever the booms do.
    this.basket.rotation.z = -(this.a1.value + this.a2.value + this.jib.rotation.z);

    // Cylinders follow their geometry.
    this.lowerCyl.rotation.z = this.a1.value * 0.72 - 0.1;
    this.lowerRod.position.y = 2.4 + this.a1.value * 1.5;
    this.upperCyl.rotation.z = this.a2.value * 0.55 + 0.5;
    this.upperRod.position.y = 2.2 - this.a2.value * 0.9;
  }

  get moving(): boolean {
    return Math.abs(this.a1.velocity) + Math.abs(this.a2.velocity) + Math.abs(this.yaw.velocity) > 0.02;
  }

  stow(dt: number): void {
    this.yaw.step(0, dt);
    this.a1.step(0.06, dt);
    this.a2.step(-0.12, dt);
    this.turret.rotation.y = this.yaw.value;
    this.lower.rotation.z = this.a1.value;
    this.upper.rotation.z = this.a2.value;
    this.basket.rotation.z = -(this.a1.value + this.a2.value);
  }
}
