// 一筆入力。ポインタ→スラブ平面へのレイキャストでワールド座標を取得し、
// チョーク線として床へ描く（発光させない・カメラ固定・左右一致）。

import * as THREE from 'three';
import { DIM } from '../config';
import { RawSample } from '../path/process';
import { chalkTexture } from '../materials/textures';

const MAX_PTS = 2400;

export class StrokeInput {
  group: THREE.Group;
  enabled = false;
  onComplete: ((samples: RawSample[]) => void) | null = null;
  onStart: (() => void) | null = null;

  private canvas: HTMLCanvasElement;
  private camera: THREE.PerspectiveCamera;
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -DIM.slabTop);
  private ndc = new THREE.Vector2();
  private hit = new THREE.Vector3();

  private samples: RawSample[] = [];
  private drawing = false;
  private activePointer = -1;

  // チョークリボン
  private chalkGeom: THREE.BufferGeometry;
  private chalkPos: Float32Array;
  private chalkUV: Float32Array;
  private chalkMesh: THREE.Mesh;
  private chalkCount = 0;
  private chalkLen = 0;

  // 墨出し線（整形後の機械経路）
  private inkMesh: THREE.Mesh | null = null;

  constructor(canvas: HTMLCanvasElement, camera: THREE.PerspectiveCamera) {
    this.canvas = canvas;
    this.camera = camera;
    this.group = new THREE.Group();

    this.chalkPos = new Float32Array(MAX_PTS * 2 * 3);
    this.chalkUV = new Float32Array(MAX_PTS * 2 * 2);
    this.chalkGeom = new THREE.BufferGeometry();
    this.chalkGeom.setAttribute('position', new THREE.BufferAttribute(this.chalkPos, 3));
    this.chalkGeom.setAttribute('uv', new THREE.BufferAttribute(this.chalkUV, 2));
    const idx = new Uint32Array((MAX_PTS - 1) * 6);
    let k = 0;
    for (let i = 0; i < MAX_PTS - 1; i++) {
      const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
      idx[k++] = a; idx[k++] = b; idx[k++] = c;
      idx[k++] = b; idx[k++] = d; idx[k++] = c;
    }
    this.chalkGeom.setIndex(new THREE.BufferAttribute(idx, 1));
    this.chalkGeom.setDrawRange(0, 0);
    const tex = chalkTexture();
    tex.wrapS = THREE.RepeatWrapping;
    // 建設用マーキングクレヨン（ケール）の赤: 明るいスラブ上でも読める
    const mat = new THREE.MeshBasicMaterial({
      color: 0xc84f2e, alphaMap: tex, transparent: true, depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2,
    });
    this.chalkMesh = new THREE.Mesh(this.chalkGeom, mat);
    this.chalkMesh.frustumCulled = false;
    this.chalkMesh.renderOrder = 2;
    this.group.add(this.chalkMesh);

    canvas.addEventListener('pointerdown', this.onDown, { passive: false });
    canvas.addEventListener('pointermove', this.onMove, { passive: false });
    canvas.addEventListener('pointerup', this.onUp, { passive: false });
    canvas.addEventListener('pointercancel', this.onUp, { passive: false });
  }

  private screenToWorld(clientX: number, clientY: number): THREE.Vector3 | null {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const p = this.raycaster.ray.intersectPlane(this.plane, this.hit);
    return p ? p : null;
  }

  private onDown = (e: PointerEvent): void => {
    if (!this.enabled || this.drawing) return;
    const w = this.screenToWorld(e.clientX, e.clientY);
    if (!w) return;
    // スラブの少し外までは許容（範囲内へ整形される）
    if (Math.abs(w.x) > DIM.slabW * 0.7 || Math.abs(w.z) > DIM.slabD * 0.7) return;
    e.preventDefault();
    this.drawing = true;
    this.activePointer = e.pointerId;
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* iOS で失敗しても続行 */ }
    this.samples = [{ x: w.x, z: w.z, t: performance.now() }];
    this.chalkCount = 0;
    this.chalkLen = 0;
    this.pushChalkPoint(w.x, w.z);
    this.onStart?.();
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.drawing || e.pointerId !== this.activePointer) return;
    e.preventDefault();
    const w = this.screenToWorld(e.clientX, e.clientY);
    if (!w) return;
    const last = this.samples[this.samples.length - 1];
    const d = Math.hypot(w.x - last.x, w.z - last.z);
    if (d < 0.012) return;
    this.samples.push({ x: w.x, z: w.z, t: performance.now() });
    this.pushChalkPoint(w.x, w.z);
  };

  private onUp = (e: PointerEvent): void => {
    if (!this.drawing || e.pointerId !== this.activePointer) return;
    e.preventDefault();
    this.drawing = false;
    this.activePointer = -1;
    this.finishStroke();
  };

  private finishStroke(): void {
    const s = this.samples;
    let arc = 0;
    for (let i = 1; i < s.length; i++) arc += Math.hypot(s[i].x - s[i - 1].x, s[i].z - s[i - 1].z);
    if (arc < 0.45 || s.length < 6) {
      // 短すぎ: そのまま消して再挑戦（失敗にしない）
      this.clearChalk();
      return;
    }
    this.enabled = false;
    this.onComplete?.(s.slice());
  }

  private pushChalkPoint(x: number, z: number): void {
    if (this.chalkCount >= MAX_PTS) return;
    const i = this.chalkCount;
    const y = DIM.slabTop + 0.004;
    const HW = 0.024;
    // 進行方向に直交する幅
    let dx = 0.0, dz = 1.0;
    if (i > 0) {
      const px = this.chalkPos[(i - 1) * 6], pz = this.chalkPos[(i - 1) * 6 + 2];
      const mx = (this.chalkPos[(i - 1) * 6] + this.chalkPos[(i - 1) * 6 + 3]) / 2;
      const mz = (this.chalkPos[(i - 1) * 6 + 2] + this.chalkPos[(i - 1) * 6 + 5]) / 2;
      const vx = x - mx, vz = z - mz;
      const vl = Math.hypot(vx, vz) || 1;
      dx = -vz / vl; dz = vx / vl;
      this.chalkLen += vl;
      void px; void pz;
    }
    const o = i * 6;
    this.chalkPos[o] = x + dx * HW; this.chalkPos[o + 1] = y; this.chalkPos[o + 2] = z + dz * HW;
    this.chalkPos[o + 3] = x - dx * HW; this.chalkPos[o + 4] = y; this.chalkPos[o + 5] = z - dz * HW;
    const ou = i * 4;
    const u = this.chalkLen * 6;
    this.chalkUV[ou] = u; this.chalkUV[ou + 1] = 0;
    this.chalkUV[ou + 2] = u; this.chalkUV[ou + 3] = 1;
    this.chalkCount++;
    (this.chalkGeom.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.chalkGeom.getAttribute('uv') as THREE.BufferAttribute).needsUpdate = true;
    this.chalkGeom.setDrawRange(0, Math.max(0, this.chalkCount - 1) * 6);
  }

  clearChalk(): void {
    this.chalkCount = 0;
    this.chalkLen = 0;
    this.chalkGeom.setDrawRange(0, 0);
  }

  /** 整形後の経路を墨出し線として表示 */
  showInkLine(pts: { x: number; z: number }[], closed: boolean): void {
    this.hideInkLine();
    const n = pts.length + (closed ? 1 : 0);
    const pos = new Float32Array(n * 2 * 3);
    const y = DIM.slabTop + 0.006;
    const HW = 0.007;
    for (let i = 0; i < n; i++) {
      const p = pts[i % pts.length];
      const iq = closed ? (i + 1) % pts.length : Math.min(i + 1, pts.length - 1);
      const ip = closed ? (i - 1 + pts.length) % pts.length : Math.max(i - 1, 0);
      const q = pts[iq];
      const prev = pts[ip];
      const vx = q.x - prev.x, vz = q.z - prev.z;
      const vl = Math.hypot(vx, vz) || 1;
      const dx = -vz / vl, dz = vx / vl;
      const o = i * 6;
      pos[o] = p.x + dx * HW; pos[o + 1] = y; pos[o + 2] = p.z + dz * HW;
      pos[o + 3] = p.x - dx * HW; pos[o + 4] = y; pos[o + 5] = p.z - dz * HW;
    }
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
      idx.push(a, b, c, b, d, c);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x2c4360, transparent: true, opacity: 0.85, depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -3,
    });
    this.inkMesh = new THREE.Mesh(geom, mat);
    this.inkMesh.renderOrder = 3;
    this.inkMesh.frustumCulled = false;
    this.group.add(this.inkMesh);
  }

  hideInkLine(): void {
    if (this.inkMesh) {
      this.inkMesh.geometry.dispose();
      (this.inkMesh.material as THREE.Material).dispose();
      this.group.remove(this.inkMesh);
      this.inkMesh = null;
    }
  }

  /** テスト用: ワールド座標列を実入力と同じ経路で流し込む */
  async simulateStroke(pts: [number, number][], durMs: number): Promise<void> {
    if (!this.enabled) return;
    const t0 = performance.now();
    this.samples = [];
    this.chalkCount = 0;
    this.chalkLen = 0;
    this.drawing = true;
    this.onStart?.();
    for (let i = 0; i < pts.length; i++) {
      const t = t0 + (i / (pts.length - 1)) * durMs;
      this.samples.push({ x: pts[i][0], z: pts[i][1], t });
      this.pushChalkPoint(pts[i][0], pts[i][1]);
      if (i % 4 === 3) await new Promise(r => setTimeout(r, (durMs / pts.length) * 4));
    }
    this.drawing = false;
    this.finishStroke();
  }

  get isDrawing(): boolean { return this.drawing; }

  /** デバッグ用 */
  debugInfo(): Record<string, unknown> {
    return {
      chalkCount: this.chalkCount,
      chalkRange: this.chalkGeom.drawRange.count,
      chalkFirst: Array.from(this.chalkPos.slice(0, 6)),
      chalkVisible: this.chalkMesh.visible,
      groupVisible: this.group.visible,
      parent: this.group.parent ? this.group.parent.type : null,
      ink: this.inkMesh ? (this.inkMesh.geometry.getAttribute('position') as THREE.BufferAttribute).count : -1,
    };
  }
}
