import * as THREE from 'three';
import { clamp, TAU } from '../core/rng';
import { buildPolarSolid, updatePolarSolid, type PolarSolidOptions } from './PolarSolid';

/**
 * CreamFillVolumes — the cream layer between the two sponges is a real polar
 * height field, not a painted surface. Setting a strawberry down presses a
 * dimple and pushes a small rim up; the piping bag raises the field from the
 * bottom of a gap upward; the palette knife levels it; the top sponge
 * compresses it. Every one of those steps changes the volume that the section
 * later cuts through, which is why the cream thickness in the reveal matches
 * what the child actually did.
 */
export class CreamField {
  readonly nA: number;
  readonly nR: number;
  readonly rOuter: number;
  readonly base: number;
  private readonly h: Float32Array;
  private readonly initial: number;
  private version = 0;

  constructor(opts: {
    angularSegments: number;
    radialSegments: number;
    rOuter: number;
    base: number;
    initialHeight: number;
  }) {
    this.nA = opts.angularSegments;
    this.nR = opts.radialSegments;
    this.rOuter = opts.rOuter;
    this.base = opts.base;
    this.initial = opts.initialHeight;
    this.h = new Float32Array(this.nA * (this.nR + 1));
    this.reset();
  }

  get revision(): number {
    return this.version;
  }

  reset(): void {
    // A spread layer is never perfectly flat: it thins a little at the rim.
    for (let ia = 0; ia < this.nA; ia++) {
      for (let ir = 0; ir <= this.nR; ir++) {
        const t = ir / this.nR;
        this.h[ia * (this.nR + 1) + ir] = this.initial * (1 - 0.16 * t * t);
      }
    }
    this.version++;
  }

  private index(ia: number, ir: number): number {
    return (((ia % this.nA) + this.nA) % this.nA) * (this.nR + 1) + clamp(ir, 0, this.nR);
  }

  /** Height above `base`, bilinear, angle in radians and radius in metres. */
  heightAt(angle: number, radius: number): number {
    const fa = ((angle / TAU) * this.nA + this.nA * 4) % this.nA;
    const fr = clamp((radius / this.rOuter) * this.nR, 0, this.nR);
    const ia = Math.floor(fa);
    const ir = Math.floor(fr);
    const ta = fa - ia;
    const tr = fr - ir;
    const h00 = this.h[this.index(ia, ir)];
    const h10 = this.h[this.index(ia + 1, ir)];
    const h01 = this.h[this.index(ia, ir + 1)];
    const h11 = this.h[this.index(ia + 1, ir + 1)];
    return (
      h00 * (1 - ta) * (1 - tr) + h10 * ta * (1 - tr) + h01 * (1 - ta) * tr + h11 * ta * tr
    );
  }

  topAt(angle: number, radius: number): number {
    return this.base + this.heightAt(angle, radius);
  }

  private forEachNear(
    x: number,
    z: number,
    radius: number,
    fn: (i: number, falloff: number, r: number) => void,
  ): void {
    const cellR = this.rOuter / this.nR;
    for (let ia = 0; ia < this.nA; ia++) {
      const a = (ia / this.nA) * TAU;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      for (let ir = 0; ir <= this.nR; ir++) {
        const r = ir * cellR;
        const d = Math.hypot(ca * r - x, sa * r - z);
        if (d > radius) continue;
        fn(ia * (this.nR + 1) + ir, 1 - d / radius, d);
      }
    }
  }

  /** A berry settling in: local dimple plus the ridge of displaced cream. */
  press(x: number, z: number, radius: number, depth: number): void {
    const outer = radius * 1.9;
    this.forEachNear(x, z, outer, (i, _f, d) => {
      if (d <= radius) {
        const t = 1 - d / radius;
        this.h[i] = Math.max(0.0004, this.h[i] - depth * (t * t * (3 - 2 * t)));
      } else {
        const t = 1 - (d - radius) / (outer - radius);
        this.h[i] += depth * 0.42 * t * t;
      }
    });
    this.version++;
  }

  /**
   * Piping: the nozzle fills a gap from the bottom up. `rate` is metres of
   * cream added this frame, and the field never overshoots `target`.
   */
  fill(x: number, z: number, radius: number, target: number, rate: number): number {
    let added = 0;
    const cellArea = (TAU / this.nA) * (this.rOuter / this.nR);
    this.forEachNear(x, z, radius, (i, f) => {
      const want = target - this.base;
      if (this.h[i] >= want) return;
      const step = Math.min(want - this.h[i], rate * (0.35 + 0.65 * f));
      this.h[i] += step;
      added += step * cellArea;
    });
    if (added > 0) this.version++;
    return added;
  }

