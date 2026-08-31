import * as THREE from 'three';
import { DIM, mm } from '../core/units';
import type { Materials } from '../render/materials';
import { buildRoom, BENCH_TOP_Y, TURNTABLE_POS, NAIL_WORK_POS, TABLE_CENTRE, TABLE_TOP_Y, SEATS } from '../build/Room';
import {
  buildCandle, buildFlowerNail, buildKnife, buildLifter, buildPalette, buildPaperSquare,
  buildPipingBag, buildPlaceCard, buildPlate, buildScraper, buildTurntable,
} from '../build/tools';
import { buildPipingTip } from '../build/PipingTip';
import { buildHand } from '../build/Hands';
import { WholeCake, initialCoat, CAKE_H } from '../build/Cake';
import type { CakeState, SeatId } from '../core/CakeState';
import type { CreamColorId } from '../core/FlowerRecord';

/**
 * Everything that exists in the scene, and where it is. Stages move these
 * around; none of them owns the truth about the cake, which lives in CakeState.
 */

const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();

/**
 * Place a hand so that the thing it is holding physically runs through its
 * fingers: `gripAxis` is the axis of the tool, `armDir` the way the forearm
 * leaves the frame. Because the fingers were solved to close on that axis, a
 * tool positioned this way can never appear to float.
 */
export function orientHand(
  hand: THREE.Object3D,
  gripPoint: THREE.Vector3,
  gripAxis: THREE.Vector3,
  armDir: THREE.Vector3,
): void {
  _z.copy(gripAxis).normalize();
  _x.copy(armDir).normalize().negate();
  _x.addScaledVector(_z, -_x.dot(_z));
  if (_x.lengthSq() < 1e-8) _x.set(1, 0, 0).addScaledVector(_z, -_z.x);
  _x.normalize();
  _y.crossVectors(_z, _x).normalize();
  _m.makeBasis(_x, _y, _z);
  hand.quaternion.setFromRotationMatrix(_m);
  hand.position.copy(gripPoint);
}

export class World {
  readonly scene = new THREE.Scene();
  readonly room: THREE.Group;

  readonly turntable: THREE.Group;
  readonly turntablePlate: THREE.Group;

  /** Holds the cake and everything resting on it. */
  readonly cakeCarrier = new THREE.Group();
  cake: WholeCake;
  /** Where flowers placed on the cake live (cake-local). */
  readonly cakeTop = new THREE.Group();
  /** The pieces the cake has been cut into, if it has. */
  readonly cakePieces: THREE.Group[] = [];

  /** Does not turn: the frame the piping hand works in. */
  readonly nailPivot = new THREE.Group();
  /** Turns with the nail: paper, cone and petals. */
  readonly nailSpin = new THREE.Group();
  readonly nailMesh: THREE.Group;
  readonly paper: THREE.Mesh;
  /** Where the flower being piped lives. */
  readonly flowerHost = new THREE.Group();

  readonly pipingRig = new THREE.Group();
  readonly pipingTip: THREE.Group;
  pipingBag: THREE.Group;
  readonly pipingHand: THREE.Group;
  readonly nailHand: THREE.Group;

  readonly scraperRig = new THREE.Group();
  readonly scraperHand: THREE.Group;
  readonly lifterRig = new THREE.Group();
  readonly lifterHand: THREE.Group;
  readonly knifeRig = new THREE.Group();
  readonly knifeHand: THREE.Group;
  readonly paletteRig = new THREE.Group();

  readonly candle: THREE.Group;
  readonly candleFlame: THREE.Group;
  readonly candleLight: THREE.PointLight;

  readonly plates: Record<SeatId, THREE.Mesh>;
  readonly placeCards: Record<SeatId, THREE.Group>;
  readonly guestHand: THREE.Group;

  private readonly materials: Materials;
  private bagColor: CreamColorId = 'rose';

