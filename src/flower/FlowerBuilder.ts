import * as THREE from 'three';
import { PetalMesh } from './PetalMesh';
import {
  computeSampleNormals,
  makeSample,
  sampleCountFor,
  samplePetal,
  MAX_SAMPLES,
  type PetalSample,
} from './petalPath';
import type { FlowerRecord, PetalRecord, CreamColorId } from '../core/FlowerRecord';
import type { Materials } from '../render/materials';
import { TAU, clamp, makeRandom } from '../util/math';
import { loft } from '../build/geometry';

/**
 * Row settings. Row 0 is the tight inner whorl that reads as a bud; row 1 is
 * the open outer whorl that turns the bud into a full rose. A child who stops
 * after row 0 keeps a small flower, and that choice survives all the way to the
 * plate.
 */
export const ROWS = [
  {
    // The bud: the bag held high, so the ribbon tips in over the cone, and its
    // free edge furls inwards over the centre. Three of these wrap it fully.
    radius: 0.0074, arch: 0.0018, baseY: 0.0018, lean: 0.55, band: 0.0135,
    thickness: 0.0022, furl: 0.38, span: (TAU / 3) * 1.15, count: 3,
  },
  {
    // The open row: the bag much lower, so the ribbon stands almost upright,
    // and its free edge falls away from the flower instead of over it.
    radius: 0.0118, arch: 0.0015, baseY: 0.0010, lean: 0.16, band: 0.0140,
    thickness: 0.0025, furl: -0.55, span: (TAU / 5) * 1.25, count: 5,
  },
] as const;

/** Flow multipliers stored along a petal so the child's own rhythm survives. */
export interface PetalFlow {
  values: number[];
}

interface LivePetal {
  record: PetalRecord;
  mesh: PetalMesh;
  flow: number[];
  intended: number;
}

const _scratch: PetalSample[] = Array.from({ length: MAX_SAMPLES }, makeSample);

/**
 * Owns the three.js objects for one flower and keeps them in step with its
 * record. The group can be re-parented freely: moving the flower from the nail
 * to the cake and then onto a plate changes nothing but which frame it hangs
 * in.
 */
export class FlowerBuilder {
  readonly group = new THREE.Group();
  readonly record: FlowerRecord;

  private readonly materials: Materials;
  private petals: LivePetal[] = [];
  private live: LivePetal | null = null;
  private cone: THREE.Mesh | null = null;

  constructor(record: FlowerRecord, materials: Materials) {
    this.record = record;
    this.materials = materials;
    this.group.name = `flower:${record.id}`;
    this.buildCone();
  }

