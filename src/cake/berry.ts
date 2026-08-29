import * as THREE from 'three';
import { Rng } from '../util/rng';

/**
 * A strawberry described analytically so that the same definition drives both
 * the visible mesh and the cross-section solver. No two berries share a shape.
 */
export interface BerryParams {
  /** Tip-to-shoulder length (cm). */
  length: number;
  /** Widest radius (cm). */
  radius: number;
  /** Catmull-Rom control values (0..1 of radius), tip -> shoulder. */
  profile: number[];
  lobeAmp: number;
  lobePhase: number;
  lobeCount: number;
  lobe2Amp: number;
  lobe2Phase: number;
  /** Sideways lean of the axis, so berries are not perfect solids of revolution. */
  bend: number;
  bendPhase: number;
  seed: number;
}

const DEFAULT_PROFILE = [0.0, 0.26, 0.52, 0.73, 0.89, 0.98, 1.0, 0.95, 0.8];

export function makeBerryParams(rng: Rng, sizeBias = 1): BerryParams {
  const profile = DEFAULT_PROFILE.map((v, i) => {
    if (i === 0) return 0;
    // Vary tip sharpness, shoulder width and where the berry is widest.
    const shoulder = i / (DEFAULT_PROFILE.length - 1);
    const tipVar = rng.range(-0.09, 0.1) * (1 - shoulder);
    const midVar = rng.range(-0.055, 0.055);
    const topVar = rng.range(-0.12, 0.07) * shoulder;
    return Math.max(0.02, v + tipVar + midVar + topVar);
  });
  return {
    length: rng.range(3.1, 4.3) * sizeBias,
    radius: rng.range(1.05, 1.5) * sizeBias,
    profile,
    lobeAmp: rng.range(0.03, 0.075),
    lobePhase: rng.range(0, Math.PI * 2),
    lobeCount: rng.pick([3, 4, 5]),
    lobe2Amp: rng.range(0.015, 0.04),
    lobe2Phase: rng.range(0, Math.PI * 2),
    bend: rng.range(0.0, 0.1),
    bendPhase: rng.range(0, Math.PI * 2),
    seed: rng.next(),
  };
}

function catmull(p: number[], t: number): number {
  const n = p.length - 1;
  const x = Math.max(0, Math.min(1, t)) * n;
  const i = Math.min(n - 1, Math.floor(x));
  const f = x - i;
  const p0 = p[Math.max(0, i - 1)];
  const p1 = p[i];
  const p2 = p[Math.min(n, i + 1)];
  const p3 = p[Math.min(n, i + 2)];
  const f2 = f * f;
  const f3 = f2 * f;
  return (
    0.5 *
    (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 + (-p0 + 3 * p1 - 3 * p2 + p3) * f3)
  );
}

/** Local frame: axis along +Y, tip at y=-L/2, shoulder at y=+L/2. */
export class Berry {
  readonly p: BerryParams;
  constructor(p: BerryParams) {
    this.p = p;
  }

  /** Radius of the body at normalised height s (0 tip, 1 shoulder) and angle. */
  radiusAt(s: number, theta: number): number {
    const p = this.p;
    if (s <= 0 || s >= 1) return 0;
    const base = catmull(p.profile, s);
    const lobeWeight = 0.35 + 0.65 * s;
    const lobe =
      1 +
      p.lobeAmp * Math.cos(p.lobeCount * theta + p.lobePhase) * lobeWeight +
      p.lobe2Amp * Math.cos((p.lobeCount + 3) * theta + p.lobe2Phase);
    return Math.max(0, base * p.radius * lobe);
  }

  /** Axis offset at height s: a gentle natural lean. */
  axisOffset(s: number): { x: number; z: number } {
    const b = this.p.bend * this.p.radius * (s - 0.5);
    return { x: b * Math.cos(this.p.bendPhase), z: b * Math.sin(this.p.bendPhase) };
  }

  get halfLength(): number {
    return this.p.length * 0.5;
  }

  /** Bounding sphere radius around the local origin. */
  get boundRadius(): number {
    return Math.hypot(this.p.length * 0.5, this.p.radius * 1.12);
  }

  /** Surface point of the body. */
  point(s: number, theta: number, out: THREE.Vector3): THREE.Vector3 {
    const r = this.radiusAt(s, theta);
    const off = this.axisOffset(s);
    out.set(off.x + r * Math.cos(theta), (s - 0.5) * this.p.length, off.z + r * Math.sin(theta));
    return out;
  }

