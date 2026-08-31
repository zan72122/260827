import { clamp, fbm2 } from '../util/math';

export const CAKE_RADIUS = 0.075;
export const CAKE_TOP = 0.062;

const FIELD = 0.086; // half extent of the height fields
const N = 112;

/**
 * Two coarse height fields over the cake top:
 *  - `deposit`: how tall the piped cream already is at a point, so a new stroke
 *    starts on top of the old one and sinks into it slightly.
 *  - `press`: how far the nappe has been pushed down by the nozzle, so the
 *    cream foot really does dent the cake.
 */
export class CakeSurfaceContact {
  private deposit = new Float32Array(N * N);
  /** frozen copy taken when a stroke starts, so a stroke cannot climb its own deposit */
  private depositBase = new Float32Array(N * N);
  private press = new Float32Array(N * N);
  private wobble = new Float32Array(N * N);
  private _dirty = true;

  constructor() {
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = ((i / (N - 1)) * 2 - 1) * FIELD;
        const z = ((j / (N - 1)) * 2 - 1) * FIELD;
        const r = Math.hypot(x, z);
        const th = Math.atan2(z, x);
        // shallow spiral left by the palette knife, plus a little irregularity
        const spiral = Math.sin(r * 300 + th * 1.4) * 0.00052;
        const grain = fbm2(x * 190, z * 190, 3) * 0.00034;
        const dome = -Math.pow(clamp(r / CAKE_RADIUS, 0, 1), 3.2) * 0.0013;
        this.wobble[j * N + i] = spiral + grain + dome;
      }
    }
  }

  get dirty(): boolean {
    return this._dirty;
  }

  clearDirty(): void {
    this._dirty = false;
  }

  private sample(f: Float32Array, x: number, z: number): number {
    const fx = ((x / FIELD) * 0.5 + 0.5) * (N - 1);
    const fz = ((z / FIELD) * 0.5 + 0.5) * (N - 1);
    if (fx < 0 || fz < 0 || fx > N - 1 || fz > N - 1) return 0;
    const i0 = Math.floor(fx);
    const j0 = Math.floor(fz);
    const i1 = Math.min(N - 1, i0 + 1);
    const j1 = Math.min(N - 1, j0 + 1);
    const tx = fx - i0;
    const tz = fz - j0;
    const a = f[j0 * N + i0] * (1 - tx) + f[j0 * N + i1] * tx;
    const b = f[j1 * N + i0] * (1 - tx) + f[j1 * N + i1] * tx;
    return a * (1 - tz) + b * tz;
  }

  private splat(f: Float32Array, x: number, z: number, radius: number, value: number, max: boolean): void {
    const toI = (v: number) => ((v / FIELD) * 0.5 + 0.5) * (N - 1);
    const ri = Math.ceil((radius / FIELD) * 0.5 * (N - 1));
    const ci = toI(x);
    const cj = toI(z);
    const i0 = Math.max(0, Math.floor(ci) - ri);
    const i1 = Math.min(N - 1, Math.ceil(ci) + ri);
    const j0 = Math.max(0, Math.floor(cj) - ri);
    const j1 = Math.min(N - 1, Math.ceil(cj) + ri);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const px = ((i / (N - 1)) * 2 - 1) * FIELD;
        const pz = ((j / (N - 1)) * 2 - 1) * FIELD;
        const d = Math.hypot(px - x, pz - z);
        if (d > radius) continue;
        const w = 1 - d / radius;
        const smooth = w * w * (3 - 2 * w);
        const k = j * N + i;
        if (max) f[k] = Math.max(f[k], value * smooth);
        else f[k] += value * smooth;
      }
    }
    this._dirty = true;
  }

  /** Nappe height (relative to CAKE_TOP) including the dent from the nozzle. */
  nappe(x: number, z: number): number {
    return this.sample(this.wobble, x, z) - this.sample(this.press, x, z);
  }

  surfaceY(x: number, z: number): number {
    return CAKE_TOP + this.nappe(x, z);
  }

  /** Height of already-piped cream above the surface at this point. */
  creamHeight(x: number, z: number): number {
    return this.sample(this.deposit, x, z);
  }

  /**
   * Height of the cream that was already there when the current stroke began.
   * The live field must never be used as the ground for the stroke writing into
   * it, or the column climbs on top of itself.
   */
  creamHeightBase(x: number, z: number): number {
    return this.sample(this.depositBase, x, z);
  }

  beginStroke(): void {
    this.depositBase.set(this.deposit);
  }

  addDeposit(x: number, z: number, radius: number, height: number): void {
    this.splat(this.deposit, x, z, Math.max(radius, 0.0025), height, true);
  }

  addPress(x: number, z: number, radius: number, depth: number): void {
    this.splat(this.press, x, z, radius, depth, true);
  }

  /** Undo support: knock the deposit field back down over a region. */
  clearRegion(x: number, z: number, radius: number): void {
    const toI = (v: number) => ((v / FIELD) * 0.5 + 0.5) * (N - 1);
    const ri = Math.ceil((radius / FIELD) * 0.5 * (N - 1));
    const ci = toI(x);
    const cj = toI(z);
    for (let j = Math.max(0, Math.floor(cj) - ri); j <= Math.min(N - 1, Math.ceil(cj) + ri); j++) {
      for (let i = Math.max(0, Math.floor(ci) - ri); i <= Math.min(N - 1, Math.ceil(ci) + ri); i++) {
        const px = ((i / (N - 1)) * 2 - 1) * FIELD;
        const pz = ((j / (N - 1)) * 2 - 1) * FIELD;
        if (Math.hypot(px - x, pz - z) > radius) continue;
        this.deposit[j * N + i] = 0;
        this.depositBase[j * N + i] = 0;
        this.press[j * N + i] *= 0.25;
      }
    }
    this._dirty = true;
  }
}
