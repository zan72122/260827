export type Beat =
  | 'introMacro'
  | 'introApproach'
  | 'awaitFirst'
  | 'firstFlow'
  | 'firstDone'
  | 'presentNozzles'
  | 'free'
  | 'finale';

/**
 * The order of discovery: see the hole, watch the cream take its shape, then be
 * handed the other two tips and left alone. Nothing here is a menu.
 */
export class GameFlow {
  beat: Beat = 'introMacro';
  t = 0;
  strokes = 0;
  private idle = 0;

  update(dt: number, piping: boolean): void {
    this.t += dt;
    this.idle = piping ? 0 : this.idle + dt;

    switch (this.beat) {
      case 'introMacro':
        if (this.t > 2.9) this.go('introApproach');
        break;
      case 'introApproach':
        if (this.t > 2.0) this.go('awaitFirst');
        break;
      case 'firstDone':
        if (this.t > 1.9) this.go('presentNozzles');
        break;
      case 'presentNozzles':
        if (this.t > 3.0) this.go('free');
        break;
      case 'free':
        if (this.strokes >= 4 && this.idle > 26) this.go('finale');
        break;
      case 'finale':
        break;
      default:
        break;
    }
  }

  go(b: Beat): void {
    if (this.beat === b) return;
    this.beat = b;
    this.t = 0;
  }

  /** any touch counts as life: it must not fall straight back into the finale */
  poke(): void {
    this.idle = 0;
  }

  notifyBegin(): void {
    this.idle = 0;
    if (this.beat === 'awaitFirst') this.go('firstFlow');
    else if (this.beat === 'finale') this.go('free');
  }

  notifyFinish(): void {
    this.strokes++;
    if (this.beat === 'firstFlow') this.go('firstDone');
  }

  get acceptsPiping(): boolean {
    return (
      this.beat === 'awaitFirst' ||
      this.beat === 'firstFlow' ||
      this.beat === 'free' ||
      this.beat === 'finale' ||
      this.beat === 'presentNozzles' ||
      this.beat === 'firstDone'
    );
  }

  get canSwapNozzle(): boolean {
    return this.beat === 'presentNozzles' || this.beat === 'free' || this.beat === 'finale';
  }
}
