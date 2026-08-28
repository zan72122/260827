import * as THREE from 'three';
import { damp, lerp } from '../core/rng';
import type { WorldMaterials } from '../core/materials';
import { beam, boltRing, boltRow, weldRing } from './props';

/**
 * Trunk clamp on a vibrating table, with an oversized two-hand safety lever.
 * Nothing moves unless the lever is held down - that is the whole contract.
 */
export class Shaker {
  readonly group = new THREE.Group();
  readonly deckHeight = 0.72;
  private readonly deck = new THREE.Group();
  private readonly jaws: THREE.Group[] = [];
  private readonly lever = new THREE.Group();
  private readonly motor = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.13, 0.3, 14),
    new THREE.MeshStandardMaterial({ color: 0x2f3538, roughness: 0.55, metalness: 0.6 }),
  );
  private readonly eccentric: THREE.Mesh;
  private readonly ram: THREE.Mesh;
  private readonly disposables: Array<{ dispose(): void }> = [];

  /** 0 open .. 1 gripping the trunk. */
  clamp = 0;
  /** 0 released .. 1 pressed. */
  leverPress = 0;
  /** 0 still .. 1 full shake. */
  vibration = 0;
  private phase = 0;
  private spin = 0;

  constructor(mats: WorldMaterials) {
    // ---- ground frame ----------------------------------------------------
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      const leg = beam(0.14, 0.14, this.deckHeight, mats.paintGreen);
      leg.position.set(sx * 0.64, this.deckHeight / 2, sz * 0.6);
      this.group.add(leg);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.13, 0.06, 12), mats.rubber);
      foot.position.set(sx * 0.64, 0.03, sz * 0.6);
      this.group.add(foot);
      const plate = beam(0.3, 0.3, 0.02, mats.steelDark);
      plate.position.set(sx * 0.64, 0.07, sz * 0.6);
      this.group.add(plate);
      const bolts = boltRow(3, 0.09, mats.steel);
      bolts.position.set(sx * 0.64, 0.09, sz * 0.6 + 0.1);
      this.group.add(bolts);
    }
    for (const sz of [-1, 1]) {
      const rail = beam(1.5, 0.12, 0.14, mats.paintGreen);
      rail.position.set(0, 0.5, sz * 0.6);
      this.group.add(rail);
    }

    // ---- vibrating deck --------------------------------------------------
    const plate = beam(1.36, 1.3, 0.07, mats.steelDark);
    plate.position.y = this.deckHeight;
    this.deck.add(plate);
    const lip = weldRing(0.5, mats.steel, 0.014);
    lip.rotation.x = Math.PI / 2;
    lip.position.y = this.deckHeight + 0.035;
    this.deck.add(lip);
    const spikes = boltRing(0.16, 6, mats.steel, 0.02);
    spikes.position.y = this.deckHeight + 0.04;
    this.deck.add(spikes);
    // springs between frame and deck
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      const spring = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 8), mats.steel);
      spring.position.set(sx * 0.44, this.deckHeight - 0.08, sz * 0.42);
      this.deck.add(spring);
    }

    // ---- motor with a deliberately unbalanced weight ----------------------
    this.motor.rotation.z = Math.PI / 2;
    this.motor.position.set(0.46, this.deckHeight - 0.16, -0.34);
    this.deck.add(this.motor);
    this.eccentric = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.14, 0.07),
      new THREE.MeshStandardMaterial({ color: 0x6b6f72, roughness: 0.5, metalness: 0.8 }),
    );
    this.eccentric.position.set(0.62, this.deckHeight - 0.16, -0.34);
    this.deck.add(this.eccentric);
    const guard = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.1, 14, 1, true), mats.paintYellow);
    guard.rotation.z = Math.PI / 2;
    guard.position.copy(this.eccentric.position);
    this.deck.add(guard);
    this.group.add(this.deck);

    // ---- trunk clamp -----------------------------------------------------
    for (const side of [-1, 1]) {
      const jaw = new THREE.Group();
      const shell = new THREE.Mesh(
        new THREE.CylinderGeometry(0.17, 0.19, 0.3, 12, 1, true, -Math.PI / 2, Math.PI),
        mats.steel,
      );
      shell.rotation.y = side < 0 ? 0 : Math.PI;
      shell.castShadow = true;
      jaw.add(shell);
      const back = beam(0.26, 0.1, 0.3, mats.paintGreen);
      back.position.set(side * 0.24, 0, 0);
      jaw.add(back);
      jaw.position.set(side * 0.24, this.deckHeight + 0.52, 0);
      this.jaws.push(jaw);
      this.deck.add(jaw);
      // hydraulic ram driving the jaw
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.34, 8), mats.steel);
      rod.rotation.z = Math.PI / 2;
      rod.position.set(side * 0.5, this.deckHeight + 0.52, 0);
      this.deck.add(rod);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.28, 10), mats.paintGreen);
      barrel.rotation.z = Math.PI / 2;
      barrel.position.set(side * 0.72, this.deckHeight + 0.52, 0);
      this.deck.add(barrel);
    }

    // mast carrying the clamp
    for (const sx of [-1, 1]) {
      const mast = beam(0.12, 0.12, 0.62, mats.paintGreen);
      mast.position.set(sx * 0.72, this.deckHeight + 0.28, 0);
      this.deck.add(mast);
    }

    // ---- safety lever: deliberately big, at a child's eye height ---------
    const post = beam(0.13, 0.13, 1.18, mats.paintGreen);
    post.position.set(-0.05, 0.59, 0.96);
    this.group.add(post);
    const pivot = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.14, 10), mats.steel);
    pivot.rotation.x = Math.PI / 2;
    pivot.position.set(-0.05, 1.18, 0.96);
    this.group.add(pivot);
    const arm = beam(0.66, 0.09, 0.09, mats.paintYellow);
    arm.position.set(0.31, 0, 0);
    this.lever.add(arm);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.26, 12), mats.rubber);
    grip.rotation.x = Math.PI / 2;
    grip.position.set(0.64, 0, 0);
    this.lever.add(grip);
    // hazard band
    const band = beam(0.12, 0.095, 0.095, mats.steelDark);
    band.position.set(0.43, 0, 0);
    this.lever.add(band);
    this.lever.position.set(-0.05, 1.18, 0.96);
    this.group.add(this.lever);

    this.ram = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8), mats.steel);
    this.ram.position.set(-0.05, 0.9, 0.96);
    this.group.add(this.ram);

    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = mesh.castShadow || true;
        mesh.receiveShadow = true;
        if (mesh.geometry) this.disposables.push(mesh.geometry);
      }
    });
  }

  /** World-space point where the trunk butt sits. */
  get seatY(): number {
    return this.deckHeight + 0.03;
  }

  update(dt: number): void {
    this.spin += this.vibration * dt * 74;
    this.phase += dt;
    const amp = this.vibration * 0.006;
    const w = Math.sin(this.phase * 2 * Math.PI * 11.5);
    const w2 = Math.cos(this.phase * 2 * Math.PI * 11.5 * 0.5);
    this.deck.position.set(w * amp * 1.4, Math.abs(w2) * amp, w2 * amp);
    this.deck.rotation.z = w * amp * 0.5;
    this.eccentric.rotation.x = this.spin;
    this.motor.rotation.x = this.spin;

    const target = lerp(0.28, 0.02, this.clamp);
    for (let i = 0; i < this.jaws.length; i++) {
      const side = i === 0 ? -1 : 1;
      this.jaws[i].position.x = side * (0.16 + target);
    }
    this.lever.rotation.z = -this.leverPress * 0.55;
    this.ram.scale.y = 1 - this.leverPress * 0.35;
  }

  setLeverSmooth(target: number, dt: number): void {
    this.leverPress = damp(this.leverPress, target, 16, dt);
  }

  /** World position of the lever grip, for placing the on-screen hint. */
  gripWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.lever.localToWorld(out.set(0.64, 0, 0));
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
