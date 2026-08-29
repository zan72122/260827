import { clamp } from './math';

/**
 * Critically-dampable angular spring used for branch sway.
 * Solved semi-implicitly so large timesteps stay stable on weak phones.
 */
export class AngularSpring {
  value: number;
  velocity = 0;
  target: number;
  stiffness: number;
  damping: number;
  limit: number;

  constructor(value: number, stiffness: number, damping: number, limit = 0.55) {
    this.value = value;
    this.target = value;
    this.stiffness = stiffness;
    this.damping = damping;
    this.limit = limit;
  }

  /** `drive` is an external angular acceleration (e.g. trunk motion). */
  step(dt: number, drive = 0): number {
    // Sub-step so a stiff spring never explodes on a dropped frame.
    const steps = Math.min(4, Math.max(1, Math.ceil(dt / 0.016)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const accel = (this.target - this.value) * this.stiffness - this.velocity * this.damping + drive;
      this.velocity += accel * h;
      this.value += this.velocity * h;
      const lo = this.target - this.limit;
      const hi = this.target + this.limit;
      if (this.value < lo) {
        this.value = lo;
        this.velocity *= -0.2;
      } else if (this.value > hi) {
        this.value = hi;
        this.velocity *= -0.2;
      }
    }
    this.velocity = clamp(this.velocity, -12, 12);
    return this.value;
  }
}
