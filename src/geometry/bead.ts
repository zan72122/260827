// ============================================================
// 押出ビードのジオメトリ生成。
// - 扁平な断面（重力と下層への圧着で潰れた形）を経路に沿って押し出す
// - アクティブ層: 事前確保バッファ + drawRange 更新（毎フレームallocなし）
// - 完成層: 数層ごとに静的ジオメトリへ結合し draw call を抑える
// - aBirth / aRand 属性で「湿り→乾き」をシェーダー表現
// ============================================================

import * as THREE from 'three';
import { DIM } from '../config';
import { makeNoise1D } from '../util/math2d';

// 断面プロファイル（u: 横 -1..1, v: 縦 0..1、下面は下層へ僅かに食い込む）
// 完全な円ではなく、下が潰れ横に張り出した形状
const PROFILE_UV: [number, number][] = [
  [0.78, -0.06],
  [1.02, 0.22],
  [1.06, 0.52],
  [0.86, 0.82],
  [0.45, 0.995],
  [-0.45, 0.995],
  [-0.86, 0.82],
  [-1.06, 0.52],
  [-1.02, 0.22],
  [-0.78, -0.06],
];
const NP = PROFILE_UV.length;

// 断面の滑らか法線（2D）
const PROFILE_N: [number, number][] = (() => {
  const out: [number, number][] = [];
  for (let i = 0; i < NP; i++) {
    const a = PROFILE_UV[(i - 1 + NP) % NP];
    const b = PROFILE_UV[i];
    const c = PROFILE_UV[(i + 1) % NP];
    // 隣接エッジ法線の平均
    const e1 = [b[0] - a[0], b[1] - a[1]];
    const e2 = [c[0] - b[0], c[1] - b[1]];
    let nx = e1[1] + e2[1];
    let ny = -(e1[0] + e2[0]);
    const l = Math.hypot(nx, ny) || 1;
    out.push([nx / l, ny / l]);
  }
  return out;
})();

export interface RingInput {
  x: number; z: number;
  tx: number; tz: number;
  yBase: number;          // この層の下端の高さ
  width: number;          // ビード全幅
  height: number;         // ビード高（層高×係数）
  curv: number;
  birth: number;          // ゲーム秒
  taper: number;          // 0..1（端部の絞り）
  meniscus: number;       // 0..1 ノズル直下の盛り上がり
  layerIdx: number;
  s: number;              // 弧長（wobble用）
}

const MAX_ACTIVE_RINGS = 560;
const FLOATS_V = 3;
const BATCH_LAYERS = 8;

const wobbleN = makeNoise1D(913);

export class BeadBuilder {
  readonly group: THREE.Group;
  private mat: THREE.Material;

  // アクティブ層
  private activeGeom: THREE.BufferGeometry;
  private activeMesh: THREE.Mesh;
  private aPos: Float32Array;
  private aNrm: Float32Array;
  private aBirth: Float32Array;
  private aRand: Float32Array;
  private ringCount = 0;
  private ringInputs: RingInput[] = [];

  // 結合バッチ
  private bakedMeshes: THREE.Mesh[] = [];
  private layerMeshes: THREE.Mesh[] = [];
  private pendingPos: number[] = [];
  private pendingNrm: number[] = [];
  private pendingBirth: number[] = [];
  private pendingRand: number[] = [];
  private pendingIdx: number[] = [];
  private pendingLayers = 0;

  totalRings = 0;

