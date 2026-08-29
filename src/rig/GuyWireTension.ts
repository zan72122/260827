import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { MaterialLibrary } from '../materials/MaterialLibrary';
import type { TreeHierarchy } from '../tree/TreeHierarchy';
import { TubeStrip, makePoints, sampleCatenary } from '../world/Cable';
import { clamp, damp, lerp } from '../core/math';

export interface GuyLeg {
  /** Horizontal unit direction from the stem towards this anchor. */
  dir: Vector3;
  anchor: Vector3;
  tension: number;
  target: number;
  wire: TubeStrip;
  points: Vector3[];
  drum: Mesh;
  turnbuckle: Mesh;
}

const LEAN_PER_UNIT = 0.062;

/**
 * Three-legged guying.
 *
 * The rule the child is meant to find is "pull a rope, the big tree moves".
 * So the solver is deliberately the simplest thing that is still true: the
 * horizontal pull of the three legs is summed, and the stem leans along the
 * resultant. Nothing has to be read off a gauge — the top against the building
 * edge, the slack in the wire, the bubble at the base and the shadow all move
 * together and continuously.
 */
export class GuyWireTension {
  readonly group = new Group();
  readonly legs: GuyLeg[] = [];
  readonly collarHeight: number;

  private readonly indicatorBall: Mesh;
  private readonly resultant = new Vector3();
  private readonly tmp = new Vector3();
  private readonly collarWorld = new Vector3();
  private engaged = 0;

  constructor(
    private readonly tree: TreeHierarchy,
    materials: MaterialLibrary,
    center: Vector3,
    anchorRadius = 11.5,
  ) {
    this.group.position.copy(center);
    this.collarHeight = 0.62;

    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
      const dir = new Vector3(Math.cos(a), 0, Math.sin(a));
      const anchor = new Vector3(dir.x * anchorRadius, 0.35, dir.z * anchorRadius).add(center);

      // Ground anchor: bolted plate, eye, turnbuckle and a hand winch drum.
      const plate = new Mesh(new BoxGeometry(1.1, 0.12, 0.9), materials.galvanised);
      plate.position.set(dir.x * anchorRadius, 0.06, dir.z * anchorRadius);
      plate.rotation.y = -a;
      plate.receiveShadow = true;
      this.group.add(plate);

      const drum = new Mesh(new CylinderGeometry(0.3, 0.3, 0.5, 14), materials.craneEnamel);
      drum.position.set(dir.x * (anchorRadius - 0.1), 0.42, dir.z * (anchorRadius - 0.1));
      drum.rotation.z = Math.PI / 2;
      drum.rotation.y = -a;
      drum.castShadow = true;
      this.group.add(drum);

      const frame = new Mesh(new BoxGeometry(0.16, 0.7, 0.62), materials.galvanised);
      frame.position.copy(drum.position).setY(0.35);
      frame.rotation.y = -a;
      this.group.add(frame);

      const turnbuckle = new Mesh(new CylinderGeometry(0.06, 0.06, 0.42, 8), materials.galvanised);
      turnbuckle.castShadow = true;
      this.group.add(turnbuckle);

      const wire = new TubeStrip(14, 5, 0.024, materials.wireRope);
      this.group.add(wire.mesh);

      this.legs.push({
        dir,
        anchor,
        tension: 0,
        target: 0,
        wire,
        points: makePoints(15),
        drum,
        turnbuckle,
      });
    }

    // Bullseye level cast into the base plate: a ball that rolls off centre
    // exactly as far as the stem is out of plumb. No numbers, no bubble scale.
    const housing = new Mesh(new TorusGeometry(0.42, 0.06, 8, 22), materials.galvanised);
    housing.rotation.x = -Math.PI / 2;
    housing.position.set(2.35, 0.32, 0);
    this.group.add(housing);
    const dish = new Mesh(new CylinderGeometry(0.42, 0.42, 0.05, 22), materials.craneDark);
    dish.position.copy(housing.position).setY(0.3);
    this.group.add(dish);
    this.indicatorBall = new Mesh(new SphereGeometry(0.1, 12, 10), materials.hiVis);
    this.indicatorBall.position.copy(housing.position).setY(0.38);
    this.group.add(this.indicatorBall);
  }

  /** Fade the whole guying rig in once the stem is seated. */
  setEngaged(v: number): void {
    this.engaged = clamp(v, 0, 1);
    for (const leg of this.legs) {
      leg.wire.mesh.visible = this.engaged > 0.05;
      leg.turnbuckle.visible = this.engaged > 0.05;
    }
  }

  setTension(index: number, value: number): void {
    this.legs[index].target = clamp(value, 0, 1);
  }

  /** Positive delta = winding in, i.e. tightening this leg. */
  windDrum(index: number, delta: number): void {
    const leg = this.legs[index];
    leg.target = clamp(leg.target + delta, 0, 1);
  }

  getTensions(): number[] {
    return this.legs.map((l) => l.tension);
  }

  /** Radians of lean; the phase logic uses it to decide when plumb is reached. */
  get leanAngle(): number {
    return this.resultant.length() * LEAN_PER_UNIT;
  }

  /** Which leg is the slackest — used to hint the first guided round. */
  get slackestLeg(): number {
    let idx = 0;
    for (let i = 1; i < this.legs.length; i++) {
      if (this.legs[i].tension < this.legs[idx].tension) idx = i;
    }
    return idx;
  }

  update(dt: number): void {
    this.resultant.set(0, 0, 0);
    for (const leg of this.legs) {
      // Winches move at a fixed, unhurried rate; there is no way to snatch.
      leg.tension = damp(leg.tension, leg.target, 3.4, dt);
      this.resultant.addScaledVector(leg.dir, leg.tension);
    }

    // Resultant pull tips the stem: leaning towards +X is a negative rotation
    // about Z, leaning towards +Z is a positive rotation about X.
    const k = LEAN_PER_UNIT * this.engaged;
    this.tree.setLean(this.resultant.z * k, -this.resultant.x * k);

    this.tree.pointOnStem(this.collarHeight, this.collarWorld);
    for (const leg of this.legs) {
      // Slack wire hangs in a deep catenary; tight wire is a straight line.
      const sag = lerp(1.5, 0.05, leg.tension);
      sampleCatenary(this.collarWorld, leg.anchor, sag, leg.points);
      leg.wire.update(leg.points);
      leg.drum.rotation.x = leg.tension * 6.2;
      const mid = this.tmp.copy(leg.anchor).lerp(this.collarWorld, 0.12);
      leg.turnbuckle.position.copy(mid);
      leg.turnbuckle.lookAt(this.collarWorld);
      leg.turnbuckle.rotateX(Math.PI / 2);
    }

    const lean = this.tree.lean;
    this.indicatorBall.position.x = 2.35 - lean.z * 9;
    this.indicatorBall.position.z = lean.x * 9;
  }
}
