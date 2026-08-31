import * as THREE from 'three';
import { DIM, SECTION } from '../sim/geometry';
import { GH, GW } from '../sim/protocol';
import type { SimState } from '../sim/state';
import type { MaterialSet } from './materials';
import { canvasTexture } from './materials';

/**
 * ステンレス製の染色ラック（[S5] の形状を参考に自作）と、
 * そこに 1 枚だけ装着したスライド。
 * ラックの底からスライド下端までの高さ、スロットの間隔、槽との適合を実寸で合わせる。
 */
export class RackObject {
  group = new THREE.Group();
  slideGroup = new THREE.Group();
  sectionMesh: THREE.Mesh;
  private sectionTex: THREE.CanvasTexture;
  private sectionCtx: CanvasRenderingContext2D;
  private filmMesh: THREE.Mesh;
  private dripGroup = new THREE.Group();
  private drips: { mesh: THREE.Mesh; v: number; life: number }[] = [];

  constructor(mats: MaterialSet) {
    const R = DIM.rack;
    const wire = R.wire;

    const wireGeom = (len: number) => new THREE.CylinderGeometry(wire / 2, wire / 2, len, 6, 1);

    // --- 底部の枠（前後 2 本 + 左右 2 本）
    const addBar = (len: number, axis: 'x' | 'z', pos: THREE.Vector3, mat = mats.steel) => {
      const m = new THREE.Mesh(wireGeom(len), mat);
      m.rotation.z = axis === 'x' ? Math.PI / 2 : 0;
      if (axis === 'z') m.rotation.x = Math.PI / 2;
      m.position.copy(pos);
      m.castShadow = true;
      this.group.add(m);
      return m;
    };
    addBar(R.w, 'x', new THREE.Vector3(0, 0, -R.d / 2));
    addBar(R.w, 'x', new THREE.Vector3(0, 0, R.d / 2));
    addBar(R.d, 'z', new THREE.Vector3(-R.w / 2, 0, 0));
    addBar(R.d, 'z', new THREE.Vector3(R.w / 2, 0, 0));
    addBar(R.w, 'x', new THREE.Vector3(0, R.h - 8, -R.d / 2));
    addBar(R.w, 'x', new THREE.Vector3(0, R.h - 8, R.d / 2));

    // --- 支柱
    for (const sx of [-R.w / 2, R.w / 2]) {
      for (const sz of [-R.d / 2, R.d / 2]) {
        const m = new THREE.Mesh(wireGeom(R.h - 8), mats.steel);
        m.position.set(sx, (R.h - 8) / 2, sz);
        m.castShadow = true;
        this.group.add(m);
      }
    }

    // --- スライドを立てる仕切り（10 枚分。今回は 1 枚だけ挿す）
    for (let i = 0; i < R.slots; i++) {
      const x = (i - (R.slots - 1) / 2) * R.slotPitch;
      for (const sz of [-R.d / 2 + 6, R.d / 2 - 6]) {
        const m = new THREE.Mesh(wireGeom(R.h - 14), mats.steelDark);
        m.position.set(x, (R.h - 14) / 2, sz);
        this.group.add(m);
      }
      // 下端の受け
      const rest = new THREE.Mesh(wireGeom(R.d - 10), mats.steelDark);
      rest.rotation.x = Math.PI / 2;
      rest.position.set(x, DIM.slideRestY, 0);
      this.group.add(rest);
    }

    // --- 取っ手（上部）
    const handle = new THREE.Group();
    const hb = new THREE.Mesh(wireGeom(R.w * 0.55), mats.steel);
    hb.rotation.z = Math.PI / 2;
    hb.position.set(0, R.h + R.handleH, 0);
    handle.add(hb);
    for (const sx of [-R.w * 0.275, R.w * 0.275]) {
      const p = new THREE.Mesh(wireGeom(R.handleH), mats.steel);
      p.position.set(sx, R.h + R.handleH / 2 - 4, 0);
      handle.add(p);
      const d = new THREE.Mesh(wireGeom(Math.hypot(R.w / 2 - Math.abs(sx), 10)), mats.steel);
      d.position.set(sx * 1.6, R.h - 4, 0);
      d.rotation.z = Math.sign(sx) * 0.5;
      handle.add(d);
    }
    handle.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    this.group.add(handle);

    // --- スライド（1 枚）
    const S = DIM.slide;
    const slide = new THREE.Mesh(new THREE.BoxGeometry(S.thick, S.len, S.wid), mats.glassThin);
    slide.renderOrder = 4;
    this.slideGroup.add(slide);

    // ラベル面（すりガラス／白い紙）
    const labelTex = canvasTexture(256, 512, (ctx) => {
      ctx.fillStyle = '#f7f7f2';
      ctx.fillRect(0, 0, 256, 512);
      ctx.fillStyle = '#1b1d1f';
      ctx.font = 'bold 34px system-ui, sans-serif';
      ctx.save();
      ctx.translate(128, 256);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillText('S-2601  大腸', 0, -8);
      ctx.font = '26px system-ui, sans-serif';
      ctx.fillStyle = '#4d5358';
      ctx.fillText('H&E  4µm', 0, 30);
      ctx.restore();
    });
    const label = new THREE.Mesh(
      new THREE.BoxGeometry(S.thick + 0.06, DIM.slideLabelLen, S.wid * 0.96),
      new THREE.MeshStandardMaterial({ map: labelTex, roughness: 0.85, metalness: 0 }),
    );
    label.position.y = S.len / 2 - DIM.slideLabelLen / 2;
    this.slideGroup.add(label);

    // 切片（4µm。肉眼ではほとんど見えない薄い膜として控えめに表現する）
    const cv = document.createElement('canvas');
    cv.width = GW * 8;
    cv.height = GH * 8;
    this.sectionCtx = cv.getContext('2d')!;
    this.sectionTex = new THREE.CanvasTexture(cv);
    this.sectionTex.colorSpace = THREE.SRGBColorSpace;
    this.sectionMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(SECTION.x1 - SECTION.x0, SECTION.y1 - SECTION.y0),
      new THREE.MeshStandardMaterial({ map: this.sectionTex, transparent: true, roughness: 0.5, metalness: 0, opacity: 0.9 }),
    );
    this.sectionMesh.rotation.y = Math.PI / 2;
    this.sectionMesh.position.set(
      S.thick / 2 + 0.02,
      -S.len / 2 + (SECTION.y0 + SECTION.y1) / 2,
      (SECTION.x0 + SECTION.x1) / 2 - S.wid / 2,
    );
    this.slideGroup.add(this.sectionMesh);

