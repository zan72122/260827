import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { loft, taperedTube, LoftSection } from './geo';
import {
  FurPalette, furBodyTextures, furHeadTextures, furLegTexture, furCardTexture, mulberry
} from './textures';

// ---------------------------------------------------------------------------
// トナカイ（Rangifer tarandus）
//   肩高 ~1.15m / 体幹長 ~1.4m、深い胸郭、細い脚と幅広い蹄、
//   厚い冬毛と首下の淡いラフ、両性に生えるC字湾曲の枝角。
// 共有リグ（グループ階層＋手続きアニメ）に個体パラメータを与えて構築する。
// ---------------------------------------------------------------------------

export interface ReindeerParams {
  name: string;
  seed: number;
  palette: FurPalette;
  shoulderHeight: number;  // 肩高スケール（1 = 1.15m 相当）
  bodyLength: number;      // 体幹の長さ係数
  chestDepth: number;      // 胸の深さ係数
  legThickness: number;
  antler: {
    height: number;        // 主幹の高さ係数
    spread: number;        // 左右の開き
    curve: number;         // 前方への湾曲
    topPoints: number;     // 先端の枝数 2..4
    asym: number;          // 左右差 0..0.15
    color: string;
  };
}

export const DEER_PRESETS: ReindeerParams[] = [
  {
    // ホシ: 中庸の茶、大柄、広い角 — 最初の一頭
    name: 'hoshi', seed: 101,
    palette: {
      seed: 101, back: '#6f5b44', side: '#8d7659', belly: '#cfc3af', ruff: '#e8dfd0',
      faceBase: '#8a7355', blaze: '#e8e0d2', blazeShape: 'star', sockColor: '#d8cfc0'
    },
    shoulderHeight: 1.0, bodyLength: 1.0, chestDepth: 1.05, legThickness: 1.0,
    antler: { height: 1.0, spread: 1.0, curve: 1.0, topPoints: 3, asym: 0.06, color: '#8a7358' }
  },
  {
    // ユキ: 明るい灰ベージュ、細身、小ぶりで左右差のある角、顔の流星
    name: 'yuki', seed: 211,
    palette: {
      seed: 211, back: '#8d7f6b', side: '#a99a83', belly: '#e2d9c8', ruff: '#efe9dc',
      faceBase: '#9a8a72', blaze: '#f2ece0', blazeShape: 'stripe'
    },
    shoulderHeight: 0.93, bodyLength: 0.95, chestDepth: 0.95, legThickness: 0.88,
    antler: { height: 0.8, spread: 0.85, curve: 1.15, topPoints: 2, asym: 0.14, color: '#9c8a70' }
  },
  {
    // クリ: 濃い焦茶、がっしり短躯、高く細い角、白いソックス
    name: 'kuri', seed: 307,
    palette: {
      seed: 307, back: '#51402d', side: '#6a563f', belly: '#b2a189', ruff: '#d4c7b0',
      faceBase: '#6d5941', sockColor: '#e5dccb'
    },
    shoulderHeight: 0.97, bodyLength: 0.92, chestDepth: 1.1, legThickness: 1.1,
    antler: { height: 1.15, spread: 0.8, curve: 0.85, topPoints: 3, asym: 0.05, color: '#6d5a42' }
  }
];

// 共有ジオメトリ（全個体で使い回す）
let sharedLegUpper: THREE.BufferGeometry | null = null;
let sharedLegLower: THREE.BufferGeometry | null = null;
let sharedLegCannon: THREE.BufferGeometry | null = null;
let sharedHoof: THREE.BufferGeometry | null = null;
let sharedEye: THREE.BufferGeometry | null = null;
let sharedEar: THREE.BufferGeometry | null = null;
let sharedTail: THREE.BufferGeometry | null = null;
let sharedSnowCake: THREE.BufferGeometry | null = null;
let sharedCardTex: THREE.Texture | null = null;
let sharedHoofMat: THREE.MeshStandardMaterial | null = null;
let sharedEyeMat: THREE.MeshStandardMaterial | null = null;

// 脚セグメント: 上が太く下が細い錐台。ピボットは上端。
// vLo..vHi で脚テクスチャの担当帯域を指定（ソックスは最下段の帯のみに出る）
function legSegGeo(topR: number, botR: number, len: number, vLo = 0, vHi = 1): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(topR, botR, len, 8, 3);
  g.translate(0, -len / 2, 0);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    uv.setY(i, vLo + uv.getY(i) * (vHi - vLo));
  }
  return g;
}

