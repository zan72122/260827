import * as THREE from 'three';
import { BLANK, GRAIN_PERIOD, blankRadius } from '../config';
import { entryRamp } from './chip';

const TWO_PI = Math.PI * 2;
const INV_TWO_PI = 1 / TWO_PI;

/**
 * The conical linden blank, held between centres.
 *
 * Its surface is a lathe grid whose radius is reduced exactly where shavings
 * have been raised: for a branch rooted at (yStart + cut, phi), material is
 * gone over the axial span [yStart, yStart + cut] and over the blade's width,
 * to the depth of the cut. The removed volume, the shaving's width, its
 * length and the position of its root are all driven from the same numbers,
 * so the trench can never disagree with the shaving standing in it.
 */

export interface BranchVariant {
  skew: number;
  cup: number;
  widthMul: number;
  tipMul: number;
  lenMul: number;
}

export interface RowSpec {
  /** height where every stroke in this row begins */
  yStart: number;
  length: number;
  width: number;
  depth: number;
  tipRadius: number;
  curlOpen: number;
  rake: number;
  count: number;
  /** angle of branch 0 in the blank's own frame */
  phi0: number;
  /** current stroke length per branch (0 = untouched) */
  cuts: Float64Array;
  variants: BranchVariant[];
  premade: boolean;
}

export function branchPhi(row: RowSpec, i: number): number {
  return row.phi0 + (i * Math.PI * 2) / row.count;
}

/** depth of material removed at (y, theta) by one row. */
function rowDepth(row: RowSpec, y: number, theta: number): number {
  const s = y - row.yStart;
  if (s < -1e-6) return 0;
  const r = blankRadius(y);
  let best = 0;
  for (let i = 0; i < row.count; i++) {
    const cut = row.cuts[i];
    // a short run-out past the edge: there the material is still lifting, so
    // the groove shallows into the shaving instead of ending in a wall
    const RUNOUT = 0.014;
    if (cut <= 1e-6 || s > cut + RUNOUT) continue;
    const outFade = s <= cut ? 1 : 1 - (s - cut) / RUNOUT;
    const v = row.variants[i];
    let d = theta - branchPhi(row, i);
    d -= TWO_PI * Math.round(d * INV_TWO_PI);
    const ramp = entryRamp(Math.min(s, cut), row.length);
    const hw = row.width * v.widthMul * 0.5 * (0.62 + 0.38 * ramp);
    const q = Math.abs(d * r) / hw;
    if (q >= 1) continue;
    // flat floor, short shoulder where the blade's corner ran
    const shoulder = q <= 0.86 ? 1 : 1 - (q - 0.86) / 0.14;
    const sh = shoulder * shoulder * (3 - 2 * shoulder);
    const dep = row.depth * (0.45 + 0.55 * ramp) * sh * outFade;
    if (dep > best) best = dep;
  }
  return best;
}

export class Blank {
  readonly geometry: THREE.BufferGeometry;
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh;

  private ys: Float64Array;
  private nt: number;
  private cols: number;
  private baseR: Float64Array;      // radius with the craftsman's rows already cut
  private seamTheta = Math.PI;
  private rows: RowSpec[] = [];
  private workRow: RowSpec | null = null;
  private workRingLo = 0;
  private workRingHi = 0;

  constructor(material: THREE.Material, opts: { nt: number; coarse: number; bandStep: number; workStep: number }) {
    this.nt = opts.nt;
    this.cols = opts.nt + 1;
    this.ys = new Float64Array(0);
    this.baseR = new Float64Array(0);
    this.geometry = new THREE.BufferGeometry();
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
    this.opts = opts;
  }
  private opts: { nt: number; coarse: number; bandStep: number; workStep: number };

  private built = false;

  /**
   * Build the lathe grid; dense inside the rows so trench walls stay crisp.
   * The grid never changes shape, so on a replay only the radius field is
   * recomputed -- no buffer is ever allocated twice.
   */
  build(rows: RowSpec[], workRowIndex: number) {
    this.rows = rows;
    this.workRow = rows[workRowIndex] ?? null;
    if (this.built) {
      this.bakeBase();
      this.writeAll();
      return;
    }
    const { coarse, bandStep, workStep } = this.opts;

    const set = new Set<number>();
    const add = (y: number) => set.add(Math.round(y * 100000) / 100000);
    // the turned foot and the flat base face
    add(-BLANK.footDepth - 0.02); add(-BLANK.footDepth); add(-0.04); add(-0.012); add(-0.004); add(0);
    add(BLANK.height - 0.05); add(BLANK.height - 0.012); add(BLANK.height);
    for (let y = 0; y <= BLANK.height + 1e-9; y += coarse) add(Math.min(y, BLANK.height));
    add(BLANK.height);
    rows.forEach((r, ri) => {
      const step = ri === workRowIndex ? workStep : bandStep;
      const lo = r.yStart - 0.03, hi = r.yStart + r.length + 0.05;
      for (let y = lo; y <= hi; y += step) add(y);
      add(hi);
    });
    this.ys = Float64Array.from([...set].sort((a, b) => a - b));
    this.cacheTrig();

    const nRing = this.ys.length;
    const nVert = nRing * this.cols;
    const pos = new Float32Array(nVert * 3);
    const nor = new Float32Array(nVert * 3);
    const uv = new Float32Array(nVert * 2);
    const idx = new Uint32Array((nRing - 1) * this.nt * 6);
    let o = 0;
    for (let i = 0; i < nRing - 1; i++) {
      for (let j = 0; j < this.nt; j++) {
        const a = i * this.cols + j, b = a + 1, c = a + this.cols, d = c + 1;
        idx[o++] = a; idx[o++] = c; idx[o++] = d;
        idx[o++] = a; idx[o++] = d; idx[o++] = b;
      }
    }
    this.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geometry.setIndex(new THREE.BufferAttribute(idx, 1));

    this.baseR = new Float64Array(nVert);
    this.bakeBase();
    this.built = true;

    if (this.workRow) {
      const r = this.workRow;
      this.workRingLo = this.ringIndex(r.yStart - 0.04);
      this.workRingHi = this.ringIndex(r.yStart + r.length + 0.06);
    }
    this.writeAll();
    this.geometry.computeBoundingSphere();
  }

