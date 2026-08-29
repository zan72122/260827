import * as THREE from 'three';
import { BERRY_VARIANTS, type StrawberryCatalog } from '../content/StrawberryCatalog';
import type { Materials } from '../content/Materials';
import type { AdaptiveQuality } from '../core/Quality';
import { BerryView } from './BerryView';
import { Rng } from '../core/rng';

/**
 * The tray of prepared slices. In landscape it sits beside the cake so the shelf
 * and the work surface are visible at once; in portrait it lies in front of the
 * cake, below the ring. Each slice lies cut face up, which is the whole point:
 * the child can see the red shape before deciding where it should go.
 */
export class Tray {
  readonly root = new THREE.Group();
  readonly items: { variantId: string; view: BerryView }[] = [];
  private readonly dish: THREE.Mesh;

  constructor(
    materials: Materials,
    catalog: StrawberryCatalog,
    quality: AdaptiveQuality,
  ) {
    this.dish = new THREE.Mesh(
      new THREE.BoxGeometry(0.152, 0.0038, 0.046),
      materials.slate,
    );
    this.dish.receiveShadow = true;
    this.root.add(this.dish);
    const rim = new THREE.Mesh(
      new THREE.BoxGeometry(0.158, 0.0048, 0.052),
      materials.slate,
    );
    rim.position.y = -0.0016;
    rim.receiveShadow = true;
    this.root.add(rim);

    const rng = new Rng(0x7a11);
    BERRY_VARIANTS.forEach((v, i) => {
      const view = new BerryView(catalog.get(v.id), materials, quality);
      const x = -0.0615 + i * 0.0246;
      const q = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(-Math.PI / 2, 0, rng.jitter(0.24)),
      );
      view.setTransform(
        new THREE.Vector3(x, 0.0021 + v.thickness / 2, rng.jitter(0.004)),
        q,
      );
      view.root.userData.trayVariant = v.id;
      this.root.add(view.root);
      this.items.push({ variantId: v.id, view });
    });
  }

  /** Portrait puts the tray in front of the cake; landscape puts it beside it. */
  layout(portrait: boolean): void {
    if (portrait) {
      this.root.position.set(0, 0.0, 0.126);
      this.root.rotation.set(0, 0, 0);
    } else {
      this.root.position.set(0.152, 0.0, 0.026);
      this.root.rotation.set(0, -Math.PI / 2.3, 0);
    }
  }

  /** During the first play only one slice is offered, held in the middle. */
  showOnly(count: number): void {
    this.root.visible = count > 0;
    this.items.forEach((item, i) => {
      const on = i < count;
      item.view.root.visible = on;
      const spread = count === 1 ? 0 : 1;
      item.view.root.position.x = spread * (-0.0615 + i * 0.0246);
    });
  }

  pickables(): THREE.Object3D[] {
    return this.items.map((i) => i.view.root);
  }
}