  constructor(materials: Materials, state: CakeState) {
    this.materials = materials;
    this.scene.name = 'kurukuru';

    this.room = buildRoom(materials);
    this.scene.add(this.room);

    const tt = buildTurntable(materials);
    this.turntable = tt.group;
    this.turntablePlate = tt.plate;
    this.turntable.position.copy(TURNTABLE_POS);
    this.scene.add(this.turntable);

    state.resetCoat(initialCoat(state.SIDE_COLUMNS));
    this.cake = new WholeCake(materials, state.roughness);
    this.cakeCarrier.add(this.cake.group);
    this.cakeCarrier.add(this.cakeTop);
    this.cakeCarrier.position.set(0, DIM.turntablePlateThickness, 0);
    this.turntablePlate.add(this.cakeCarrier);

    // --- the flower nail and its paper
    this.nailPivot.position.copy(NAIL_WORK_POS);
    // A flower nail is held, never stood on the bench, so it only appears once
    // there is a hand in frame to hold it.
    this.nailPivot.visible = false;
    this.scene.add(this.nailPivot);
    this.nailPivot.add(this.nailSpin);

    this.nailMesh = buildFlowerNail(materials);
    this.nailMesh.position.y = -DIM.nailDiscThickness;
    this.nailSpin.add(this.nailMesh);

    this.paper = buildPaperSquare(materials);
    this.paper.position.y = mm(0.2);
    this.nailSpin.add(this.paper);

    this.flowerHost.position.y = DIM.paperThickness + mm(0.25);
    this.nailSpin.add(this.flowerHost);

    // The left hand grips the shaft below the disc; the shaft runs through it.
    this.nailHand = buildHand(materials, {
      side: 'left',
      gripRadius: DIM.nailShaftRadius,
      pose: 'pinch',
    });
    orientHand(
      this.nailHand,
      new THREE.Vector3(0, -mm(52), 0),
      new THREE.Vector3(0, 1, 0),
      // Out of the left of the frame rather than towards the camera: what a
      // child needs to see is the fingers on the shaft, not a forearm.
      new THREE.Vector3(-0.92, -0.36, 0.10),
    );
    this.nailPivot.add(this.nailHand);

    // --- bag, tip and the right hand
    this.pipingTip = buildPipingTip(materials);
    this.pipingRig.add(this.pipingTip);
    this.pipingBag = buildPipingBag(materials, this.bagColor);
    this.pipingBag.position.y = DIM.tipLength - mm(4);
    this.pipingRig.add(this.pipingBag);
    this.pipingHand = buildHand(materials, { side: 'right', gripRadius: mm(28) });
    orientHand(
      this.pipingHand,
      new THREE.Vector3(0, DIM.tipLength + mm(150), 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0.16, 0.96, -0.22),
    );
    this.pipingRig.add(this.pipingHand);
    this.nailPivot.add(this.pipingRig);

    // --- bench scraper
    const scraper = buildScraper(materials);
    this.scraperRig.add(scraper);
    this.scraperHand = buildHand(materials, { side: 'right', gripRadius: mm(5) });
    orientHand(
      this.scraperHand,
      new THREE.Vector3(0, mm(80), mm(3)),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0.55, 0.5, 0.67),
    );
    this.scraperRig.add(this.scraperHand);
    this.scraperRig.visible = false;
    this.scene.add(this.scraperRig);