  /**
   * Mesh for the berry body. `half` builds the lengthwise-cut slice used inside
   * the cake; whole berries are used for the decoration on top.
   */
  buildGeometry(half: boolean, radialSeg = 26, heightSeg = 22): THREE.BufferGeometry {
    const thetaStart = half ? Math.PI : 0;
    const thetaLen = half ? Math.PI : Math.PI * 2;
    const cols = radialSeg + 1;
    const rows = heightSeg + 1;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const v = new THREE.Vector3();
    for (let j = 0; j < rows; j++) {
      const s = j / heightSeg;
      const sClamped = 0.0025 + s * 0.995;
      for (let i = 0; i < cols; i++) {
        const th = thetaStart + (i / radialSeg) * thetaLen;
        this.point(sClamped, th, v);
        pos.push(v.x, v.y, v.z);
        uv.push(i / radialSeg, s);
      }
    }
    for (let j = 0; j < heightSeg; j++) {
      for (let i = 0; i < radialSeg; i++) {
        const a = j * cols + i;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    // Close the shoulder, or the calyx sits over an open shell.
    if (!half) {
      const top = heightSeg * cols;
      const centre = pos.length / 3;
      pos.push(0, this.halfLength * 0.995, 0);
      uv.push(0.5, 1);
      for (let i = 0; i < radialSeg; i++) idx.push(centre, top + i + 1, top + i);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }

  /** Outline of the berry in its own z = 0 plane (tip -> shoulder -> back down). */
  silhouette(heightSeg = 26): THREE.Vector2[] {
    const pts: THREE.Vector2[] = [];
    for (let j = 0; j <= heightSeg; j++) {
      const s = 0.0025 + (j / heightSeg) * 0.995;
      const off = this.axisOffset(s);
      pts.push(new THREE.Vector2(off.x + this.radiusAt(s, 0), (s - 0.5) * this.p.length));
    }
    for (let j = heightSeg; j >= 0; j--) {
      const s = 0.0025 + (j / heightSeg) * 0.995;
      const off = this.axisOffset(s);
      pts.push(new THREE.Vector2(off.x - this.radiusAt(s, Math.PI), (s - 0.5) * this.p.length));
    }
    return pts;
  }

  /** Signed field of a lengthwise slice of half-thickness `t` (negative inside). */
  signedSlab(x: number, y: number, z: number, t: number): number {
    const hl = this.halfLength;
    const axial = Math.max(-(y + hl), y - hl);
    const s = Math.min(0.998, Math.max(0.002, (y + hl) / this.p.length));
    const off = this.axisOffset(s);
    const xMax = off.x + this.radiusAt(s, 0);
    const xMin = off.x - this.radiusAt(s, Math.PI);
    const lateral = Math.max(xMin - x, x - xMax);
    return Math.max(axial, lateral, Math.abs(z) - t);
  }

  /** The two flat faces of a lengthwise slice, carrying cross-section attributes. */
  buildSlabFaces(t: number, heightSeg = 30): THREE.BufferGeometry {
    const outline = this.silhouette(heightSeg);
    const cx = outline.reduce((a, q) => a + q.x, 0) / outline.length;
    const cy = outline.reduce((a, q) => a + q.y, 0) / outline.length;
    const pos: number[] = [];
    const nor: number[] = [];
    const radial: number[] = [];
    const angle: number[] = [];
    const seed: number[] = [];
    const idx: number[] = [];
    const RINGS = [0, 0.55, 1];
    for (const side of [1, -1]) {
      const base = pos.length / 3;
      for (let ri = 0; ri < RINGS.length; ri++) {
        const k = RINGS[ri];
        if (ri === 0) {
          pos.push(cx, cy, side * t);
          nor.push(0, 0, side);
          radial.push(0);
          angle.push(0);
          seed.push(this.p.seed);
          continue;
        }
        for (const q of outline) {
          pos.push(cx + (q.x - cx) * k, cy + (q.y - cy) * k, side * t);
          nor.push(0, 0, side);
          radial.push(k);
          angle.push(Math.atan2(q.y - cy, q.x - cx));
          seed.push(this.p.seed);
        }
      }
      const n = outline.length;
      const r1 = base + 1;
      const r2 = r1 + n;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        if (side > 0) {
          idx.push(base, r1 + i, r1 + j);
          idx.push(r1 + i, r2 + i, r1 + j);
          idx.push(r1 + j, r2 + i, r2 + j);
        } else {
          idx.push(base, r1 + j, r1 + i);
          idx.push(r1 + i, r1 + j, r2 + i);
          idx.push(r1 + j, r2 + j, r2 + i);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('aRadial', new THREE.Float32BufferAttribute(radial, 1));
    g.setAttribute('aAngle', new THREE.Float32BufferAttribute(angle, 1));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }

  /** Curved skin rim around a lengthwise slice. */
  buildSlabRim(t: number, heightSeg = 30): THREE.BufferGeometry {
    const outline = this.silhouette(heightSeg);
    const n = outline.length;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const rings = [-1, -0.6, 0, 0.6, 1];
    let arc = 0;
    const arcs: number[] = [];
    for (let i = 0; i < n; i++) {
      arcs.push(arc);
      arc += outline[i].distanceTo(outline[(i + 1) % n]);
    }
    for (let ri = 0; ri < rings.length; ri++) {
      const k = rings[ri];
      const bulge = Math.cos((k * Math.PI) / 2) * 0.085;
      for (let i = 0; i < n; i++) {
        const prev = outline[(i - 1 + n) % n];
        const next = outline[(i + 1) % n];
        const tx = next.x - prev.x;
        const ty = next.y - prev.y;
        const len = Math.hypot(tx, ty) || 1;
        const nx = ty / len;
        const ny = -tx / len;
        pos.push(outline[i].x + nx * bulge, outline[i].y + ny * bulge, k * t);
        uv.push(arcs[i] / 2.4, (k * t) / 2.4 + 0.5);
      }
    }
    for (let ri = 0; ri < rings.length - 1; ri++) {
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const a = ri * n + i;
        const b = ri * n + j;
        const c = (ri + 1) * n + i;
        const d = (ri + 1) * n + j;
        idx.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }

  /** Representative achenes as real geometry, for berries seen close up. */
  buildAcheneGeometry(count = 34, rngSeed = 3): THREE.BufferGeometry {
    const rng = new Rng(Math.floor(this.p.seed * 100000) + rngSeed);
    const geos: THREE.BufferGeometry[] = [];
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const s = rng.range(0.12, 0.94);
      const th = rng.range(0, Math.PI * 2);
      this.point(s, th, v);
      this.point(s + 0.01, th, a);
      this.point(s, th + 0.01, b);
      n.copy(a).sub(v).cross(b.clone().sub(v)).normalize().multiplyScalar(-1);
      if (n.lengthSq() < 0.5) continue;
      const g = new THREE.SphereGeometry(rng.range(0.055, 0.085), 6, 4);
      g.scale(1, 1.45, 0.55);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      const spin = new THREE.Quaternion().setFromAxisAngle(n, rng.range(0, Math.PI));
      q.premultiply(spin);
      m.compose(v.clone().addScaledVector(n, -0.012), q, new THREE.Vector3(1, 1, 1));
      g.applyMatrix4(m);
      geos.push(g);
    }
    return mergeGeometries(geos);
  }

  /** Green calyx for whole decorating berries. */
  buildHullGeometry(): THREE.BufferGeometry {
    const rng = new Rng(Math.floor(this.p.seed * 77777) + 11);
    const geos: THREE.BufferGeometry[] = [];
    const leaves = rng.int(6, 8);
    const top = this.halfLength * 0.96;
    const rBase = this.radiusAt(0.985, 0) * 0.95;
    for (let i = 0; i < leaves; i++) {
      const ang = (i / leaves) * Math.PI * 2 + rng.range(-0.14, 0.14);
      const len = rBase * rng.range(0.8, 1.15);
      const wid = rBase * rng.range(0.3, 0.45);
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.quadraticCurveTo(wid, len * 0.4, 0, len);
      shape.quadraticCurveTo(-wid, len * 0.4, 0, 0);
      const g = new THREE.ShapeGeometry(shape, 8);
      const droop = rng.range(0.1, 0.5);
      const m = new THREE.Matrix4().makeRotationX(Math.PI / 2 + droop);
      g.applyMatrix4(m);
      g.applyMatrix4(new THREE.Matrix4().makeRotationY(-ang));
      g.applyMatrix4(new THREE.Matrix4().makeTranslation(0, top - 0.02, 0));
      geos.push(g);
    }
    const stem = new THREE.CylinderGeometry(0.08, 0.11, 0.55, 6);
    stem.translate(0, top + 0.22, 0);
    geos.push(stem);
    return mergeGeometries(geos);
  }
}

/** Small local merge helper (avoids pulling in the examples addon). */
export function mergeGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  if (!list.length) return out;
  let vCount = 0;
  let iCount = 0;
  for (const g of list) {
    vCount += g.getAttribute('position').count;
    iCount += g.index ? g.index.count : g.getAttribute('position').count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
  let vo = 0;
  let io = 0;
  for (const g of list) {
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const t = g.getAttribute('uv');
    pos.set(p.array as Float32Array, vo * 3);
    nor.set(n.array as Float32Array, vo * 3);
    if (t) uv.set(t.array as Float32Array, vo * 2);
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.getX(i) + vo;
    } else {
      for (let i = 0; i < p.count; i++) idx[io++] = i + vo;
    }
    vo += p.count;
  }
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}
