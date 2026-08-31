import * as THREE from 'three';
import { MAX_SAMPLES, type PetalSample } from './petalPath';

/**
 * A single petal, as a solid.
 *
 * The cross-section is a closed loop: across the front face from the thick root
 * to the thin free edge, then back along the rear face. Lofting those loops
 * along the tip's path gives a ribbon with a real root, a real edge with real
 * thickness, a front and a back that differ, and enough body to occlude the
 * petal beneath it. Seen edge-on it is still a solid; there is no card, no
 * sprite and no sphere anywhere in it.
 *
 * The buffers are allocated once at full size and refilled as the child pipes,
 * so a growing petal costs no allocations and leaks nothing when it is thrown
 * away.
 */

/** Points across the band, root to free edge. */
const V = 10;
/** Points around one cross-section loop. */
const RING = (V + 1) * 2;
/** Thinnest the free edge ever gets, in metres. Thin, but never zero. */
const EDGE_MIN = 0.00032;

const MAX_VERTS = MAX_SAMPLES * RING + 2;
const MAX_INDICES = (MAX_SAMPLES - 1) * RING * 6 + RING * 3 * 2;

export class PetalMesh {
  readonly mesh: THREE.Mesh;
  private readonly positions: Float32Array;
  private readonly normals: Float32Array;
  private readonly uvs: Float32Array;
  private readonly indices: Uint32Array;
  private readonly geometry: THREE.BufferGeometry;
  private rings = 0;