    // --- flower lifter
    const lifter = buildLifter(materials);
    this.lifterRig.add(lifter);
    this.lifterHand = buildHand(materials, { side: 'right', gripRadius: mm(3) });
    orientHand(
      this.lifterHand,
      new THREE.Vector3(-mm(62), 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(-0.88, 0.30, 0.36),
    );
    this.lifterRig.add(this.lifterHand);
    this.lifterRig.visible = false;
    this.scene.add(this.lifterRig);

    // --- palette knife, used for the dab of cream that holds a flower down
    this.paletteRig.add(buildPalette(materials));
    this.paletteRig.visible = false;
    this.scene.add(this.paletteRig);

    // --- cake knife
    const knife = buildKnife(materials);
    this.knifeRig.add(knife);
    this.knifeHand = buildHand(materials, { side: 'right', gripRadius: mm(9) });
    orientHand(
      this.knifeHand,
      new THREE.Vector3(-mm(58), 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(-0.72, 0.42, 0.55),
    );
    this.knifeRig.add(this.knifeHand);
    this.knifeRig.visible = false;
    this.scene.add(this.knifeRig);

    // --- candle
    const c = buildCandle(materials);
    this.candle = c.group;
    this.candleFlame = c.flame;
    this.candleLight = c.light;
    this.candle.visible = false;
    this.candleFlame.visible = false;
    this.candleLight.intensity = 0;
    this.cakeTop.add(this.candle);

    // --- the two places at the table
    this.plates = { petal: buildPlate(materials), leaf: buildPlate(materials) };
    this.placeCards = {
      petal: buildPlaceCard(materials, 'petal'),
      leaf: buildPlaceCard(materials, 'leaf'),
    };
    for (const key of ['petal', 'leaf'] as SeatId[]) {
      const bearing = SEATS[key].bearing;
      const p = this.plates[key];
      p.position.set(
        TABLE_CENTRE.x + Math.cos(bearing) * 0.34,
        TABLE_TOP_Y + mm(4),
        TABLE_CENTRE.z + Math.sin(bearing) * 0.34,
      );
      this.scene.add(p);

      const card = this.placeCards[key];
      card.position.set(
        TABLE_CENTRE.x + Math.cos(bearing) * 0.46,
        TABLE_TOP_Y + mm(26),
        TABLE_CENTRE.z + Math.sin(bearing) * 0.46,
      );
      card.rotation.y = -bearing - Math.PI / 2;
      card.rotation.x = -0.22;
      this.scene.add(card);
    }

    // --- the person being given the cake: a hand, offered palm up
    this.guestHand = buildHand(materials, { side: 'right', gripRadius: mm(30), pose: 'pinch' });
    this.guestHand.visible = false;
    this.scene.add(this.guestHand);
  }

  /** Free a cut piece's geometry. Materials are shared and stay alive. */
  releasePiece(piece: THREE.Group): void {
    piece.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry) m.geometry.dispose();
    });
    piece.parent?.remove(piece);
  }

  /**
   * Put a fresh cake on the turntable. Everything the previous one owned is
   * released first, so replaying does not accumulate geometry.
   */
  resetCake(state: CakeState): void {
    for (const piece of this.cakePieces) this.releasePiece(piece);
    this.cakePieces.length = 0;

    for (const child of [...this.cakeTop.children]) {
      if (child === this.candle) continue;
      const m = child as THREE.Mesh;
      if (m.isMesh && m.geometry) m.geometry.dispose();
      this.cakeTop.remove(child);
    }

    this.cake.dispose();
    this.cake.group.parent?.remove(this.cake.group);
    state.resetCoat(initialCoat(state.SIDE_COLUMNS, 7 + state.sessionsServed * 31));
    this.cake = new WholeCake(this.materials, state.roughness);
    this.cakeCarrier.add(this.cake.group);

    this.turntablePlate.rotation.y = 0;
    this.turntablePlate.add(this.cakeCarrier);
    this.cakeCarrier.position.set(0, DIM.turntablePlateThickness, 0);
    this.cakeCarrier.rotation.set(0, 0, 0);
    this.cakeCarrier.scale.set(1, 1, 1);

    this.candle.visible = false;
    this.candleFlame.visible = false;
    this.candleLight.intensity = 0;
    this.candle.position.set(0, 0, 0);
    this.candle.rotation.set(0, 0, 0);
    this.guestHand.visible = false;
    this.knifeRig.visible = false;
    this.lifterRig.visible = false;
    this.scraperRig.visible = false;
    this.nailSpin.rotation.y = 0;
  }

  /** Swap the cream in the bag when a different colour is chosen. */
  setBagColor(color: CreamColorId): void {
    if (color === this.bagColor) return;
    this.bagColor = color;
    const fill = this.pipingBag.getObjectByName('bagFill') as THREE.Mesh | null;
    if (fill) fill.material = this.materials.cream[color];
  }

  currentBagColor(): CreamColorId {
    return this.bagColor;
  }

  /** World position of the middle of the cake's side, for aiming lights. */
  cakeFocus(target: THREE.Vector3): THREE.Vector3 {
    this.cakeCarrier.getWorldPosition(target);
    target.y += CAKE_H * 0.55;
    return target;
  }

  benchTopY(): number {
    return BENCH_TOP_Y;
  }
}
