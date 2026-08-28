import * as THREE from 'three';
import type { WorldMaterials } from '../core/materials';
import { beam, corrugatedSlab } from './props';
import { Rng } from '../core/rng';

/** Where the tree is delivered: a real-scale covered hall with warm lighting. */
export class Lobby {
  readonly group = new THREE.Group();
  /** Finished floor level of the hall, above the yard's graded dirt. */
  readonly floorY = 0.6;
  /** World position the tree is stood up on. */
  readonly stand = new THREE.Vector3(40, 0.6, -2.2);
  private readonly lights: THREE.Light[] = [];
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(mats: WorldMaterials) {
    this.group.position.set(40, 0, 0);

    // the hall stands on a plinth, clear of the yard's graded dirt
    const slabGeo = new THREE.BoxGeometry(24, 1.2, 27);
    const slab = new THREE.Mesh(slabGeo, mats.concrete);
    slab.position.set(0, this.floorY - 0.6, 1);
    slab.receiveShadow = true;
    this.group.add(slab);
    this.disposables.push(slabGeo);

    const inner = new THREE.Group();
    inner.position.y = this.floorY;
    this.group.add(inner);

    // columns and roof
    const roof = corrugatedSlab(24.4, 27.4, mats.steelDark, 30);
    roof.position.set(0, 6.9, 1);
    inner.add(roof);
    for (const x of [-10, -4, 4, 10]) {
      for (const z of [-10, 12]) {
        const col = beam(0.36, 0.36, 6.8, mats.concrete);
        col.position.set(x, 3.4, z);
        inner.add(col);
        this.disposables.push(col.geometry);
      }
      const truss = beam(24, 0.18, 0.55, mats.steelDark);
      truss.rotation.y = Math.PI / 2;
      truss.position.set(x, 6.6, 1);
      inner.add(truss);
      this.disposables.push(truss.geometry);
    }

    // back wall and a glazed front onto the winter yard
    const wall = beam(24, 0.2, 6.8, mats.concrete, false);
    wall.position.set(0, 3.4, -12);
    wall.receiveShadow = true;
    inner.add(wall);
    this.disposables.push(wall.geometry);
    for (const sx of [-1, 1]) {
      const side = beam(27, 0.2, 6.8, mats.concrete, false);
      side.rotation.y = Math.PI / 2;
      side.position.set(sx * 12, 3.4, 1);
      inner.add(side);
      this.disposables.push(side.geometry);
    }
    const glassGeo = new THREE.BoxGeometry(24, 5.8, 0.08);
    const glass = new THREE.Mesh(glassGeo, mats.glass);
    glass.position.set(0, 3.2, 13.4);
    inner.add(glass);
    this.disposables.push(glassGeo);
    for (let i = 0; i < 7; i++) {
      const mullion = beam(0.12, 0.14, 5.9, mats.steelDark);
      mullion.position.set(-9 + i * 3, 3.2, 13.4);
      inner.add(mullion);
      this.disposables.push(mullion.geometry);
    }

    // warm practical lighting
    for (const [x, z] of [[-6, -4], [0, 1], [6, 6]] as const) {
      const panelGeo = new THREE.BoxGeometry(2.6, 0.1, 0.5);
      const panel = new THREE.Mesh(
        panelGeo,
        new THREE.MeshStandardMaterial({ color: 0xfff1d8, emissive: 0xffcf95, emissiveIntensity: 2.6 }),
      );
      panel.position.set(x, 6.3, z);
      inner.add(panel);
      this.disposables.push(panelGeo);
      const l = new THREE.PointLight(0xffc98d, 30, 24, 2);
      l.position.set(x, 6.0, z);
      inner.add(l);
      this.lights.push(l);
    }
    const ambient = new THREE.HemisphereLight(0xf0dfc4, 0x40382e, 0.55);
    inner.add(ambient);
    this.lights.push(ambient);

    // tree stand: a plain cast base the trunk drops into
    const baseGeo = new THREE.CylinderGeometry(0.42, 0.5, 0.22, 18);
    const base = new THREE.Mesh(baseGeo, mats.steelDark);
    base.position.set(this.stand.x - 40, 0.11, this.stand.z);
    base.castShadow = true;
    base.receiveShadow = true;
    inner.add(base);
    this.disposables.push(baseGeo);

    // a person, for scale
    const person = this.buildPerson(mats);
    person.position.set(1.9, 0, -0.5);
    person.rotation.y = -2.4;
    inner.add(person);

    // pallets and a trolley, lived-in but tidy
    const rng = new Rng(8);
    for (let i = 0; i < 3; i++) {
      const p = beam(1.2, 0.9, 0.14, mats.cloth);
      p.position.set(-8.5 + rng.jitter(0.2), 0.21 + i * 0.16, -8.4 + rng.jitter(0.3));
      p.rotation.y = rng.jitter(0.1);
      inner.add(p);
      this.disposables.push(p.geometry);
    }
  }

  private buildPerson(mats: WorldMaterials): THREE.Group {
    const g = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: 0x8a6a52, roughness: 0.85 });
    const hiVis = new THREE.MeshStandardMaterial({ color: 0x9aa15c, roughness: 0.85 });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.42, 4, 10), hiVis);
    torso.position.y = 1.24;
    torso.castShadow = true;
    g.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 10), skin);
    head.position.y = 1.66;
    head.castShadow = true;
    g.add(head);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mats.cloth);
    cap.position.y = 1.68;
    g.add(cap);
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.6, 4, 8), mats.cloth);
      leg.position.set(sx * 0.11, 0.48, 0);
      leg.castShadow = true;
      g.add(leg);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, 0.42, 4, 8), mats.cloth);
      arm.position.set(sx * 0.26, 1.24, 0.02);
      arm.rotation.z = sx * 0.12;
      g.add(arm);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.1, 0.26), mats.cloth);
      boot.position.set(sx * 0.11, 0.06, 0.03);
      g.add(boot);
    }
    this.disposables.push(skin, hiVis);
    return g;
  }

  setActive(on: boolean): void {
    for (const l of this.lights) l.visible = on;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
