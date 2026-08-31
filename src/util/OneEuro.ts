/**
 * 1 Euro filter. Suppresses the small involuntary tremor of a 4 year old's
 * finger at low speed while letting deliberate fast strokes (big waves, loops)
 * pass through untouched.
 */
class LowPass {
  private y = 0;
  private initialised = false;

  filter(x: number, alpha: number): number {
    if (!this.initialised) {
      this.y = x;
      this.initialised = true;
      return x;
    }
    this.y = alpha * x + (1 - alpha) * this.y;
    return this.y;
  }

  get value(): number {
    return this.y;
  }

  get ready(): boolean {
    return this.initialised;
  }

  reset(): void {
    this.initialised = false;
    this.y = 0;
  }
}

export class OneEuroFilter {
  private x = new LowPass();
  private dx = new LowPass();
  private lastTime = -1;

  constructor(
    private minCutoff = 1.2,
    private beta = 0.7,
    private dCutoff = 1.0,
  ) {}

  reset(): void {
    this.x.reset();
    this.dx.reset();
    this.lastTime = -1;
  }

  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(value: number, time: number): number {
    let dt = this.lastTime < 0 ? 1 / 60 : time - this.lastTime;
    if (!(dt > 1e-5)) dt = 1e-5;
    this.lastTime = time;

    const prev = this.x.ready ? this.x.value : value;
    const dValue = (value - prev) / dt;
    const edValue = this.dx.filter(dValue, OneEuroFilter.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edValue);
    return this.x.filter(value, OneEuroFilter.alpha(cutoff, dt));
  }
}

export class OneEuroVec2 {
  private fx: OneEuroFilter;
  private fy: OneEuroFilter;

  constructor(minCutoff = 1.2, beta = 0.7, dCutoff = 1.0) {
    this.fx = new OneEuroFilter(minCutoff, beta, dCutoff);
    this.fy = new OneEuroFilter(minCutoff, beta, dCutoff);
  }

  reset(): void {
    this.fx.reset();
    this.fy.reset();
  }

  filter(x: number, y: number, t: number, out: { x: number; y: number }): void {
    out.x = this.fx.filter(x, t);
    out.y = this.fy.filter(y, t);
  }
}