  /** Palette knife: one directional pass that shears high cream into low. */
  level(target: number, amount: number, sweepAngle: number, sweepWidth: number): void {
    const want = target - this.base;
    for (let ia = 0; ia < this.nA; ia++) {
      const a = (ia / this.nA) * TAU;
      let d = Math.abs(((a - sweepAngle + Math.PI * 3) % TAU) - Math.PI);
      d = Math.min(d, Math.PI);
      const inSweep = d < sweepWidth ? 1 - d / sweepWidth : 0;
      if (inSweep <= 0) continue;
      for (let ir = 0; ir <= this.nR; ir++) {
        const i = ia * (this.nR + 1) + ir;
        const k = amount * inSweep;
        this.h[i] += (want - this.h[i]) * (this.h[i] > want ? k : k * 0.55);
      }
    }
    // A blade also smooths across its own path.
    const copy = this.h.slice();
    for (let ia = 0; ia < this.nA; ia++) {
      for (let ir = 0; ir <= this.nR; ir++) {
        const i = ia * (this.nR + 1) + ir;
        const s =
          copy[this.index(ia - 1, ir)] +
          copy[this.index(ia + 1, ir)] +
          copy[this.index(ia, ir - 1)] +
          copy[this.index(ia, ir + 1)];
        this.h[i] = this.h[i] * 0.76 + (s / 4) * 0.24;
      }
    }
    this.version++;
  }

  /** Load of the upper sponge. */
  compress(factor: number, ceiling: number): void {
    const want = ceiling - this.base;
    for (let i = 0; i < this.h.length; i++) {
      if (this.h[i] > want) this.h[i] = want + (this.h[i] - want) * factor;
    }
    this.version++;
  }

  /** Highest point of the layer; used to seat the upper sponge. */
  maxHeight(): number {
    let m = 0;
    for (let i = 0; i < this.h.length; i++) if (this.h[i] > m) m = this.h[i];
    return m;
  }

  /** Cream volume in cubic metres — the honest measure of "the gap is full". */
  volume(): number {
    let v = 0;
    const dA = TAU / this.nA;
    const dR = this.rOuter / this.nR;
    for (let ia = 0; ia < this.nA; ia++) {
      for (let ir = 0; ir <= this.nR; ir++) {
        const r = ir * dR;
        v += this.h[ia * (this.nR + 1) + ir] * dA * r * dR;
      }
    }
    return v;
  }

  /** How much of the space up to `target` is still air. */
  gapVolume(target: number): number {
    let v = 0;
    const dA = TAU / this.nA;
    const dR = this.rOuter / this.nR;
    const want = target - this.base;
    for (let ia = 0; ia < this.nA; ia++) {
      for (let ir = 0; ir <= this.nR; ir++) {
        const r = ir * dR;
        const miss = Math.max(0, want - this.h[ia * (this.nR + 1) + ir]);
        v += miss * dA * r * dR;
      }
    }
    return v;
  }

  /** Largest remaining void, so the nozzle can be guided to real gaps. */
  worstGap(target: number): { x: number; z: number; deficit: number } {
    let best = { x: 0, z: 0, deficit: 0 };
    const want = target - this.base;
    const dR = this.rOuter / this.nR;
    for (let ia = 0; ia < this.nA; ia++) {
      const a = (ia / this.nA) * TAU;
      for (let ir = 2; ir <= this.nR; ir++) {
        const miss = want - this.h[ia * (this.nR + 1) + ir];
        if (miss > best.deficit) {
          best = { x: Math.cos(a) * ir * dR, z: Math.sin(a) * ir * dR, deficit: miss };
        }
      }
    }
    return best;
  }

  /**
   * Shallow dips that mark where a berry can go — no discs, no numbers, no
   * colour. Each is pressed with the same displacement the fruit itself makes,
   * so a waiting well and a filled one are the same kind of mark.
   */
  dimpleWells(wells: readonly { x: number; z: number }[], radius: number, depth: number): void {
    for (const w of wells) this.press(w.x, w.z, radius, depth);
  }

  solidOptions(a0: number, a1: number, uvScale: number): PolarSolidOptions {
    const span = a1 - a0;
    const segs = Math.max(3, Math.round((span / TAU) * this.nA));
    return {
      rOuter: this.rOuter,
      bottom: this.base,
      top: (a, r) => this.topAt(a, r),
      a0,
      a1,
      angularSegments: segs,
      radialSegments: this.nR,
      uvScale,
    };
  }

  buildGeometry(a0: number, a1: number, uvScale: number): THREE.BufferGeometry {
    return buildPolarSolid(this.solidOptions(a0, a1, uvScale));
  }

  refreshGeometry(
    geom: THREE.BufferGeometry,
    a0: number,
    a1: number,
    uvScale: number,
  ): boolean {
    return updatePolarSolid(geom, this.solidOptions(a0, a1, uvScale));
  }
}
