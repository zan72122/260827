import * as THREE from 'three';
import { taperedTube } from './geo';
import { woodTextures, clothTexture } from './textures';
import { TackMats } from './gear';

// ---------------------------------------------------------------------------
// 木製そり: 荷重をランナー → 立ち木(スタンション) → 荷台 と受ける構造。
// 前方は -Z。ランナーは前端で巻き上がり、接地面に鉄帯を持つ。
// 赤い荷台と控えめな金の縁取り（全面鏡面にはしない）。
// ---------------------------------------------------------------------------

export class Sled {
  readonly group = new THREE.Group();
  /** 牽引線を掛ける前梁のフック（左・中・右） */
  readonly hooks: THREE.Object3D[] = [];
  readonly santa: Santa;
  /** ランナー接地の左右レール位置（そり跡用） */
  readonly runnerX = 0.42;

  constructor(tack: TackMats) {
    const wt = woodTextures('#8a5a34', '#4e3018', 191);
    const wood = new THREE.MeshStandardMaterial({ map: wt.map, bumpMap: wt.bump, bumpScale: 0.5, roughness: 0.7 });
    const redWt = woodTextures('#a03026', '#6d1d16', 193);
    const redWood = new THREE.MeshStandardMaterial({
      map: redWt.map, bumpMap: redWt.bump, bumpScale: 0.4, roughness: 0.55, metalness: 0.05
    });
    const gold = new THREE.MeshStandardMaterial({ color: '#c9a04c', metalness: 0.6, roughness: 0.5 });
    const iron = new THREE.MeshStandardMaterial({ color: '#4b4f55', metalness: 0.8, roughness: 0.45 });

    // --- ランナー（左右）: 前で巻き上がる曲線 ------------------------------
    const mkRunner = (sx: number) => {
      const path: THREE.Vector3[] = [];
      // 後端 → 前方 → 巻き上がり
      path.push(new THREE.Vector3(sx, 0.055, 1.15));
      path.push(new THREE.Vector3(sx, 0.055, 0.2));
      path.push(new THREE.Vector3(sx, 0.055, -0.75));
      path.push(new THREE.Vector3(sx, 0.09, -1.05));
      path.push(new THREE.Vector3(sx, 0.28, -1.28));
      path.push(new THREE.Vector3(sx, 0.55, -1.30));
      path.push(new THREE.Vector3(sx, 0.68, -1.16));
      const runner = new THREE.Mesh(taperedTube(path, 0.045, 0.028, 8, 32), wood);
      runner.castShadow = true;
      this.group.add(runner);
      // 鉄帯（接地部）
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.014, 2.3), iron);
      strip.position.set(sx, 0.012, 0.03);
      this.group.add(strip);
      return runner;
    };
    mkRunner(-this.runnerX);
    mkRunner(this.runnerX);

    // --- スタンション（ランナーから荷台を支える立ち木） ---------------------
    for (const sx of [-this.runnerX, this.runnerX]) {
      for (const z of [0.85, 0.1, -0.6]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.034, 0.36, 8), wood);
        post.position.set(sx, 0.24, z);
        post.castShadow = true;
        this.group.add(post);
      }
      // 縦通し梁
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 1.75), wood);
      beam.position.set(sx, 0.42, 0.12);
      beam.castShadow = true;
      this.group.add(beam);
    }
    // 横梁（前・後）
    for (const z of [0.85, -0.6]) {
      const cross = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.05, 0.07), wood);
      cross.position.set(0, 0.42, z);
      this.group.add(cross);
    }

    // --- 荷台（赤）---------------------------------------------------------
    const floor = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.05, 1.75), redWood);
    floor.position.set(0, 0.47, 0.12);
    floor.castShadow = true;
    floor.receiveShadow = true;
    this.group.add(floor);
    // 側板（後ろへ高くなる曲線的な板を近似）
    const mkSide = (sx: number) => {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.34, 1.5), redWood);
      side.position.set(sx * 0.45, 0.66, 0.2);
      side.castShadow = true;
      this.group.add(side);
      // 金の縁（上端のみ・サテン調）
      const trim = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.028, 1.5), gold);
      trim.position.set(sx * 0.45, 0.845, 0.2);
      this.group.add(trim);
    };
    mkSide(-1);
    mkSide(1);
    // 背板
    const backB = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.42, 0.05), redWood);
    backB.position.set(0, 0.70, 0.93);
    backB.castShadow = true;
    this.group.add(backB);
    const backTrim = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.03, 0.055), gold);
    backTrim.position.set(0, 0.925, 0.93);
    this.group.add(backTrim);
    // 前板（低め・曲線前縁の代わりに傾斜）
    const frontB = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.3, 0.05), redWood);
    frontB.position.set(0, 0.60, -0.62);
    frontB.rotation.x = -0.25;
    frontB.castShadow = true;
    this.group.add(frontB);

    // --- 前梁と牽引フック ---------------------------------------------------
    const drawbar = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.055, 0.07), wood);
    drawbar.position.set(0, 0.30, -1.05);
    drawbar.castShadow = true;
    this.group.add(drawbar);
    for (const hx of [-0.42, 0, 0.42]) {
      const hook = new THREE.Mesh(
        new THREE.TorusGeometry(0.035, 0.010, 8, 14, Math.PI * 1.6), tack.brass);
      hook.position.set(hx, 0.27, -1.08);
      hook.rotation.x = Math.PI / 2 + 0.4;
      hook.castShadow = true;
      this.group.add(hook);
      const anchor = new THREE.Object3D();
      anchor.position.set(hx, 0.26, -1.10);
      this.group.add(anchor);
      this.hooks.push(anchor);
    }

    // --- サンタ -------------------------------------------------------------
    this.santa = new Santa();
    this.santa.group.position.set(0, 0.49, 0.45);
    this.group.add(this.santa.group);
  }
}