  constructor(mat: THREE.Material) {
    this.group = new THREE.Group();
    this.mat = mat;
    this.aPos = new Float32Array(MAX_ACTIVE_RINGS * NP * FLOATS_V);
    this.aNrm = new Float32Array(MAX_ACTIVE_RINGS * NP * FLOATS_V);
    this.aBirth = new Float32Array(MAX_ACTIVE_RINGS * NP);
    this.aRand = new Float32Array(MAX_ACTIVE_RINGS * NP);
    this.activeGeom = new THREE.BufferGeometry();
    this.activeGeom.setAttribute('position', new THREE.BufferAttribute(this.aPos, 3));
    this.activeGeom.setAttribute('normal', new THREE.BufferAttribute(this.aNrm, 3));
    this.activeGeom.setAttribute('aBirth', new THREE.BufferAttribute(this.aBirth, 1));
    this.activeGeom.setAttribute('aRand', new THREE.BufferAttribute(this.aRand, 1));
    // インデックスは最大数まで事前構築
    const idx = new Uint32Array((MAX_ACTIVE_RINGS - 1) * NP * 6);
    let k = 0;
    for (let r = 0; r < MAX_ACTIVE_RINGS - 1; r++) {
      for (let i = 0; i < NP; i++) {
        const i2 = (i + 1) % NP;
        const a = r * NP + i, b = (r + 1) * NP + i, c = (r + 1) * NP + i2, d = r * NP + i2;
        idx[k++] = a; idx[k++] = c; idx[k++] = b;
        idx[k++] = a; idx[k++] = d; idx[k++] = c;
      }
    }
    this.activeGeom.setIndex(new THREE.BufferAttribute(idx, 1));
    this.activeGeom.setDrawRange(0, 0);
    this.activeMesh = new THREE.Mesh(this.activeGeom, mat);
    this.activeMesh.castShadow = true;
    // 積層ジオメトリは層厚がシャドウマップ解像度より細かく、
    // 受影させると自己アクネで黒くなるため受影しない
    this.activeMesh.receiveShadow = false;
    this.activeMesh.frustumCulled = false;
    this.group.add(this.activeMesh);
  }

  private writeRing(target: Float32Array, tNrm: Float32Array, tBirth: Float32Array, tRand: Float32Array, ringIdx: number, rin: RingInput): void {
    const rx = rin.tz, rz = -rin.tx; // right = up × tangent
    const halfW = rin.width / 2;
    // 曲線外側/内側の非対称（内側へ僅かに寄り、外側がわずかに伸びる）
    const shift = Math.max(-0.004, Math.min(0.004, -rin.curv * 0.0016));
    // 層ごとの微小な横ゆらぎ（実機の積層ムラ）
    const wob = wobbleN(rin.s * 2.1 + rin.layerIdx * 17.3) * 0.0035
      + wobbleN(rin.s * 9.0 + rin.layerIdx * 5.1) * 0.0012;
    const cx = rin.x + rx * (shift + wob);
    const cz = rin.z + rz * (shift + wob);
    // taper→0 で断面がほぼ点に収束し、端面が閉じる（材料の切れ方）
    const tScale = 0.05 + 0.95 * rin.taper;
    const hMen = rin.height * (1 + rin.meniscus * 0.45);
    const sag = (1 - rin.taper) * rin.height * 0.22;
    const base = ringIdx * NP;
    for (let i = 0; i < NP; i++) {
      const [pu, pv] = PROFILE_UV[i];
      const [nu, nv] = PROFILE_N[i];
      const u = pu * halfW * tScale;
      let vy = pv * hMen * tScale;
      vy -= sag * (pv > 0.4 ? 1 : pv / 0.4);
      const px = cx + rx * u;
      const py = rin.yBase + vy;
      const pz = cz + rz * u;
      const o3 = (base + i) * 3;
      target[o3] = px; target[o3 + 1] = py; target[o3 + 2] = pz;
      let nx = rx * nu, ny = nv, nz = rz * nu;
      const nl = Math.hypot(nx, ny, nz) || 1;
      tNrm[o3] = nx / nl; tNrm[o3 + 1] = ny / nl; tNrm[o3 + 2] = nz / nl;
      tBirth[base + i] = rin.birth;
      tRand[base + i] = fract(Math.sin((rin.s * 91.7 + rin.layerIdx * 3.7 + i) * 12.9898) * 43758.5453);
    }
  }