  /** The white base the petals are wound around, piped with a round tip. */
  private buildCone(): void {
    const rings: THREE.Vector3[][] = [];
    const seg = 36;
    const steps = 16;
    const rnd = makeRandom(19);
    const jitter = Array.from({ length: seg }, () => (rnd() - 0.5) * 0.00012);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const y = t * 0.0100;
      // fat at the foot, drawn up to a soft point, with the spiral the round
      // tip leaves behind
      const base = 0.0072 * Math.pow(1 - t, 0.55) + 0.0004 * (1 - t);
      const ring: THREE.Vector3[] = [];
      for (let j = 0; j < seg; j++) {
        const a = (j / seg) * TAU;
        const spiral = Math.sin(a - t * 13.5) * 0.00052 * (1 - t * 0.35);
        const r = Math.max(0.00035, base + spiral + jitter[j] * (1 - t));
        ring.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
      }
      rings.push(ring);
    }
    const geo = loft(rings, { capStart: true, capEnd: true, closedRings: true });
    const mesh = new THREE.Mesh(geo, this.materials.coatCream);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.cone = mesh;
    this.group.add(mesh);
  }

  get petalCount(): number {
    return this.record.petals.length;
  }

  /** Which row the next petal belongs to, given what has been piped. */
  nextRow(): number {
    const inRow0 = this.record.petals.filter((p) => p.row === 0).length;
    return inRow0 >= ROWS[0].count ? 1 : 0;
  }

  /** True once the inner whorl is complete and the small/large choice is due. */
  innerComplete(): boolean {
    return this.record.petals.filter((p) => p.row === 0).length >= ROWS[0].count;
  }

  outerComplete(): boolean {
    return this.record.petals.filter((p) => p.row === 1).length >= ROWS[1].count;
  }

  /** Start depositing a new petal at the nail's current angle. */
  beginPetal(nailAngle: number, color: CreamColorId): void {
    if (this.live) this.endPetal();
    const row = this.nextRow();
    const cfg = ROWS[row];
    const indexInRow = this.record.petals.filter((p) => p.row === row).length;
    // Small, deliberate variation so the whorl is hand-made, not stamped.
    const wob = makeRandom(this.record.petals.length * 7919 + 13);
    const record: PetalRecord = {
      row,
      startAngle: nailAngle,
      sweep: 0,
      arch: cfg.arch * (0.93 + wob() * 0.16),
      baseY: cfg.baseY * (0.94 + wob() * 0.14),
      radius: cfg.radius * (0.96 + wob() * 0.09) + (row === 1 ? indexInRow * 0.00016 : 0),
      lean: cfg.lean * (0.93 + wob() * 0.16),
      furl: cfg.furl * (0.9 + wob() * 0.2),
      band: cfg.band * (0.94 + wob() * 0.13),
      thickness: cfg.thickness,
      color,
    };
    const mesh = new PetalMesh(this.materials.cream[color]);
    mesh.mesh.name = `petal:${row}:${indexInRow}`;
    this.group.add(mesh.mesh);
    this.live = { record, mesh, flow: [], intended: cfg.span };
    this.record.petals.push(record);
  }

  /**
   * Extend the live petal. `delta` is how far the nail just turned, `flow` how
   * generously the bag is being squeezed (derived from the speed of the arc,
   * clamped to a safe range — no pressure sensing is assumed).
   */
  extendPetal(delta: number, flow: number): void {
    const live = this.live;
    if (!live || delta <= 0) return;
    live.record.sweep = Math.min(live.record.sweep + delta, live.intended * 1.02);
    live.flow.push(clamp(flow, 0.7, 1.35));
    if (live.flow.length > 240) live.flow.shift();
    this.rebuild(live);
  }

  /** Fraction of the intended sweep the live petal has covered. */
  livePetalProgress(): number {
    if (!this.live) return 0;
    return clamp(this.live.record.sweep / this.live.intended, 0, 1);
  }

  hasLivePetal(): boolean {
    return this.live !== null;
  }

  /** Stop the flow. Whatever was deposited stays exactly as it is. */
  endPetal(): void {
    const live = this.live;
    if (!live) return;
    if (live.record.sweep < 0.09) {
      // A tap that never became a stroke leaves nothing behind.
      this.group.remove(live.mesh.mesh);
      live.mesh.dispose();
      const i = this.record.petals.indexOf(live.record);
      if (i >= 0) this.record.petals.splice(i, 1);
    } else {
      this.petals.push(live);
    }
    this.live = null;
  }

  private rebuild(live: LivePetal): void {
    const n = sampleCountFor(live.record.sweep);
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : i / (n - 1);
      const travelled = t * live.record.sweep;
      const flow = live.flow.length
        ? live.flow[Math.min(live.flow.length - 1, Math.floor(t * (live.flow.length - 1)))]
        : 1;
      samplePetal(live.record, travelled, live.intended, flow, _scratch[i]);
    }
    computeSampleNormals(_scratch, n);
    live.mesh.update(_scratch, n);
  }

  /** Rebuild every petal from the record — used when a flower is restored. */
  rebuildFromRecord(): void {
    for (const p of this.petals) {
      this.group.remove(p.mesh.mesh);
      p.mesh.dispose();
    }
    this.petals = [];
    this.live = null;
    for (const rec of this.record.petals) {
      const intended = ROWS[Math.min(rec.row, ROWS.length - 1)].span;
      const mesh = new PetalMesh(this.materials.cream[rec.color]);
      this.group.add(mesh.mesh);
      const n = sampleCountFor(rec.sweep);
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : i / (n - 1);
        samplePetal(rec, t * rec.sweep, intended, 1, _scratch[i]);
      }
      computeSampleNormals(_scratch, n);
      mesh.update(_scratch, n);
      this.petals.push({ record: rec, mesh, flow: [], intended });
    }
  }

  /** Widest horizontal extent of what has actually been piped. */
  radius(): number {
    let r = 0.0058;
    for (const p of this.record.petals) {
      const outward = Math.max(0, -p.furl) * p.band * 0.42;
      r = Math.max(r, p.radius + outward + p.thickness + 0.0012);
    }
    return r;
  }

  height(): number {
    let h = 0.0100;
    for (const p of this.record.petals) {
      h = Math.max(h, p.baseY + p.arch + p.band * Math.cos(p.lean) + 0.001);
    }
    return h;
  }

  dispose(): void {
    for (const p of this.petals) p.mesh.dispose();
    if (this.live) this.live.mesh.dispose();
    this.petals = [];
    this.live = null;
    if (this.cone) {
      this.cone.geometry.dispose();
      this.cone = null;
    }
    this.group.parent?.remove(this.group);
    this.group.clear();
  }
}
