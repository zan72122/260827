import * as THREE from 'three';
import type { StageBehaviour, StageContext } from '../app/StageContext';
import type { ChoiceButton } from '../ui/Overlay';
import type { PointerFrame } from '../input/PointerInput';
import { CAKE_H, cakeRadiusAt } from '../build/Cake';
import { DIM, mm } from '../core/units';
import { TAU, clamp, damp, wrapAngle } from '../util/math';

/**
 * Turning the table.
 *
 * The scraper is held still against one side of the cake. Turning the table
 * drags the coat past the blade, and only the part that actually goes under the
 * blade is evened out — the cream that comes off gathers on the steel, where a
 * child can see where it went. There is no quota: a short arc smooths a short
 * arc, and the way on appears as soon as enough has happened to show what the
 * gesture does.
 */

/**
 * Where the blade rests, as a bearing about the cake's axis: off to one side of
 * the camera, so the point where steel meets buttercream is in shot and the
 * face of the cake is not hidden behind the tool.
 */
const BLADE_BEARING = 0.55;
/** How wide a band of coat the blade actually touches, radians. */
const CONTACT_HALF = 0.16;

export class TurntableOperation implements StageBehaviour {
  private readonly ctx: StageContext;
  private spin = 0;
  private spinVel = 0;
  private smoothedArc = 0;
  private idle = 0;
  private collected = 0;
  private ridge: THREE.Mesh | null = null;
  private readonly centre = new THREE.Vector3();
  private readonly screen = new THREE.Vector2();
  private lastAngle = 0;
  private tracking = false;
  private ready = false;

  constructor(ctx: StageContext) {
    this.ctx = ctx;
  }

  enter(): void {
    const { world } = this.ctx;
    this.spin = world.turntablePlate.rotation.y;
    this.spinVel = 0;
    this.smoothedArc = 0;
    this.idle = 0;
    this.ready = false;
    this.ctx.camera.goTo('smoothing', 1.0);
    this.ctx.lights.setMode('bench');
    world.nailPivot.visible = false;

    world.cakeCarrier.getWorldPosition(this.centre);
    const cakeBottom = this.centre.y;

    // Stand the scraper against the side of the cake, blade face radial.
    const radius = cakeRadiusAt(this.ctx.state.roughness, BLADE_BEARING, CAKE_H * 0.5);
    world.scraperRig.position.set(
      this.centre.x + Math.cos(BLADE_BEARING) * (radius + mm(0.5)),
      cakeBottom + mm(1.5),
      this.centre.z + Math.sin(BLADE_BEARING) * (radius + mm(0.5)),
    );
    world.scraperRig.rotation.set(0, Math.PI / 2 - BLADE_BEARING, 0);
    world.scraperRig.visible = true;

    if (!this.ridge) {
      const geo = new THREE.CylinderGeometry(mm(2.6), mm(2.6), mm(70), 12, 1, false);
      geo.rotateZ(Math.PI / 2);
      geo.scale(1, 0.55, 1);
      this.ridge = new THREE.Mesh(geo, this.ctx.materials.glueCream);
      this.ridge.castShadow = true;
      world.scraperRig.add(this.ridge);
    }
    this.ridge.position.set(0, mm(6), mm(-1.6));
    this.ridge.scale.set(1, 0.02, 0.02);
    this.collected = 0;
  }

  exit(): void {
    this.ctx.world.scraperRig.visible = false;
    this.ctx.overlay.setHint(null);
    this.ctx.audio.setTurning(0);
  }

  choices(): ChoiceButton[] {
    if (!this.ready) return [];
    return [{ id: 'toFlower', icon: 'flowerSmall', label: 'make a flower', selected: false }];
  }

  onChoice(id: string): void {
    if (id === 'toFlower') {
      this.ctx.audio.tap();
      this.ctx.goTo('piping');
    }
  }

  onDown(f: PointerFrame): void {
    this.idle = 0;
    this.ctx.screenOf(this.centre, this.screen);
    this.lastAngle = Math.atan2(f.y - this.screen.y, f.x - this.screen.x);
    this.tracking = true;
  }

  onMove(f: PointerFrame): void {
    if (!this.tracking) return;
    this.idle = 0;
    this.ctx.screenOf(this.centre, this.screen);
    const a = Math.atan2(f.y - this.screen.y, f.x - this.screen.x);
    let d = wrapAngle(a - this.lastAngle);
    this.lastAngle = a;
    // A child who drags across the table rather than around it still turns it.
    const linear = (f.dx * -0.0042 + f.dy * 0.0);
    if (Math.abs(linear) > Math.abs(d)) d = linear;
    this.spinVel += clamp(d, -0.35, 0.35) * 26;
  }

  onUp(): void {
    this.tracking = false;
  }

  update(dt: number): void {
    const { world, state } = this.ctx;
    this.idle += dt;

    this.spinVel = damp(this.spinVel, 0, 5.5, dt);
    if (Math.abs(this.spinVel) < 1e-4) this.spinVel = 0;
    const delta = clamp(this.spinVel * dt, -0.25, 0.25);
    this.spin += delta;
    world.turntablePlate.rotation.y = this.spin;

    if (Math.abs(delta) > 1e-5) {
      const removed = this.smoothBand(this.spin, Math.abs(delta));
      this.smoothedArc += Math.abs(delta);
      this.collected = Math.min(1, this.collected + removed * 3.4);
      world.cake.refresh();
    }

    if (this.ridge) {
      const s = 0.02 + this.collected * 0.98;
      this.ridge.scale.set(1, 0.1 + s * 0.85, 0.12 + s * 0.9);
      this.ridge.position.y = mm(5) + s * mm(2);
    }

    const speed = clamp(Math.abs(this.spinVel) / 3.2, 0, 1);
    this.ctx.audio.setTurning(speed * 0.9);

    if (!this.ready && (this.smoothedArc > 1.15 || state.meanRoughness() < 0.28)) {
      this.ready = true;
      this.ctx.audio.petalDone(2);
    }

    this.ctx.overlay.setHint(this.idle > 2.6 && this.smoothedArc < 0.5 ? 'arc' : null);
  }

  /** Even out only the columns that just went past the blade. */
  private smoothBand(spin: number, arc: number): number {
    const rough = this.ctx.state.roughness;
    const n = rough.length;
    const local = BLADE_BEARING - spin;
    let removed = 0;
    const reach = CONTACT_HALF + arc;
    const steps = Math.max(2, Math.ceil((reach * 2 * n) / TAU) + 2);
    for (let k = -steps; k <= steps; k++) {
      const a = local + (k / steps) * reach;
      const i = ((Math.round((a / TAU) * n) % n) + n) % n;
      const dist = Math.abs((k / steps) * reach);
      const weight = clamp(1 - dist / reach, 0, 1);
      const before = rough[i];
      // Only the high spots come off; the blade cannot add cream back.
      const after = Math.max(0, before - weight * (0.55 + before * 0.9) * Math.min(arc * 2.6, 0.5));
      rough[i] = after;
      removed += before - after;
    }
    return removed / n;
  }

  dispose(): void {
    if (this.ridge) {
      this.ridge.geometry.dispose();
      this.ridge.parent?.remove(this.ridge);
      this.ridge = null;
    }
  }
}

export const TURNTABLE_RADIUS = DIM.turntableRadius;
