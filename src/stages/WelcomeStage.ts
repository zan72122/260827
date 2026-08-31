import * as THREE from 'three';
import type { StageBehaviour, StageContext } from '../app/StageContext';
import type { ChoiceButton } from '../ui/Overlay';
import type { SeatId } from '../core/CakeState';
import { damp } from '../util/math';

/**
 * No title card. The bench is simply there, with the cake on it, and the first
 * touch does two things at once: it lets sound start, which browsers require of
 * a gesture, and it picks who the cake is for. The two places are told apart by
 * the picture on the card, so nothing has to be read or typed.
 */
export class WelcomeStage implements StageBehaviour {
  private readonly ctx: StageContext;
  private chosen: SeatId | null = null;
  private idle = 0;
  private lift: Record<SeatId, number> = { petal: 0, leaf: 0 };
  private settle = 0;

  constructor(ctx: StageContext) {
    this.ctx = ctx;
  }

  enter(): void {
    this.chosen = null;
    this.idle = 0;
    this.settle = 0;
    this.ctx.camera.goTo('welcome', 0);
    this.ctx.lights.setMode('bench');
    this.ctx.world.nailPivot.visible = false;
  }

  exit(): void {
    this.ctx.overlay.setHint(null);
  }

  choices(): ChoiceButton[] {
    return [
      { id: 'seat:petal', icon: 'cardPetal', label: 'flower place card', selected: this.chosen === 'petal' },
      { id: 'seat:leaf', icon: 'cardLeaf', label: 'leaf place card', selected: this.chosen === 'leaf' },
    ];
  }

  onChoice(id: string): void {
    if (!id.startsWith('seat:')) return;
    const seat = id.slice(5) as SeatId;
    this.chosen = seat;
    this.ctx.state.seat = seat;
    this.ctx.audio.tap();
    this.settle = 0.9;
  }

  onDown(): void {
    this.idle = 0;
  }

  update(dt: number): void {
    this.idle += dt;
    this.ctx.overlay.setHint(this.idle > 2.4 && !this.chosen ? 'tap' : null);

    // The chosen card stands up a little; the other one stays put.
    for (const seat of ['petal', 'leaf'] as SeatId[]) {
      const want = this.chosen === seat ? 1 : 0;
      this.lift[seat] = damp(this.lift[seat], want, 6, dt);
      const card = this.ctx.world.placeCards[seat];
      card.position.y = card.userData.baseY ?? (card.userData.baseY = card.position.y);
      card.position.y += this.lift[seat] * 0.012;
      card.rotation.x = -0.22 + this.lift[seat] * 0.1;
    }

    if (this.settle > 0) {
      this.settle -= dt;
      if (this.settle <= 0) this.ctx.goTo('smoothing');
    }
  }
}

/** Shared helper: bearing of a world point about the cake's axis. */
export function bearingAround(centre: THREE.Vector3, p: THREE.Vector3): number {
  return Math.atan2(p.z - centre.z, p.x - centre.x);
}
