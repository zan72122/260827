import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GestureKind } from '../piping/GestureClassifier';
import type { NozzleId } from '../piping/NozzleProfile';

export interface Decoration {
  kind: GestureKind;
  nozzle: NozzleId;
  /** the trajectory the child actually drew, kept so the run can be replayed */
  trajectory: Float32Array;
  centreX: number;
  centreZ: number;
  radius: number;
  geometry: THREE.BufferGeometry;
}

/**
 * Everything the child has piped. The newest stroke stays a separate mesh so a
 * single undo is always possible; older ones are merged in batches so the draw
 * call count stays flat no matter how many shapes end up on the cake.
 */
export class DecorationHistory {
  readonly group = new THREE.Group();
  private items: Decoration[] = [];
  private latestMesh: THREE.Mesh | null = null;
  private pending: THREE.BufferGeometry[] = [];
  private mergedMesh: THREE.Mesh | null = null;
  private mergedGeo: THREE.BufferGeometry | null = null;

  constructor(private material: THREE.Material, private batchSize = 6) {
    this.group.name = 'decorations';
  }

  get count(): number {
    return this.items.length;
  }

  get list(): readonly Decoration[] {
    return this.items;
  }

  get drawCalls(): number {
    return (this.mergedMesh ? 1 : 0) + (this.pending.length ? 1 : 0) + (this.latestMesh ? 1 : 0);
  }

  add(d: Decoration): void {
    if (this.latestMesh) this.retire(this.latestMesh);
    const mesh = new THREE.Mesh(d.geometry, this.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    this.group.add(mesh);
    this.latestMesh = mesh;
    this.items.push(d);
  }

  private retire(mesh: THREE.Mesh): void {
    this.group.remove(mesh);
    this.pending.push(mesh.geometry as THREE.BufferGeometry);
    if (this.pending.length >= this.batchSize) this.flush();
    else this.rebuildPendingMesh();
  }

  private pendingMesh: THREE.Mesh | null = null;

  private rebuildPendingMesh(): void {
    if (this.pendingMesh) {
      this.group.remove(this.pendingMesh);
      this.pendingMesh.geometry.dispose();
      this.pendingMesh = null;
    }
    if (!this.pending.length) return;
    const merged = mergeGeometries(this.pending, false);
    if (!merged) return;
    const m = new THREE.Mesh(merged, this.material);
    m.castShadow = true;
    m.receiveShadow = true;
    this.group.add(m);
    this.pendingMesh = m;
  }

  private flush(): void {
    const parts: THREE.BufferGeometry[] = [];
    if (this.mergedGeo) parts.push(this.mergedGeo);
    parts.push(...this.pending);
    const merged = mergeGeometries(parts, false);
    if (!merged) return;
    if (this.mergedMesh) {
      this.group.remove(this.mergedMesh);
      this.mergedMesh.geometry.dispose();
    }
    if (this.pendingMesh) {
      this.group.remove(this.pendingMesh);
      this.pendingMesh.geometry.dispose();
      this.pendingMesh = null;
    }
    for (const g of this.pending) g.dispose();
    this.pending.length = 0;
    this.mergedGeo = merged;
    this.mergedMesh = new THREE.Mesh(merged, this.material);
    this.mergedMesh.castShadow = true;
    this.mergedMesh.receiveShadow = true;
    this.group.add(this.mergedMesh);
  }

  /** Remove only the most recent stroke. */
  undo(): Decoration | null {
    if (!this.latestMesh || !this.items.length) return null;
    this.group.remove(this.latestMesh);
    this.latestMesh.geometry.dispose();
    this.latestMesh = null;
    return this.items.pop() ?? null;
  }

  toJSON(): unknown {
    return this.items.map((d) => ({
      kind: d.kind,
      nozzle: d.nozzle,
      trajectory: Array.from(d.trajectory),
    }));
  }
}
