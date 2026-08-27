import * as THREE from 'three';

/**
 * A tube mesh with fixed topology whose vertex positions are rewritten
 * every update from a polyline + per-point radii. Used by the water
 * center stream and the hoses so no geometry is allocated per frame.
 * Frames are computed with parallel transport for stability.
 */
export class DynamicTube {
  readonly geometry: THREE.BufferGeometry;
  readonly segments: number;
  readonly radial: number;
  private posAttr: THREE.BufferAttribute;
  private normAttr: THREE.BufferAttribute;

  private tmpT = new THREE.Vector3();
  private tmpT2 = new THREE.Vector3();
  private tmpN = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();

  constructor(segments: number, radial: number) {
    this.segments = segments;
    this.radial = radial;
    const rings = segments + 1;
    const vertCount = rings * (radial + 1);
    const positions = new Float32Array(vertCount * 3);
    const normals = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);
    const indices: number[] = [];

    for (let i = 0; i < rings; i++) {
      for (let j = 0; j <= radial; j++) {
        const vi = i * (radial + 1) + j;
        uvs[vi * 2] = i / segments;
        uvs[vi * 2 + 1] = j / radial;
      }
    }
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < radial; j++) {
        const a = i * (radial + 1) + j;
        const b = a + radial + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    this.geometry = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(positions, 3);
    this.normAttr = new THREE.BufferAttribute(normals, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.normAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('normal', this.normAttr);
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.geometry.setIndex(indices);
  }

  /** points.length must be segments+1; radii same length */
  update(points: THREE.Vector3[], radii: number[]): void {
    const { segments, radial } = this;
    const pos = this.posAttr.array as Float32Array;
    const nrm = this.normAttr.array as Float32Array;

    // parallel-transport frames
    const tan = this.tmpT;
    const prevTan = this.tmpT2;
    const n = this.tmpN;
    const b = this.tmpB;

    for (let i = 0; i <= segments; i++) {
      const p = points[i];
      const pPrev = points[Math.max(0, i - 1)];
      const pNext = points[Math.min(segments, i + 1)];
      tan.subVectors(pNext, pPrev);
      if (tan.lengthSq() < 1e-10) tan.set(0, 0, 1);
      tan.normalize();

      if (i === 0) {
        // choose an initial normal perpendicular to the tangent
        n.set(0, 1, 0);
        if (Math.abs(tan.dot(n)) > 0.9) n.set(1, 0, 0);
        b.crossVectors(tan, n).normalize();
        n.crossVectors(b, tan).normalize();
      } else {
        // rotate frame from previous tangent to current
        this.tmpQ.setFromUnitVectors(prevTan, tan);
        n.applyQuaternion(this.tmpQ).normalize();
        b.crossVectors(tan, n).normalize();
      }
      prevTan.copy(tan);

      const r = radii[i];
      for (let j = 0; j <= radial; j++) {
        const theta = (j / radial) * Math.PI * 2;
        const c = Math.cos(theta), s = Math.sin(theta);
        const v = this.tmpV;
        v.set(
          n.x * c + b.x * s,
          n.y * c + b.y * s,
          n.z * c + b.z * s,
        );
        const vi = (i * (radial + 1) + j) * 3;
        pos[vi] = p.x + v.x * r;
        pos[vi + 1] = p.y + v.y * r;
        pos[vi + 2] = p.z + v.z * r;
        nrm[vi] = v.x; nrm[vi + 1] = v.y; nrm[vi + 2] = v.z;
      }
    }
    this.posAttr.needsUpdate = true;
    this.normAttr.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }
}
