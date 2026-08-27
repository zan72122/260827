import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { leatherTextures, brassTextures, woodTextures } from './textures';
import { Reindeer } from './reindeer';

// ---------------------------------------------------------------------------
// 装具: 首輪（鈴・牽引用D環付き）、胸当てハーネス、真鍮の鈴、雪払いブラシ。
// どれも「置き場にある → 指に持たれる → トナカイに収まる」の3状態を持つ。
// ---------------------------------------------------------------------------

export class TackMats {
  leather: THREE.MeshStandardMaterial;
  leatherDark: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  fleece: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  bristle: THREE.MeshStandardMaterial;

  constructor() {
    const lt = leatherTextures(51);
    this.leather = new THREE.MeshStandardMaterial({
      map: lt.map, bumpMap: lt.bump, bumpScale: 0.6, roughnessMap: lt.rough,
      roughness: 1, metalness: 0.02
    });
    const lt2 = leatherTextures(151);
    this.leatherDark = new THREE.MeshStandardMaterial({
      map: lt2.map, bumpMap: lt2.bump, bumpScale: 0.6, roughness: 0.85, metalness: 0.02,
      color: '#8a6a4a'
    });
    const bt = brassTextures(71);
    this.brass = new THREE.MeshStandardMaterial({
      map: bt.map, roughnessMap: bt.rough, bumpMap: bt.bump, bumpScale: 0.4,
      metalness: 0.85, roughness: 0.42, envMapIntensity: 0.9
    });
    this.fleece = new THREE.MeshStandardMaterial({ color: '#efe6d4', roughness: 1, metalness: 0 });
    const wt = woodTextures('#9a7a52', '#5d4428', 95);
    this.wood = new THREE.MeshStandardMaterial({ map: wt.map, bumpMap: wt.bump, bumpScale: 0.4, roughness: 0.8 });
    this.bristle = new THREE.MeshStandardMaterial({ color: '#caa96f', roughness: 1 });
  }
}

export type WearState = 'stored' | 'dragging' | 'fitting' | 'fitted';

// 鈴を掛けられる吊り輪
export interface BellLoop {
  anchor: THREE.Object3D;   // 吊り輪の位置（装具ローカル）
  swinginess: number;       // 揺れやすさ（下=1, 横=0.55）
  bellId: number | -1;      // 掛かっている鈴
}

export abstract class Wearable {
  readonly group = new THREE.Group();
  state: WearState = 'stored';
  deer: Reindeer | null = null;
  readonly bellLoops: BellLoop[] = [];
  /** 牽引線の起点となるD環 */
  dRing!: THREE.Object3D;
  protected storedPos = new THREE.Vector3();
  protected storedRot = new THREE.Euler();
  private fitT = 0;
  private fromPos = new THREE.Vector3();
  private fromQuat = new THREE.Quaternion();
  private fromScale = 1;
  onFitted?: () => void;

  setStored(pos: THREE.Vector3, rot: THREE.Euler): void {
    this.storedPos.copy(pos);
    this.storedRot.copy(rot);
    this.group.position.copy(pos);
    this.group.rotation.copy(rot);
    this.state = 'stored';
  }

  /** どのソケットへ収まるか（トナカイ側） */
  abstract socketOf(deer: Reindeer): THREE.Object3D;
  /** ソケットローカルでの装着姿勢 */
  abstract fittedOffset(): { pos: THREE.Vector3; rot: THREE.Euler };

  beginDrag(): void {
    this.state = 'dragging';
  }

  dragTo(world: THREE.Vector3): void {
    this.group.position.lerp(world, 0.55);
    // 持ち上げている間はゆっくり水平へ
    this.group.rotation.x *= 0.9;
    this.group.rotation.z *= 0.9;
  }

  /** 手から離れて置き場へ戻る（誤配置時の優しい反応） */
  returnToStore(): void {
    this.state = 'stored';
    // 位置はアニメで戻す（update 内）
  }

  startFit(deer: Reindeer): void {
    this.deer = deer;
    this.state = 'fitting';
    this.fitT = 0;
    const socket = this.socketOf(deer);
    socket.updateWorldMatrix(true, false);
    // 現在のワールド姿勢をソケットローカルに変換して保持
    const m = socket.matrixWorld.clone().invert().multiply(this.group.matrixWorld);
    m.decompose(this.fromPos, this.fromQuat, new THREE.Vector3());
    this.fromScale = this.group.scale.x;
    socket.add(this.group);
    this.group.position.copy(this.fromPos);
    this.group.quaternion.copy(this.fromQuat);
  }

