// 花システム：花びらを種類ごとの InstancedMesh に集約し、
// つぼみ→開花（bloom 0..1）を行列更新で連続アニメーションする。

import * as THREE from 'three';

export const FLOWER_COLORS = [0xff86b3, 0xffd25e, 0xbd9bff, 0x8fd4ff]; // ピンク・黄・ラベンダー・水色
export const FLOWER_TYPE_LIST = ['rose', 'tulip', 'daisy'];

// 花びら形状：原点=付け根、+Y方向に伸び、+Z側へ外反り
function makePetalGeometry(L, W, { bend = 0.5, cup = 0.5, tip = 0.3, segs = 4, rows = 6 } = {}) {
  const geo = new THREE.BufferGeometry();
  const pos = [], uv = [], idx = [];
  for (let r = 0; r <= rows; r++) {
    const v = r / rows;
    const widthProfile = 0.22 + 0.95 * Math.pow(Math.sin(Math.min(1, v * 1.04) * Math.PI), 0.65);
    for (let c = 0; c <= segs; c++) {
      const u = c / segs - 0.5;
      const x = u * W * widthProfile;
      const y = v * L;
      // 外反り（bend）＋横方向カップ（cup）＋先端そり返り（tip）
      let z = bend * L * v * v + cup * W * (u * u) * (0.4 + 0.6 * v);
      z += tip * L * Math.pow(Math.max(0, v - 0.75) / 0.25, 2) * 0.5;
      pos.push(x, y, z);
      uv.push(c / segs, v);
    }
  }
  const cols = segs + 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < segs; c++) {
      const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// 花びらの淡いグラデーションテクスチャ（instanceColor と乗算される）
function makePetalTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 128, 0, 0);
  grad.addColorStop(0, '#c9c0b6');   // 付け根は少し深い色
  grad.addColorStop(0.35, '#ffffff');
  grad.addColorStop(1, '#fff6ee');   // 先端明るく
  g.fillStyle = grad; g.fillRect(0, 0, 64, 128);
  // 縦の淡い筋（花脈）
  g.globalAlpha = 0.08; g.strokeStyle = '#9a8f85';
  for (let i = 0; i < 7; i++) {
    g.beginPath();
    g.moveTo(32 + (i - 3) * 3, 126);
    g.quadraticCurveTo(32 + (i - 3) * 9, 60, 32 + (i - 3) * 11, 6);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 花タイプ定義：花びら層（whorl）ごとの枚数・閉/開の傾き・スケール
const TYPE_DEFS = {
  rose: {
    petalGeo: () => makePetalGeometry(0.05, 0.054, { bend: 0.55, cup: 0.9, tip: 0.5 }),
    whorls: [
      { n: 6, r: 0.004, h: 0.006, closed: 0.04, open: 0.3, s: 0.5, yawOff: 0 },
      { n: 8, r: 0.007, h: 0.004, closed: 0.10, open: 0.62, s: 0.8, yawOff: 0.45 },
      { n: 9, r: 0.010, h: 0.002, closed: 0.18, open: 0.95, s: 1.05, yawOff: 0.85 },
    ],
    center: null,
    headR: 0.045,
  },
  tulip: {
    petalGeo: () => makePetalGeometry(0.062, 0.048, { bend: 0.18, cup: 1.0, tip: -0.25 }),
    whorls: [
      { n: 3, r: 0.005, h: 0.004, closed: 0.05, open: 0.38, s: 0.92, yawOff: 0 },
      { n: 3, r: 0.008, h: 0.002, closed: 0.12, open: 0.58, s: 1.0, yawOff: Math.PI / 3 },
    ],
    center: { r: 0.010, color: 0x3d5a2a, squash: 1.2 },
    headR: 0.04,
  },
  daisy: {
    petalGeo: () => makePetalGeometry(0.052, 0.016, { bend: 0.22, cup: 0.3, tip: 0.15 }),
    whorls: [
      { n: 13, r: 0.009, h: 0.004, closed: 0.10, open: 1.18, s: 0.9, yawOff: 0.24 },
      { n: 13, r: 0.011, h: 0.002, closed: 0.20, open: 1.42, s: 1.0, yawOff: 0 },
    ],
    center: { r: 0.014, color: 0xe8a02c, squash: 0.65 },
    headR: 0.05,
  },
};

// 会場全体で保持できる花の上限。花びらの InstancedMesh 容量もこの値から
// 導出し、花の種類ごとに枚数が違っても同じ数の花を安全に配置できるようにする。
export const MAX_FLOWER_HEADS = 1000;

const PETALS_PER_FLOWER = Object.freeze(Object.fromEntries(
  FLOWER_TYPE_LIST.map(type => [
    type,
    TYPE_DEFS[type].whorls.reduce((sum, whorl) => sum + whorl.n, 0),
  ]),
));
const PETAL_CAPACITY = Object.freeze(Object.fromEntries(
  FLOWER_TYPE_LIST.map(type => [type, MAX_FLOWER_HEADS * PETALS_PER_FLOWER[type]]),
));
const CENTER_CAPACITY = MAX_FLOWER_HEADS;
const CALYX_CAPACITY = MAX_FLOWER_HEADS;

const _m = new THREE.Matrix4();
const _mYaw = new THREE.Matrix4();
const _mT = new THREE.Matrix4();
const _mTilt = new THREE.Matrix4();
const _mS = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);

