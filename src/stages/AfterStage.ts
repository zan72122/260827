import type { StageBehaviour, StageContext } from '../app/StageContext';
import type { ChoiceButton } from '../ui/Overlay';
import type { SeatId } from '../core/CakeState';

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
    this.ctx.camera.goTo('admire', 1.5);
    this.ctx.lights.setMode('table');
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
