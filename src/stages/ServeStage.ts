import * as THREE from 'three';
import type { StageBehaviour, StageContext } from '../app/StageContext';
import type { ChoiceButton } from '../ui/Overlay';
import type { PointerFrame } from '../input/PointerInput';
import { TABLE_TOP_Y, TABLE_CENTRE, SEATS } from '../build/Room';
import { CAKE_R, cakeTopY } from '../build/Cake';
import { DIM, mm } from '../core/units';
import { TAU, clamp, damp, easeInOut, wrapAngle } from '../util/math';

/**
 * Carrying the cake to the table, and the candle.
 *
 * The same cake travels: it is not re-lit somewhere else or swapped for a
 * prettier one. The candle stands well away from the flowers, and it goes out
 * with a sweep of one finger — there is no microphone, no camera and nothing
 * that needs a real breath. A child who would rather leave it burning can go
 * straight on.
 */

const CANDLE_RADIUS = CAKE_R * 0.52;

type Phase = 'carrying' | 'lighting' | 'blowing' | 'out' | 'clearing';

export class ServeStage implements StageBehaviour {
  private readonly ctx: StageContext;
  private phase: Phase = 'carrying';
  private clock = 0;
  private idle = 0;
  private breath = 0;
  private gust = 0;
  private fromPos = new THREE.Vector3();
  private fromYaw = 0;
  private toPos = new THREE.Vector3();
  private toYaw = 0;
  private flicker = 0;

  constructor(ctx: StageContext) {
    this.ctx = ctx;
  }

  enter(): void {
    const { world, state } = this.ctx;
    this.phase = 'carrying';
    this.clock = 0;
    this.idle = 0;
    this.breath = 0;
    this.gust = 0;

    world.scraperRig.visible = false;
    world.lifterRig.visible = false;
    world.nailPivot.visible = false;

    // Take the cake off the turntable without changing where it is in the room.
    world.scene.attach(world.cakeCarrier);
    this.fromPos.copy(world.cakeCarrier.position);
    this.fromYaw = world.cakeCarrier.rotation.y;

    const bearing = SEATS[state.seat].bearing;
    // The cake goes in the middle of the table whichever place was chosen, so
    // the shots that follow can be framed on one spot.
    this.toPos.set(TABLE_CENTRE.x, TABLE_TOP_Y + mm(1), TABLE_CENTRE.z);
    // Turn the cake so the flower the child made faces their guest.
    const flowers = this.ctx.placedFlowers();
    const first = flowers[0];
    const flowerBearing = first ? Math.atan2(first.group.position.z, first.group.position.x) : 0;
    this.toYaw = this.fromYaw + wrapAngle(bearing - (flowerBearing + this.fromYaw));

    this.ctx.camera.goTo('carry', 1.4);
    this.ctx.lights.setMode('table');
  }

  exit(): void {
    this.ctx.overlay.setHint(null);
  }

  choices(): ChoiceButton[] {
    if (this.phase === 'lighting' || this.phase === 'blowing') {
      return [{ id: 'skipCandle', icon: 'next', label: 'go on without blowing it out' }];
    }
    return [];
  }

  onChoice(id: string): void {
    if (id !== 'skipCandle') return;
    this.ctx.audio.tap();
    this.extinguish(false);
  }

  onDown(): void {
    this.idle = 0;
  }

  onMove(f: PointerFrame): void {
    if (this.phase !== 'lighting' && this.phase !== 'blowing') return;
    this.idle = 0;
    const speed = Math.hypot(f.dx, f.dy);
    if (speed < 1.2) return;
    this.phase = 'blowing';
    this.gust = Math.min(1, this.gust + speed * 0.02);
    this.breath += speed * 0.0055;
    if (this.breath > 1) this.extinguish(true);
  }

  private extinguish(blown: boolean): void {
    if (this.phase === 'out' || this.phase === 'clearing') return;
    this.phase = 'out';
    this.clock = 0;
    const world = this.ctx.world;
    world.candleFlame.visible = false;
    this.ctx.state.candleLit = false;
    if (blown) this.ctx.audio.flameOut();
  }

