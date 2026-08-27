import * as THREE from 'three';
import { LayRoute, Station, CABLE_RADIUS } from '../route/route';
import { makeCableMaterial } from './materials';

const RADIAL = 8;
export const BURY_LAG = 8; // metres the burial closes behind the touchdown

// --- shared tube writer (parallel-transport frames) -------------------------

// Module-level scratch: writeTube runs every frame for the catenary.
const _tangent = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _binormal = new THREE.Vector3();
const _prevTangent = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _q = new THREE.Quaternion();

function writeTube(
  centers: THREE.Vector3[],
  radius: number,
  positions: Float32Array,
  normals: Float32Array
): void {
  const n = centers.length;
  const tangent = _tangent;
  const normal = _normal;
  const binormal = _binormal;
  const prevTangent = _prevTangent;
  const tmp = _tmp;
  const q = _q;

  for (let i = 0; i < n; i++) {
    const prev = centers[Math.max(0, i - 1)];
    const next = centers[Math.min(n - 1, i + 1)];
    tangent.subVectors(next, prev);
    if (tangent.lengthSq() < 1e-10) tangent.set(1, 0, 0);
    tangent.normalize();

    if (i === 0) {
      // Any perpendicular start frame.
      tmp.set(0, 1, 0);
      if (Math.abs(tangent.dot(tmp)) > 0.95) tmp.set(1, 0, 0);
      normal.crossVectors(tangent, tmp).normalize();
    } else {
      // Rotate the previous frame by the minimal rotation between tangents.
      q.setFromUnitVectors(prevTangent, tangent);
      normal.applyQuaternion(q).normalize();
    }
    prevTangent.copy(tangent);
    binormal.crossVectors(tangent, normal).normalize();

    const c = centers[i];
    for (let j = 0; j < RADIAL; j++) {
      const th = (j / RADIAL) * Math.PI * 2;
      const nx = normal.x * Math.cos(th) + binormal.x * Math.sin(th);
      const ny = normal.y * Math.cos(th) + binormal.y * Math.sin(th);
      const nz = normal.z * Math.cos(th) + binormal.z * Math.sin(th);
      const k = (i * RADIAL + j) * 3;
      positions[k] = c.x + nx * radius;
      positions[k + 1] = c.y + ny * radius;
      positions[k + 2] = c.z + nz * radius;
      normals[k] = nx;
      normals[k + 1] = ny;
      normals[k + 2] = nz;
    }
  }
}

function tubeIndices(rings: number): Uint16Array {
  const idx = new Uint16Array((rings - 1) * RADIAL * 6);
  let k = 0;
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < RADIAL; j++) {
      const a = i * RADIAL + j;
      const b = i * RADIAL + ((j + 1) % RADIAL);
      const c = (i + 1) * RADIAL + j;
      const d = (i + 1) * RADIAL + ((j + 1) % RADIAL);
      idx[k++] = a; idx[k++] = c; idx[k++] = b;
      idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
  }
  return idx;
}

// --- burial ribbons ---------------------------------------------------------

interface BuryRun {
  i0: number; // first station index of the contiguous sand run
  i1: number; // last station index (inclusive)
  trench: THREE.Mesh;
  mound: THREE.Mesh;
}

function buildRibbon(
  stations: Station[],
  i0: number,
  i1: number,
  profile: (side: number) => { off: number; lift: number },
  color: number,
  seabedHeight: (x: number, z: number) => number
): THREE.Mesh {
  // 3 verts per ring: left edge, centre, right edge.
  const count = i1 - i0 + 1;
  const positions = new Float32Array(count * 3 * 3);
  const up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const st = stations[i0 + i];
    side.crossVectors(up, st.tangent).normalize();
    const entries = [-1, 0, 1];
    for (let e = 0; e < 3; e++) {
      const { off, lift } = profile(entries[e]);
      const x = st.pos.x + side.x * off;
      const z = st.pos.z + side.z * off;
      const ground = seabedHeight(x, z);
      const k = (i * 3 + e) * 3;
      positions[k] = x;
      positions[k + 1] = ground + lift;
      positions[k + 2] = z;
    }
  }
  const index: number[] = [];
  for (let i = 0; i < count - 1; i++) {
    for (let e = 0; e < 2; e++) {
      const a = i * 3 + e, b = i * 3 + e + 1;
      const c = (i + 1) * 3 + e, d = (i + 1) * 3 + e + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  geo.setDrawRange(0, 0);
  const mesh = new THREE.Mesh(geo, ribbonMaterial(color));
  mesh.frustumCulled = false;
  return mesh;
}

// Shared per-colour ribbon materials so rebuilds never leak materials.
const ribbonMats = new Map<number, THREE.MeshStandardMaterial>();
function ribbonMaterial(color: number): THREE.MeshStandardMaterial {
  let m = ribbonMats.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.95 });
    ribbonMats.set(color, m);
  }
  return m;
}