  /** the craftsman's rows, baked into the static radius */
  private bakeBase() {
    for (let i = 0; i < this.ys.length; i++) {
      const y = this.ys[i];
      for (let j = 0; j < this.cols; j++) {
        this.baseR[i * this.cols + j] = this.profile(y) - this.premadeDepth(y, this.theta(j));
      }
    }
  }

  private cosT = new Float64Array(0);
  private sinT = new Float64Array(0);
  private thT = new Float64Array(0);
  private cacheTrig() {
    if (this.cosT.length !== this.cols) {
      this.cosT = new Float64Array(this.cols);
      this.sinT = new Float64Array(this.cols);
      this.thT = new Float64Array(this.cols);
    }
    for (let j = 0; j < this.cols; j++) {
      const th = this.seamTheta + (j * TWO_PI) / this.nt;
      this.thT[j] = th; this.cosT[j] = Math.cos(th); this.sinT[j] = Math.sin(th);
    }
  }

  private theta(j: number) { return this.thT[j]; }

  private ringIndex(y: number) {
    let lo = 0, hi = this.ys.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.ys[m] < y) lo = m + 1; else hi = m; }
    return lo;
  }

  /** turned outline of the blank, including the spigot held by the lower centre */
  private profile(y: number): number {
    if (y <= -BLANK.footDepth) return 0.004;
    if (y >= BLANK.height) return 0.004;
    if (y > BLANK.height - 0.05) {
      const k = (BLANK.height - y) / 0.05;
      return 0.004 + (Math.max(0.016, blankRadius(BLANK.height - 0.05)) - 0.004) * k;
    }
    if (y <= -0.012) return BLANK.footRadius;
    if (y < 0) return BLANK.footRadius + (blankRadius(0) - BLANK.footRadius) * ((y + 0.012) / 0.012);
    return Math.max(0.016, blankRadius(y));
  }

  private premadeDepth(y: number, th: number): number {
    let d = 0;
    for (const r of this.rows) if (r.premade) d = Math.max(d, rowDepth(r, y, th));
    return d;
  }

  private radiusAt(i: number, j: number): number {
    const base = this.baseR[i * this.cols + j];
    const r = this.workRow;
    if (!r) return base;
    return base - rowDepth(r, this.ys[i], this.theta(j));
  }

  private bandR = new Float64Array(0);
  private bandLo = -1;
  private colLo = 0;
  private colHi = 0;

  private radiusCached(i: number, j: number): number {
    if (this.bandLo >= 0) {
      const r = i - this.bandLo;
      if (r >= 0 && r < this.bandRows) return this.bandR[r * this.cols + j];
    }
    return this.radiusAt(i, j);
  }
  private bandRows = 0;

  /** analytic-ish surface normal from the radius field */
  private writeRing(i: number) {
    const pos = this.geometry.attributes.position.array as Float32Array;
    const nor = this.geometry.attributes.normal.array as Float32Array;
    const uvA = this.geometry.attributes.uv.array as Float32Array;
    const nRing = this.ys.length;
    const y = this.ys[i];
    const im = Math.max(0, i - 1), ip = Math.min(nRing - 1, i + 1);
    const dy = this.ys[ip] - this.ys[im] || 1;
    const dth = (Math.PI * 2) / this.nt;
    for (let k = this.colLo; k <= this.colHi; k++) {
      const j = this.bandLo < 0 ? k : ((k % this.nt) + this.nt) % this.nt;
      if (j >= this.cols) continue;
      const R = this.radiusCached(i, j);
      const jm = (j - 1 + this.nt) % this.nt, jp = (j + 1) % this.nt;
      const Rth = (this.radiusCached(i, jp) - this.radiusCached(i, jm)) / (2 * dth);
      const Ry = (this.radiusCached(ip, j) - this.radiusCached(im, j)) / dy;
      const ct = this.cosT[j], st = this.sinT[j];
      const o = i * this.cols + j;
      pos[o * 3] = R * ct; pos[o * 3 + 1] = y; pos[o * 3 + 2] = R * st;
      // outward normal = dP/dy  x  dP/dtheta
      const tx = Rth * ct - R * st, tz = Rth * st + R * ct;   // dP/dtheta
      const yx = Ry * ct, yz = Ry * st;                       // dP/dy = (yx, 1, yz)
      const cx = tz;
      const cy = yz * tx - yx * tz;
      const cz = -tx;
      const inv = 1 / (Math.hypot(cx, cy, cz) || 1);
      nor[o * 3] = cx * inv; nor[o * 3 + 1] = cy * inv; nor[o * 3 + 2] = cz * inv;
      if (this.bandLo >= 0 && j === 0) {
        // the seam column is a duplicate of column 0: same point, other UV
        const d = i * this.cols + this.nt;
        pos[d * 3] = pos[o * 3]; pos[d * 3 + 1] = pos[o * 3 + 1]; pos[d * 3 + 2] = pos[o * 3 + 2];
        nor[d * 3] = nor[o * 3]; nor[d * 3 + 1] = nor[o * 3 + 1]; nor[d * 3 + 2] = nor[o * 3 + 2];
      }
      // material coordinates: axial position, and true arc position around it
      uvA[o * 2] = y / GRAIN_PERIOD;
      uvA[o * 2 + 1] = ((j * TWO_PI) / this.nt) * blankRadius(Math.max(0, y)) / GRAIN_PERIOD;
    }
  }

  private writeAll() {
    this.colLo = 0; this.colHi = this.cols - 1;
    for (let i = 0; i < this.ys.length; i++) this.writeRing(i);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.normal.needsUpdate = true;
    this.geometry.attributes.uv.needsUpdate = true;
  }

  /**
   * Refresh the band the child is working in. Only the ONE face being cut can
   * have changed, so only its columns are re-evaluated: the rest of the band
   * already holds the right numbers from when those faces were cut. Every
   * radius is evaluated once into a scratch field and the normals read their
   * neighbours out of it, rather than re-deriving each one five times.
   *
   * @param phi  blank-local angle of the face being cut; omit to redo the lot
   */
  updateWorkBand(phi?: number) {
    const lo = Math.max(0, this.workRingLo - 1);
    const hi = Math.min(this.ys.length - 1, this.workRingHi + 1);
    const rlo = Math.max(0, lo - 1), rhi = Math.min(this.ys.length - 1, hi + 1);
    const rows = rhi - rlo + 1;
    if (this.bandR.length < rows * this.cols) this.bandR = new Float64Array(rows * this.cols);

    // columns to touch, as unwrapped indices around the face being cut
    let k0 = 0, k1 = this.nt;
    if (phi !== undefined && this.workRow) {
      const r = Math.max(0.02, blankRadius(this.workRow.yStart));
      const half = (this.workRow.width * 0.6) / r + 0.18;   // blade + margin
      const per = TWO_PI / this.nt;
      const mid = (phi - this.seamTheta) / per;
      const span = half / per + 2;
      k0 = Math.floor(mid - span); k1 = Math.ceil(mid + span);
      if (k1 - k0 >= this.nt) { k0 = 0; k1 = this.nt; }
    }

    this.bandLo = -1;
    this.colLo = k0; this.colHi = k1;
    for (let i = rlo; i <= rhi; i++) {
      const base = (i - rlo) * this.cols;
      for (let k = k0 - 1; k <= k1 + 1; k++) {
        const j = ((k % this.nt) + this.nt) % this.nt;
        const v = this.radiusAt(i, j);
        this.bandR[base + j] = v;
        if (j === 0) this.bandR[base + this.nt] = v;
      }
    }
    this.bandLo = rlo; this.bandRows = rows;
    for (let i = lo; i <= hi; i++) this.writeRing(i);
    this.bandLo = -1;
    this.colLo = 0; this.colHi = this.nt;

    const p = this.geometry.attributes.position as THREE.BufferAttribute;
    const n = this.geometry.attributes.normal as THREE.BufferAttribute;
    p.addUpdateRange(lo * this.cols * 3, (hi - lo + 1) * this.cols * 3);
    n.addUpdateRange(lo * this.cols * 3, (hi - lo + 1) * this.cols * 3);
    p.needsUpdate = true; n.needsUpdate = true;
  }

  /** Keep the one UV seam on the far side of the blank as it is indexed round. */
  setSeamAwayFrom(cameraAzimuth: number, blankRotation: number) {
    const want = cameraAzimuth - blankRotation + Math.PI;
    if (Math.abs(Math.atan2(Math.sin(want - this.seamTheta), Math.cos(want - this.seamTheta))) < 0.35) return;
    this.seamTheta = want;
    this.cacheTrig();
    this.bakeBase();
    this.writeAll();
  }

  /** the blank's surface radius at (y, theta) in its own frame, cuts included */
  radiusProbe(y: number, theta: number): number {
    let d = this.premadeDepth(y, theta);
    if (this.workRow) d = Math.max(d, rowDepth(this.workRow, y, theta));
    return this.profile(y) - d;
  }

  dispose() { this.geometry.dispose(); }
}
