import * as THREE from 'three';
import { MM } from '../core/units';
import { spec, shoulderPlaneY } from '../design/treeSpec';
import { COMB_NOTES, PINS } from '../mech/melody';
import {
  buildPotGeometry,
  buildWindowFrameGeometry,
  buildGearGeometry,
  buildPinDrumGeometry,
  buildCombBackGeometry,
  mergeSimple,
} from './parts';
import type { Palette } from './materials';

/** Gear ratio from the great wheel to the governor pinion. */
export const GOVERNOR_RATIO = 5;

/**
 * 鉢と機構 — the pot and the movement it holds.  The pot never turns: it is
 * screwed to the bench.  Only the shaft group turns, and it carries the barrel,
 * the great wheel and the pin drum, which is why the tune's position and the
 * tree's angle are the same number.
 */
export class PotAndMovement {
  readonly group = new THREE.Group();
  /** everything on the main arbor */
  readonly shaftGroup = new THREE.Group();
  /** the fan governor, geared off the great wheel */
  readonly governorGroup = new THREE.Group();
  readonly combTeeth: THREE.InstancedMesh;
  private toothFlash: Float32Array;
  private toothColour = new THREE.Color();

  constructor(palette: Palette) {
    this.group.name = 'pot';

    const shell = new THREE.Mesh(buildPotGeometry(), palette.pot);
    shell.castShadow = true;
    shell.receiveShadow = true;
    this.group.add(shell);

    const frame = new THREE.Mesh(buildWindowFrameGeometry(), palette.brass);
    frame.castShadow = true;
    this.group.add(frame);

    // felt pad under the pot, and the two brass screws that hold it to the bench
    const felt = new THREE.Mesh(
      new THREE.CylinderGeometry(50 * MM, 50 * MM, 1.6 * MM, 32),
      palette.felt,
    );
    felt.position.y = 0.8 * MM;
    this.group.add(felt);

    // brass bed plate: it carries the bushing the tree stands in
    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(
        spec.pot.bedPlate.radius * MM,
        spec.pot.bedPlate.radius * MM,
        spec.pot.bedPlate.thickness * MM,
        44,
      ),
      palette.brass,
    );
    plate.position.y = (spec.pot.height + spec.pot.bedPlate.thickness / 2) * MM;
    plate.castShadow = true;
    plate.receiveShadow = true;
    this.group.add(plate);

    const plateTop = spec.pot.height + spec.pot.bedPlate.thickness;