// --- the cable system -------------------------------------------------------

/**
 * One continuous physical cable:
 *   laid seabed tube (prebuilt, revealed with drawRange as the lay advances)
 *   + dynamic catenary tube from the touchdown point up to the ship's stern.
 * The catenary always starts exactly at the last revealed station, so the
 * cable is never broken between stern and seabed.
 */
export class CableSystem {
  readonly group = new THREE.Group();
  private laid!: THREE.Mesh;
  private catenary!: THREE.Mesh;
  private catPositions!: Float32Array;
  private catNormals!: Float32Array;
  private route: LayRoute | null = null;
  private buryRuns: BuryRun[] = [];
  private catCenters: THREE.Vector3[] = [];
  private readonly CAT_RINGS = 30;
  /** current interpolated touchdown point (for ROV + camera) */
  readonly touchdownPoint = new THREE.Vector3();
  readonly touchdownTangent = new THREE.Vector3(1, 0, 0);
  /** exact centre of the last revealed laid ring - the catenary starts here */
  private touchdownBase = new THREE.Vector3();
  touchdownS = 0;
  private lastGap = 0;
  gapSeabed = 0;
  gapStern = 0;
  private scratchHto = new THREE.Vector3();
  private scratchM0 = new THREE.Vector3();
  private scratchM1 = new THREE.Vector3();

  constructor() {
    for (let i = 0; i < this.CAT_RINGS; i++) this.catCenters.push(new THREE.Vector3());
  }

  build(route: LayRoute): void {
    this.clear();
    this.route = route;
    const st = route.stations;

    // Laid tube: full geometry now, revealed progressively.
    const positions = new Float32Array(st.length * RADIAL * 3);
    const normals = new Float32Array(st.length * RADIAL * 3);
    writeTube(st.map((x) => x.pos), CABLE_RADIUS, positions, normals);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setIndex(new THREE.BufferAttribute(tubeIndices(st.length), 1));
    geo.setDrawRange(0, 0);
    this.laid = new THREE.Mesh(geo, makeCableMaterial());
    this.laid.frustumCulled = false;
    this.group.add(this.laid);

    // Catenary tube: small dynamic geometry, rewritten every frame.
    this.catPositions = new Float32Array(this.CAT_RINGS * RADIAL * 3);
    this.catNormals = new Float32Array(this.CAT_RINGS * RADIAL * 3);
    const cgeo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(this.catPositions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    const norAttr = new THREE.BufferAttribute(this.catNormals, 3);
    norAttr.setUsage(THREE.DynamicDrawUsage);
    cgeo.setAttribute('position', posAttr);
    cgeo.setAttribute('normal', norAttr);
    cgeo.setIndex(new THREE.BufferAttribute(tubeIndices(this.CAT_RINGS), 1));
    this.catenary = new THREE.Mesh(cgeo, makeCableMaterial());
    this.catenary.frustumCulled = false;
    this.catenary.visible = false;
    this.group.add(this.catenary);

    // Burial ribbons over contiguous sand runs: an open trench that follows
    // the touchdown, and a soil mound that closes it behind.
    let runStart = -1;
    for (let i = 0; i <= st.length; i++) {
      const b = i < st.length && st[i].buriable;
      if (b && runStart < 0) runStart = i;
      if (!b && runStart >= 0) {
        const i1 = i - 1;
        if (i1 - runStart >= 3) {
          const sb = route.seabed;
          // Edge vertices are sunk BELOW the exact surface so the strips tuck
          // under the (linearly interpolated) terrain mesh instead of showing
          // floating edges on slopes.
          const trench = buildRibbon(st, runStart, i1, (side) => (
            side === 0 ? { off: 0, lift: -0.55 } : { off: 0.75, lift: -0.22 }
          ), 0x4a453a, (x, z) => sb.height(x, z));
          const mound = buildRibbon(st, runStart, i1, (side) => (
            side === 0 ? { off: 0, lift: CABLE_RADIUS * 2 + 0.35 } : { off: 1.7, lift: -0.25 }
          ), 0x9a8a6c, (x, z) => sb.height(x, z));
          this.group.add(trench, mound);
          this.buryRuns.push({ i0: runStart, i1, trench, mound });
        }
        runStart = -1;
      }
    }
  }

  /** Remove all cable meshes (replay / new plan). */
  reset(): void {
    this.clear();
    this.route = null;
  }

  private clear(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      const m = child as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    }
    this.buryRuns = [];

    this.touchdownS = 0;
  }