  /** リングを1つ追加（層の進行）。 */
  addRing(rin: RingInput): void {
    if (this.ringCount >= MAX_ACTIVE_RINGS - 2) this.flushActive(true);
    this.writeRing(this.aPos, this.aNrm, this.aBirth, this.aRand, this.ringCount, rin);
    this.ringInputs.push({ ...rin });
    this.ringCount++;
    this.totalRings++;
    this.commitActive();
  }

  /** 末尾リングをヘッド現在位置へ更新（ノズルとビードの隙間をなくす）。 */
  updateLiveRing(rin: RingInput): void {
    if (this.ringCount === 0) {
      this.addRing(rin);
      return;
    }
    this.writeRing(this.aPos, this.aNrm, this.aBirth, this.aRand, this.ringCount - 1, rin);
    this.ringInputs[this.ringInputs.length - 1] = { ...rin };
    this.commitActive();
  }

  private commitActive(): void {
    const posAttr = this.activeGeom.getAttribute('position') as THREE.BufferAttribute;
    const nrmAttr = this.activeGeom.getAttribute('normal') as THREE.BufferAttribute;
    const bAttr = this.activeGeom.getAttribute('aBirth') as THREE.BufferAttribute;
    const rAttr = this.activeGeom.getAttribute('aRand') as THREE.BufferAttribute;
    posAttr.needsUpdate = true;
    nrmAttr.needsUpdate = true;
    bAttr.needsUpdate = true;
    rAttr.needsUpdate = true;
    const rings = this.ringCount;
    this.activeGeom.setDrawRange(0, Math.max(0, (rings - 1)) * NP * 6);
  }