function easeBloom(t) {
  // ふわっと開いて最後に少し弾む
  const u = Math.min(1, Math.max(0, t));
  const back = 1.35;
  const e = u * u * (3 - 2 * u);
  return e + Math.sin(e * Math.PI) * 0.08 * back * u;
}

export class FlowerSystem {
  constructor(scene) {
    this.scene = scene;
    this.flowers = [];
    this.time = 0;
    const petalTex = makePetalTexture();
    this.meshes = {};
    this.counts = {};
    for (const type of FLOWER_TYPE_LIST) {
      const def = TYPE_DEFS[type];
      const mat = new THREE.MeshStandardMaterial({
        map: petalTex, side: THREE.DoubleSide,
        roughness: 0.55, metalness: 0.0,
      });
      const im = new THREE.InstancedMesh(def.petalGeo(), mat, PETAL_CAPACITY[type]);
      im.count = 0;
      im.castShadow = true;
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(im);
      this.meshes[type] = im;
      this.counts[type] = 0;
    }
    // 花芯（デイジー等の中心）
    const cGeo = new THREE.SphereGeometry(1, 10, 8);
    const cMat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
    this.centerMesh = new THREE.InstancedMesh(cGeo, cMat, CENTER_CAPACITY);
    this.centerMesh.count = 0; this.centerMesh.frustumCulled = false;
    this.centerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.centerMesh);
    this.centerCount = 0;
    // がく（つぼみを包む緑）
    const kGeo = new THREE.ConeGeometry(1, 1.4, 6);
    kGeo.translate(0, 0.55, 0);
    const kMat = new THREE.MeshStandardMaterial({ color: 0x4c7a35, roughness: 0.7 });
    this.calyxMesh = new THREE.InstancedMesh(kGeo, kMat, CALYX_CAPACITY);
    this.calyxMesh.count = 0; this.calyxMesh.frustumCulled = false;
    this.calyxMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.calyxMesh);
    this.calyxCount = 0;
  }

  // parent: Object3D（省略時はワールド直置き）。position/quaternion は parent ローカル。
  // dynamic: 親が動き続ける花（吊り飾り等）は毎フレーム行列を更新する。
  add(type, colorHex, { parent = null, position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = 1, bloom = 0, dynamic = false } = {}) {
    const def = TYPE_DEFS[type];
    const im = this.meshes[type];
    const petalsNeeded = PETALS_PER_FLOWER[type];

    // InstancedMesh は確保容量を超えた setMatrixAt/setColorAt を受け付けない。
    // 途中まで count を進めた不完全な花を残さないよう、すべての枠を先に検査する。
    if (!def || !im || !petalsNeeded) {
      throw new TypeError(`Unknown flower type: ${type}`);
    }
    if (this.flowers.length + 1 > MAX_FLOWER_HEADS) {
      throw new RangeError(`Flower head capacity exceeded (${MAX_FLOWER_HEADS})`);
    }
    if (this.counts[type] + petalsNeeded > PETAL_CAPACITY[type]) {
      throw new RangeError(`Petal capacity exceeded for ${type} (${PETAL_CAPACITY[type]})`);
    }
    if (def.center && this.centerCount + 1 > CENTER_CAPACITY) {
      throw new RangeError(`Flower center capacity exceeded (${CENTER_CAPACITY})`);
    }
    if (this.calyxCount + 1 > CALYX_CAPACITY) {
      throw new RangeError(`Flower calyx capacity exceeded (${CALYX_CAPACITY})`);
    }

    const petals = [];
    const color = new THREE.Color(colorHex);
    for (let w = 0; w < def.whorls.length; w++) {
      const wh = def.whorls[w];
      for (let i = 0; i < wh.n; i++) {
        const id = this.counts[type]++;
        im.setColorAt(id, color);
        petals.push({
          id,
          yaw: (i / wh.n) * Math.PI * 2 + wh.yawOff,
          r: wh.r, h: wh.h,
          closed: wh.closed, open: wh.open, s: wh.s,
          jitter: 0.92 + Math.random() * 0.16,
        });
      }
    }
    im.count = this.counts[type];
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    let centerId = -1;
    if (def.center) {
      centerId = this.centerCount++;
      this.centerMesh.setColorAt(centerId, new THREE.Color(def.center.color));
      this.centerMesh.count = this.centerCount;
      if (this.centerMesh.instanceColor) this.centerMesh.instanceColor.needsUpdate = true;
    }
    const calyxId = this.calyxCount++;
    this.calyxMesh.count = this.calyxCount;
    const h = {
      type, def, petals, centerId, calyxId,
      parent, position: position.clone(), quaternion: quaternion.clone(),
      scale, bloom, targetBloom: bloom, bloomSpeed: 1.6, bloomDelay: 0,
      popT: -1, visible: true, swayAmp: 0, swayPhase: Math.random() * 6.28,
      colorHex, dynamic, dirty: true,
    };
    this.flowers.push(h);
    return h;
  }

  // 検証用APIへ安全に公開できる、現在値だけの読み取り専用スナップショット。
  get capacityUsage() {
    const petals = Object.fromEntries(FLOWER_TYPE_LIST.map(type => {
      const used = this.counts[type];
      const capacity = PETAL_CAPACITY[type];
      return [type, Object.freeze({
        used,
        capacity,
        remaining: capacity - used,
        petalsPerFlower: PETALS_PER_FLOWER[type],
      })];
    }));
    const usage = (used, capacity) => Object.freeze({
      used,
      capacity,
      remaining: capacity - used,
    });

    return Object.freeze({
      heads: usage(this.flowers.length, MAX_FLOWER_HEADS),
      petals: Object.freeze(petals),
      centers: usage(this.centerCount, CENTER_CAPACITY),
      calyxes: usage(this.calyxCount, CALYX_CAPACITY),
    });
  }

  setBloomAll(target, baseDelay = 0, stagger = 1.2) {
    for (const f of this.flowers) {
      if (!f.visible) continue;
      f.targetBloom = target;
      f.bloomDelay = baseDelay + Math.random() * stagger;
    }
  }

  update(dt, camera) {
    this.time += dt;
    const t = this.time;
    let bloomedNow = 0;
    const touched = { rose: false, tulip: false, daisy: false };
    let touchedExtra = false;
    for (const f of this.flowers) {
      // 動いていない花は行列を書き直さない（大量の花でも軽い）
      let animating = f.dirty || f.dynamic || f.swayAmp > 0;
      // 開花進行
      if (f.bloomDelay > 0) { f.bloomDelay -= dt; animating = true; }
      else if (f.bloom !== f.targetBloom) {
        const dir = Math.sign(f.targetBloom - f.bloom);
        f.bloom += dir * dt * f.bloomSpeed;
        if ((dir > 0 && f.bloom >= f.targetBloom) || (dir < 0 && f.bloom <= f.targetBloom)) {
          f.bloom = f.targetBloom;
          if (dir > 0 && f.targetBloom >= 1) bloomedNow++;
        }
        animating = true;
      }
      // 配置時ポップ
      let popScale = 1;
      if (f.popT >= 0) {
        f.popT += dt * 2.6;
        animating = true;
        if (f.popT >= 1) { f.popT = -1; }
        else {
          const p = f.popT;
          popScale = p < 0.6 ? (p / 0.6) * 1.15 : 1.15 - 0.15 * ((p - 0.6) / 0.4);
        }
      }
      if (!animating) continue;
      f.dirty = false;
      this._writeMatrices(f, popScale, t);
      touched[f.type] = true;
      touchedExtra = true;
    }
    for (const type of FLOWER_TYPE_LIST) {
      if (touched[type]) this.meshes[type].instanceMatrix.needsUpdate = true;
    }
    if (touchedExtra) {
      this.centerMesh.instanceMatrix.needsUpdate = true;
      this.calyxMesh.instanceMatrix.needsUpdate = true;
    }
    return bloomedNow;
  }

  _writeMatrices(f, popScale, t) {
    const im = this.meshes[f.type];
    if (!f.visible) {
      for (const p of f.petals) im.setMatrixAt(p.id, _zero);
      if (f.centerId >= 0) this.centerMesh.setMatrixAt(f.centerId, _zero);
      this.calyxMesh.setMatrixAt(f.calyxId, _zero);
      return;
    }
    // 花のベース行列（parent考慮＋ゆらぎ）
    _q.copy(f.quaternion);
    if (f.swayAmp > 0) {
      const a = Math.sin(t * 1.3 + f.swayPhase) * f.swayAmp;
      const b = Math.cos(t * 0.9 + f.swayPhase * 1.7) * f.swayAmp * 0.6;
      const qs = new THREE.Quaternion().setFromEuler(new THREE.Euler(a, 0, b));
      _q.multiply(qs);
    }
    const s = f.scale * popScale;
    _m.compose(f.position, _q, _v.set(s, s, s));
    if (f.parent) {
      f.parent.updateWorldMatrix(true, false);
      _m.premultiply(f.parent.matrixWorld);
    }
    const base = _m.clone();
    const bl = easeBloom(f.bloom);
    const petalScaleG = 0.75 + 0.25 * bl;
    for (const p of f.petals) {
      _mYaw.makeRotationY(p.yaw);
      _mT.makeTranslation(0, p.h, p.r);
      const tilt = p.closed + (p.open - p.closed) * bl * p.jitter;
      _mTilt.makeRotationX(tilt);
      const ps = p.s * petalScaleG;
      _mS.makeScale(ps, ps, ps);
      _m.copy(base).multiply(_mYaw).multiply(_mT).multiply(_mTilt).multiply(_mS);
      im.setMatrixAt(p.id, _m);
    }
    if (f.centerId >= 0) {
      const c = f.def.center;
      const cs = c.r * (0.5 + 0.5 * bl);
      _mS.makeScale(cs, cs * c.squash, cs);
      _mT.makeTranslation(0, f.def.center.squash * cs * 0.5, 0);
      _m.copy(base).multiply(_mT).multiply(_mS);
      this.centerMesh.setMatrixAt(f.centerId, _m);
    }
    // がく：つぼみ時は花を包み、開花で下がって縮む
    const kR = f.def.headR * (0.95 - 0.45 * bl);
    const kH = f.def.headR * (1.05 - 0.62 * bl);
    _mS.makeScale(kR, kH, kR);
    _mT.makeTranslation(0, -f.def.headR * 0.55, 0);
    _m.copy(base).multiply(_mT).multiply(_mS);
    this.calyxMesh.setMatrixAt(f.calyxId, _m);
  }
}