function ensureShared(): void {
  if (sharedLegUpper) return;
  sharedLegUpper = legSegGeo(0.075, 0.046, 0.42, 0.55, 1.0);
  sharedLegLower = legSegGeo(0.044, 0.029, 0.28, 0.30, 0.55);
  sharedLegCannon = legSegGeo(0.027, 0.023, 0.30, 0.0, 0.30);
  // 蹄: 幅広の三日月型（雪上適応）— 前後に割れた二趾を1メッシュで
  const toe = new THREE.SphereGeometry(0.047, 8, 6);
  toe.scale(0.95, 0.55, 1.25);
  const toeL = toe.clone().translate(-0.028, -0.02, -0.01);
  const toeR = toe.clone().translate(0.028, -0.02, -0.01);
  sharedHoof = mergeGeometries([toeL, toeR])!;
  toe.dispose();
  sharedEye = new THREE.SphereGeometry(0.023, 10, 8);
  // 耳: 先の丸い小さな杓子型（毛で覆われる）
  const ear = loft([
    { z: 0, rx: 0.026, ry: 0.016 },
    { z: -0.065, rx: 0.042, ry: 0.020 },
    { z: -0.115, rx: 0.031, ry: 0.015 },
    { z: -0.15, rx: 0.010, ry: 0.007 }
  ], 8);
  sharedEar = ear;
  // 尾: 短く、下面は淡色（テクスチャで表現される位置に合わせる）
  const tail = loft([
    { z: 0, rx: 0.045, ry: 0.05 },
    { z: 0.09, rx: 0.05, ry: 0.055 },
    { z: 0.16, rx: 0.025, ry: 0.03 }
  ], 8);
  sharedTail = tail;
  const cake = new THREE.SphereGeometry(0.5, 7, 5);
  cake.scale(1, 0.35, 1);
  sharedSnowCake = cake;
  sharedCardTex = furCardTexture('#efe9dc');
  sharedHoofMat = new THREE.MeshStandardMaterial({ color: '#2e2621', roughness: 0.55, metalness: 0.05 });
  sharedEyeMat = new THREE.MeshStandardMaterial({
    color: '#1b130d', roughness: 0.08, metalness: 0.1, envMapIntensity: 1.6
  });
}

interface Leg {
  root: THREE.Group;    // 肩/股のピボット
  mid: THREE.Group;     // 肘/膝
  cannon: THREE.Group;  // 手根/飛節
  hoofPivot: THREE.Group;
  front: boolean;
  phase: number;        // 歩容内の位相オフセット
  wasDown: boolean;
  hoofWorld: THREE.Vector3;
}

export type GaitMode = 'idle' | 'walk' | 'trot' | 'float';

export class Reindeer {
  readonly params: ReindeerParams;
  readonly root: THREE.Group;
  readonly body: THREE.Group;
  readonly neck: THREE.Group;
  readonly head: THREE.Group;
  readonly earL: THREE.Group;
  readonly earR: THREE.Group;
  private legs: Leg[] = [];
  private bodyMesh!: THREE.Mesh;

  // 装着位置マーカー
  readonly collarSocket: THREE.Object3D;   // 首の付け根
  readonly chestSocket: THREE.Object3D;    // 胸前面（胸当て用）
  readonly traceSocket: THREE.Object3D;    // 牽引線の起点（胸帯の脇）
  readonly muzzleTip: THREE.Object3D;      // 呼気の出所
  readonly backSocket: THREE.Object3D;     // 背（雪よけの基準）

  // 雪の付着
  private snowInst: THREE.InstancedMesh;
  private snowLocal: { pos: THREE.Vector3; rot: THREE.Euler; base: number; scale: number }[] = [];
  private snowDirty = true;

  // アニメーション状態
  mode: GaitMode = 'idle';
  speed = 0;              // 実移動速度 m/s（root の移動は呼び出し側）
  private phase = 0;
  private idleT = 0;
  private blinkT = 0;
  private breathT = 0;
  private seedRand: () => number;
  private stretch = 0;    // 牽引の踏ん張り 0..1
  private liftT = 0;
  headYawTarget = 0;      // 首の左右（注視制御）
  headPitchTarget = 0;
  headRollTarget = 0;     // 首かしげ
  private headYaw = 0;
  private headPitch = 0;
  private headRoll = 0;
  earAlert = 0.5;         // 0=リラックス後ろ 1=前方警戒
  private earFlickT = 0;
  private earFlickSide = 0;
  private lookTimer = 0;
  /** 注視目標（ワールド）。null で正面 */
  gazeTarget: THREE.Vector3 | null = null;
  onFootfall?: (worldPos: THREE.Vector3, weight: number) => void;
  onBreath?: (worldPos: THREE.Vector3) => void;

  private scaleAll: number;

