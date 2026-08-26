// 小型ラフタークレーン。閉曲線の壁が完成した後、
// 事前製作の小さな屋根パネル（子どもの輪郭形状）を吊って壁上へ載せる。
// 「印刷だけで建築が完結するわけではない」ことを示す仕上げ工程。

import * as THREE from 'three';
import { DIM } from '../config';
import { WallPath } from '../path/process';
import { roughNoiseTexture } from '../materials/textures';
import { clamp, smoothstep } from '../util/math2d';

const roughTex = roughNoiseTexture(55);
function steel(color: number, rough = 0.55, metal = 0.55): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, roughnessMap: roughTex });
}

export class Crane {
  group: THREE.Group;
  private turret: THREE.Group;
  private boom: THREE.Group;
  private boomSecs: THREE.Mesh[] = [];
  private hookGroup: THREE.Group;
  private cable: THREE.Mesh;
  private roof: THREE.Mesh | null = null;
  private roofHome = new THREE.Vector3();
  private roofTarget = new THREE.Vector3();
  private slings: THREE.LineSegments | null = null;

  // アニメーション状態
  private t = 0;
  private active = false;
  private finished = false;
  private baseYaw: number;

  constructor() {
    this.group = new THREE.Group();
    this.baseYaw = -0.7;

    // 台車（トラックシャシー）
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 3.6), steel(0xd8b83a, 0.6, 0.4));
    chassis.position.y = 0.62;
    chassis.castShadow = true;
    this.group.add(chassis);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.75, 0.95), steel(0xe6e2d8, 0.5, 0.3));
    cab.position.set(0, 1.1, 1.6);
    cab.castShadow = true;
    this.group.add(cab);
    // 車輪
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.95 });
    for (const z of [-1.3, -0.5, 1.2]) {
      for (const x of [-0.72, 0.72]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.26, 14), wheelMat);
        w.rotation.z = Math.PI / 2;
        w.position.set(x, 0.32, z);
        w.castShadow = true;
        this.group.add(w);
      }
    }
    // アウトリガー（展開状態）
    for (const [x, z] of [[-1.05, -1.5], [1.05, -1.5], [-1.05, 0.9], [1.05, 0.9]]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.14, 0.14), steel(0xd8b83a, 0.6, 0.4));
      arm.position.set(x * 0.72, 0.5, z);
      this.group.add(arm);
      const jack = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 8), steel(0x555a60));
      jack.position.set(x, 0.26, z);
      this.group.add(jack);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.05, 10), steel(0x555a60));
      pad.position.set(x, 0.03, z);
      pad.castShadow = true;
      this.group.add(pad);
    }

    // 旋回体
    this.turret = new THREE.Group();
    this.turret.position.set(0, 0.95, -0.7);
    this.group.add(this.turret);
    const turretBody = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.5, 1.3), steel(0xd8b83a, 0.6, 0.4));
    turretBody.position.y = 0.25;
    turretBody.castShadow = true;
    this.turret.add(turretBody);
    // カウンターウェイト
    const cw = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.42, 0.5), steel(0x6d6f73, 0.7, 0.4));
    cw.position.set(0, 0.28, 0.85);
    cw.castShadow = true;
    this.turret.add(cw);

    // 伸縮ブーム（3段）
    this.boom = new THREE.Group();
    this.boom.position.set(0, 0.55, -0.35);
    this.turret.add(this.boom);
    const secDims: [number, number][] = [[0.3, 3.2], [0.24, 2.9], [0.18, 2.7]];
    let acc = 0;
    for (const [w, l] of secDims) {
      const sec = new THREE.Mesh(new THREE.BoxGeometry(w, w, l), steel(0xd8b83a, 0.55, 0.45));
      sec.position.z = -(acc + l / 2);
      sec.castShadow = true;
      this.boom.add(sec);
      this.boomSecs.push(sec);
      acc += l * 0.24; // 初期はほぼ収納
    }
    this.boom.rotation.x = 0.08;

    // フック + ケーブル
    this.hookGroup = new THREE.Group();
    this.group.add(this.hookGroup);
    const hook = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.24, 8), steel(0x8a2f23, 0.5, 0.5));
    hook.rotation.x = Math.PI;
    this.hookGroup.add(hook);
    const cableMat = new THREE.MeshBasicMaterial({ color: 0x2c2e31 });
    this.cable = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1, 6), cableMat);
    this.group.add(this.cable);
    this.cable.visible = false;
    this.hookGroup.visible = false;

    this.group.position.set(6.2, 0, -4.6);
    this.group.rotation.y = this.baseYaw;
  }

  /** 屋根パネルを生成（子どもの閉曲線そのままの形＋僅かな軒の出） */
  buildRoof(path: WallPath, parent: THREE.Object3D): void {
    if (!path.closed) return;
    const pts = path.samples;
    let cx = 0, cz = 0;
    for (const p of pts) { cx += p.x; cz += p.z; }
    cx /= pts.length; cz /= pts.length;
    const shape = new THREE.Shape();
    const eave = 1.07;
    pts.forEach((p, i) => {
      const x = cx + (p.x - cx) * eave;
      const y = cz + (p.z - cz) * eave;
      i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y);
    });
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.09, bevelEnabled: false });
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0xb3aea3, roughness: 0.92, roughnessMap: roughTex });
    this.roof = new THREE.Mesh(geo, mat);
    this.roof.castShadow = true;
    this.roof.receiveShadow = true;
    // 吊りアンカー
    const anchor = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.015, 6, 10), steel(0x777777));
    anchor.position.set(cx, 0.12, cz);
    this.roof.add(anchor);

    const wallTop = DIM.slabTop + path.layers * DIM.layerH;
    this.roofTarget.set(0, wallTop + 0.09, 0);
    // 待機位置: クレーン脇の地面
    this.roofHome.set(4.4, 0.14, -3.2);
    this.roof.position.copy(this.roofHome);
    parent.add(this.roof);

    // スリング（4本の吊りワイヤ表現）
    const slingGeo = new THREE.BufferGeometry();
    slingGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 3), 3));
    this.slings = new THREE.LineSegments(slingGeo, new THREE.LineBasicMaterial({ color: 0x3a3d40 }));
    this.slings.frustumCulled = false;
    this.slings.visible = false;
    parent.add(this.slings);
  }

  /** 設置シーケンス開始 */
  start(): void {
    if (!this.roof) { this.finished = true; return; }
    this.active = true;
    this.t = 0;
    this.hookGroup.visible = true;
    this.cable.visible = true;
    if (this.slings) this.slings.visible = true;
  }

  get isFinished(): boolean { return this.finished; }
  get hasRoof(): boolean { return this.roof !== null; }

  update(dt: number): void {
    if (!this.active || !this.roof) return;
    this.t += dt;
    const t = this.t;
    // タイムライン:
    // 0-2.5s: ブーム伸長・起こし  2.5-4s: 旋回して屋根上空へ
    // 4-6s: 屋根吊り上げ→水平移動  6-8.5s: 壁上へ降下  8.5-10s: ブーム戻し
    const extend = smoothstep(0, 2.5, t);
    const swing = smoothstep(2.2, 4.2, t);
    const carry = smoothstep(4.0, 6.2, t);
    const lower = smoothstep(6.2, 8.6, t);
    const retreat = smoothstep(8.8, 10.5, t);

    // ブーム
    this.boom.rotation.x = 0.08 + (0.62 - 0.2 * lower) * extend * (1 - retreat * 0.8);
    const lens = [0.24, 0.7, 0.95];
    this.boomSecs.forEach((sec, i) => {
      const geoLen = (sec.geometry as THREE.BoxGeometry).parameters.depth;
      const ext = (0.24 + (lens[i] - 0.24) * extend * (1 - retreat * 0.7));
      let acc = 0;
      for (let j = 0; j < i; j++) {
        const gl = (this.boomSecs[j].geometry as THREE.BoxGeometry).parameters.depth;
        acc += gl * (0.24 + (lens[j] - 0.24) * extend * (1 - retreat * 0.7));
      }
      sec.position.z = -(acc + geoLen / 2 * (i === 0 ? 1 : 1));
    });

    // 旋回: 待機 → 屋根位置 → スラブ中心上空
    const roofPickYaw = 0.55;
    const dropYaw = 1.62;
    this.turret.rotation.y = roofPickYaw * swing + (dropYaw - roofPickYaw) * carry;

    // ブーム先端（ワールド）
    const tip = new THREE.Vector3(0, 0, -(this.boomTotalLen()));
    this.boom.localToWorld(tip);

    // 屋根の移動: home → 吊上げ → target
    const lift = smoothstep(4.4, 5.4, t);
    const p = this.roof.position;
    if (t < 4.4) {
      p.copy(this.roofHome);
    } else {
      const mid = new THREE.Vector3(
        this.roofHome.x + (this.roofTarget.x - this.roofHome.x) * lower,
        this.roofHome.y + 2.6 * lift * (1 - lower * lower) + (this.roofTarget.y - this.roofHome.y) * lower,
        this.roofHome.z + (this.roofTarget.z - this.roofHome.z) * lower,
      );
      // 降下の最終段はゆっくり正確に
      p.lerp(mid, Math.min(1, dt * 5));
      if (t > 8.4) p.copy(this.roofTarget).lerp(p, Math.max(0, 1 - (t - 8.4)));
    }
    this.roof.rotation.y = Math.sin(t * 1.7) * 0.02 * (1 - lower);

    // フック・ケーブル
    const hookPos = t < 8.6
      ? new THREE.Vector3(p.x, p.y + 0.75, p.z)
      : tip.clone().setY(Math.max(2.2, tip.y - 1.2));
    this.hookGroup.position.copy(hookPos);
    const cl = Math.max(0.2, tip.y - hookPos.y);
    this.cable.scale.y = cl;
    this.cable.position.set((tip.x + hookPos.x) / 2, (tip.y + hookPos.y) / 2, (tip.z + hookPos.z) / 2);
    this.cable.lookAt(tip);
    this.cable.rotateX(Math.PI / 2);

    // スリング
    if (this.slings && t < 8.6) {
      const attr = this.slings.geometry.getAttribute('position') as THREE.BufferAttribute;
      const bb = new THREE.Box3().setFromObject(this.roof);
      const corners = [
        new THREE.Vector3(bb.min.x + 0.15, p.y + 0.1, bb.min.z + 0.15),
        new THREE.Vector3(bb.max.x - 0.15, p.y + 0.1, bb.min.z + 0.15),
        new THREE.Vector3(bb.max.x - 0.15, p.y + 0.1, bb.max.z - 0.15),
        new THREE.Vector3(bb.min.x + 0.15, p.y + 0.1, bb.max.z - 0.15),
      ];
      for (let i = 0; i < 4; i++) {
        attr.setXYZ(i * 2, hookPos.x, hookPos.y, hookPos.z);
        attr.setXYZ(i * 2 + 1, corners[i].x, corners[i].y, corners[i].z);
      }
      attr.needsUpdate = true;
    } else if (this.slings) {
      this.slings.visible = false;
    }

    if (t > 10.6) {
      this.active = false;
      this.finished = true;
      this.hookGroup.visible = false;
      this.cable.visible = false;
      this.roof.position.copy(this.roofTarget);
    }
  }

  private boomTotalLen(): number {
    let acc = 0.4;
    for (const sec of this.boomSecs) acc += -sec.position.z * 0.5;
    return acc + 1.6;
  }

  /** 再プレイ時 */
  reset(parent: THREE.Object3D): void {
    if (this.roof) {
      this.roof.geometry.dispose();
      parent.remove(this.roof);
      this.roof = null;
    }
    if (this.slings) {
      this.slings.geometry.dispose();
      parent.remove(this.slings);
      this.slings = null;
    }
    this.active = false;
    this.finished = false;
    this.t = 0;
    this.turret.rotation.y = 0;
    this.boom.rotation.x = 0.08;
    this.hookGroup.visible = false;
    this.cable.visible = false;
  }
}
