// 成人作業員（ローポリ・手続きアニメーション）
// - 印刷中はフェンス外で待機・監視
// - 印刷完了後、1名が壁沿いを歩いて安全確認（タブレット確認・頷き）

import * as THREE from 'three';
import { COLORS } from '../config';
import { P2, clamp, dist } from '../util/math2d';

const skinMat = new THREE.MeshStandardMaterial({ color: 0xd9a077, roughness: 0.9 });
const vestMat = new THREE.MeshStandardMaterial({ color: COLORS.hiVis, roughness: 0.85 });
const stripeMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.6 });
const pantsMat = new THREE.MeshStandardMaterial({ color: 0x3f4a55, roughness: 0.95 });
const bootMat = new THREE.MeshStandardMaterial({ color: 0x30281e, roughness: 0.95 });
const helmetMat = new THREE.MeshStandardMaterial({ color: 0xf0f0e8, roughness: 0.5 });

export class Worker {
  group: THREE.Group;
  private legL: THREE.Group;
  private legR: THREE.Group;
  private armL: THREE.Group;
  private armR: THREE.Group;
  private head: THREE.Group;
  private torso: THREE.Group;
  private tablet: THREE.Mesh;
  private phase = Math.random() * 10;

  // 歩行制御
  private walking = false;
  private route: P2[] = [];
  private routeIdx = 0;
  private speed = 0.85;
  private idleYaw: number;

  constructor(yaw = 0) {
    this.idleYaw = yaw;
    this.group = new THREE.Group();
    const scaleAll = 1.0; // 成人 ~1.75m

    // 脚
    const mkLeg = (sx: number) => {
      const g = new THREE.Group();
      const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.42, 0.15), pantsMat);
      thigh.position.y = -0.21;
      thigh.castShadow = true;
      g.add(thigh);
      const shin = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.4, 0.13), pantsMat);
      shin.position.y = -0.6;
      shin.castShadow = true;
      g.add(shin);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.26), bootMat);
      boot.position.set(0, -0.83, 0.05);
      boot.castShadow = true;
      g.add(boot);
      g.position.set(sx, 0.88, 0);
      return g;
    };
    this.legL = mkLeg(-0.1);
    this.legR = mkLeg(0.1);
    this.group.add(this.legL, this.legR);

    // 胴 + ベスト
    this.torso = new THREE.Group();
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.5, 0.22), vestMat);
    chest.position.y = 1.16;
    chest.castShadow = true;
    this.torso.add(chest);
    for (const oy of [1.28, 1.04]) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.37, 0.045, 0.23), stripeMat);
      stripe.position.y = oy;
      this.torso.add(stripe);
    }
    this.group.add(this.torso);

    // 腕
    const mkArm = (sx: number) => {
      const g = new THREE.Group();
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.3, 0.11), vestMat);
      upper.position.y = -0.15;
      upper.castShadow = true;
      g.add(upper);
      const fore = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 0.09), skinMat);
      fore.position.y = -0.44;
      fore.castShadow = true;
      g.add(fore);
      g.position.set(sx, 1.38, 0);
      return g;
    };
    this.armL = mkArm(-0.24);
    this.armR = mkArm(0.24);
    this.group.add(this.armL, this.armR);

    // 頭 + ヘルメット
    this.head = new THREE.Group();
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.22, 0.2), skinMat);
    face.position.y = 1.56;
    face.castShadow = true;
    this.head.add(face);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), helmetMat);
    helmet.position.y = 1.63;
    helmet.scale.set(1, 0.85, 1.1);
    helmet.castShadow = true;
    this.head.add(helmet);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.16, 0.02, 12), helmetMat);
    brim.position.set(0, 1.63, 0.03);
    this.head.add(brim);
    this.group.add(this.head);

    // タブレット（点検時に見る）
    this.tablet = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.24, 0.02), new THREE.MeshStandardMaterial({ color: 0x2c3034, roughness: 0.4 }));
    this.tablet.visible = false;
    this.group.add(this.tablet);

    this.group.scale.setScalar(scaleAll);
    this.group.rotation.y = yaw;
  }

  setPosition(x: number, z: number): void {
    this.group.position.set(x, 0, z);
  }

  /** 点検ルートを歩かせる */
  walkRoute(route: P2[], speed = 0.85): void {
    this.route = route;
    this.routeIdx = 0;
    this.walking = true;
    this.speed = speed;
  }

  get isWalking(): boolean { return this.walking; }

  /** inspect: タブレットを見ながら頷く */
  inspect(on: boolean): void {
    this.tablet.visible = on;
  }

  update(dt: number, t: number): void {
    this.phase += dt;
    const ph = this.phase;

    if (this.walking && this.route.length > 0) {
      const target = this.route[this.routeIdx];
      const px = this.group.position.x, pz = this.group.position.z;
      const d = dist({ x: px, z: pz }, target);
      if (d < 0.08) {
        this.routeIdx++;
        if (this.routeIdx >= this.route.length) this.walking = false;
      } else {
        const step = Math.min(d, this.speed * dt);
        const dirX = (target.x - px) / d, dirZ = (target.z - pz) / d;
        this.group.position.x += dirX * step;
        this.group.position.z += dirZ * step;
        const wantYaw = Math.atan2(dirX, dirZ);
        let dy = wantYaw - this.group.rotation.y;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        this.group.rotation.y += clamp(dy, -3 * dt, 3 * dt);
      }
      // 歩行モーション
      const w = ph * 7;
      this.legL.rotation.x = Math.sin(w) * 0.55;
      this.legR.rotation.x = -Math.sin(w) * 0.55;
      this.armL.rotation.x = -Math.sin(w) * 0.4;
      this.armR.rotation.x = Math.sin(w) * 0.4;
      this.group.position.y = Math.abs(Math.sin(w)) * 0.03;
    } else {
      // アイドル: わずかな重心移動と見回し
      const decay = Math.exp(-dt * 6);
      this.legL.rotation.x *= decay;
      this.legR.rotation.x *= decay;
      this.armL.rotation.x *= decay;
      this.armR.rotation.x *= decay;
      this.group.position.y *= decay;
      this.torso.rotation.z = Math.sin(ph * 0.7) * 0.02;
      this.head.rotation.y = Math.sin(ph * 0.32) * 0.4;
      if (this.tablet.visible) {
        // タブレット確認姿勢 + 頷き
        this.armR.rotation.x = -1.15;
        this.armL.rotation.x = -0.9;
        this.head.rotation.x = 0.32 + Math.max(0, Math.sin(ph * 2.6)) * 0.12;
        this.head.rotation.y = 0;
        this.tablet.position.set(0.05, 1.3, 0.3);
        this.tablet.rotation.x = -0.6;
      } else {
        this.head.rotation.x *= decay;
      }
    }
  }
}
