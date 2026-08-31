import * as THREE from 'three';
import type { StageBehaviour, StageContext } from '../app/StageContext';
import type { ChoiceButton } from '../ui/Overlay';
import type { SeatId } from '../core/CakeState';
import { TABLE_CENTRE, TABLE_TOP_Y } from '../build/Room';

/**
 * Afterwards.
 *
 * The work stays on screen with nothing counting down and nothing to dismiss.
 * The two ways on are pictures: make another flower, or take a slice to the
 * other place at the table. Choosing the flower puts a child straight back at
 * the nail — one tap, no menu in between.
 */
export class AfterStage implements StageBehaviour {
  private readonly ctx: StageContext;
  private clock = 0;

  constructor(ctx: StageContext) {
    this.ctx = ctx;
  }

  enter(): void {
    this.clock = 0;
    this.ctx.lights.setMode('table');
    this.frameTheWholeThing();
  }

  /**
   * Both halves of what just happened belong in this shot: the slice on its
   * plate and the cake it came out of. Where the plate is depends on which
   * place was chosen, so the framing is worked out rather than fixed.
   */
  private frameTheWholeThing(): void {
    const { world, state, viewport } = this.ctx;
    const plate = new THREE.Vector3();
    world.plates[state.seat].getWorldPosition(plate);
    const target = new THREE.Vector3(
      (plate.x + TABLE_CENTRE.x) / 2,
      TABLE_TOP_Y + 0.075,
      (plate.z + TABLE_CENTRE.z) / 2,
    );
    // Stand back towards the pastry bench, where the cake came from.
    const dir = new THREE.Vector3(-0.52, 0, -0.86).normalize();
    const dist = viewport.portrait ? 1.24 : 0.94;
    this.ctx.camera.goToCustom(
      {
        position: new THREE.Vector3(
          target.x + dir.x * dist,
          target.y + (viewport.portrait ? 0.52 : 0.42),
          target.z + dir.z * dist,
        ),
        target,
        fov: viewport.portrait ? 48 : 40,
      },
      1.6,
    );
  }

  exit(): void {
    this.ctx.overlay.setHint(null);
  }

  choices(): ChoiceButton[] {
    if (this.clock < 1.6) return [];
    return [
      { id: 'again', icon: 'flowerLarge', label: 'make another flower' },
      { id: 'otherSeat', icon: 'seatSwap', label: 'give a slice to the other place' },
    ];
  }

  onChoice(id: string): void {
    this.ctx.audio.tap();
    const other: SeatId = this.ctx.state.seat === 'petal' ? 'leaf' : 'petal';
    if (id === 'again') {
      this.ctx.restart();
    } else if (id === 'otherSeat') {
      // If there is still cake with a flower on it, that slice goes to the
      // other place. If there is not, start again with the other place chosen.
      const hasFlowerLeft = this.ctx.placedFlowers().some((f) => {
        const host = f.group.parent;
        return host !== null && host.name === 'remainder';
      });
      this.ctx.state.seat = other;
      if (hasFlowerLeft && this.ctx.state.remaining.length > 0) this.ctx.goTo('cutting');
      else this.ctx.restart(other);
    }
  }

  update(dt: number): void {
    this.clock += dt;
  }
}
