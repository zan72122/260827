import { Group, Mesh, TorusGeometry, Vector3 } from 'three';
import type { MaterialLibrary } from '../materials/MaterialLibrary';
import type { TreeHierarchy } from '../tree/TreeHierarchy';
import { RibbonStrip, TubeStrip, makePoints, sampleCatenary } from '../world/Cable';
import { clamp, damp, lerp } from '../core/math';

interface Sling {
  /** Fraction of tree height where this sling bears on the stem. */
  t: number;
  strap: RibbonStrip;
  wrap: Mesh;
  points: Vector3[];
  attachWorld: Vector3;
}

/**
 * Two lifting slings and the ground taglines.
 *
 * The slings are the visible contract between the crane and the tree: while
 * they sag the tree is still the trailer's problem, and the moment they come
 * straight the load has transferred. Nothing else on screen says that as
 * clearly, so the sag, the flattening of the webbing on the bark and the small
 * elastic stretch under load are all driven from one tension value.
 */
export class SlingAndTaglineRig {
  readonly group = new Group();
  private readonly slings: Sling[] = [];
  private readonly taglines: TubeStrip[] = [];
  private readonly taglinePoints: Vector3[][] = [];
  private readonly taglineAnchors: Vector3[] = [];
  private readonly hook = new Vector3();
  private readonly apex = new Vector3();
  private readonly tmpA = new Vector3();
  private readonly tmpB = new Vector3();

  /** 0 = hook parked high and slings coiled, 1 = both slings on the stem. */
  rigged = 0;
  /** 0 = slack webbing, 1 = full load in the slings. */
  tension = 0;
  /** Player pull on the taglines, clamped to a safe range. */
  tagPull = 0;

  constructor(
    private readonly tree: TreeHierarchy,
    materials: MaterialLibrary,
  ) {
    for (const t of [0.4, 0.58]) {
      const strap = new RibbonStrip(10, 0.34, 0.045, materials.slingWebbing);
      const radius = tree.radiusAt(t);
      const wrap = new Mesh(new TorusGeometry(radius * 1.08, 0.05, 6, 20), materials.slingWebbing);
      this.group.add(strap.mesh, wrap);
      this.slings.push({ t, strap, wrap, points: makePoints(11), attachWorld: new Vector3() });
    }

    // Two taglines run from the lower crown down to ground crew; they steer
    // the load, they never take its weight.
    for (const anchor of [new Vector3(9.5, 0.1, 7.5), new Vector3(-8.5, 0.1, 8.5)]) {
      const line = new TubeStrip(12, 4, 0.022, materials.wireRope);
      this.group.add(line.mesh);
      this.taglines.push(line);
      this.taglinePoints.push(makePoints(13));
      this.taglineAnchors.push(anchor);
    }
  }

  /** Where the hook has to be for the slings to hang straight. */
  hookTarget(out = new Vector3()): Vector3 {
    this.tree.pointOnStem(this.slings[0].t, this.tmpA);
    this.tree.pointOnStem(this.slings[1].t, this.tmpB);
    // Bridle apex above the mid-point of the two bearing points, standing off
    // by the sling length so the legs make a sensible included angle.
    out.copy(this.tmpA).lerp(this.tmpB, 0.55);
    const span = this.tmpA.distanceTo(this.tmpB);
    out.y += Math.max(4.5, span * 1.6);
    return out;
  }

  setHookWorld(v: Vector3): void {
    this.hook.copy(v);
  }

  update(dt: number): void {
    this.apex.copy(this.hook);
    const stretch = this.tension;
    for (const sling of this.slings) {
      this.tree.pointOnStem(sling.t, sling.attachWorld);
      // Slack webbing hangs; loaded webbing comes straight and stretches a
      // few centimetres, which shows up as the sag going to zero.
      const sag = lerp(0.85, 0.02, stretch) * this.rigged + (1 - this.rigged) * 0.05;
      sampleCatenary(this.apex, sling.attachWorld, sag, sling.points);
      const axis = this.tree.worldAxis(this.tmpA);
      sling.strap.update(sling.points, axis, stretch);
      sling.strap.mesh.visible = this.rigged > 0.02;

      sling.wrap.visible = this.rigged > 0.5;
      sling.wrap.position.copy(sling.attachWorld);
      sling.wrap.quaternion.copy(this.tree.stem.getWorldQuaternion(sling.wrap.quaternion));
      sling.wrap.rotateX(Math.PI / 2);
      // Under load the round sling flattens against the bark.
      const flat = lerp(1, 0.72, stretch);
      sling.wrap.scale.set(1, 1, flat);
    }

    for (let i = 0; i < this.taglines.length; i++) {
      const anchor = this.taglineAnchors[i];
      const attach = this.tree.pointOnStem(0.74 - i * 0.06, this.tmpB);
      const pts = this.taglinePoints[i];
      const pull = clamp(this.tagPull * (i === 0 ? 1 : -1), -1, 1);
      const sag = lerp(1.4, 0.35, Math.abs(pull));
      const worker = this.tmpA.copy(anchor);
      worker.x += pull * 1.2;
      sampleCatenary(attach, worker, sag, pts);
      this.taglines[i].update(pts);
      this.taglines[i].mesh.visible = this.rigged > 0.5;
    }

    this.tagPull = damp(this.tagPull, 0, 2.5, dt);
  }

  get slingAttachHeights(): number[] {
    return this.slings.map((s) => s.t);
  }
}
