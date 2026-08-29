/**
 * The netting machine: an infeed table, a pair of driven rubber rollers, a
 * rolled-steel cone and a net spool on the exit ring. Wear is painted only
 * where the tree actually touches — the mouth rim, the roller faces and the
 * exit ring — everything else is ordinary working enamel.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { boltRing, box, tube, weldRing } from './props';
import type { Materials } from './materials';
import { clamp } from '../core/rand';

export const AXIS_Y = 1.6;
export const MOUTH_R = 1.36;
export const EXIT_R = 0.42;
export const CONE_LEN = 2.65;
export const INFEED_X = -4.8;
export const OUTFEED_X = CONE_LEN + 4.6;

export class Baler {
  readonly group = new THREE.Group();
  private rollers: THREE.Object3D[] = [];
  private idlers: THREE.Object3D[] = [];
  private spool: THREE.Object3D;
  private handWheel: THREE.Object3D;

  constructor(mats: Materials) {
    const plate = 0.024;

    // ---- cone: outer skin, inner skin, both rims ----
    const outer = new THREE.CylinderGeometry(EXIT_R, MOUTH_R, CONE_LEN, 40, 3, true);
    outer.rotateZ(-Math.PI / 2);
    outer.translate(CONE_LEN / 2, AXIS_Y, 0);
    // The cone is a single open shell, so it cannot cast into the shadow map
    // without shadowing itself — whichever side is recorded, the other one goes
    // black. Its ribs, rims and legs carry the machine's shadow instead.
    const skin = new THREE.Mesh(outer, mats.balerPaint);
    skin.castShadow = false;
    // nor does it receive: the ribs and rims sit millimetres off its surface
    // and would otherwise smear the whole cone into their own shadow
    skin.receiveShadow = false;
    this.group.add(skin);

    const inner = new THREE.CylinderGeometry(EXIT_R - plate, MOUTH_R - plate, CONE_LEN, 40, 3, true);
    inner.rotateZ(-Math.PI / 2);
    inner.translate(CONE_LEN / 2, AXIS_Y, 0);
    const innerMat = mats.wear.clone();
    innerMat.side = THREE.BackSide;
    innerMat.color = new THREE.Color(0x8d9298);
    const innerMesh = new THREE.Mesh(inner, innerMat);
    this.group.add(innerMesh);

    // rims: the two edges the branches drag across
    const rims = mergeGeometries(
      [
        (() => {
          const g = new THREE.TorusGeometry(MOUTH_R, plate * 1.6, 6, 44);
          g.rotateY(Math.PI / 2);
          g.translate(0, AXIS_Y, 0);
          return g;
        })(),
        (() => {
          const g = new THREE.TorusGeometry(EXIT_R, plate * 1.4, 6, 30);
          g.rotateY(Math.PI / 2);
          g.translate(CONE_LEN, AXIS_Y, 0);
          return g;
        })(),
      ],
      false,
    )!;
    const rimMesh = new THREE.Mesh(rims, mats.wear);
    rimMesh.castShadow = true;
    this.group.add(rimMesh);

    // ---- reinforcement: circumferential bands, welds, longitudinal ribs ----
    const bandParts: THREE.BufferGeometry[] = [];
    for (const t of [0.34, 0.68]) {
      const x = CONE_LEN * t;
      const r = this.radiusAt(x) + 0.014;
      const g = new THREE.TorusGeometry(r, 0.032, 6, 40);
      g.rotateY(Math.PI / 2);
      g.translate(x, AXIS_Y, 0);
      bandParts.push(g);
    }
    const ribCount = 8;
    const slope = Math.atan2(MOUTH_R - EXIT_R, CONE_LEN);
    const slant = Math.hypot(CONE_LEN, MOUTH_R - EXIT_R);
    for (let i = 0; i < ribCount; i++) {
      const a = (i / ribCount) * Math.PI * 2 + 0.2;
      const g = box(slant * 0.94, 0.085, 0.028);
      g.rotateZ(slope);
      g.translate(CONE_LEN / 2, (MOUTH_R + EXIT_R) / 2 + 0.05, 0);
      g.rotateX(a);
      g.translate(0, AXIS_Y, 0);
      bandParts.push(g);
    }
    const bands = new THREE.Mesh(mergeGeometries(bandParts, false)!, mats.balerPaint);
    bands.castShadow = false;
    this.group.add(bands);

    const welds = new THREE.Mesh(
      mergeGeometries(
        [0.34, 0.68].map((t) => weldRing(this.radiusAt(CONE_LEN * t) + 0.001, CONE_LEN * t, 0.013)),
        false,
      )!,
      mats.darkSteel,
    );
    welds.position.y = AXIS_Y;
    this.group.add(welds);

    const bolts = new THREE.Mesh(
      mergeGeometries(
        [boltRing(MOUTH_R + 0.055, 16, 0.024, 0.03), boltRing(EXIT_R + 0.05, 8, 0.02, CONE_LEN - 0.02)],
        false,
      )!,
      mats.darkSteel,
    );
    bolts.position.y = AXIS_Y;
    this.group.add(bolts);

    // ---- legs and base plates ----
    const legParts: THREE.BufferGeometry[] = [];
    for (const [x, spread] of [
      [0.22, MOUTH_R * 0.78],
      [CONE_LEN - 0.2, EXIT_R + 0.36],
    ] as const) {
      const drop = AXIS_Y - this.radiusAt(x) * 0.72;
      for (const s of [-1, 1]) {
        legParts.push(box(0.09, drop, 0.09, x, drop / 2, s * spread));
        legParts.push(box(0.26, 0.03, 0.26, x, 0.015, s * spread));
        legParts.push(box(0.06, drop * 0.5, 0.06, x + 0.28, drop * 0.3, s * spread * 0.75));
      }
    }
    const legs = new THREE.Mesh(mergeGeometries(legParts, false)!, mats.balerPaint);
    legs.castShadow = true;
    legs.receiveShadow = true;
    this.group.add(legs);

    // ---- infeed table: idle rollers in a channel frame ----
    const tableY = AXIS_Y - 0.34;
    const frameParts: THREE.BufferGeometry[] = [];
    frameParts.push(box(Math.abs(INFEED_X), 0.08, 0.08, INFEED_X / 2, tableY, -0.52));
    frameParts.push(box(Math.abs(INFEED_X), 0.08, 0.08, INFEED_X / 2, tableY, 0.52));
    const bays = Math.round(Math.abs(INFEED_X) / 1.15);
    for (let i = 0; i < bays; i++) {
      const x = INFEED_X + 0.4 + i * ((Math.abs(INFEED_X) - 0.8) / (bays - 1));
      frameParts.push(box(0.08, tableY - 0.04, 0.08, x, (tableY - 0.04) / 2, -0.52));
      frameParts.push(box(0.08, tableY - 0.04, 0.08, x, (tableY - 0.04) / 2, 0.52));
      frameParts.push(box(0.22, 0.03, 0.22, x, 0.015, -0.52));
      frameParts.push(box(0.22, 0.03, 0.22, x, 0.015, 0.52));
    }
    // outfeed
    frameParts.push(box(OUTFEED_X - CONE_LEN, 0.08, 0.08, (OUTFEED_X + CONE_LEN) / 2, tableY, -0.42));
    frameParts.push(box(OUTFEED_X - CONE_LEN, 0.08, 0.08, (OUTFEED_X + CONE_LEN) / 2, tableY, 0.42));
    const outBays = 4;
    for (let i = 0; i < outBays; i++) {
      const x = CONE_LEN + 0.5 + i * ((OUTFEED_X - CONE_LEN - 0.9) / (outBays - 1));
      frameParts.push(box(0.08, tableY - 0.04, 0.08, x, (tableY - 0.04) / 2, -0.42));
      frameParts.push(box(0.08, tableY - 0.04, 0.08, x, (tableY - 0.04) / 2, 0.42));
    }
    const tableFrame = new THREE.Mesh(mergeGeometries(frameParts, false)!, mats.balerPaint);
    tableFrame.castShadow = true;
    tableFrame.receiveShadow = true;
    this.group.add(tableFrame);

    // Idle rollers spin about their own axis, so the geometry has to be built
    // at the origin and placed by the mesh transform — offsetting it in the
    // geometry would swing the whole row around the machine instead.
    const idlerGeo = tube(0.06, 0.98, 10, 'z');
    const inRollers = Math.round((Math.abs(INFEED_X) - 0.4) / 0.3);
    for (let i = 0; i < inRollers; i++) {
      const r = new THREE.Mesh(idlerGeo, mats.wear);
      r.position.set(INFEED_X + 0.25 + i * 0.3, tableY + 0.1, 0);
      r.castShadow = true;
      this.group.add(r);
      this.idlers.push(r);
    }
    const outGeo = tube(0.055, 0.78, 10, 'z');
    const outRollers = Math.round((OUTFEED_X - CONE_LEN - 0.4) / 0.34);
    for (let i = 0; i < outRollers; i++) {
      const r = new THREE.Mesh(outGeo, mats.wear);
      r.position.set(CONE_LEN + 0.35 + i * 0.34, tableY + 0.1, 0);
      this.group.add(r);
      this.idlers.push(r);
    }

    // ---- driven rubber rollers just before the mouth ----
    const rollerX = -0.42;
    for (const y of [AXIS_Y + 0.46, AXIS_Y - 0.46]) {
      const holder = new THREE.Object3D();
      holder.position.set(rollerX, y, 0);
      const drum = new THREE.Mesh(tube(0.2, 0.86, 16, 'z', 0, 0, 0), mats.rubber);
      drum.castShadow = true;
      holder.add(drum);
      const hub = new THREE.Mesh(tube(0.075, 1.02, 10, 'z', 0, 0, 0), mats.darkSteel);
      holder.add(hub);
      const flange = new THREE.Mesh(
        mergeGeometries([tube(0.13, 0.03, 12, 'z', 0, 0, 0.44), tube(0.13, 0.03, 12, 'z', 0, 0, -0.44)], false)!,
        mats.darkSteel,
      );
      holder.add(flange);
      this.group.add(holder);
      this.rollers.push(holder);
    }
    const rollerFrame = new THREE.Mesh(
      mergeGeometries(
        [
          box(0.1, 1.5, 0.1, rollerX, AXIS_Y, -0.56),
          box(0.1, 1.5, 0.1, rollerX, AXIS_Y, 0.56),
          box(0.34, 0.1, 1.3, rollerX, AXIS_Y + 0.78, 0),
          box(0.3, 0.03, 0.3, rollerX, 0.015, -0.56),
          box(0.3, 0.03, 0.3, rollerX, 0.015, 0.56),
          box(0.1, AXIS_Y - 0.72, 0.1, rollerX, (AXIS_Y - 0.72) / 2, -0.56),
          box(0.1, AXIS_Y - 0.72, 0.1, rollerX, (AXIS_Y - 0.72) / 2, 0.56),
        ],
        false,
      )!,
      mats.balerPaint,
    );
    rollerFrame.castShadow = true;
    this.group.add(rollerFrame);

    // hand wheel that drives the rollers
    this.handWheel = new THREE.Object3D();
    this.handWheel.position.set(rollerX, AXIS_Y + 0.1, 0.72);
    const wheel = new THREE.Mesh(
      mergeGeometries(
        [
          (() => {
            const g = new THREE.TorusGeometry(0.24, 0.024, 6, 24);
            g.rotateY(Math.PI / 2);
            return g;
          })(),
          tube(0.05, 0.1, 10, 'z', 0, 0, 0),
          box(0.028, 0.46, 0.028, 0, 0, 0),
          box(0.46, 0.028, 0.028, 0, 0, 0),
        ],
        false,
      )!,
      mats.darkSteel,
    );
    this.handWheel.add(wheel);
    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xc0341f, roughness: 0.5 }),
    );
    knob.position.set(0, 0.24, 0.05);
    this.handWheel.add(knob);
    this.group.add(this.handWheel);

    // ---- net spool riding on the exit ring ----
    this.spool = new THREE.Object3D();
    this.spool.position.set(CONE_LEN + 0.42, AXIS_Y + 0.62, 0.42);
    const roll = new THREE.Mesh(
      tube(0.23, 0.5, 18, 'z', 0, 0, 0),
      new THREE.MeshStandardMaterial({ color: 0xc4571c, roughness: 0.8 }),
    );
    roll.castShadow = true;
    this.spool.add(roll);
    const core = new THREE.Mesh(tube(0.05, 0.62, 10, 'z', 0, 0, 0), mats.darkSteel);
    this.spool.add(core);
    this.group.add(this.spool);
    const spoolArm = new THREE.Mesh(
      mergeGeometries(
        [
          box(0.06, 0.9, 0.06, CONE_LEN + 0.42, AXIS_Y + 0.2, 0.72),
          box(0.9, 0.06, 0.06, CONE_LEN + 0.05, AXIS_Y + 0.62, 0.72),
        ],
        false,
      )!,
      mats.balerPaint,
    );
    this.group.add(spoolArm);

    // ---- control box and hose ----
    const controls = new THREE.Mesh(
      mergeGeometries([box(0.3, 0.4, 0.22, -1.0, 1.15, 0.78), box(0.1, 0.9, 0.1, -1.0, 0.45, 0.78)], false)!,
      mats.balerPaint,
    );
    controls.castShadow = true;
    this.group.add(controls);
    const hose = new THREE.Mesh(
      new THREE.TorusGeometry(0.35, 0.022, 5, 24, Math.PI * 1.3),
      new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.9 }),
    );
    hose.position.set(-0.72, 0.62, 0.78);
    hose.rotation.set(0.4, 0.2, 1.2);
    this.group.add(hose);
  }

  /** Cone radius at a local x. Outside the cone it is unconstrained / held. */
  radiusAt(x: number): number {
    const t = clamp(x / CONE_LEN, 0, 1);
    return MOUTH_R + (EXIT_R - MOUTH_R) * t;
  }

  /** How wide the machine will let the tree be at this local x. */
  allowedRadius(x: number): number {
    if (x < -0.05) return 99;
    if (x > CONE_LEN) return EXIT_R;
    return this.radiusAt(x);
  }

  update(dt: number, feed: number): void {
    for (const r of this.rollers) r.rotation.z -= feed * dt * 5.2;
    for (const r of this.idlers) r.rotation.z -= feed * dt * 3.4;
    this.spool.rotation.z -= feed * dt * 2.1;
    this.handWheel.rotation.z -= feed * dt * 5.2;
  }
}