  constructor(params: ReindeerParams) {
    ensureShared();
    this.params = params;
    this.seedRand = mulberry(params.seed * 7 + 1);
    const S = params.shoulderHeight;
    this.scaleAll = S;
    const L = params.bodyLength;
    const C = params.chestDepth;

    this.root = new THREE.Group();
    this.root.name = `deer-${params.name}`;

    const furB = furBodyTextures(params.palette, false);
    const furN = furBodyTextures(params.palette, true); // 首用: 下端にラフ（たてがみ状の淡毛）
    const furH = furHeadTextures(params.palette);
    const legTex = furLegTexture(params.palette);
    // envMapIntensity を絞って毛皮のプラスチック的な照りを消す
    const bodyMat = new THREE.MeshStandardMaterial({
      map: furB.map, bumpMap: furB.bump, bumpScale: 0.9, roughnessMap: furB.rough,
      roughness: 1.0, metalness: 0, envMapIntensity: 0.12
    });
    const neckMat = new THREE.MeshStandardMaterial({
      map: furN.map, bumpMap: furN.bump, bumpScale: 0.9, roughnessMap: furN.rough,
      roughness: 1.0, metalness: 0, envMapIntensity: 0.12
    });
    const headMat = new THREE.MeshStandardMaterial({
      map: furH.map, bumpMap: furH.bump, bumpScale: 0.5, roughness: 0.95, metalness: 0,
      envMapIntensity: 0.12
    });
    const legMat = new THREE.MeshStandardMaterial({
      map: legTex, roughness: 0.95, metalness: 0, envMapIntensity: 0.12
    });
    const antlerMat = new THREE.MeshStandardMaterial({
      color: params.antler.color, roughness: 0.75, metalness: 0.02, envMapIntensity: 0.2
    });

    // --- 胴体 ---------------------------------------------------------------
    // 前が -Z。断面 v=0 が首側になるよう -Z から並べる。
    const secs: LoftSection[] = [
      { z: -0.755 * L, y: 0.05, rx: 0.045, ry: 0.055, bottomBulge: 1.0 },     // 丸い前端の芯
      { z: -0.74 * L, y: 0.07, rx: 0.09, ry: 0.11 * C, bottomBulge: 1.05 },
      { z: -0.70 * L, y: 0.095, rx: 0.14, ry: 0.165 * C, bottomBulge: 1.1 },
      { z: -0.64 * L, y: 0.09, rx: 0.19, ry: 0.24 * C, bottomBulge: 1.18 },
      { z: -0.55 * L, y: 0.10, rx: 0.21, ry: 0.275 * C, bottomBulge: 1.22 },  // 前胸（深い）
      { z: -0.42 * L, y: 0.13, rx: 0.23, ry: 0.30 * C, bottomBulge: 1.18 },    // き甲
      { z: -0.08 * L, y: 0.09, rx: 0.24, ry: 0.275 * C, bottomBulge: 1.05 },
      { z: 0.26 * L, y: 0.08, rx: 0.235, ry: 0.26 * C, bottomBulge: 0.92 },    // 腹線は後ろで上がる
      { z: 0.52 * L, y: 0.11, rx: 0.20, ry: 0.24, bottomBulge: 0.85 },
      { z: 0.66 * L, y: 0.135, rx: 0.135, ry: 0.185, bottomBulge: 0.85 },      // 尻
      { z: 0.73 * L, y: 0.11, rx: 0.06, ry: 0.095, bottomBulge: 0.9 }
    ];
    this.body = new THREE.Group();
    this.body.position.y = 0.84;
    this.root.add(this.body);
    this.bodyMesh = new THREE.Mesh(loft(secs, 18), bodyMat);
    this.bodyMesh.castShadow = true;
    this.bodyMesh.receiveShadow = true;
    this.body.add(this.bodyMesh);

    // --- 首 -----------------------------------------------------------------
    // 胸の前上から前上方へ。下面のラフ（垂れ毛）は bottomBulge で厚く。
    this.neck = new THREE.Group();
    this.neck.position.set(0, 0.18, -0.52 * L);
    this.body.add(this.neck);
    const neckLen = 0.55;
    const neckGeo = loft([
      { z: 0.12, rx: 0.165, ry: 0.225, bottomBulge: 1.45 },
      { z: -0.16, rx: 0.135, ry: 0.185, bottomBulge: 1.6 },
      { z: -0.38, rx: 0.115, ry: 0.155, bottomBulge: 1.45 },
      { z: -neckLen, rx: 0.095, ry: 0.12, bottomBulge: 1.15 }
    ], 14, true, true);
    const neckMesh = new THREE.Mesh(neckGeo, neckMat);
    neckMesh.castShadow = true;
    this.neck.add(neckMesh);
    this.neck.rotation.x = 0.62; // 上向き（正 = 上げる）

    // --- 頭 -----------------------------------------------------------------
    this.head = new THREE.Group();
    this.head.position.set(0, 0.02, -neckLen - 0.02);
    this.neck.add(this.head);
    const headGeo = loft([
      { z: 0.11, rx: 0.090, ry: 0.108 },              // 後頭
      { z: -0.02, rx: 0.097, ry: 0.112 },             // 眼窩部
      { z: -0.14, y: -0.013, rx: 0.075, ry: 0.090 },
      { z: -0.26, y: -0.033, rx: 0.060, ry: 0.068 },  // 鼻梁（まっすぐな顔立ち）
      { z: -0.35, y: -0.049, rx: 0.049, ry: 0.054 },
      { z: -0.40, y: -0.057, rx: 0.038, ry: 0.039 }   // 毛で覆われた鼻先
    ], 14);
    const headMesh = new THREE.Mesh(headGeo, headMat);
    headMesh.castShadow = true;
    this.head.add(headMesh);
    // 鼻先（しっとりした濃色の小さな鼻）
    const noseGeo = new THREE.SphereGeometry(0.026, 10, 8);
    const noseMat = new THREE.MeshStandardMaterial({ color: '#2d221a', roughness: 0.35 });
    const nose = new THREE.Mesh(noseGeo, noseMat);
    nose.position.set(0, -0.057, -0.408);
    nose.scale.set(1.15, 0.8, 1);
    this.head.add(nose);
    // 目（側方に付く）
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(sharedEye!, sharedEyeMat!);
      eye.position.set(sx * 0.077, 0.012, -0.06);
      eye.scale.set(0.75, 1, 1);
      this.head.add(eye);
    }
    // 耳（可動ピボット）
    this.earL = new THREE.Group();
    this.earR = new THREE.Group();
    for (const [grp, sx] of [[this.earL, -1], [this.earR, 1]] as [THREE.Group, number][]) {
      grp.position.set(sx * 0.095, 0.06, 0.055);
      const em = new THREE.Mesh(sharedEar!, headMat);
      em.scale.setScalar(1.15);
      em.castShadow = true;
      grp.add(em);
      grp.rotation.set(0.5, sx * -1.1, sx * 0.25);
      this.head.add(grp);
    }
    // 枝角
    const antlers = this.buildAntlers(antlerMat);
    this.head.add(antlers);
    this.head.rotation.x = -0.4;