  /** Reveal the laid cable up to arc length s and place the touchdown point. */
  setTouchdown(s: number): void {
    if (!this.route) return;
    this.touchdownS = s;
    const st = this.route.stations;
    // At full completion the last segment (to the far anchor) must draw too.
    const idx = s >= this.route.length - 1e-3
      ? st.length - 1
      : this.route.stationIndexAt(s);

    (this.laid.geometry as THREE.BufferGeometry).setDrawRange(0, Math.max(0, idx) * RADIAL * 6);

    const a = st[idx];
    const b = st[Math.min(idx + 1, st.length - 1)];
    const t = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
    this.touchdownPoint.copy(a.pos).lerp(b.pos, THREE.MathUtils.clamp(t, 0, 1));
    this.touchdownTangent.copy(a.tangent);
    this.touchdownBase.copy(a.pos);

    // Burial reveals: trench window follows the touchdown, mound trails it.
    const moundS = s - BURY_LAG;
    const moundIdx = this.route.stationIndexAt(Math.max(0, moundS));
    for (const run of this.buryRuns) {
      const tEnd = THREE.MathUtils.clamp(idx - run.i0, 0, run.i1 - run.i0);
      const mEnd = THREE.MathUtils.clamp(moundIdx - run.i0, 0, run.i1 - run.i0);
      (run.trench.geometry as THREE.BufferGeometry).setDrawRange(mEnd * 12, Math.max(0, tEnd - mEnd) * 12);
      (run.mound.geometry as THREE.BufferGeometry).setDrawRange(0, mEnd * 12);
    }
  }

  /** Rebuild the water-column span from the touchdown to the ship's stern. */
  updateCatenary(sternWorld: THREE.Vector3, shipForward: THREE.Vector3, landingBlend: number): void {
    if (!this.route) return;
    this.catenary.visible = true;
    // Start exactly at the last drawn laid ring so the tube is never broken;
    // the ground clamp below makes the first metres hug the seabed past the
    // interpolated touchdown before the span lifts off.
    const P0 = this.touchdownBase;
    const P1 = sternWorld;
    const chord = P0.distanceTo(P1);
    if (chord < 0.5) {
      this.catenary.visible = false;
      return;
    }
    // Hermite: leaves the seabed along the route tangent, arrives at the stern
    // moving up + forward (so it continues over the sheave without a kink).
    const d = Math.max(chord * 0.55, 2);
    const hto = this.scratchHto.set(P1.x - P0.x, 0, P1.z - P0.z);
    if (hto.lengthSq() > 1e-6) hto.normalize();
    const m0 = this.scratchM0.copy(this.touchdownTangent).lerp(hto, landingBlend);
    // During the shore landing the touchdown can pass the parked ship; if the
    // blend cancels out or points away from the stern, fall back to the
    // direct horizontal so the span never hairpins.
    if (m0.lengthSq() < 0.1 || m0.dot(hto) < 0) m0.copy(hto);
    m0.normalize().multiplyScalar(d);
    const m1 = this.scratchM1.set(shipForward.x * 0.6, 1.0, shipForward.z * 0.6).normalize().multiplyScalar(d);

    for (let i = 0; i < this.CAT_RINGS; i++) {
      const t = i / (this.CAT_RINGS - 1);
      const t2 = t * t, t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      const c = this.catCenters[i];
      c.set(
        h00 * P0.x + h10 * m0.x + h01 * P1.x + h11 * m1.x,
        h00 * P0.y + h10 * m0.y + h01 * P1.y + h11 * m1.y,
        h00 * P0.z + h10 * m0.z + h01 * P1.z + h11 * m1.z
      );
      // Keep the span from tunnelling under the seabed mid-water - but never
      // detach the last rings from the stern attachment point over shallows.
      if (i < this.CAT_RINGS - 3) {
        const ground = this.route.seabed.height(c.x, c.z) + CABLE_RADIUS * 0.9;
        if (c.y < ground) c.y = ground;
      }
    }
    writeTube(this.catCenters, CABLE_RADIUS, this.catPositions, this.catNormals);
    const geo = this.catenary.geometry as THREE.BufferGeometry;
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('normal') as THREE.BufferAttribute).needsUpdate = true;

    this.gapSeabed = this.catCenters[0].distanceTo(this.touchdownBase);
    this.gapStern = this.catCenters[this.CAT_RINGS - 1].distanceTo(sternWorld);
    this.lastGap = this.gapSeabed + this.gapStern;
  }

  hideCatenary(): void {
    this.catenary.visible = false;
  }

  /** Point on the catenary (0 = touchdown, 1 = stern) for the descent camera. */
  catenaryPoint(t: number, out: THREE.Vector3): THREE.Vector3 {
    const i = THREE.MathUtils.clamp(Math.round(t * (this.CAT_RINGS - 1)), 0, this.CAT_RINGS - 1);
    return out.copy(this.catCenters[i]);
  }

  /** For the verification harness: 0 when stern/seabed spans join exactly. */
  continuityGap(): number {
    return this.lastGap;
  }
}
