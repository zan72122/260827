import * as THREE from 'three';
import type { Profile } from './NozzleProfile';
import { clamp } from '../util/math';

export interface RingSample {
  /** section centre, world space */
  c: THREE.Vector3;
  /** unit tangent of the extrusion path */
  t: THREE.Vector3;
  /** section scale along the frame u / v axes */
  su: number;
  sv: number;
  /** extra roll about the tangent (rad) — used by the ribbon gesture */
  roll: number;
  /** uniform outward push (m) — the foot spreading on contact */
  flare: number;
  /** 0 at the cake surface, 1 well above it (drives contact shading) */
  lift: number;
  time: number;
}

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _refZ = new THREE.Vector3(0, 0, 1);
const _refX = new THREE.Vector3(1, 0, 0);

/**
 * Streaming sweep of a nozzle cross-section along the path the finger actually
 * produced. Only newly written rings are uploaded to the GPU; nothing is rebuilt
 * per frame.
 */
export class ExtrusionBuilder {
  readonly geometry = new THREE.BufferGeometry();

  private profile!: Profile;
  private stride = 0; // vertices per ring (profile.count + 1 seam duplicate)
  private maxRings: number;
  private pos!: Float32Array;
  private nor!: Float32Array;
  private uv!: Float32Array;
  private col!: Float32Array;
  private idx!: Uint32Array;

  private posAttr!: THREE.BufferAttribute;
  private norAttr!: THREE.BufferAttribute;
  private uvAttr!: THREE.BufferAttribute;
  private colAttr!: THREE.BufferAttribute;

  /** committed rings */
  private ringCount = 0;
  /** true when a preview ring occupies slot ringCount */
  private hasPreview = false;

  private centres: Float32Array;
  private lifts: Float32Array;
  private arcLen = 0;

  private frameB = new THREE.Vector3(1, 0, 0);
  private frameT = new THREE.Vector3(0, 1, 0);
  private frameReady = false;

  private minBound = new THREE.Vector3();
  private maxBound = new THREE.Vector3();