    // 液膜（濡れた面と乾いた面を分ける）
    this.filmMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(S.wid * 0.98, S.len * 0.72),
      new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0, roughness: 0.02, metalness: 0, depthWrite: false }),
    );
    this.filmMesh.rotation.y = Math.PI / 2;
    this.filmMesh.position.set(S.thick / 2 + 0.05, -S.len * 0.1, 0);
    this.slideGroup.add(this.filmMesh);

    // 10 スロットのうち 5 番目に 1 枚だけ装着（他は空のまま）
    this.slideGroup.position.set(
      (4 - (R.slots - 1) / 2) * R.slotPitch,
      DIM.slideRestY + DIM.slide.len / 2,
      0,
    );
    this.slideGroup.rotation.z = 0;
    this.group.add(this.slideGroup);
    this.group.add(this.dripGroup);
  }

  /** 切片の見た目（肉眼相当）を状態から更新する。 */
  updateSection(state: SimState): void {
    const ctx = this.sectionCtx;
    const f = state.field;
    const cw = 8;
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        const i = y * GW + x;
        // 肉眼では 4µm 切片はごく淡い。色素量に応じたわずかな着色にとどめる。
        const h = f.hemaN[i] * 0.35 + f.hemaB[i] * 0.5;
        const e = f.eosin[i] * 0.5;
        const par = f.paraffin[i];
        const r = 255 - e * 46 - h * 54 - par * 6;
        const g = 255 - e * 96 - h * 62 - par * 6;
        const b = 255 - e * 60 - h * 20 - par * 2;
        const a = Math.min(0.92, 0.14 + h * 0.5 + e * 0.4 + par * 0.16);
        ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${a})`;
        ctx.clearRect(x * cw, (GH - 1 - y) * cw, cw, cw);
        ctx.fillRect(x * cw, (GH - 1 - y) * cw, cw, cw);
      }
    }
    this.sectionTex.needsUpdate = true;
  }

  /** 液膜の見え方（薄い膜・濡れ）を更新する。 */
  updateFilm(state: SimState): void {
    const total = state.film.totalVol();
    const mat = this.filmMesh.material as THREE.MeshPhysicalMaterial;
    mat.opacity = Math.min(0.36, total * 12);
  }

  /** 液切りで滴が元の槽へ落ちる。 */
  spawnDrip(worldY: number): void {
    const geo = new THREE.SphereGeometry(1.1, 8, 6);
    const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, roughness: 0.02, metalness: 0 });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(this.slideGroup.position.x, worldY, 0);
    this.dripGroup.add(m);
    this.drips.push({ mesh: m, v: 0, life: 0 });
  }

  update(dt: number, floorY: number): void {
    for (let i = this.drips.length - 1; i >= 0; i--) {
      const d = this.drips[i];
      d.v += 900 * dt;
      d.mesh.position.y -= d.v * dt;
      d.life += dt;
      const worldY = this.group.position.y + d.mesh.position.y;
      if (worldY <= floorY || d.life > 2.2) {
        this.dripGroup.remove(d.mesh);
        d.mesh.geometry.dispose();
        (d.mesh.material as THREE.Material).dispose();
        this.drips.splice(i, 1);
      }
    }
  }

  dispose(): void {
    this.sectionTex.dispose();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
  }
}