    // --- 尾 -----------------------------------------------------------------
    const tail = new THREE.Mesh(sharedTail!, bodyMat);
    tail.position.set(0, 0.17, 0.70 * L);
    tail.rotation.x = -0.6;
    this.body.add(tail);

    // --- 脚 -----------------------------------------------------------------
    const T = params.legThickness;
    const mkLeg = (front: boolean, sx: number, phase: number): Leg => {
      const rootG = new THREE.Group();
      rootG.position.set(sx * (front ? 0.155 : 0.165), front ? 0.12 : 0.10, (front ? -0.5 : 0.52) * L);
      this.body.add(rootG);
      const upper = new THREE.Mesh(sharedLegUpper!, legMat);
      upper.scale.set(T, 1, T);
      upper.castShadow = true;
      rootG.add(upper);
      const mid = new THREE.Group();
      mid.position.y = -0.40;
      rootG.add(mid);
      const lower = new THREE.Mesh(sharedLegLower!, legMat);
      lower.scale.set(T, 1, T);
      lower.castShadow = true;
      mid.add(lower);
      const cannon = new THREE.Group();
      cannon.position.y = -0.26;
      mid.add(cannon);
      const cannonMesh = new THREE.Mesh(sharedLegCannon!, legMat);
      cannonMesh.scale.set(T, 1, T);
      cannonMesh.castShadow = true;
      cannon.add(cannonMesh);
      const hoofPivot = new THREE.Group();
      hoofPivot.position.y = -0.28;
      cannon.add(hoofPivot);
      const hoof = new THREE.Mesh(sharedHoof!, sharedHoofMat!);
      hoof.castShadow = true;
      hoofPivot.add(hoof);
      return { root: rootG, mid, cannon, hoofPivot, front, phase, wasDown: true, hoofWorld: new THREE.Vector3() };
    };
    // 歩様の位相（4拍のウォーク）: LF, RH, RF, LH の順
    this.legs.push(mkLeg(true, -1, 0.0));   // FL
    this.legs.push(mkLeg(true, 1, 0.5));    // FR
    this.legs.push(mkLeg(false, -1, 0.75)); // BL
    this.legs.push(mkLeg(false, 1, 0.25));  // BR

