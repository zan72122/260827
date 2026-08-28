import * as THREE from 'three';
import { Rng, clamp, lerp, damp, smoothstep } from '../core/rng';
import { netAlphaTexture } from '../core/textures';
import type { QualitySettings } from '../core/renderer';

const TAIL_ROWS = 5;

/**
 * Baling net. Not a transparent bag: a knitted tube under real tension that holds the
 * branches in, gathers into a bunch as it is pulled off, and leaves a slack tail the
 * child can grab.
 */
export class Net {
  readonly object = new THREE.Group();
  private readonly geo: THREE.BufferGeometry;
  private readonly mesh: THREE.Mesh;
  private readonly nearMat: THREE.MeshStandardMaterial;
  private readonly farMat: THREE.MeshStandardMaterial;
  private readonly rings: THREE.Mesh[] = [];
  private readonly ringT: number[] = [];
  private readonly ringSnap: number[] = [];
  private readonly rows: number;
  private readonly cols: number;
  private readonly pos: THREE.BufferAttribute;
  private readonly normal: THREE.BufferAttribute;
  private readonly collapse: Float32Array;
  private readonly wobble: Float32Array;
  private readonly rng = new Rng(555);
  private height = 4;
  private radiusFn: (t: number) => number = () => 0.2;

  /** 0..1 how much of the tree the net has been wrapped over. */
  wrap = 0;
  /** 0..1 release front from the butt end upward. */
  front = 0;
  /** Extra length the finger has dragged out of the tail, metres. */
  pull = 0;
  /** Rings that snapped this frame - the audio layer consumes these. */
  snaps = 0;