  update(dt: number): void {
    if (this.state === 'fitting') {
      this.fitT += dt * 2.2;
      const t = Math.min(1, this.fitT);
      // 少し沈み込んで馴染むイージング
      const e = 1 - Math.pow(1 - t, 3);
      const off = this.fittedOffset();
      const q = new THREE.Quaternion().setFromEuler(off.rot);
      this.group.position.lerpVectors(this.fromPos, off.pos, e);
      this.group.quaternion.slerpQuaternions(this.fromQuat, q, e);
      const wobble = t < 1 ? Math.sin(t * Math.PI * 3) * 0.03 * (1 - t) : 0;
      this.group.scale.setScalar(this.fromScale * (1 + wobble));
      if (t >= 1) {
        this.state = 'fitted';
        this.group.scale.setScalar(this.fromScale);
        this.onFitted?.();
      }
    } else if (this.state === 'stored') {
      // 置き場へふわりと戻る
      this.group.position.lerp(this.storedPos, Math.min(1, dt * 6));
      this.group.rotation.x += (this.storedRot.x - this.group.rotation.x) * Math.min(1, dt * 6);
      this.group.rotation.y += (this.storedRot.y - this.group.rotation.y) * Math.min(1, dt * 6);
      this.group.rotation.z += (this.storedRot.z - this.group.rotation.z) * Math.min(1, dt * 6);
    }
  }

  /** 掴み判定の中心 */
  grabWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.group.getWorldPosition(out);
  }
}

// ---------------------------------------------------------------------------
// 首輪（サーミ式: 太い革のカラー。鈴の吊り輪と、下部に牽引用D環）
// ---------------------------------------------------------------------------
export class NeckCollar extends Wearable {
  constructor(mats: TackMats) {
    super();
    // 厚いパッド付きの輪（首の楕円に合わせ scale）
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.032, 10, 24), mats.leather);
    collar.scale.set(1, 1.22, 1);
    const pad = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.040, 10, 24), mats.fleece);
    pad.scale.set(1, 1.2, 0.6);
    pad.position.z = 0.012;
    // バックル（上部）
    const buckleFrame = new THREE.Mesh(new THREE.TorusGeometry(0.030, 0.007, 6, 4), mats.brass);
    buckleFrame.position.set(0, 0.23, -0.01);
    buckleFrame.rotation.z = Math.PI / 4;
    // 下部のD環
    const dring = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.009, 8, 16), mats.brass);
    dring.position.set(0, -0.245, 0.01);
    this.group.add(collar, pad, buckleFrame, dring);
    this.group.traverse((o) => { o.castShadow = true; });
    this.dRing = new THREE.Object3D();
    this.dRing.position.copy(dring.position);
    this.group.add(this.dRing);
    // 吊り輪: 下中央・左右斜め下
    const mkLoop = (x: number, y: number, sw: number) => {
      const loopMesh = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.006, 6, 12), mats.brass);
      loopMesh.position.set(x, y, 0.02);
      this.group.add(loopMesh);
      const a = new THREE.Object3D();
      a.position.set(x, y - 0.015, 0.02);
      this.group.add(a);
      this.bellLoops.push({ anchor: a, swinginess: sw, bellId: -1 });
    };
    mkLoop(-0.16, -0.16, 0.8);
    mkLoop(0.16, -0.16, 0.8);
  }

  socketOf(deer: Reindeer): THREE.Object3D {
    return deer.collarSocket;
  }

  fittedOffset(): { pos: THREE.Vector3; rot: THREE.Euler } {
    // 首軸（ソケットのローカル -Z）にトーラスの法線を合わせる
    return { pos: new THREE.Vector3(0, -0.01, 0), rot: new THREE.Euler(0, 0, 0) };
  }
}

// ---------------------------------------------------------------------------
// 胸当てハーネス（ブレストカラー）: 胸を横切る幅広の帯 + 上で留めるバックル
// ---------------------------------------------------------------------------
export class BreastHarness extends Wearable {
  /** 留め終わったか（バックル工程） */
  buckled = false;
  readonly strapEnd: THREE.Group;   // 未留めの革端（ドラッグ対象）
  readonly buckleTarget: THREE.Object3D;
  private strapHome = new THREE.Vector3();

