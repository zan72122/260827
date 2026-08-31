import * as THREE from 'three';
import { DIM, SECTION } from '../sim/geometry';
import { GH, GW } from '../sim/protocol';
import type { MountResult, SimState } from '../sim/state';
import { canvasTexture, type MaterialSet } from './materials';

/**
 * 封入台。ラックから取り出した同じスライドを作業面へ置き、
 * 封入剤を押し出し、カバーガラスの接触位置と角度・速度を操作する。
 * スライドは Z 方向に長辺を向け、カバーガラスは手前側の一辺を支点に倒れる。
 */
export class MountStage {
  group = new THREE.Group();
  slideGroup = new THREE.Group();
  coverPivot = new THREE.Group();
  cover: THREE.Mesh;
  dispenser = new THREE.Group();
  private drop: THREE.Mesh;
  private mediumMesh: THREE.Mesh;
  private mediumTex: THREE.CanvasTexture;
  private mediumCtx: CanvasRenderingContext2D;
  private sectionTex: THREE.CanvasTexture;
  private sectionCtx: CanvasRenderingContext2D;
  private slipY: number = DIM.coverDefaultY;

  constructor(mats: MaterialSet) {
    const S = DIM.slide;

    // 作業面（艶消しの暗いマット。透明なガラスの縁と封入剤が読めるようにする）
    const mat = new THREE.Mesh(
      new THREE.BoxGeometry(150, 6, 132),
      new THREE.MeshStandardMaterial({ color: 0x2f3438, roughness: 0.96, metalness: 0 }),
    );
    // 天面を y=0 に合わせる（スライドはこの面の上に置かれる）
    mat.position.set(0, -3, 0);
    mat.receiveShadow = true;
    this.group.add(mat);

    // スライド（長辺 = Z）
    const slide = new THREE.Mesh(new THREE.BoxGeometry(S.wid, S.thick, S.len), mats.glassThin);
    slide.position.y = S.thick / 2;
    slide.renderOrder = 3;
    slide.castShadow = true;
    this.slideGroup.add(slide);
    // ガラスの縁: 薄い板であることが分かるよう、側面だけをわずかに強調する
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0xf4f8f6, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.92 });
    for (const [w2, d2, x2, z2] of [
      [S.wid, 0.5, 0, -S.len / 2],
      [S.wid, 0.5, 0, S.len / 2],
      [0.5, S.len, -S.wid / 2, 0],
      [0.5, S.len, S.wid / 2, 0],
    ] as const) {
      const e2 = new THREE.Mesh(new THREE.BoxGeometry(w2, S.thick, d2), edgeMat);
      e2.position.set(x2, S.thick / 2, z2);
      this.slideGroup.add(e2);
    }

    const labelTex = canvasTexture(512, 180, (ctx) => {
      ctx.fillStyle = '#f7f7f2';
      ctx.fillRect(0, 0, 512, 180);
      ctx.fillStyle = '#1b1d1f';
      ctx.font = 'bold 52px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('S-2601  大腸', 256, 74);
      ctx.font = '38px system-ui, sans-serif';
      ctx.fillStyle = '#4d5358';
      ctx.fillText('H&E  4µm', 256, 130);
    });
    const label = new THREE.Mesh(
      new THREE.BoxGeometry(S.wid * 0.96, S.thick + 0.08, DIM.slideLabelLen),
      new THREE.MeshStandardMaterial({ map: labelTex, roughness: 0.85, metalness: 0 }),
    );
    label.position.set(0, S.thick / 2, S.len / 2 - DIM.slideLabelLen / 2);
    this.slideGroup.add(label);

    // 切片
    const cv = document.createElement('canvas');
    cv.width = GW * 8;
    cv.height = GH * 8;
    this.sectionCtx = cv.getContext('2d')!;
    this.sectionTex = new THREE.CanvasTexture(cv);
    this.sectionTex.colorSpace = THREE.SRGBColorSpace;
    const sec = new THREE.Mesh(
      new THREE.PlaneGeometry(SECTION.x1 - SECTION.x0, SECTION.y1 - SECTION.y0),
      new THREE.MeshStandardMaterial({ map: this.sectionTex, transparent: true, roughness: 0.5, metalness: 0 }),
    );
    sec.rotation.x = -Math.PI / 2;
    sec.position.set((SECTION.x0 + SECTION.x1) / 2 - S.wid / 2, S.thick + 0.02, -(S.len / 2) + (SECTION.y0 + SECTION.y1) / 2);
    this.slideGroup.add(sec);

    // 封入剤の広がり（カバーガラスとスライドの間）
    const mcv = document.createElement('canvas');
    mcv.width = 128;
    mcv.height = 256;
    this.mediumCtx = mcv.getContext('2d')!;
    this.mediumTex = new THREE.CanvasTexture(mcv);
    this.mediumTex.colorSpace = THREE.SRGBColorSpace;
    this.mediumMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(DIM.cover.wid, DIM.cover.len),
      new THREE.MeshPhysicalMaterial({ map: this.mediumTex, transparent: true, roughness: 0.06, metalness: 0, depthWrite: false, opacity: 0 }),
    );
    this.mediumMesh.rotation.x = -Math.PI / 2;
    this.mediumMesh.position.set(0, S.thick + 0.05, 0);
    this.slideGroup.add(this.mediumMesh);

    this.group.add(this.slideGroup);

    // 封入剤の液滴
    this.drop = new THREE.Mesh(
      new THREE.SphereGeometry(1, 20, 14),
      new THREE.MeshPhysicalMaterial({ color: 0xfaf6e8, transparent: true, opacity: 0.6, roughness: 0.02, metalness: 0, ior: 1.5, envMapIntensity: 1.6 }),
    );
    this.drop.scale.set(0.001, 0.001, 0.001);
    this.drop.position.set(0, S.thick, 0);
    this.slideGroup.add(this.drop);

    // カバーガラス（24 x 50 mm、厚さ 0.17 mm。薄い板として見せる）
    this.cover = new THREE.Mesh(new THREE.BoxGeometry(DIM.cover.wid, DIM.cover.thick, DIM.cover.len), mats.glassThin);
    this.cover.position.set(0, DIM.cover.thick / 2, DIM.cover.len / 2);
    this.cover.renderOrder = 6;
    this.cover.castShadow = true;
    const cEdge = new THREE.MeshStandardMaterial({ color: 0xf6fbf9, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.95 });
    for (const [w3, d3, x3, z3] of [
      [DIM.cover.wid, 0.4, 0, -DIM.cover.len / 2],
      [DIM.cover.wid, 0.4, 0, DIM.cover.len / 2],
      [0.4, DIM.cover.len, -DIM.cover.wid / 2, 0],
      [0.4, DIM.cover.len, DIM.cover.wid / 2, 0],
    ] as const) {
      const e3 = new THREE.Mesh(new THREE.BoxGeometry(w3, DIM.cover.thick, d3), cEdge);
      e3.position.set(x3, 0, z3);
      this.cover.add(e3);
    }
    this.coverPivot.add(this.cover);
    this.coverPivot.position.set(0, S.thick, -S.len / 2 + this.slipY);
    this.group.add(this.coverPivot);

    // 封入剤の容器（ノズル付き）
    // 容器はノズル先端をグループ原点に置き、本体を奥・右へ傾けて持つ（切片の上を塞がない）
    const inner = new THREE.Group();
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.8, 6, 10), new THREE.MeshStandardMaterial({ color: 0xd6d4cd, roughness: 0.4 }));
    tip.position.y = 3;
    inner.add(tip);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3.8, 12, 12), new THREE.MeshStandardMaterial({ color: 0xe8e6df, roughness: 0.45 }));
    neck.position.y = 12;
    inner.add(neck);
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(7, 8, 28, 18),
      new THREE.MeshStandardMaterial({ color: 0xf6f4ee, roughness: 0.4, metalness: 0, transparent: true, opacity: 0.9 }),
    );
    body.position.y = 32;
    inner.add(body);
    inner.rotation.set(-0.55, 0, 0.5);
    this.dispenser.add(inner);
    this.dispenser.position.set(0, 5, 0);
    this.dispenser.visible = false;
    this.group.add(this.dispenser);
  }

  setDispenser(visible: boolean, xMm: number, yMm: number): void {
    this.dispenser.visible = visible;
    this.dispenser.position.set(xMm, 5, -DIM.slide.len / 2 + yMm);
  }

  /** 押し出した量に応じて液滴を大きくする。 */
  setVolume(ul: number, xMm: number, yMm: number): void {
    const r = Math.max(0.001, Math.cbrt((ul * 3) / (4 * Math.PI)) * 1.9);
    this.drop.scale.set(r, r * 0.45, r);
    this.drop.position.set(xMm, DIM.slide.thick + r * 0.2, -DIM.slide.len / 2 + yMm);
  }

  /** カバーガラスの接触辺の位置（スライド下端からの mm）。 */
  setSlipY(mm: number): void {
    this.slipY = mm;
    this.coverPivot.position.z = -DIM.slide.len / 2 + mm;
  }

  getSlipY(): number {
    return this.slipY;
  }

  /** カバーガラスの角度（度）。0 でスライドに接する。 */
  setAngle(deg: number): void {
    this.coverPivot.rotation.x = -THREE.MathUtils.degToRad(deg);
  }

  /** 封入結果を、カバーガラスの下の被覆・気泡として表示する。 */
  showResult(res: MountResult | null): void {
    const mm = this.mediumMesh.material as THREE.MeshPhysicalMaterial;
    if (!res) {
      mm.opacity = 0;
      return;
    }
    const ctx = this.mediumCtx;
    ctx.clearRect(0, 0, 128, 256);
    // 切片の範囲だけ状態が分かるので、その範囲を描き、外側は被覆済みとして薄く塗る
    ctx.fillStyle = 'rgba(252,250,242,0.55)';
    ctx.fillRect(0, 0, 128, 256);
    const y0 = ((SECTION.y0 - this.slipY) / DIM.cover.len) * 256;
    const y1 = ((SECTION.y1 - this.slipY) / DIM.cover.len) * 256;
    const x0 = ((SECTION.x0 - (DIM.slide.wid - DIM.cover.wid) / 2) / DIM.cover.wid) * 128;
    const x1 = ((SECTION.x1 - (DIM.slide.wid - DIM.cover.wid) / 2) / DIM.cover.wid) * 128;
    const cw = (x1 - x0) / GW;
    const ch = (y1 - y0) / GH;
    for (let gy = 0; gy < GH; gy++) {
      for (let gx = 0; gx < GW; gx++) {
        const i = gy * GW + gx;
        const air = res.air[i];
        const cov = res.coverage[i];
        const px = x0 + gx * cw;
        const py = 256 - (y0 + (gy + 1) * ch);
        if (air > 0.3) ctx.fillStyle = `rgba(255,255,255,${0.15 + 0.5 * air})`;
        else if (cov < 0.5) ctx.fillStyle = 'rgba(228,222,205,0.75)';
        else ctx.fillStyle = 'rgba(252,250,242,0.5)';
        ctx.fillRect(px, py, cw + 1, ch + 1);
      }
    }
    this.mediumTex.needsUpdate = true;
    mm.opacity = 1;
    this.mediumMesh.position.z = -DIM.slide.len / 2 + this.slipY + DIM.cover.len / 2;
  }

  updateSection(state: SimState): void {
    const ctx = this.sectionCtx;
    const f = state.field;
    const cw = 8;
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        const i = y * GW + x;
        const h = f.hemaN[i] * 0.35 + f.hemaB[i] * 0.5;
        const e = f.eosin[i] * 0.5;
        const par = f.paraffin[i];
        const r = 255 - e * 46 - h * 54 - par * 6;
        const g = 255 - e * 96 - h * 62 - par * 6;
        const b = 255 - e * 60 - h * 20 - par * 2;
        const a = Math.min(0.92, 0.14 + h * 0.5 + e * 0.4 + par * 0.16);
        ctx.clearRect(x * cw, (GH - 1 - y) * cw, cw, cw);
        ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${a})`;
        ctx.fillRect(x * cw, (GH - 1 - y) * cw, cw, cw);
      }
    }
    this.sectionTex.needsUpdate = true;
  }

  update(_dt: number): void {
    /* 現状アニメーションなし */
  }

  dispose(): void {
    this.mediumTex.dispose();
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