  constructor(quality: QualitySettings) {
    const detail = quality.tier === 'low' ? 0.6 : quality.tier === 'medium' ? 0.82 : 1;
    this.rows = TAIL_ROWS + Math.max(12, Math.round(26 * detail));
    this.cols = Math.max(10, Math.round(18 * detail));

    const verts = this.rows * (this.cols + 1);
    const positions = new Float32Array(verts * 3);
    const normals = new Float32Array(verts * 3);
    const uvs = new Float32Array(verts * 2);
    const indices: number[] = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c <= this.cols; c++) {
        const i = r * (this.cols + 1) + c;
        uvs[i * 2] = (c / this.cols) * 5;
        uvs[i * 2 + 1] = (r / this.rows) * 9;
      }
    }
    for (let r = 0; r < this.rows - 1; r++) {
      for (let c = 0; c < this.cols; c++) {
        const a = r * (this.cols + 1) + c;
        const b = a + 1;
        const d = a + this.cols + 1;
        const e = d + 1;
        indices.push(a, d, b, b, d, e);
      }
    }
    this.geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(positions, 3);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.pos);
    this.normal = new THREE.BufferAttribute(normals, 3);
    this.normal.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('normal', this.normal);
    this.geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.geo.setIndex(indices);
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2, 0), 6);

    const alpha = netAlphaTexture(quality.textureSize === 256 ? 128 : 256);
    this.nearMat = new THREE.MeshStandardMaterial({
      color: 0xe0a071,
      alphaMap: alpha,
      alphaTest: 0.38,
      side: THREE.DoubleSide,
      roughness: 0.86,
      metalness: 0,
    });
    // distance version: same weave, coarser cells and no knot detail
    const coarse = alpha.clone();
    coarse.repeat.set(0.5, 0.5);
    coarse.needsUpdate = true;
    this.farMat = new THREE.MeshStandardMaterial({
      color: 0xe0a071,
      alphaMap: coarse,
      alphaTest: 0.3,
      side: THREE.DoubleSide,
      roughness: 0.9,
      metalness: 0,
    });
    this.mesh = new THREE.Mesh(this.geo, this.nearMat);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.object.add(this.mesh);

    this.collapse = new Float32Array(this.rows);
    this.wobble = new Float32Array(this.rows);
    for (let r = 0; r < this.rows; r++) this.wobble[r] = this.rng.range(0, Math.PI * 2);

    const ringGeo = new THREE.TorusGeometry(1, 0.012, 5, 20);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xb8703c, roughness: 0.7, metalness: 0.05 });
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(ringGeo, ringMat);
      m.rotation.x = Math.PI / 2;
      m.visible = false;
      m.castShadow = false;
      this.rings.push(m);
      this.ringT.push((i + 0.5) / 7);
      this.ringSnap.push(0);
      this.object.add(m);
    }
  }

  configure(height: number, radiusFn: (t: number) => number): void {
    this.height = height;
    this.radiusFn = radiusFn;
  }

  reset(): void {
    this.wrap = 0;
    this.front = 0;
    this.pull = 0;
    this.collapse.fill(0);
    for (let i = 0; i < this.rings.length; i++) {
      this.ringSnap[i] = 0;
      this.rings[i].visible = false;
    }
    this.object.visible = false;
  }

  setLOD(near: boolean): void {
    const want = near ? this.nearMat : this.farMat;
    if (this.mesh.material !== want) this.mesh.material = want;
  }

  update(dt: number): void {
    this.snaps = 0;
    if (!this.object.visible) return;
    const bodyRows = this.rows - TAIL_ROWS;
    const arr = this.pos.array as Float32Array;
    const nrm = this.normal.array as Float32Array;
    const gatherY = -0.05 - this.pull * 0.55;

    for (let r = 0; r < this.rows; r++) {
      const body = r >= TAIL_ROWS;
      const j = r - TAIL_ROWS;
      const t = body ? j / (bodyRows - 1) : 0;
      const released = body ? this.front > t : true;
      const target = released ? 1 : 0;
      this.collapse[r] = damp(this.collapse[r], target, released ? 9 : 14, dt);
      const k = this.collapse[r];

      // wrapped height: the net only exists where the baler has already laid it
      const wrapped = body ? clamp((this.wrap - t) * 6, 0, 1) : clamp(this.wrap * 6, 0, 1);

      const tight = this.radiusFn(t) * 1.02 + 0.012;
      // netting pinches at the tension rings and bulges between them
      const pinch = 1 - 0.09 * Math.cos(t * Math.PI * 2 * this.rings.length);
      const bodyR = tight * pinch * wrapped;
      const bodyY = t * this.height;

      // gathered bunch: loose folds hanging under the butt end
      const bunchR = 0.055 + 0.05 * Math.sin(this.wobble[r] + t * 9);
      const bunchY = gatherY - (1 - t) * 0.14 - (r % 3) * 0.02;

      const tailT = body ? 0 : (TAIL_ROWS - r) / TAIL_ROWS;
      const tailR = lerp(0.05, 0.02, tailT);
      const tailY = -tailT * (0.22 + this.pull * 1.15);

      const rr = body ? lerp(bodyR, bunchR, k) : tailR * wrapped;
      const yy = body ? lerp(bodyY, bunchY, k) : tailY;
      const sway = body ? Math.sin(this.wobble[r] * 1.3) * 0.012 * k : 0;

      for (let c = 0; c <= this.cols; c++) {
        const a = (c / this.cols) * Math.PI * 2;
        const i = (r * (this.cols + 1) + c) * 3;
        const wob = 1 + (body ? Math.sin(a * 3 + this.wobble[r]) * 0.02 * (1 - k) : 0);
        arr[i] = Math.cos(a) * rr * wob + sway;
        arr[i + 1] = yy;
        arr[i + 2] = Math.sin(a) * rr * wob;
        nrm[i] = Math.cos(a);
        nrm[i + 1] = 0;
        nrm[i + 2] = Math.sin(a);
      }
    }
    this.pos.needsUpdate = true;
    this.normal.needsUpdate = true;

    for (let i = 0; i < this.rings.length; i++) {
      const t = this.ringT[i];
      const ring = this.rings[i];
      const wrapped = this.wrap > t + 0.02;
      if (!wrapped) {
        ring.visible = false;
        continue;
      }
      if (this.front > t) {
        if (this.ringSnap[i] === 0) {
          this.ringSnap[i] = 0.0001;
          this.snaps++;
        }
        this.ringSnap[i] = Math.min(1, this.ringSnap[i] + dt * 4.5);
        if (this.ringSnap[i] >= 1) {
          ring.visible = false;
          continue;
        }
        const s = smoothstep(this.ringSnap[i]);
        ring.visible = true;
        ring.position.y = lerp(t * this.height, gatherY, s);
        const r = lerp(this.radiusFn(t) * 1.03, 0.07, s);
        ring.scale.setScalar(Math.max(0.01, r));
      } else {
        ring.visible = true;
        ring.position.y = t * this.height;
        ring.scale.setScalar(Math.max(0.01, this.radiusFn(t) * 1.03));
      }
    }
  }

  dispose(): void {
    this.geo.dispose();
    this.nearMat.dispose();
    this.farMat.dispose();
    this.rings[0]?.geometry.dispose();
    (this.rings[0]?.material as THREE.Material)?.dispose();
  }
}
