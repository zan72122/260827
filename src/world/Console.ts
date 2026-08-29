import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import type { MaterialLibrary } from '../materials/MaterialLibrary';
import { clamp } from '../core/math';

/**
 * The remote operating console in the safe zone.
 *
 * Everything the player touches is here, outside the fence: the hoist lever,
 * the trim drums, the enable handle and three mechanical indicator lamps. The
 * physical console exists in the scene so the child can see where they are
 * standing, and why they are not up a ladder.
 */
export class Console {
  readonly group = new Group();
  readonly lampMaterials: MeshStandardMaterial[] = [];
  private readonly lever: Group;
  private readonly handle: Group;

  constructor(materials: MaterialLibrary, position: Vector3, facing: number) {
    this.group.position.copy(position);
    this.group.rotation.y = facing;

    const pedestal = new Mesh(new BoxGeometry(1.9, 1.0, 0.85), materials.craneEnamel);
    pedestal.position.y = 0.5;
    pedestal.castShadow = true;
    const desk = new Mesh(new BoxGeometry(2.0, 0.1, 1.0), materials.craneDark);
    desk.position.y = 1.03;
    desk.rotation.x = -0.22;
    const legs = new Mesh(new BoxGeometry(1.7, 0.12, 0.7), materials.galvanised);
    legs.position.y = 0.06;
    this.group.add(pedestal, desk, legs);

    // Three mechanical indicator lamps in a row: the only "countdown" in the
    // game, and it is a machine telling you the system is ready.
    for (let i = 0; i < 3; i++) {
      const housing = new Mesh(new CylinderGeometry(0.11, 0.13, 0.14, 12), materials.craneDark);
      housing.position.set(-0.5 + i * 0.5, 1.16, -0.16);
      housing.rotation.x = -0.22;
      const mat = new MeshStandardMaterial({
        color: 0x30240f,
        emissive: 0xffb347,
        emissiveIntensity: 0,
        roughness: 0.4,
      });
      const lens = new Mesh(new CylinderGeometry(0.09, 0.09, 0.05, 12), mat);
      lens.position.copy(housing.position).setY(housing.position.y + 0.08);
      lens.rotation.x = -0.22;
      this.lampMaterials.push(mat);
      this.group.add(housing, lens);
    }

    this.lever = new Group();
    this.lever.position.set(0.62, 1.08, 0.1);
    const shaft = new Mesh(new CylinderGeometry(0.035, 0.04, 0.42, 8), materials.galvanised);
    shaft.position.y = 0.21;
    const knob = new Mesh(new CylinderGeometry(0.075, 0.075, 0.1, 10), materials.hiVis);
    knob.position.y = 0.44;
    this.lever.add(shaft, knob);
    this.group.add(this.lever);

    this.handle = new Group();
    this.handle.position.set(-0.62, 1.1, 0.12);
    const base = new Mesh(new CylinderGeometry(0.13, 0.15, 0.08, 12), materials.craneDark);
    const grip = new Mesh(new CylinderGeometry(0.05, 0.05, 0.3, 10), materials.hiVis);
    grip.position.y = 0.17;
    this.handle.add(base, grip);
    this.group.add(this.handle);
  }

  /** `count` lamps lit, 0..3. */
  setLamps(count: number): void {
    for (let i = 0; i < this.lampMaterials.length; i++) {
      this.lampMaterials[i].emissiveIntensity = i < count ? 2.6 : 0;
    }
  }

  setLever(v: number): void {
    this.lever.rotation.x = clamp(v, 0, 1) * -0.7;
  }

  setHandle(v: number): void {
    this.handle.rotation.x = clamp(v, 0, 1) * -0.8;
  }
}
