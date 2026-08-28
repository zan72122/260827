/**
 * Guidance without words and without glowing outlines: the machine itself moves a
 * little. A lever bobs, a clasp swings, a placard lifts, a cord sways. Attention
 * comes from motion and framing, and it fades as the child gets it.
 */
export type HintFn = (t: number, amount: number) => void;

export class ChildGuidance {
  private hint: HintFn | null = null;
  private idle = 0;
  private amount = 0;
  private clock = 0;
  private level = 1;

  /** 1 = first letter, full nudging. 3 = barely any. */
  setLevel(round: number): void {
    this.level = Math.max(1, Math.min(3, round));
  }

  setHint(fn: HintFn | null): void {
    if (this.hint === fn) return;
    this.hint?.(this.clock, 0);
    this.hint = fn;
    this.idle = 0;
    this.amount = 0;
  }

  /** Any touch resets the wait. */
  poke(): void {
    this.idle = 0;
    this.amount = 0;
    this.hint?.(this.clock, 0);
  }

  private get delay(): number {
    return this.level === 1 ? 2.0 : this.level === 2 ? 4.2 : 6.5;
  }

  private get strength(): number {
    return this.level === 1 ? 1 : this.level === 2 ? 0.6 : 0.35;
  }

  update(dt: number): void {
    this.clock += dt;
    if (!this.hint) return;
    this.idle += dt;
    const want = this.idle > this.delay ? this.strength : 0;
    this.amount += (want - this.amount) * Math.min(1, dt * 2.4);
    this.hint(this.clock, this.amount);
  }
}