    // 回転受け — bushing pressed through the plate, and the thrust washer on top
    const bushing = new THREE.Mesh(
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(spec.pot.bushingOuter / 2, plateTop - spec.pot.bushingDepth),
          new THREE.Vector2(spec.pot.bushingOuter / 2, plateTop),
          new THREE.Vector2(spec.pot.bushingBore / 2, plateTop),
          new THREE.Vector2(spec.pot.bushingBore / 2, plateTop - spec.pot.bushingDepth),
          new THREE.Vector2(spec.pot.bushingOuter / 2, plateTop - spec.pot.bushingDepth),
        ].map((v) => new THREE.Vector2(v.x * MM, v.y * MM)),
        28,
      ),
      palette.brass,
    );
    bushing.castShadow = true;
    this.group.add(bushing);

    const washer = new THREE.Mesh(
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(spec.pot.bushingBore / 2 + 0.1, plateTop),
          new THREE.Vector2(spec.pot.washerOuter / 2, plateTop),
          new THREE.Vector2(spec.pot.washerOuter / 2, plateTop + spec.pot.washerThickness),
          new THREE.Vector2(spec.pot.bushingBore / 2 + 0.1, plateTop + spec.pot.washerThickness),
        ].map((v) => new THREE.Vector2(v.x * MM, v.y * MM)),
        28,
      ),
      palette.brass,
    );
    washer.castShadow = true;
    this.group.add(washer);

    // ---- movement, hung below the bed plate on two pillars -----------------
    const lowerPlateY = 22;
    for (const x of [-30, 30]) {
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(2.4 * MM, 2.4 * MM, (spec.pot.height - lowerPlateY) * MM, 10),
        palette.brass,
      );
      pillar.position.set(x * MM, ((spec.pot.height + lowerPlateY) / 2) * MM, -10 * MM);
      this.group.add(pillar);
    }
    const lower = new THREE.Mesh(
      new THREE.CylinderGeometry(34 * MM, 34 * MM, 2 * MM, 28),
      palette.brass,
    );
    lower.position.y = lowerPlateY * MM;
    this.group.add(lower);

    // main arbor: it is the same shaft the tree's axle sits on
    const arbor = new THREE.Mesh(
      new THREE.CylinderGeometry(3 * MM, 3 * MM, (plateTop - lowerPlateY) * MM, 12),
      palette.steel,
    );
    arbor.position.y = ((plateTop + lowerPlateY) / 2) * MM;
    this.shaftGroup.add(arbor);

    // mainspring barrel
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(22 * MM, 22 * MM, 16 * MM, 28),
      palette.brass,
    );
    barrel.position.y = 56 * MM;
    barrel.castShadow = true;
    this.shaftGroup.add(barrel);

    // great wheel, sitting on the barrel
    const great = new THREE.Mesh(buildGearGeometry(20, 40, 3, 3.2), palette.brass);
    great.position.y = 65.5 * MM;
    this.shaftGroup.add(great);

    // pin drum, on the same arbor: one pin for every note on the drum
    const drum = new THREE.Mesh(
      buildPinDrumGeometry(PINS.map((p) => p.phase), 15, 22),
      palette.brass,
    );
    drum.position.y = 35 * MM;
    this.shaftGroup.add(drum);
    this.group.add(this.shaftGroup);

    // governor: pinion meshed with the great wheel, plus its air brake fan
    const pinion = new THREE.Mesh(buildGearGeometry(4, 8, 3, 1.2), palette.steel);
    pinion.position.y = 65.5 * MM;
    this.governorGroup.add(pinion);
    const govShaft = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2 * MM, 1.2 * MM, 34 * MM, 8),
      palette.steel,
    );
    govShaft.position.y = 62 * MM;
    this.governorGroup.add(govShaft);
    const blades = mergeSimple([
      new THREE.BoxGeometry(17 * MM, 0.5 * MM, 7 * MM),
      (() => {
        const b = new THREE.BoxGeometry(17 * MM, 0.5 * MM, 7 * MM);
        b.rotateY(Math.PI / 2);
        return b;
      })(),
    ]);
    const fan = new THREE.Mesh(blades, palette.brass);
    fan.position.y = 76 * MM;
    this.governorGroup.add(fan);
    this.governorGroup.position.set(24 * MM, 0, 0);
    this.group.add(this.governorGroup);

    // 櫛歯 — the comb the pins pluck. One tooth per note on the drum.
    const combBase = new THREE.Mesh(buildCombBackGeometry(COMB_NOTES.length), palette.steel);
    combBase.position.set(-24 * MM, 35 * MM, 0);
    combBase.rotation.y = Math.PI / 2;
    this.group.add(combBase);

    const toothGeo = new THREE.BoxGeometry(13 * MM, 0.9 * MM, 1.3 * MM);
    toothGeo.translate((13 / 2) * MM, 0, 0);
    this.combTeeth = new THREE.InstancedMesh(toothGeo, palette.steel.clone(), COMB_NOTES.length);
    this.combTeeth.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const m = new THREE.Matrix4();
    for (let i = 0; i < COMB_NOTES.length; i++) {
      const z = (-((COMB_NOTES.length - 1) * 1.9) / 2 + i * 1.9) * MM;
      m.makeTranslation(-21 * MM, 35 * MM, z);
      this.combTeeth.setMatrixAt(i, m);
      this.combTeeth.setColorAt(i, this.toothColour.setRGB(0.62, 0.65, 0.68));
    }
    this.toothFlash = new Float32Array(COMB_NOTES.length);
    this.group.add(this.combTeeth);
  }

  /** Height of the shoulder plane above the pot's base, in metres. */
  get shoulderY() {
    return shoulderPlaneY * MM;
  }

  /** Drive the visible parts from the movement's state. */
  update(shaftYaw: number, dt: number) {
    this.shaftGroup.rotation.y = shaftYaw;
    this.governorGroup.rotation.y = -shaftYaw * GOVERNOR_RATIO;
    let dirty = false;
    for (let i = 0; i < this.toothFlash.length; i++) {
      if (this.toothFlash[i] > 0) {
        this.toothFlash[i] = Math.max(0, this.toothFlash[i] - dt * 4.5);
        const f = this.toothFlash[i];
        this.combTeeth.setColorAt(i, this.toothColour.setRGB(0.62 + f * 0.9, 0.65 + f * 0.8, 0.68 + f * 0.5));
        dirty = true;
      }
    }
    if (dirty && this.combTeeth.instanceColor) this.combTeeth.instanceColor.needsUpdate = true;
  }

  /** Show that a tooth was plucked, whether or not sound is on. */
  flashTooth(index: number) {
    if (index >= 0 && index < this.toothFlash.length) this.toothFlash[index] = 1;
  }

  /** Top of the pot's rim, in metres. */
  get rimY() {
    return spec.pot.height * MM;
  }
}