    // --- 毛カード（輪郭の毛羽立ち: 首下ラフ・胸・腹） ------------------------
    const cardMat = new THREE.MeshStandardMaterial({
      map: sharedCardTex!, transparent: false, alphaTest: 0.25,
      side: THREE.DoubleSide, roughness: 1, metalness: 0,
      color: params.palette.ruff
    });
    // 首下のラフ（垂れ毛の房）: 首の軸を含む縦の面のみ（横向きのフィンは作らない）
    const neckCards: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 3; i++) {
      const z = -0.08 - i * 0.15;
      const p = new THREE.PlaneGeometry(0.15, 0.15);
      p.rotateY(Math.PI / 2);
      p.translate(0, -0.20 + i * 0.012, z);
      neckCards.push(p);
    }
    const neckCardMesh = new THREE.Mesh(mergeGeometries(neckCards)!, cardMat);
    this.neck.add(neckCardMesh);

    // --- 装着マーカー --------------------------------------------------------
    this.collarSocket = new THREE.Object3D();
    this.collarSocket.position.set(0, -0.02, -0.10);
    this.neck.add(this.collarSocket);
    this.chestSocket = new THREE.Object3D();
    this.chestSocket.position.set(0, 0.14, -0.58 * L);
    this.body.add(this.chestSocket);
    this.traceSocket = new THREE.Object3D();
    this.traceSocket.position.set(0, -0.22, -0.62 * L);
    this.body.add(this.traceSocket);
    this.muzzleTip = new THREE.Object3D();
    this.muzzleTip.position.set(0, -0.07, -0.40);
    this.head.add(this.muzzleTip);
    this.backSocket = new THREE.Object3D();
    this.backSocket.position.set(0, 0.35, -0.1);
    this.body.add(this.backSocket);

    // --- 雪の付着（上面にたまる圧雪の塊） ------------------------------------
    const snowMat = new THREE.MeshStandardMaterial({ color: '#eef2f8', roughness: 0.9, metalness: 0 });
    const COUNT = 34;
    this.snowInst = new THREE.InstancedMesh(sharedSnowCake!, snowMat, COUNT);
    this.snowInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.snowInst.castShadow = false;
    const r = mulberry(params.seed + 77);
    for (let i = 0; i < COUNT; i++) {
      // 背〜尻の上面と首上面にランダム配置
      const onNeck = r() < 0.25;
      let pos: THREE.Vector3, rot: THREE.Euler;
      if (onNeck) {
        pos = new THREE.Vector3((r() - 0.5) * 0.14, 0.15 + r() * 0.04, -0.1 - r() * 0.3);
        rot = new THREE.Euler(0.5, r() * Math.PI, 0);
      } else {
        const z = (-0.5 + r() * 1.1) * L;
        const lateral = (r() - 0.5) * 0.32;
        const yTop = 0.30 - Math.abs(lateral) * 0.55 + (z < 0 ? 0.05 : 0.0);
        pos = new THREE.Vector3(lateral, yTop, z);
        rot = new THREE.Euler((r() - 0.5) * 0.4 + lateral * -1.2, r() * Math.PI, 0);
      }
      this.snowLocal.push({ pos, rot, base: 0.10 + r() * 0.13, scale: 0 });
    }
    this.body.add(this.snowInst);
    this.updateSnowMatrices();

    this.root.scale.setScalar(S);
    this.root.traverse((o) => { o.matrixAutoUpdate = true; });
  }

  // ---------------------------------------------------------------------
  private buildAntlers(mat: THREE.MeshStandardMaterial): THREE.Mesh {
    const A = this.params.antler;
    const geos: THREE.BufferGeometry[] = [];
    const rnd = mulberry(this.params.seed + 5);
    for (const side of [-1, 1]) {
      const k = 1 + (side === 1 ? A.asym : -A.asym);
      const H = A.height * k;
      const SP = A.spread;
      const CV = A.curve;
      const bx = side * 0.038;
      const base = new THREE.Vector3(bx, 0.10, 0.02);
      // 主幹: 後上方へ立ち上がり、上部で前方へ湾曲
      const beam = [
        base,
        new THREE.Vector3(side * 0.09 * SP, 0.10 + 0.16 * H, 0.13),
        new THREE.Vector3(side * 0.13 * SP, 0.10 + 0.36 * H, 0.17),
        new THREE.Vector3(side * 0.15 * SP, 0.10 + 0.55 * H, 0.10 - 0.06 * CV),
        new THREE.Vector3(side * 0.13 * SP, 0.10 + 0.66 * H, -0.05 - 0.10 * CV),
        new THREE.Vector3(side * 0.11 * SP, 0.10 + 0.70 * H, -0.16 - 0.10 * CV)
      ];
      geos.push(taperedTube(beam, 0.027, 0.009, 7, 18));
      // 眉枝（ブラウタイン）: 基部から顔の上へ前方に張り出す
      const brow = [
        new THREE.Vector3(bx, 0.115, 0.01),
        new THREE.Vector3(side * 0.05, 0.14, -0.10),
        new THREE.Vector3(side * 0.04, 0.175, -0.20)
      ];
      geos.push(taperedTube(brow, 0.016, 0.006, 6, 8));
      // ベズ枝: 眉枝の上、前方やや外へ
      const bez = [
        new THREE.Vector3(side * 0.07 * SP, 0.10 + 0.17 * H, 0.12),
        new THREE.Vector3(side * 0.10 * SP, 0.10 + 0.24 * H, -0.02),
        new THREE.Vector3(side * 0.12 * SP, 0.10 + 0.30 * H, -0.12)
      ];
      geos.push(taperedTube(bez, 0.014, 0.005, 6, 8));
      // 後枝
      const rear = [
        new THREE.Vector3(side * 0.12 * SP, 0.10 + 0.40 * H, 0.16),
        new THREE.Vector3(side * 0.16 * SP, 0.10 + 0.47 * H, 0.24)
      ];
      geos.push(taperedTube(rear, 0.012, 0.005, 6, 6));
      // 先端の枝
      for (let i = 0; i < A.topPoints; i++) {
        const t0 = 0.58 + i * 0.07;
        const from = new THREE.Vector3(
          side * (0.14 - i * 0.01) * SP,
          0.10 + t0 * H,
          0.02 - 0.16 * CV * (t0 - 0.5) * 2
        );
        const dir = new THREE.Vector3(side * (rnd() - 0.35) * 0.05, 0.05 + rnd() * 0.04, -0.09 - rnd() * 0.05);
        geos.push(taperedTube([from, from.clone().add(dir), from.clone().add(dir).add(
          new THREE.Vector3(0, 0.045, -0.03))], 0.011, 0.004, 6, 6));
      }
    }
    const merged = mergeGeometries(geos)!;
    for (const g of geos) g.dispose();
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    return mesh;
  }

  // ---------------------------------------------------------------------
  /** 雪の被り具合 0..1 を一括設定 */
  setSnowCover(amount: number): void {
    for (const s of this.snowLocal) s.scale = amount;
    this.snowDirty = true;
    this.updateSnowMatrices();
  }

  get snowCover(): number {
    let t = 0;
    for (const s of this.snowLocal) t += s.scale;
    return t / this.snowLocal.length;
  }

  /**
   * ブラシ: ワールド座標 near と掃く方向で近傍の雪塊を払う。
   * 返り値: 払われた塊のワールド位置（粒子の発生源）
   */
  brushAt(world: THREE.Vector3, alongFur: boolean): THREE.Vector3[] {
    const local = this.body.worldToLocal(world.clone());
    const removed: THREE.Vector3[] = [];
    const reach = alongFur ? 0.34 : 0.18;
    const rate = alongFur ? 1 : 0.35;
    for (const s of this.snowLocal) {
      if (s.scale <= 0.01) continue;
      if (s.pos.distanceTo(local) < reach) {
        s.scale = Math.max(0, s.scale - rate);
        if (s.scale <= 0.01) {
          s.scale = 0;
          removed.push(this.body.localToWorld(s.pos.clone()));
        }
        this.snowDirty = true;
      }
    }
    if (this.snowDirty) this.updateSnowMatrices();
    return removed;
  }

  private updateSnowMatrices(): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    for (let i = 0; i < this.snowLocal.length; i++) {
      const s = this.snowLocal[i];
      q.setFromEuler(s.rot);
      const sc = s.base * s.scale;
      m.compose(s.pos, q, v.set(sc, sc, sc));
      this.snowInst.setMatrixAt(i, m);
    }
    this.snowInst.instanceMatrix.needsUpdate = true;
    this.snowInst.count = this.snowLocal.length;
    this.snowDirty = false;
  }

  // ---------------------------------------------------------------------
  /** 首をかしげる（誤配置への優しい反応） */
  tiltHead(): void {
    this.headRollTarget = (this.seedRand() < 0.5 ? 1 : -1) * 0.35;
    this.earAlert = 0.9;
    setTimeout(() => { this.headRollTarget = 0; }, 1100);
  }

  /** 装具が正しく収まったときの安堵（耳が緩み、頭がわずかに下がる） */
  calmSettle(): void {
    this.earAlert = 0.15;
    this.headPitchTarget = 0.18;
    setTimeout(() => {
      this.headPitchTarget = 0;
      this.earAlert = 0.5;
      if (this.onBreath) {
        const p = new THREE.Vector3();
        this.muzzleTip.getWorldPosition(p);
        this.onBreath(p);
      }
    }, 900);
  }

  perkUp(): void {
    this.earAlert = 1;
    this.headPitchTarget = -0.12;
    setTimeout(() => { this.headPitchTarget = 0; }, 800);
  }

  /** 牽引の踏ん張り表現（0..1）。張力立ち上がりで呼ぶ */
  setStretch(v: number): void {
    this.stretch = v;
  }

  // ---------------------------------------------------------------------
  update(dt: number, elapsed: number): void {
    const S = this.scaleAll;
    this.idleT += dt;
    this.breathT += dt;
    this.blinkT -= dt;

    // --- 注視: gazeTarget があれば首と頭をそちらへ向ける -------------------
    if (this.gazeTarget) {
      const local = this.root.worldToLocal(this.gazeTarget.clone());
      const yaw = Math.atan2(-(local.x), -(local.z));
      this.headYawTarget = THREE.MathUtils.clamp(yaw, -1.1, 1.1);
      const dist = Math.hypot(local.x, local.z);
      const pitch = Math.atan2(local.y - 1.4, dist);
      this.headPitchTarget = THREE.MathUtils.clamp(-pitch * 0.5, -0.3, 0.5);
    }
    const k = 1 - Math.exp(-dt * 5);
    this.headYaw += (this.headYawTarget - this.headYaw) * k;
    this.headPitch += (this.headPitchTarget - this.headPitch) * k;
    this.headRoll += (this.headRollTarget - this.headRoll) * k;

    // --- 呼吸（胸郭のふくらみ） -------------------------------------------
    const breathRate = this.mode === 'trot' || this.mode === 'float' ? 1.4 : 0.42;
    const breath = Math.sin(this.breathT * Math.PI * 2 * breathRate);
    this.bodyMesh.scale.set(1 + breath * 0.012, 1 + breath * 0.016, 1);
    if (this.breathT * breathRate > 1) {
      this.breathT = 0;
      if (this.onBreath && this.seedRand() < 0.6) {
        const p = new THREE.Vector3();
        this.muzzleTip.getWorldPosition(p);
        this.onBreath(p);
      }
    }

    // --- 歩容 -------------------------------------------------------------
    const spd = this.speed / S;
    const strideLen = 0.75;
    if (this.mode === 'walk' || this.mode === 'trot') {
      const freq = Math.max(0.55, spd / strideLen);
      this.phase += dt * freq;
    } else if (this.mode === 'float') {
      this.liftT += dt;
    } else {
      // 停止中も位相をゆっくり接地へ戻す
      const target = Math.round(this.phase);
      this.phase += (target - this.phase) * Math.min(1, dt * 4);
    }

    const trotBlend = this.mode === 'trot' ? 1 : 0;
    const amp = this.mode === 'idle' ? 0 : THREE.MathUtils.clamp(spd / 1.2, 0.25, 1.35);

    for (let i = 0; i < this.legs.length; i++) {
      const leg = this.legs[i];
      // トロットでは対角二拍へ位相を寄せる
      const walkPhase = leg.phase;
      const trotPhase = (i === 0 || i === 3) ? 0 : 0.5; // FL+BR / FR+BL
      const ph = THREE.MathUtils.lerp(walkPhase, trotPhase, trotBlend);
      const t = (this.phase + ph) % 1;
      const swing = Math.sin(t * Math.PI * 2);
      const liftPhase = Math.max(0, Math.sin(t * Math.PI * 2 + Math.PI / 2));

      if (this.mode === 'float') {
        // 滞空: 前脚は前方へ畳み、後脚は後方へ流す（跳躍の空中姿勢）
        const f = Math.min(1, this.liftT * 2);
        const wob = Math.sin(elapsed * 3 + i) * 0.05;
        if (leg.front) {
          leg.root.rotation.x = THREE.MathUtils.lerp(leg.root.rotation.x, 0.5 + wob, f * 0.1);
          leg.mid.rotation.x = THREE.MathUtils.lerp(leg.mid.rotation.x, -1.4, f * 0.1);
          leg.cannon.rotation.x = THREE.MathUtils.lerp(leg.cannon.rotation.x, 0.6, f * 0.1);
        } else {
          leg.root.rotation.x = THREE.MathUtils.lerp(leg.root.rotation.x, -0.55 + wob, f * 0.1);
          leg.mid.rotation.x = THREE.MathUtils.lerp(leg.mid.rotation.x, 0.5, f * 0.1);
          leg.cannon.rotation.x = THREE.MathUtils.lerp(leg.cannon.rotation.x, -0.7, f * 0.1);
        }
        leg.hoofPivot.rotation.x = 0.35;
        continue;
      }

      // 踏ん張り: 牽引開始時は前傾し脚を後方へ押す
      const dig = this.stretch * (leg.front ? 0.16 : 0.22);

      if (leg.front) {
        leg.root.rotation.x = swing * 0.5 * amp - 0.04 - dig;
        leg.mid.rotation.x = -0.06 - liftPhase * 0.9 * amp;
        leg.cannon.rotation.x = 0.04 + liftPhase * 0.55 * amp;
        leg.hoofPivot.rotation.x = liftPhase * 0.4 * amp;
      } else {
        // 後肢: 股-膝-飛節のジグザグ
        leg.root.rotation.x = swing * 0.45 * amp + 0.35 - dig;
        leg.mid.rotation.x = -0.65 - liftPhase * 0.55 * amp;
        leg.cannon.rotation.x = 0.38 + liftPhase * 0.4 * amp;
        leg.hoofPivot.rotation.x = -0.1 + liftPhase * 0.3 * amp;
      }

      // 接地イベント
      const down = swing < -0.55;
      if (down && !leg.wasDown && this.mode !== 'idle' && this.onFootfall) {
        leg.hoofPivot.getWorldPosition(leg.hoofWorld);
        this.onFootfall(leg.hoofWorld, amp);
      }
      leg.wasDown = down;
    }

    // idle: 立ち姿勢へ緩やかに戻し、時折の体重移動・脚踏み
    if (this.mode === 'idle') {
      const rest = (leg: Leg, rx: number, mx: number, cx: number) => {
        leg.root.rotation.x += (rx - leg.root.rotation.x) * Math.min(1, dt * 3);
        leg.mid.rotation.x += (mx - leg.mid.rotation.x) * Math.min(1, dt * 3);
        leg.cannon.rotation.x += (cx - leg.cannon.rotation.x) * Math.min(1, dt * 3);
        leg.hoofPivot.rotation.x += (0 - leg.hoofPivot.rotation.x) * Math.min(1, dt * 3);
      };
      const shift = Math.sin(this.idleT * 0.35) * 0.03;
      rest(this.legs[0], -0.05 + shift, -0.05, 0.04);
      rest(this.legs[1], -0.03 - shift, -0.06, 0.05);
      rest(this.legs[2], 0.35 + shift, -0.66, 0.40);
      rest(this.legs[3], 0.37 - shift, -0.64, 0.38);
      // 前脚の軽い雪掻き（脚踏み）: ときどき
      if (this.idleT > 6 + this.seedRand() * 6) {
        this.idleT = 0;
        const pawLeg = this.legs[this.seedRand() < 0.5 ? 0 : 1];
        const seq = [0.35, -0.15, 0.3, -0.05];
        seq.forEach((v, j) => {
          setTimeout(() => { pawLeg.root.rotation.x = v; }, j * 160);
        });
      }
    }

    // --- 体幹の上下動・ピッチ ---------------------------------------------
    let bodyY = 0.84, bodyPitch = 0;
    if (this.mode === 'walk' || this.mode === 'trot') {
      bodyY += Math.abs(Math.sin(this.phase * Math.PI * 2)) * 0.028 * amp;
      bodyPitch = Math.sin(this.phase * Math.PI * 4) * 0.012 * amp;
    } else if (this.mode === 'float') {
      bodyY += 0.05 + Math.sin(elapsed * 2.2 + this.params.seed) * 0.035;
      bodyPitch = -0.10 + Math.sin(elapsed * 1.7) * 0.03;
    }
    bodyPitch += this.stretch * 0.10; // 踏ん張りの前傾
    this.body.position.y += (bodyY - this.body.position.y) * Math.min(1, dt * 8);
    this.body.rotation.x += (bodyPitch - this.body.rotation.x) * Math.min(1, dt * 8);

    // --- 首・頭 ------------------------------------------------------------
    const neckBase = this.mode === 'float' ? 0.85
      : this.mode === 'trot' ? 0.72
      : this.mode === 'walk' ? 0.60 : 0.62;
    const neckBob = (this.mode === 'walk') ? Math.sin(this.phase * Math.PI * 2) * 0.05 * amp : 0;
    this.neck.rotation.x += (neckBase + neckBob - this.stretch * 0.22 - this.neck.rotation.x) * Math.min(1, dt * 5);
    this.neck.rotation.y += (this.headYaw * 0.45 - this.neck.rotation.y) * Math.min(1, dt * 5);
    this.head.rotation.y = this.headYaw * 0.55;
    this.head.rotation.x = -0.40 - this.neck.rotation.x * 0.62 + this.headPitch;
    this.head.rotation.z = this.headRoll;

    // --- 耳 ----------------------------------------------------------------
    this.earFlickT -= dt;
    if (this.earFlickT < 0) {
      this.earFlickT = 2 + this.seedRand() * 5;
      this.earFlickSide = this.seedRand() < 0.5 ? 0 : 1;
    }
    const flick = this.earFlickT > (2 + 5) - 0.25 ? Math.sin(this.earFlickT * 40) * 0.3 : 0;
    const earFwd = THREE.MathUtils.lerp(1.15, 0.25, this.earAlert); // alert=1 で前へ
    const targetL = new THREE.Euler(earFwd * 0.5, -0.9 + (1 - this.earAlert) * -0.35, -0.25 - earFwd * 0.2);
    const targetR = new THREE.Euler(earFwd * 0.5, 0.9 + (1 - this.earAlert) * 0.35, 0.25 + earFwd * 0.2);
    const ek = Math.min(1, dt * 6);
    this.earL.rotation.x += (targetL.x + (this.earFlickSide === 0 ? flick : 0) - this.earL.rotation.x) * ek;
    this.earL.rotation.y += (targetL.y - this.earL.rotation.y) * ek;
    this.earL.rotation.z += (targetL.z - this.earL.rotation.z) * ek;
    this.earR.rotation.x += (targetR.x + (this.earFlickSide === 1 ? flick : 0) - this.earR.rotation.x) * ek;
    this.earR.rotation.y += (targetR.y - this.earR.rotation.y) * ek;
    this.earR.rotation.z += (targetR.z - this.earR.rotation.z) * ek;
  }

  /** 立ち姿勢の静的リセット（モード遷移時のガタつき防止用） */
  settleToIdle(): void {
    this.mode = 'idle';
    this.speed = 0;
    this.stretch = 0;
    this.liftT = 0;
  }

  /** ボディの当たり判定に使うメッシュ */
  get hitMesh(): THREE.Mesh {
    return this.bodyMesh;
  }
}