  private lightCandle(): void {
    const { world, state } = this.ctx;
    // Stand the candle where it is not touching a flower.
    let best = 0;
    let bestGap = -1;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU;
      let gap = Math.PI;
      for (const f of this.ctx.placedFlowers()) {
        const fa = Math.atan2(f.group.position.z, f.group.position.x);
        gap = Math.min(gap, Math.abs(wrapAngle(a - fa)));
      }
      if (gap > bestGap) {
        bestGap = gap;
        best = a;
      }
    }
    const x = Math.cos(best) * CANDLE_RADIUS;
    const z = Math.sin(best) * CANDLE_RADIUS;
    world.candle.position.set(x, cakeTopY(x, z) - mm(8), z);
    world.candle.userData.baseY = world.candle.position.y;
    world.candle.rotation.set(0.03, best, 0.02);
    world.candle.visible = true;
    world.candleFlame.visible = true;
    world.candleFlame.scale.setScalar(0.01);
    state.candlePresent = true;
    state.candleLit = true;
    this.ctx.camera.goTo('candle', 1.2);
  }

  update(dt: number): void {
    const { world } = this.ctx;
    this.clock += dt;
    this.idle += dt;

    if (this.phase === 'carrying') {
      const t = clamp(this.clock / 1.7, 0, 1);
      const k = easeInOut(t);
      world.cakeCarrier.position.lerpVectors(this.fromPos, this.toPos, k);
      world.cakeCarrier.position.y += Math.sin(Math.PI * t) * 0.05;
      world.cakeCarrier.rotation.y = this.fromYaw + (this.toYaw - this.fromYaw) * k;
      if (t >= 1) {
        this.phase = 'lighting';
        this.clock = 0;
        this.lightCandle();
      }
      return;
    }

    // Flame: it lives, it leans away from a gust, and it goes out.
    if (world.candleFlame.visible) {
      this.flicker += dt * 6.2;
      const grow = clamp(this.clock / 0.6, 0, 1);
      const wobble = 1 + Math.sin(this.flicker) * 0.06 + Math.sin(this.flicker * 2.7) * 0.03;
      const lean = this.gust * 1.15;
      world.candleFlame.scale.set(
        grow * wobble * (1 + lean * 0.4),
        grow * wobble * (1 - lean * 0.45),
        grow * wobble,
      );
      world.candleFlame.rotation.z = lean * 0.9;
      world.candleLight.intensity = grow * (0.85 + Math.sin(this.flicker * 1.7) * 0.09) * (1 - this.gust * 0.5);
      this.gust = damp(this.gust, 0, 3.4, dt);
      this.breath = Math.max(0, this.breath - dt * 0.22);
    } else {
      world.candleLight.intensity = damp(world.candleLight.intensity, 0, 8, dt);
    }

    if (this.phase === 'lighting' || this.phase === 'blowing') {
      this.ctx.overlay.setHint(this.idle > 3.0 ? 'swipe' : null);
      return;
    }

    if (this.phase === 'out') {
      this.ctx.overlay.setHint(null);
      if (this.clock > 1.1) {
        this.phase = 'clearing';
        this.clock = 0;
      }
      return;
    }

    if (this.phase === 'clearing') {
      // The candle comes off before the cake is cut.
      const t = clamp(this.clock / 0.9, 0, 1);
      world.candle.position.y += dt * 0.09;
      world.candle.rotation.z = t * 0.5;
      if (t >= 1) {
        world.candle.visible = false;
        this.ctx.state.candlePresent = false;
        world.candle.position.y = world.candle.userData.baseY ?? world.candle.position.y;
        world.candle.rotation.set(0, 0, 0);
        this.ctx.goTo('cutting');
      }
    }
  }
}

export const CANDLE_HEIGHT = DIM.candleHeight;
