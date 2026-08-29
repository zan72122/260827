import { BoxGeometry, Group, Mesh, TorusGeometry, Vector3 } from 'three';
import type { MaterialLibrary } from '../materials/MaterialLibrary';
import type { TreeHierarchy } from '../tree/TreeHierarchy';
import { clamp, damp, lerp } from '../core/math';

interface Band {
  /** Height fraction of the stem where the transport strap bites. */
  t: number;
  radius: number;
  strap: Mesh;
  buckle: Mesh;
  /** 0 = strapped, 1 = strap removed. */
  open: number;
  target: number;
}

/**
 * Transport strapping.
 *
 * On the trailer the straps are the reason the tree reads as a long green
 * package instead of a tree. Taking them off, bottom band first, is a short
 * step whose only job is to give the stem back its real width — the crown
 * grows outward, the plaza around it gets smaller.
 */
export class BranchRelease {
  readonly group = new Group();
  private readonly bands: Band[] = [];
  private released = 0;
  private readonly tmp = new Vector3();

  constructor(
    private readonly tree: TreeHierarchy,
    materials: MaterialLibrary,
  ) {
    // Bands sit on the branched part of the stem, not on the bare butt.
    const fractions = [0.22, 0.42, 0.62, 0.82];
    for (const t of fractions) {
      const h = t * tree.height;
      // Sized from the bundled pose the crown is actually in, plus the little
      // the webbing stands off the needles it is compressing.
      const radius = tree.reachAt(h) + 0.12;

      const strap = new Mesh(new TorusGeometry(radius, 0.042, 6, 26), materials.transportStrap);
      strap.rotation.x = Math.PI / 2;
      strap.castShadow = true;
      const buckle = new Mesh(new BoxGeometry(0.24, 0.16, 0.12), materials.galvanised);
      this.group.add(strap, buckle);
      this.bands.push({ t, radius, strap, buckle, open: 0, target: 0 });
    }
    // Straps start on, so the crown starts fully bundled.
    tree.setBundleForHeight(-1);
  }

  get bandCount(): number {
    return this.bands.length;
  }

  get releasedCount(): number {
    return this.released;
  }

  get allReleased(): boolean {
    return this.released >= this.bands.length;
  }

  /** Height fraction of the next strap to come off, or null when done. */
  get nextBandT(): number | null {
    return this.released < this.bands.length ? this.bands[this.released].t : null;
  }

  /** Player pulled the lowest remaining strap free. */
  releaseNext(): boolean {
    if (this.released >= this.bands.length) return false;
    this.bands[this.released].target = 1;
    this.released++;
    const freedTo =
      this.released < this.bands.length
        ? lerp(this.bands[this.released - 1].t, this.bands[this.released].t, 0.85) * this.tree.height
        : this.tree.height + 1;
    this.tree.setBundleForHeight(freedTo);
    return true;
  }

  /** Put every strap back on for a replay. */
  reset(): void {
    this.released = 0;
    for (const band of this.bands) {
      band.target = 0;
      band.open = 0;
    }
    this.tree.setBundleForHeight(-1);
  }

  update(dt: number): void {
    for (const band of this.bands) {
      band.open = damp(band.open, band.target, 2.4, dt);
      const o = clamp(band.open, 0, 1);
      const pos = this.tree.pointOnStem(band.t, this.tmp);
      // The strap first slackens, then drops clear of the branch it held.
      band.strap.position.copy(pos);
      band.strap.position.y -= o * 1.4;
      band.strap.scale.setScalar(1 + o * 0.35);
      band.strap.visible = o < 0.98;
      band.strap.quaternion.copy(this.tree.stem.getWorldQuaternion(band.strap.quaternion));
      band.strap.rotateX(Math.PI / 2);
      band.buckle.visible = band.strap.visible;
      band.buckle.position.copy(band.strap.position);
      band.buckle.position.x += band.radius * (1 + o * 0.35);
    }
  }
}