  constructor(maxRings = 620, maxProfilePoints = 96) {
    this.maxRings = maxRings;
    const maxStride = maxProfilePoints + 1;
    const maxVerts = maxRings * maxStride;
    this.pos = new Float32Array(maxVerts * 3);
    this.nor = new Float32Array(maxVerts * 3);
    this.uv = new Float32Array(maxVerts * 2);
    this.col = new Float32Array(maxVerts * 3);
    this.idx = new Uint32Array((maxRings - 1) * maxProfilePoints * 6);
    this.centres = new Float32Array(maxRings * 3);
    this.lifts = new Float32Array(maxRings);

    this.posAttr = new THREE.BufferAttribute(this.pos, 3);
    this.norAttr = new THREE.BufferAttribute(this.nor, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.norAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('normal', this.norAttr);
    this.uvAttr = new THREE.BufferAttribute(this.uv, 2);
    this.colAttr = new THREE.BufferAttribute(this.col, 3);
    this.uvAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('uv', this.uvAttr);
    this.geometry.setAttribute('color', this.colAttr);
    this.geometry.setIndex(new THREE.BufferAttribute(this.idx, 1));
    this.geometry.setDrawRange(0, 0);
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
  }

  get rings(): number {
    return this.ringCount;
  }

  get isEmpty(): boolean {
    return this.ringCount < 2;
  }

  begin(profile: Profile): void {
    this.profile = profile;
    this.stride = profile.count + 1;
    this.ringCount = 0;
    this.hasPreview = false;
    this.arcLen = 0;
    this.frameReady = false;
    this.geometry.setDrawRange(0, 0);
    this.minBound.set(Infinity, Infinity, Infinity);
    this.maxBound.set(-Infinity, -Infinity, -Infinity);
    this.buildIndices();
  }

  private buildIndices(): void {
    const p = this.profile.count;
    const s = this.stride;
    let w = 0;
    for (let i = 0; i < this.maxRings - 1; i++) {
      const a0 = i * s;
      const a1 = (i + 1) * s;
      for (let j = 0; j < p; j++) {
        this.idx[w++] = a0 + j;
        this.idx[w++] = a0 + j + 1;
        this.idx[w++] = a1 + j + 1;
        this.idx[w++] = a0 + j;
        this.idx[w++] = a1 + j + 1;
        this.idx[w++] = a1 + j;
      }
    }
    const ia = this.geometry.getIndex();
    if (ia) ia.needsUpdate = true;
  }

  /** advance the parallel-transported frame to a new tangent */
  private advanceFrame(t: THREE.Vector3, rollLock: number, segLen: number): void {
    if (!this.frameReady) {
      this.frameT.copy(t);
      const ref = Math.abs(t.dot(_refZ)) > 0.9 ? _refX : _refZ;
      this.frameB.crossVectors(t, ref).normalize();
      this.frameReady = true;
    } else {
      _q.setFromUnitVectors(this.frameT, t);
      this.frameB.applyQuaternion(_q);
      this.frameT.copy(t);
      // re-orthonormalise against drift
      this.frameB.addScaledVector(t, -this.frameB.dot(t)).normalize();
    }

    if (rollLock > 0) {
      const align = 1 - Math.abs(t.dot(_up));
      if (align > 0.08) {
        // desired v axis = world up projected into the section plane
        _v.copy(_up).addScaledVector(t, -_up.dot(t)).normalize();
        _n.crossVectors(t, this.frameB); // current v axis
        const cross = _b.crossVectors(_n, _v).dot(t);
        const dot = _n.dot(_v);
        const phi = Math.atan2(cross, dot);
        const maxStep = 26 * segLen + 0.02; // rad, rate limited by arc length
        const step = clamp(phi, -maxStep, maxStep) * rollLock * align;
        this.frameB.applyAxisAngle(t, step).normalize();
      }
    }
  }

  private writeRing(slot: number, s: RingSample, rollLock: number): void {
    const p = this.profile;
    const stride = this.stride;
    const base = slot * stride;

    if (slot > 0) {
      _v.set(
        s.c.x - this.centres[(slot - 1) * 3],
        s.c.y - this.centres[(slot - 1) * 3 + 1],
        s.c.z - this.centres[(slot - 1) * 3 + 2],
      );
    } else {
      _v.set(0, 0, 0);
    }
    const segLen = _v.length();

    // frame is only advanced for committed rings so previews never corrupt it
    const savedB = _tmpB.copy(this.frameB);
    const savedT = _tmpT.copy(this.frameT);
    const savedReady = this.frameReady;
    this.advanceFrame(s.t, rollLock, segLen);

    _b.copy(this.frameB);
    _n.crossVectors(this.frameT, _b);
    if (s.roll !== 0) {
      _b.applyAxisAngle(this.frameT, s.roll);
      _n.crossVectors(this.frameT, _b);
    }

    const arc = slot > 0 ? this.arcLen + segLen : 0;
    const shadeBase = 0.86 + 0.14 * clamp(s.lift, 0, 1);

    for (let j = 0; j < p.count; j++) {
      const pu = p.pts[j * 2] * s.su;
      const pv = p.pts[j * 2 + 1] * s.sv;
      const r = Math.hypot(pu, pv) || 1;
      const fu = pu + (pu / r) * s.flare;
      const fv = pv + (pv / r) * s.flare;
      const x = s.c.x + _b.x * fu + _n.x * fv;
      const y = s.c.y + _b.y * fu + _n.y * fv;
      const z = s.c.z + _b.z * fu + _n.z * fv;
      const o = (base + j) * 3;
      this.pos[o] = x;
      this.pos[o + 1] = y;
      this.pos[o + 2] = z;
      const uo = (base + j) * 2;
      this.uv[uo] = p.arc[j];
      this.uv[uo + 1] = arc * 90;
      // ridge tips catch light, valleys sit in their own shadow
      const sh = shadeBase * (0.80 + 0.20 * p.ridge[j]);
      this.col[o] = sh;
      this.col[o + 1] = sh;
      this.col[o + 2] = sh;
      if (x < this.minBound.x) this.minBound.x = x;
      if (y < this.minBound.y) this.minBound.y = y;
      if (z < this.minBound.z) this.minBound.z = z;
      if (x > this.maxBound.x) this.maxBound.x = x;
      if (y > this.maxBound.y) this.maxBound.y = y;
      if (z > this.maxBound.z) this.maxBound.z = z;
    }
    // seam duplicate
    const src = base * 3;
    const dst = (base + p.count) * 3;
    this.pos[dst] = this.pos[src];
    this.pos[dst + 1] = this.pos[src + 1];
    this.pos[dst + 2] = this.pos[src + 2];
    this.col[dst] = this.col[src];
    this.col[dst + 1] = this.col[src + 1];
    this.col[dst + 2] = this.col[src + 2];
    this.uv[(base + p.count) * 2] = 1;
    this.uv[(base + p.count) * 2 + 1] = arc * 90;

    this.centres[slot * 3] = s.c.x;
    this.centres[slot * 3 + 1] = s.c.y;
    this.centres[slot * 3 + 2] = s.c.z;
    this.lifts[slot] = s.lift;

    // restore the frame — the caller decides when a ring is permanent
    this.pendingB.copy(this.frameB);
    this.pendingT.copy(this.frameT);
    this.pendingReady = this.frameReady;
    this.frameB.copy(savedB);
    this.frameT.copy(savedT);
    this.frameReady = savedReady;
    this.pendingArc = arc;
  }

  private pendingB = new THREE.Vector3();
  private pendingT = new THREE.Vector3();
  private pendingReady = false;
  private pendingArc = 0;

  /** Write the ring that is currently glued to the nozzle opening. */
  setPreview(s: RingSample, rollLock: number): void {
    if (this.ringCount >= this.maxRings - 1) return;
    this.writeRing(this.ringCount, s, rollLock);
    this.hasPreview = true;
    this.refreshTail();
  }

  /** Promote the preview ring to a permanent one. */
  commit(s: RingSample, rollLock: number): void {
    if (this.ringCount >= this.maxRings - 1) return;
    this.writeRing(this.ringCount, s, rollLock);
    this.frameB.copy(this.pendingB);
    this.frameT.copy(this.pendingT);
    this.frameReady = this.pendingReady;
    this.arcLen = this.pendingArc;
    this.ringCount++;
    this.hasPreview = false;
    this.refreshTail();
  }

  private refreshTail(): void {
    const visible = this.ringCount + (this.hasPreview ? 1 : 0);
    if (visible < 2) {
      this.geometry.setDrawRange(0, 0);
      return;
    }
    const from = Math.max(0, visible - 4);
    this.recomputeNormals(from, visible - 1);
    const stride = this.stride;
    const upFrom = from * stride;
    const upCount = (visible - from) * stride;
    this.posAttr.addUpdateRange(upFrom * 3, upCount * 3);
    this.posAttr.needsUpdate = true;
    this.norAttr.addUpdateRange(upFrom * 3, upCount * 3);
    this.norAttr.needsUpdate = true;
    this.colAttr.addUpdateRange(upFrom * 3, upCount * 3);
    this.colAttr.needsUpdate = true;
    this.uvAttr.addUpdateRange(upFrom * 2, upCount * 2);
    this.uvAttr.needsUpdate = true;
    this.geometry.setDrawRange(0, (visible - 1) * this.profile.count * 6);
    this.updateBoundingSphere();
  }

  private recomputeNormals(from: number, to: number): void {
    const p = this.profile.count;
    const stride = this.stride;
    const last = to;
    for (let i = from; i <= to; i++) {
      const rowPrev = Math.max(0, i - 1);
      const rowNext = Math.min(last, i + 1);
      for (let j = 0; j < p; j++) {
        const jPrev = (j - 1 + p) % p;
        const jNext = (j + 1) % p;
        const a = (i * stride + jNext) * 3;
        const b = (i * stride + jPrev) * 3;
        const c = (rowNext * stride + j) * 3;
        const d = (rowPrev * stride + j) * 3;
        const dux = this.pos[a] - this.pos[b];
        const duy = this.pos[a + 1] - this.pos[b + 1];
        const duz = this.pos[a + 2] - this.pos[b + 2];
        let dvx = this.pos[c] - this.pos[d];
        let dvy = this.pos[c + 1] - this.pos[d + 1];
        let dvz = this.pos[c + 2] - this.pos[d + 2];
        if (rowNext === rowPrev) {
          dvx = this.frameT.x;
          dvy = this.frameT.y;
          dvz = this.frameT.z;
        }
        let nx = duy * dvz - duz * dvy;
        let ny = duz * dvx - dux * dvz;
        let nz = dux * dvy - duy * dvx;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l;
        ny /= l;
        nz /= l;
        const o = (i * stride + j) * 3;
        this.nor[o] = nx;
        this.nor[o + 1] = ny;
        this.nor[o + 2] = nz;
      }
      const base = i * stride;
      const src = base * 3;
      const dst = (base + p) * 3;
      this.nor[dst] = this.nor[src];
      this.nor[dst + 1] = this.nor[src + 1];
      this.nor[dst + 2] = this.nor[src + 2];
    }
  }

  private updateBoundingSphere(): void {
    const s = this.geometry.boundingSphere!;
    s.center.set(
      (this.minBound.x + this.maxBound.x) * 0.5,
      (this.minBound.y + this.maxBound.y) * 0.5,
      (this.minBound.z + this.maxBound.z) * 0.5,
    );
    s.radius =
      0.5 *
        Math.hypot(
          this.maxBound.x - this.minBound.x,
          this.maxBound.y - this.minBound.y,
          this.maxBound.z - this.minBound.z,
        ) +
      0.002;
  }

  /**
   * Bake the finished stroke into a tight, static geometry. Vertices carry an
   * extra "relaxed" position so the piped shape can settle a hair over the next
   * few seconds without any per-frame CPU work.
   */
  finalize(nowSeconds: number): THREE.BufferGeometry | null {
    const visible = this.ringCount + (this.hasPreview ? 1 : 0);
    if (visible < 3) return null;
    this.recomputeNormals(0, visible - 1);

    const p = this.profile.count;
    const stride = this.stride;
    const verts = visible * stride;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(this.pos.buffer.slice(0, verts * 3 * 4));
    const nor = new Float32Array(this.nor.buffer.slice(0, verts * 3 * 4));
    const uv = new Float32Array(this.uv.buffer.slice(0, verts * 2 * 4));
    const col = new Float32Array(this.col.buffer.slice(0, verts * 3 * 4));

    const relaxed = new Float32Array(verts * 3);
    const settle = new Float32Array(verts);
    const yBase = this.minBound.y;
    const height = Math.max(1e-4, this.maxBound.y - yBase);
    for (let i = 0; i < visible; i++) {
      const cx = this.centres[i * 3];
      const cy = this.centres[i * 3 + 1];
      const cz = this.centres[i * 3 + 2];
      for (let j = 0; j <= p; j++) {
        const o = (i * stride + j) * 3;
        const hFac = clamp((pos[o + 1] - yBase) / height, 0, 1);
        const rj = this.profile.ridge[j % p];
        const k = 0.055 * rj * hFac; // ridge tips ease back toward the axis
        relaxed[o] = pos[o] + (cx - pos[o]) * k;
        relaxed[o + 1] = pos[o + 1] + (cy - pos[o + 1]) * k * 0.35 - 0.00028 * hFac;
        relaxed[o + 2] = pos[o + 2] + (cz - pos[o + 2]) * k;
        settle[i * stride + j] = nowSeconds;
      }
    }

    const triCount = (visible - 1) * p * 6;
    const idx = verts > 65535 ? new Uint32Array(triCount) : new Uint16Array(triCount);
    for (let i = 0; i < triCount; i++) idx[i] = this.idx[i];

    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aRelaxed', new THREE.BufferAttribute(relaxed, 3));
    g.setAttribute('aSettle', new THREE.BufferAttribute(settle, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    return g;
  }

  clear(): void {
    this.ringCount = 0;
    this.hasPreview = false;
    this.geometry.setDrawRange(0, 0);
  }
}

const _tmpB = new THREE.Vector3();
const _tmpT = new THREE.Vector3();
