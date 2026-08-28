import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  Object3D,
  TorusGeometry,
  Vector3,
} from 'three';
import type { MaterialLibrary } from './materials';

/**
 * The rest of the single-horse driving harness: a breast collar taking the
 * pull, the traces running back to the shafts, a back band and a belly band.
 *
 * It exists so the bell strap reads as one piece of a real, load-bearing rig
 * rather than a decoration floating on the animal - and so the child is never
 * shown assembling the load-bearing parts themselves.
 */
export class DrivingHarness {
  readonly group = new Group();
  readonly traceLeft: Mesh;
  readonly traceRight: Mesh;
  private collar: Mesh;
  private neckStrap: Group;
  private backBand: Mesh;
  private bellyBand: Mesh;
  private terrets: Mesh[] = [];

  constructor(mats: MaterialLibrary) {
    // Breast collar: a horizontal band low across the chest, taking the pull.
    // The arc is an ellipse so it follows the brisket rather than standing off
    // it as a ring would.
    // A wide band, not a rod: the tube is squashed radially and stretched
    // vertically so the collar reads as a strap pressed into the coat.
    const collarGeo = new TorusGeometry(0.4, 0.028, 6, 24, Math.PI);
    collarGeo.rotateX(Math.PI / 2);
    collarGeo.scale(0.74, 1.9, 1);
    this.collar = new Mesh(collarGeo, mats.leather);
    this.collar.position.set(0, 1.04, 0.5);
    this.collar.castShadow = true;
    this.group.add(this.collar);

    // Two short straps carry the collar up over the withers, which is what
    // stops a breast collar from sliding down onto the shoulder joint.
    this.neckStrap = new Group();
    for (const side of [-1, 1]) {
      const from = new Vector3(side * 0.3, 1.06, 0.48);
      const to = new Vector3(side * 0.06, 1.62, 0.44);
      const dir = to.clone().sub(from);
      const strap = new Mesh(new CylinderGeometry(0.018, 0.018, dir.length(), 5), mats.leather);
      strap.position.copy(from).addScaledVector(dir, 0.5);
      strap.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir.clone().normalize());
      strap.castShadow = true;
      this.neckStrap.add(strap);
    }
    this.group.add(this.neckStrap);

    // Belly band round the barrel, holding the pad down.
    const bellyGeo = new TorusGeometry(0.34, 0.021, 6, 22);
    bellyGeo.scale(0.75, 1.0, 1);
    this.bellyBand = new Mesh(bellyGeo, mats.leather);
    this.bellyBand.position.set(0, 1.19, -0.12);
    this.bellyBand.castShadow = true;
    this.group.add(this.bellyBand);

    // The pad on the back that carries the shafts.
    this.backBand = new Mesh(new BoxGeometry(0.34, 0.06, 0.4), mats.leather);
    this.backBand.position.set(0, 1.52, -0.12);
    this.backBand.castShadow = true;
    this.group.add(this.backBand);

    // Terrets: the rings the reins run through, on top of the pad.
    for (const x of [-0.13, 0.13]) {
      const ring = new Mesh(new TorusGeometry(0.032, 0.007, 5, 10), mats.iron);
      ring.position.set(x, 1.58, -0.12);
      this.terrets.push(ring);
      this.group.add(ring);
    }

    const trace = new CylinderGeometry(0.016, 0.016, 1, 5);
    trace.translate(0, 0.5, 0);
    this.traceLeft = new Mesh(trace, mats.leather);
    this.traceRight = new Mesh(trace.clone(), mats.leather);
    for (const m of [this.traceLeft, this.traceRight]) {
      m.castShadow = true;
      this.group.add(m);
    }
  }

  /** Stretch each trace between its collar ring and the shaft it pulls. */
  linkTraces(leftFrom: Vector3, leftTo: Vector3, rightFrom: Vector3, rightTo: Vector3): void {
    this.aim(this.traceLeft, leftFrom, leftTo);
    this.aim(this.traceRight, rightFrom, rightTo);
  }

  private aim(mesh: Mesh, from: Vector3, to: Vector3): void {
    mesh.position.copy(from);
    const dir = to.clone().sub(from);
    const len = dir.length();
    if (len < 1e-4) return;
    mesh.scale.set(1, len, 1);
    mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
  }

  setTracesVisible(v: boolean): void {
    this.traceLeft.visible = v;
    this.traceRight.visible = v;
  }

  addTo(parent: Object3D): void {
    parent.add(this.group);
  }
}
