import type { Placement } from './PlacementRing';

/**
 * ReplayLoop — the game is not a quiz, so nothing here is scored or checked.
 * It only remembers what the last round looked like so the line above the cake
 * can point at the next thing worth trying: turn one round, mix the sizes, keep
 * the ring and move the knife, put one in the middle. After that it gets out of
 * the way and just asks what the next cut will look like.
 */
export interface RoundRecord {
  signature: string;
  cut: number;
  faces: number;
}

const sign = (placements: readonly Placement[]): string =>
  placements
    .map((p) => `${p.slotId}:${p.variantId}:${p.orientation}`)
    .sort()
    .join('|');

export class ReplayLoop {
  private history: RoundRecord[] = [];

  get rounds(): number {
    return this.history.length;
  }

  record(placements: readonly Placement[], cut: number, faces: number): void {
    this.history.push({ signature: sign(placements), cut, faces });
  }

  /** True when the child kept the ring and only moved the knife. */
  get sameRingNewCut(): boolean {
    if (this.history.length < 2) return false;
    const a = this.history[this.history.length - 1];
    const b = this.history[this.history.length - 2];
    return a.signature === b.signature && a.cut !== b.cut;
  }

  /** A single quiet nudge, never an instruction and never an answer. */
  suggestion(placements: readonly Placement[]): string {
    const round = this.history.length;
    const orientations = new Set(placements.map((p) => p.orientation));
    const variants = new Set(placements.map((p) => p.variantId));
    const hasCentre = placements.some((p) => p.slotId >= 12);

    if (round <= 1 && orientations.size < 2) return 'むきを かえて おいてみる？';
    if (round === 2 && variants.size < 3) return 'おおきいのと ちいさいのを まぜてみる？';
    if (round === 3) return 'おなじまま、きる むきだけ かえてみる？';
    if (round >= 4 && !hasCentre) return 'まんなかにも おいてみる？';
    return 'つぎは どんな かたちに なるかな';
  }
}