  constructor(material: THREE.Material) {
    this.positions = new Float32Array(MAX_VERTS * 3);
    this.normals = new Float32Array(MAX_VERTS * 3);
    this.uvs = new Float32Array(MAX_VERTS * 2);
    this.indices = new Uint32Array(MAX_INDICES);

    this.geometry = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(this.positions, 3);
    pos.setUsage(THREE.DynamicDrawUsage);
    const nor = new THREE.BufferAttribute(this.normals, 3);
    nor.setUsage(THREE.DynamicDrawUsage);
    const idx = new THREE.BufferAttribute(this.indices, 1);
    idx.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', pos);
    this.geometry.setAttribute('normal', nor);
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(this.uvs, 2));
    this.geometry.setIndex(idx);
    this.geometry.setDrawRange(0, 0);
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0.06);

    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
  }

  setMaterial(m: THREE.Material): void {
    this.mesh.material = m;
  }

  /** Rebuild the solid from the given samples. */
  update(samples: PetalSample[], count: number): void {
    const n = Math.min(count, MAX_SAMPLES);
    if (n < 2) {
      this.rings = 0;
      this.geometry.setDrawRange(0, 0);
      return;
    }
    this.rings = n;
    const P = this.positions;
    const U = this.uvs;

    const c = new THREE.Vector3();
    const off = new THREE.Vector3();

    for (let i = 0; i < n; i++) {
      const s = samples[i];
      const u = i / (n - 1);
      const base = i * RING;
      // A hand-held bag never runs perfectly evenly; a slight waver along the
      // ribbon keeps the surface from reading as extruded plastic.
      const waver = Math.sin(u * 21 + i * 0.7) * 0.00022 + Math.sin(u * 47) * 0.00009;
      for (let j = 0; j <= V; j++) {
        const v = j / V;
        // Centre line of the ribbon at this point across the band. The free
        // edge furls towards or away from the flower, so the band is not flat.
        const furl = s.curl * s.band * 0.44 * v * v * (1.15 - 0.15 * v);
        c.copy(s.pos)
          .addScaledVector(s.wide, v * s.band)
          .addScaledVector(s.normal, furl + waver * v);
        // Thick at the root where the wide end of the slot sat, tapering to a
        // thin — but real — free edge.
        const half = (s.thickness * Math.pow(1 - v, 1.35) + EDGE_MIN) * 0.5;
        off.copy(s.normal).multiplyScalar(half);

        const front = (base + j) * 3;
        P[front] = c.x + off.x;
        P[front + 1] = c.y + off.y;
        P[front + 2] = c.z + off.z;
        const backJ = base + RING - 1 - j;
        const back = backJ * 3;
        P[back] = c.x - off.x;
        P[back + 1] = c.y - off.y;
        P[back + 2] = c.z - off.z;

        U[(base + j) * 2] = u;
        U[(base + j) * 2 + 1] = v * 0.5;
        U[backJ * 2] = u;
        U[backJ * 2 + 1] = 1 - v * 0.5;
      }
    }

    // Two cap centroids, appended after the rings that are in use.
    const capA = n * RING;
    const capB = capA + 1;
    this.centroid(0, capA);
    this.centroid(n - 1, capB);

    // Index: sides first, then the two fans, contiguous from zero so a single
    // draw range covers exactly what exists.
    const I = this.indices;
    let k = 0;
    for (let i = 0; i < n - 1; i++) {
      const a0 = i * RING;
      const b0 = (i + 1) * RING;
      for (let j = 0; j < RING; j++) {
        const j2 = (j + 1) % RING;
        I[k++] = a0 + j;
        I[k++] = b0 + j2;
        I[k++] = a0 + j2;
        I[k++] = a0 + j;
        I[k++] = b0 + j;
        I[k++] = b0 + j2;
      }
    }
    for (let j = 0; j < RING; j++) {
      const j2 = (j + 1) % RING;
      I[k++] = capA;
      I[k++] = j;
      I[k++] = j2;
    }
    const last = (n - 1) * RING;
    for (let j = 0; j < RING; j++) {
      const j2 = (j + 1) % RING;
      I[k++] = capB;
      I[k++] = last + j2;
      I[k++] = last + j;
    }

    this.computeNormals(n * RING + 2, k);

    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.normal as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.uv as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.index as THREE.BufferAttribute).needsUpdate = true;
    this.geometry.setDrawRange(0, k);
    this.updateBounds(n * RING + 2);
  }

  private centroid(ringIndex: number, target: number): void {
    const P = this.positions;
    let x = 0;
    let y = 0;
    let z = 0;
    const base = ringIndex * RING;
    for (let j = 0; j < RING; j++) {
      x += P[(base + j) * 3];
      y += P[(base + j) * 3 + 1];
      z += P[(base + j) * 3 + 2];
    }
    P[target * 3] = x / RING;
    P[target * 3 + 1] = y / RING;
    P[target * 3 + 2] = z / RING;
    this.uvs[target * 2] = ringIndex === 0 ? 0 : 1;
    this.uvs[target * 2 + 1] = 0.5;
  }

  private computeNormals(vertCount: number, indexCount: number): void {
    const N = this.normals;
    const P = this.positions;
    N.fill(0, 0, vertCount * 3);
    const I = this.indices;
    for (let t = 0; t < indexCount; t += 3) {
      const a = I[t] * 3;
      const b = I[t + 1] * 3;
      const c = I[t + 2] * 3;
      const abx = P[b] - P[a];
      const aby = P[b + 1] - P[a + 1];
      const abz = P[b + 2] - P[a + 2];
      const acx = P[c] - P[a];
      const acy = P[c + 1] - P[a + 1];
      const acz = P[c + 2] - P[a + 2];
      const nx = aby * acz - abz * acy;
      const ny = abz * acx - abx * acz;
      const nz = abx * acy - aby * acx;
      N[a] += nx; N[a + 1] += ny; N[a + 2] += nz;
      N[b] += nx; N[b + 1] += ny; N[b + 2] += nz;
      N[c] += nx; N[c + 1] += ny; N[c + 2] += nz;
    }
    for (let i = 0; i < vertCount; i++) {
      const o = i * 3;
      const len = Math.hypot(N[o], N[o + 1], N[o + 2]);
      if (len > 1e-12) {
        N[o] /= len;
        N[o + 1] /= len;
        N[o + 2] /= len;
      } else {
        N[o] = 0;
        N[o + 1] = 1;
        N[o + 2] = 0;
      }
    }
  }

  private updateBounds(vertCount: number): void {
    const P = this.positions;
    let maxSq = 0;
    for (let i = 0; i < vertCount; i++) {
      const o = i * 3;
      const d = P[o] * P[o] + P[o + 1] * P[o + 1] + P[o + 2] * P[o + 2];
      if (d > maxSq) maxSq = d;
    }
    const bs = this.geometry.boundingSphere!;
    bs.center.set(0, 0, 0);
    bs.radius = Math.sqrt(maxSq) + 0.002;
  }

  get ringCount(): number {
    return this.rings;
  }

  dispose(): void {
    this.geometry.dispose();
  }
}