// ---- リボン（ちょうちょ結び） ----
export function makeBow(colorHex, scale = 1) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.4, metalness: 0.05 });
  const loopGeo = new THREE.TorusGeometry(0.055, 0.016, 8, 20);
  const l1 = new THREE.Mesh(loopGeo, mat);
  l1.scale.set(1, 0.7, 0.42);
  l1.position.set(-0.055, 0.01, 0);
  l1.rotation.z = 0.5;
  const l2 = l1.clone();
  l2.position.x = 0.055;
  l2.rotation.z = -0.5;
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), mat);
  knot.scale.set(1.15, 0.85, 0.8);
  const tailGeo = makePetalGeometry(0.09, 0.034, { bend: -0.35, cup: 0.25, tip: 0.1 });
  const t1 = new THREE.Mesh(tailGeo, mat);
  t1.rotation.set(Math.PI * 0.92, 0, 0.35);
  const t2 = new THREE.Mesh(tailGeo, mat);
  t2.rotation.set(Math.PI * 0.92, 0, -0.35);
  g.add(l1, l2, knot, t1, t2);
  g.scale.setScalar(scale);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// 花びら1枚のジオメトリ（舞い散り用・軽量）
export function makeLoosePetalGeometry() {
  return makePetalGeometry(0.032, 0.026, { bend: 0.45, cup: 0.6, tip: 0.3, segs: 3, rows: 4 });
}
