import { clamp, damp, smoothstep } from '../util/math';

/**
 * Not a soft body — just the few deformations that read as a real bag:
 * the mass of cream sagging into the lower third, a small volume loss while the
 * hand squeezes, and the twisted, collapsed top.
 */
export class BagMorphController {
  /** 0..1 remaining cream */
  fill = 0.92;
  /** 0..1 squeeze from the hand */
  squeeze = 0;
  private squeezeTarget = 0;

  setPressure(v: number): void {
    this.squeezeTarget = clamp(v, 0, 1);
  }

  consume(volume: number): void {
    // ~1.1 litre of cream in the bag; a child will never actually empty it
    this.fill = clamp(this.fill - volume / 0.0011, 0.28, 1);
  }

  update(dt: number): void {
    this.squeeze = damp(this.squeeze, this.squeezeTarget, 0.07, dt);
  }

  /** Radius multiplier along the bag, s = 0 at the tip, 1 at the twisted top. */
  radiusAt(s: number, theta: number): number {
    const centre = 0.30 + 0.16 * this.fill - 0.05 * this.squeeze;
    const w = 0.27;
    const sag = Math.exp(-Math.pow((s - centre) / w, 2)) * (0.16 + 0.30 * this.fill);
    const grip = Math.exp(-Math.pow((s - 0.52) / 0.15, 2)) * this.squeeze * 0.16;
    const twist = smoothstep(0.80, 1.0, s);
    const crease = Math.sin(theta * 5 + s * 26) * 0.055 * smoothstep(0.66, 1.0, s);
    const fold = Math.sin(theta * 3 - s * 9) * 0.02 * (1 - twist);
    return (1 + sag - grip + fold + crease) * (1 - twist * 0.82);
  }

  /** Where the cream surface sits inside the bag. */
  get creamLine(): number {
    return 0.20 + 0.52 * this.fill;
  }
}