// ---------------------------------------------------------------------------
// サンタ: 低ポリの座像。手綱を軽く引く腕の所作だけを持つ。
// ---------------------------------------------------------------------------
export class Santa {
  readonly group = new THREE.Group();
  readonly armL: THREE.Group;
  readonly armR: THREE.Group;
  readonly handL = new THREE.Object3D();
  readonly handR = new THREE.Object3D();
  private raise = 0;
  raiseTarget = 0;

  constructor() {
    const coat = new THREE.MeshStandardMaterial({ map: clothTexture('#b3342c'), roughness: 0.9 });
    const trim = new THREE.MeshStandardMaterial({ color: '#f2ede4', roughness: 1 });
    const skin = new THREE.MeshStandardMaterial({ color: '#e8b28e', roughness: 0.7 });
    const beard = new THREE.MeshStandardMaterial({ color: '#eeeae2', roughness: 1 });
    const dark = new THREE.MeshStandardMaterial({ color: '#3a2c22', roughness: 0.8 });

    // 座った胴（下すぼまり）
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10), coat);
    body.scale.set(1, 1.25, 0.9);
    body.position.y = 0.24;
    body.castShadow = true;
    // ベルト
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.195, 0.028, 8, 16), dark);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 0.20;
    // 頭
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 12, 10), skin);
    head.position.y = 0.56;
    head.castShadow = true;
    // ひげ
    const beardMesh = new THREE.Mesh(new THREE.SphereGeometry(0.095, 10, 8), beard);
    beardMesh.scale.set(1, 1.15, 0.8);
    beardMesh.position.set(0, 0.50, -0.045);
    // 帽子
    const hatBase = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.032, 8, 16), trim);
    hatBase.rotation.x = Math.PI / 2;
    hatBase.position.y = 0.62;
    const hatCone = new THREE.Mesh(new THREE.ConeGeometry(0.095, 0.2, 10), coat);
    hatCone.position.set(0, 0.71, 0.02);
    hatCone.rotation.x = 0.35;
    const pom = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 6), trim);
    pom.position.set(0, 0.77, 0.09);
    this.group.add(body, belt, head, beardMesh, hatBase, hatCone, pom);

    // 腕（肩ピボット）
    const mkArm = (sx: number) => {
      const arm = new THREE.Group();
      arm.position.set(sx * 0.19, 0.42, 0);
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.24, 8), coat);
      upper.position.y = -0.10;
      upper.castShadow = true;
      const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.016, 8, 12), trim);
      cuff.rotation.x = Math.PI / 2;
      cuff.position.y = -0.22;
      const mitten = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), dark);
      mitten.position.y = -0.26;
      arm.add(upper, cuff, mitten);
      arm.rotation.x = -1.05; // 前へ差し出し、手綱を持つ
      arm.rotation.z = sx * 0.25;
      this.group.add(arm);
      return { arm, mitten };
    };
    const l = mkArm(-1);
    const r = mkArm(1);
    this.armL = l.arm;
    this.armR = r.arm;
    l.mitten.add(this.handL);
    r.mitten.add(this.handR);
  }

  update(dt: number): void {
    this.raise += (this.raiseTarget - this.raise) * Math.min(1, dt * 3.2);
    const a = -1.05 - this.raise * 0.45;
    this.armL.rotation.x = a;
    this.armR.rotation.x = a;
  }

  /** 手綱をひと引きする所作 */
  tug(): void {
    this.raiseTarget = 1;
    setTimeout(() => { this.raiseTarget = 0.55; }, 700);
  }

  rest(): void {
    this.raiseTarget = 0;
  }
}