  /**
   * 層完了時: アクティブリングを層メッシュとして確定表示し、
   * 同時に結合バッファへも蓄積。BATCH_LAYERS 層ごとに
   * 層メッシュ群を1つの結合メッシュへ置き換えて draw call を抑える。
   * keepTail=true なら最後のリングを次層の起点として残す。
   */
  flushActive(keepTail: boolean): void {
    const rings = this.ringCount;
    if (rings < 2) return;
    const vertBase = this.pendingPos.length / 3;
    for (let r = 0; r < rings; r++) {
      const o = r * NP * 3;
      for (let i = 0; i < NP * 3; i++) {
        this.pendingPos.push(this.aPos[o + i]);
        this.pendingNrm.push(this.aNrm[o + i]);
      }
      const o1 = r * NP;
      for (let i = 0; i < NP; i++) {
        this.pendingBirth.push(this.aBirth[o1 + i]);
        this.pendingRand.push(this.aRand[o1 + i]);
      }
    }
    for (let r = 0; r < rings - 1; r++) {
      for (let i = 0; i < NP; i++) {
        const i2 = (i + 1) % NP;
        const a = vertBase + r * NP + i, b = vertBase + (r + 1) * NP + i;
        const c = vertBase + (r + 1) * NP + i2, d = vertBase + r * NP + i2;
        this.pendingIdx.push(a, c, b, a, d, c);
      }
    }
    this.pendingLayers++;

    // この層単体の表示メッシュ（結合までのつなぎ）
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.aPos.slice(0, rings * NP * 3), 3));
    lg.setAttribute('normal', new THREE.BufferAttribute(this.aNrm.slice(0, rings * NP * 3), 3));
    lg.setAttribute('aBirth', new THREE.BufferAttribute(this.aBirth.slice(0, rings * NP), 1));
    lg.setAttribute('aRand', new THREE.BufferAttribute(this.aRand.slice(0, rings * NP), 1));
    const lIdx: number[] = [];
    for (let r = 0; r < rings - 1; r++) {
      for (let i = 0; i < NP; i++) {
        const i2 = (i + 1) % NP;
        const a = r * NP + i, b = (r + 1) * NP + i, c = (r + 1) * NP + i2, d = r * NP + i2;
        lIdx.push(a, c, b, a, d, c);
      }
    }
    lg.setIndex(lIdx);
    const lm = new THREE.Mesh(lg, this.mat);
    lm.castShadow = true;
    lm.receiveShadow = false;
    lm.frustumCulled = false;
    this.layerMeshes.push(lm);
    this.group.add(lm);

    // アクティブをリセット（末尾リングを引き継ぎ）
    const tail = keepTail ? this.ringInputs[this.ringInputs.length - 1] : null;
    this.ringCount = 0;
    this.ringInputs.length = 0;
    if (tail) {
      this.writeRing(this.aPos, this.aNrm, this.aBirth, this.aRand, 0, tail);
      this.ringInputs.push(tail);
      this.ringCount = 1;
    }
    this.commitActive();

    if (this.pendingLayers >= BATCH_LAYERS) this.bakeBatch();
  }

  private bakeBatch(): void {
    if (this.pendingIdx.length === 0) return;
    // つなぎの層メッシュを破棄して結合メッシュへ置き換え
    for (const m of this.layerMeshes) {
      m.geometry.dispose();
      this.group.remove(m);
    }
    this.layerMeshes.length = 0;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pendingPos), 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.pendingNrm), 3));
    geom.setAttribute('aBirth', new THREE.BufferAttribute(new Float32Array(this.pendingBirth), 1));
    geom.setAttribute('aRand', new THREE.BufferAttribute(new Float32Array(this.pendingRand), 1));
    const needsU32 = this.pendingPos.length / 3 > 65535;
    geom.setIndex(new THREE.BufferAttribute(
      needsU32 ? new Uint32Array(this.pendingIdx) : new Uint16Array(this.pendingIdx), 1));
    const mesh = new THREE.Mesh(geom, this.mat);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    this.bakedMeshes.push(mesh);
    this.group.add(mesh);
    this.pendingPos.length = 0;
    this.pendingNrm.length = 0;
    this.pendingBirth.length = 0;
    this.pendingRand.length = 0;
    this.pendingIdx.length = 0;
    this.pendingLayers = 0;
  }

  /** 印刷完了時: 残りを確定 */
  finalize(): void {
    this.flushActive(false);
    this.bakeBatch();
  }

  /** 再プレイ時: すべてのGPUリソースを解放 */
  dispose(): void {
    for (const m of this.bakedMeshes) {
      m.geometry.dispose();
      this.group.remove(m);
    }
    this.bakedMeshes.length = 0;
    for (const m of this.layerMeshes) {
      m.geometry.dispose();
      this.group.remove(m);
    }
    this.layerMeshes.length = 0;
    this.pendingPos.length = 0;
    this.pendingNrm.length = 0;
    this.pendingBirth.length = 0;
    this.pendingRand.length = 0;
    this.pendingIdx.length = 0;
    this.pendingLayers = 0;
    this.ringCount = 0;
    this.ringInputs.length = 0;
    this.totalRings = 0;
    this.activeGeom.setDrawRange(0, 0);
  }

  get bakedCount(): number { return this.bakedMeshes.length; }

  /** デバッグ: 末尾リング数個の実寸（幅・高さ・下端） */
  debugExtents(count = 5): { rings: number; extents: { w: number; h: number; y0: number; y1: number }[] } {
    const out: { w: number; h: number; y0: number; y1: number }[] = [];
    const n = Math.min(count, this.ringCount);
    for (let k = this.ringCount - n; k < this.ringCount; k++) {
      let minY = 1e9, maxY = -1e9, minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
      for (let i = 0; i < NP; i++) {
        const o = (k * NP + i) * 3;
        minX = Math.min(minX, this.aPos[o]); maxX = Math.max(maxX, this.aPos[o]);
        minY = Math.min(minY, this.aPos[o + 1]); maxY = Math.max(maxY, this.aPos[o + 1]);
        minZ = Math.min(minZ, this.aPos[o + 2]); maxZ = Math.max(maxZ, this.aPos[o + 2]);
      }
      out.push({
        w: Math.hypot(maxX - minX, maxZ - minZ),
        h: maxY - minY,
        y0: minY, y1: maxY,
      });
    }
    return { rings: this.ringCount, extents: out };
  }
}

function fract(v: number): number { return v - Math.floor(v); }
