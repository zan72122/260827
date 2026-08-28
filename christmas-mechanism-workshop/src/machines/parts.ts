import * as THREE from 'three';

/**
 * A pool of identical fitted parts drawn in one call.  Vanes, candles and
 * wicks repeat, so they live here as instances; the loose copy a child
 * drags is a single mesh that hands over to an instance once it seats.
 */
export class SlotSet {
  readonly mesh: THREE.InstancedMesh;
  private shown: boolean[];
  private mtx = new THREE.Matrix4();
  private hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, count: number, shadows = false) {
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.castShadow = shadows;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;
    this.shown = new Array(count).fill(false);
    for (let i = 0; i < count; i++) this.mesh.setMatrixAt(i, this.hidden);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  place(i: number, pos: THREE.Vector3, quat: THREE.Quaternion, scale = 1) {
    this.mtx.compose(pos, quat, new THREE.Vector3(scale, scale, scale));
    this.mesh.setMatrixAt(i, this.mtx);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.shown[i] = true;
  }
  setMatrix(i: number, m: THREE.Matrix4) {
    this.mesh.setMatrixAt(i, m);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.shown[i] = true;
  }
  hide(i: number) {
    this.mesh.setMatrixAt(i, this.hidden);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.shown[i] = false;
  }
  isShown(i: number) { return this.shown[i]; }
}

/** A tapered wax candle plus its blackened wick, sized for a tabletop piece. */
export function candleGeometries(height: number) {
  const wax = new THREE.CylinderGeometry(0.0060, 0.0068, height, 14, 1);
  wax.translate(0, height / 2, 0);
  const wick = new THREE.CylinderGeometry(0.00060, 0.00095, 0.0105, 5);
  wick.translate(0, height + 0.0042, 0);
  return { wax, wick };
}