  constructor(mats: TackMats, needsBuckle: boolean) {
    super();
    // 肩掛けの full collar: 首の付け根を囲む厚い革の輪（開口は上、バックルで閉じる）
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(0.185, 0.030, 10, 24, Math.PI * 1.55), mats.leather);
    band.rotation.z = Math.PI * 0.725; // 開口を上へ
    band.scale.set(1, 1.2, 1);
    const pad = new THREE.Mesh(
      new THREE.TorusGeometry(0.185, 0.038, 10, 20, Math.PI * 1.2), mats.fleece);
    pad.rotation.z = Math.PI * 0.9;
    pad.scale.set(1, 1.17, 0.55);
    pad.position.z = 0.014;
    // 下部中央のD環（牽引線）
    const dring = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.009, 8, 16), mats.brass);
    dring.position.set(0, -0.24, 0.02);
    this.group.add(band, pad, dring);
    this.dRing = new THREE.Object3D();
    this.dRing.position.copy(dring.position);
    this.group.add(this.dRing);
    // 吊り輪（胸帯の左右）
    const mkLoop = (x: number, y: number, sw: number) => {
      const loopMesh = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.006, 6, 12), mats.brass);
      loopMesh.position.set(x, y, 0.025);
      this.group.add(loopMesh);
      const a = new THREE.Object3D();
      a.position.set(x, y - 0.015, 0.025);
      this.group.add(a);
      this.bellLoops.push({ anchor: a, swinginess: sw, bellId: -1 });
    };
    mkLoop(-0.165, -0.085, 0.7);
    mkLoop(0.165, -0.085, 0.7);

    // バックル（右肩側の帯上端）
    const buckle = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.TorusGeometry(0.030, 0.008, 6, 4), mats.brass);
    frame.rotation.z = Math.PI / 4;
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.05, 6), mats.brass);
    pin.rotation.z = Math.PI / 2;
    buckle.add(frame, pin);
    buckle.position.set(0.165, 0.135, 0.015);
    this.group.add(buckle);
    this.buckleTarget = buckle;
    this.group.traverse((o) => { o.castShadow = true; });

    // 未留めの革端（左肩側からぶら下がる短い帯 + 先端タブ）
    this.strapEnd = new THREE.Group();
    const tab = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.13, 0.015), mats.leatherDark);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), mats.leatherDark);
    tip.position.y = -0.07;
    this.strapEnd.add(tab, tip);
    this.strapHome.set(-0.18, 0.09, 0.03);
    this.strapEnd.position.copy(this.strapHome);
    this.strapEnd.rotation.z = 0.5;
    this.group.add(this.strapEnd);
    if (!needsBuckle) {
      this.buckled = true;
      this.strapEnd.visible = false;
    }
  }

  /** バックル留めの完了 */
  closeBuckle(): void {
    this.buckled = true;
  }

  /** ストラップ端を手元へ戻す */
  resetStrap(): void {
    this.strapEnd.position.copy(this.strapHome);
    this.strapEnd.rotation.set(0, 0, 0.5);
  }

  updateStrap(dt: number): void {
    if (this.buckled) {
      // 留まった位置（バックルの上に重なる）へ
      this.strapEnd.position.lerp(new THREE.Vector3(0.125, 0.13, 0.03), Math.min(1, dt * 8));
      this.strapEnd.rotation.z += (-0.9 - this.strapEnd.rotation.z) * Math.min(1, dt * 8);
    }
  }

  socketOf(deer: Reindeer): THREE.Object3D {
    return deer.chestSocket;
  }

  fittedOffset(): { pos: THREE.Vector3; rot: THREE.Euler } {
    // 首の付け根の傾きに沿わせる（体ローカルで首軸に法線を合わせる）
    return { pos: new THREE.Vector3(0, 0, 0.01), rot: new THREE.Euler(0.55, 0, 0) };
  }
}

// ---------------------------------------------------------------------------
// 真鍮の鈴（クロタル）: InstancedMesh で描き、揺れと音は鈴ごとに管理
// ---------------------------------------------------------------------------
export interface BellState {
  size: number;            // 0 小 / 1 中 / 2 大
  scale: number;
  home: THREE.Vector3;     // ラック上の位置
  attachedLoop: BellLoop | null;
  wearable: Wearable | null;
  dragging: boolean;
  dragPos: THREE.Vector3;
  angle: number;           // 振り子角
  vel: number;
  lastWorld: THREE.Vector3;
  worldVel: THREE.Vector3;
  ringCooldown: number;
}

export class BellSystem {
  readonly inst: THREE.InstancedMesh;
  readonly bells: BellState[] = [];
  private dummy = new THREE.Object3D();
  onRing?: (size: number, vel: number, worldX: number) => void;

  constructor(mats: TackMats, homes: { pos: THREE.Vector3; size: number }[]) {
    // クロタル鈴: 球体 + 赤道の膨らみ + スリット + 吊り耳
    const ball = new THREE.SphereGeometry(0.042, 12, 10);
    const belt = new THREE.TorusGeometry(0.041, 0.007, 6, 16);
    belt.rotateX(Math.PI / 2);
    const slit = new THREE.BoxGeometry(0.012, 0.008, 0.062);
    slit.translate(0, -0.036, 0);
    const ear = new THREE.TorusGeometry(0.012, 0.005, 6, 10);
    ear.translate(0, 0.049, 0);
    const geo = mergeGeometries([ball, belt, slit, ear])!;
    geo.translate(0, -0.05, 0); // ピボットを吊り耳へ
    this.inst = new THREE.InstancedMesh(geo, mats.brass, homes.length);
    this.inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.inst.castShadow = true;
    for (const h of homes) {
      this.bells.push({
        size: h.size,
        scale: 1.05 + h.size * 0.3,
        home: h.pos.clone(),
        attachedLoop: null, wearable: null,
        dragging: false, dragPos: h.pos.clone(),
        angle: 0, vel: 0,
        lastWorld: h.pos.clone(), worldVel: new THREE.Vector3(),
        ringCooldown: 0
      });
    }
  }

