import { BoxGeometry, CylinderGeometry, Group, Mesh, Vector3, type BufferGeometry, type Material } from 'three';
import type { MaterialLibrary } from '../materials/MaterialLibrary';
import type { QualityProfile } from '../core/AdaptiveQuality';

/**
 * The low-loader the tree arrives on.
 *
 * The deck height, the bolsters under the stem and the ratchet straps are the
 * reason the opening shot reads as freight: something long, wrapped and tied
 * down, that has clearly been driven here.
 */
export class Trailer {
  readonly group = new Group();
  readonly deckHeight = 1.42;

  constructor(materials: MaterialLibrary, profile: QualityProfile, origin: Vector3, length = 24) {
    this.group.position.copy(origin);
    const shadow = profile.shadows;
    const add = (geo: BufferGeometry, mat: Material, x: number, y: number, z: number) => {
      const m = new Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = shadow;
      m.receiveShadow = true;
      this.group.add(m);
      return m;
    };

    // Deck and side rails.
    add(new BoxGeometry(length, 0.26, 2.9), materials.deckTimber, length / 2 - 2, this.deckHeight - 0.13, 0);
    add(new BoxGeometry(length, 0.34, 0.16), materials.craneDark, length / 2 - 2, this.deckHeight - 0.3, 1.45);
    add(new BoxGeometry(length, 0.34, 0.16), materials.craneDark, length / 2 - 2, this.deckHeight - 0.3, -1.45);
    // Gooseneck at the tractor end.
    add(new BoxGeometry(3.4, 0.5, 2.4), materials.craneDark, -3.4, this.deckHeight + 0.3, 0);

    // Rear bogie: three axles, dual wheels.
    const tyre = new CylinderGeometry(0.52, 0.52, 0.34, 12);
    for (let axle = 0; axle < 3; axle++) {
      const x = length - 6.2 + axle * 1.5;
      for (const side of [-1, 1]) {
        for (const off of [0, 0.38]) {
          const w = add(tyre, materials.rubber, x, 0.52, side * (1.1 + off));
          w.rotation.x = Math.PI / 2;
        }
      }
    }

    // Tractor unit.
    const cabX = -7.6;
    add(new BoxGeometry(5.2, 0.7, 2.5), materials.craneDark, cabX + 1.2, 1.0, 0);
    add(new BoxGeometry(2.6, 2.3, 2.5), materials.craneEnamel, cabX, 2.4, 0);
    add(new BoxGeometry(0.1, 1.0, 2.1), materials.craneDark, cabX - 1.3, 2.8, 0);
    for (const [x, r] of [
      [cabX - 0.4, 0.6],
      [cabX + 3.0, 0.6],
    ] as const) {
      for (const side of [-1, 1]) {
        const w = add(new CylinderGeometry(r, r, 0.38, 12), materials.rubber, x, r, side * 1.15);
        w.rotation.x = Math.PI / 2;
      }
    }

    // Bolsters: V-cradles that carried the stem, left behind once it lifts.
    for (const x of [1.2, 9.5, 17.2]) {
      for (const side of [-1, 1]) {
        const cheek = add(new BoxGeometry(0.5, 1.0, 0.22), materials.deckTimber, x, this.deckHeight + 0.42, side * 0.62);
        cheek.rotation.x = side * 0.42;
      }
      add(new BoxGeometry(1.6, 0.18, 1.5), materials.deckTimber, x, this.deckHeight + 0.08, 0);
    }
  }
}
