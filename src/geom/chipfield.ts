import * as THREE from 'three';
import {
  allocChip, writeChipIndices, writeChip, hideChip, chipVertexCount,
  type ChipBuffers, type ChipParams,
} from './chip';

/** A fixed pool of shavings sharing one buffer, so nothing is allocated at run time. */
export class ChipField {
  readonly geometry = new THREE.BufferGeometry();
  readonly mesh: THREE.Mesh;
  private buf: ChipBuffers;

  constructor(readonly count: number, readonly seg: number, readonly ring: number, material: THREE.Material) {
    this.buf = allocChip(seg, ring, count);
    for (let i = 0; i < count; i++) {
      writeChipIndices(this.buf, seg, ring, i);
      hideChip(this.buf, seg, ring, i);
    }
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.buf.position, 3));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(this.buf.normal, 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(this.buf.uv, 2));
    this.geometry.setIndex(new THREE.BufferAttribute(this.buf.index, 1));
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.7, 0), 3);
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
  }

  set(i: number, p: ChipParams, cut: number, rootOut?: THREE.Vector3) {
    if (cut <= 1e-5) { this.hide(i); return; }
    writeChip(this.buf, this.seg, this.ring, i, p, cut, rootOut);
  }
  hide(i: number) { hideChip(this.buf, this.seg, this.ring, i); }

  commit(range?: [number, number]) {
    const p = this.geometry.attributes.position as THREE.BufferAttribute;
    const n = this.geometry.attributes.normal as THREE.BufferAttribute;
    const u = this.geometry.attributes.uv as THREE.BufferAttribute;
    if (range) {
      const vc = chipVertexCount(this.seg, this.ring);
      const off = range[0] * vc, len = (range[1] - range[0] + 1) * vc;
      p.addUpdateRange(off * 3, len * 3);
      n.addUpdateRange(off * 3, len * 3);
      u.addUpdateRange(off * 2, len * 2);
    }
    p.needsUpdate = true; n.needsUpdate = true; u.needsUpdate = true;
  }

  /** centroid of one cross-section, in the field's own (spindle) frame */
  sectionCentroid(chip: number, section: number, out = new THREE.Vector3()): THREE.Vector3 {
    const per = chipVertexCount(this.seg, this.ring) / (this.seg + 1);
    const base = (chip * chipVertexCount(this.seg, this.ring) + section * per) * 3;
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < per - 1; k++) {
      x += this.buf.position[base + k * 3];
      y += this.buf.position[base + k * 3 + 1];
      z += this.buf.position[base + k * 3 + 2];
    }
    return out.set(x / (per - 1), y / (per - 1), z / (per - 1));
  }

  dispose() { this.geometry.dispose(); }
}