  bellWorld(i: number, out: THREE.Vector3): THREE.Vector3 {
    const b = this.bells[i];
    if (b.dragging) return out.copy(b.dragPos);
    if (b.attachedLoop) return b.attachedLoop.anchor.getWorldPosition(out);
    return out.copy(b.home);
  }

  attach(i: number, loop: BellLoop, wearable: Wearable): void {
    const b = this.bells[i];
    // 既に付いている鈴があれば入れ替え（元の鈴はラックへ）
    if (loop.bellId >= 0 && loop.bellId !== i) this.detach(loop.bellId);
    if (b.attachedLoop) b.attachedLoop.bellId = -1;
    b.attachedLoop = loop;
    b.wearable = wearable;
    b.dragging = false;
    loop.bellId = i;
    b.vel = 2.5; // 付けた瞬間に一揺れ
  }

  detach(i: number): void {
    const b = this.bells[i];
    if (b.attachedLoop) b.attachedLoop.bellId = -1;
    b.attachedLoop = null;
    b.wearable = null;
    b.dragging = false;
  }

  update(dt: number): void {
    const w = new THREE.Vector3();
    for (let i = 0; i < this.bells.length; i++) {
      const b = this.bells[i];
      b.ringCooldown -= dt;
      this.bellWorld(i, w);
      // 吊り点の加速度から振り子を励振
      b.worldVel.subVectors(w, b.lastWorld).divideScalar(Math.max(dt, 1e-4));
      b.lastWorld.copy(w);
      const sw = b.attachedLoop ? b.attachedLoop.swinginess : 0.4;
      const drive = THREE.MathUtils.clamp(-b.worldVel.z * 1.6 - b.worldVel.x * 0.6, -6, 6) * sw;
      // 減衰振り子
      const acc = -22 * Math.sin(b.angle) - 2.4 * b.vel + drive;
      b.vel += acc * dt;
      b.angle += b.vel * dt;
      // 鳴り: 角速度が大きく振れたとき
      if (Math.abs(b.vel) > 2.2 && b.ringCooldown <= 0) {
        b.ringCooldown = 0.16 + Math.random() * 0.08;
        this.onRing?.(b.size, Math.min(1, Math.abs(b.vel) / 7), w.x);
      }
      this.dummy.position.copy(w);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.rotation.x = b.angle * 0.5;
      this.dummy.rotation.z = b.angle;
      this.dummy.scale.setScalar(b.scale);
      this.dummy.updateMatrix();
      this.inst.setMatrixAt(i, this.dummy.matrix);
    }
    this.inst.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// 雪払いブラシ: 大きな木の柄 + 剛毛
// ---------------------------------------------------------------------------
export class Brush {
  readonly group = new THREE.Group();
  state: 'stored' | 'dragging' = 'stored';
  private storedPos = new THREE.Vector3();
  private storedRot = new THREE.Euler();

  constructor(mats: TackMats) {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.34, 8), mats.wood);
    handle.position.y = 0.20;
    const block = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.055, 0.22), mats.wood);
    block.position.y = 0.028;
    const bristles = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.21), mats.bristle);
    bristles.position.y = -0.028;
    this.group.add(handle, block, bristles);
    this.group.traverse((o) => { o.castShadow = true; });
  }

  setStored(pos: THREE.Vector3, rot: THREE.Euler): void {
    this.storedPos.copy(pos);
    this.storedRot.copy(rot);
    this.group.position.copy(pos);
    this.group.rotation.copy(rot);
    this.state = 'stored';
  }

  dragTo(world: THREE.Vector3): void {
    this.state = 'dragging';
    this.group.position.lerp(world, 0.6);
    this.group.rotation.x += (0.6 - this.group.rotation.x) * 0.2;
    this.group.rotation.z *= 0.85;
  }

  release(): void {
    this.state = 'stored';
  }

  update(dt: number): void {
    if (this.state === 'stored') {
      this.group.position.lerp(this.storedPos, Math.min(1, dt * 5));
      this.group.rotation.x += (this.storedRot.x - this.group.rotation.x) * Math.min(1, dt * 5);
      this.group.rotation.y += (this.storedRot.y - this.group.rotation.y) * Math.min(1, dt * 5);
      this.group.rotation.z += (this.storedRot.z - this.group.rotation.z) * Math.min(1, dt * 5);
    }
  }
}
