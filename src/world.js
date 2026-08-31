// 郵便局の作業机。すべて実メッシュ・実厚み。背景は思い切って軽く。
import * as THREE from './three.js';
import {
  texFromCanvas, woodCanvas, woodRoughCanvas, feltCanvas,
  padClothCanvas, padRoughCanvas, paperCanvas, paperRoughCanvas, paperBumpCanvas,
} from './textures.js';
import { INKS } from './seals.js';

// ---------- レイアウト（単位 cm） ----------
export const L = {
  deskTop: 0,          // 机の天板 y
  matTop: 0.34,        // フェルトマットの上面 = 作業面
  slotX: [-7.8, -2.6, 2.6, 7.8],
  rackZ: -10.6,
  // インクパッドは机の左右に置く。運ぶ道の上には置かない（うっかり色が変わらないように）
  padPos: [[-9.7, 0.2], [-9.7, 6.6], [9.7, 0.2], [9.7, 6.6]],
  padR: 1.78,
  padTop: 0.34 + 0.58,   // インク面（縁より一段低い）
  cardZ: 6.8,
  cardW: 10.0,
  cardD: 14.8,
  cardH: 0.062,
  // はがきローカル座標（x, z）：切手と押印位置
  stampLocal: [-2.95, -5.05],
  stampW: 2.45,
  stampD: 2.95,
  pressLocal: [-1.50, -3.60],
  collectZ: -18.0,   // 集めたカードを立てかける棚の受け
  collectY: 1.9,
};
export const cardTopY = L.matTop + L.cardH;
export const pressWorld = new THREE.Vector3(L.pressLocal[0], cardTopY, L.cardZ + L.pressLocal[1]);

// ---------- 形の道具 ----------
export function roundedSlab(w, d, h, r = 0.25, bevel = 0.12) {
  const s = new THREE.Shape();
  const hw = w / 2 - r, hd = d / 2 - r;
  s.absarc(hw, hd, r, 0, Math.PI / 2);
  s.absarc(-hw, hd, r, Math.PI / 2, Math.PI);
  s.absarc(-hw, -hd, r, Math.PI, Math.PI * 1.5);
  s.absarc(hw, -hd, r, Math.PI * 1.5, Math.PI * 2);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: Math.max(0.001, h - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 6,
  });
  g.rotateX(-Math.PI / 2);
  g.center();
  g.computeVertexNormals();
  return g;
}

function mat(opts) { return new THREE.MeshStandardMaterial(opts); }

// ---------- 環境マップ（小さな部屋を焼く） ----------
export function buildEnvironment(renderer) {
  const env = new THREE.Scene();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const add = (color, sx, sy, sz, px, py, pz) => {
    const m = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color, side: THREE.BackSide }));
    m.scale.set(sx, sy, sz); m.position.set(px, py, pz);
    env.add(m);
  };
  add(0x8b8175, 60, 40, 60, 0, 12, 0);                 // 部屋
  const light = (color, sx, sy, sz, px, py, pz) => {
    const m = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color }));
    m.scale.set(sx, sy, sz); m.position.set(px, py, pz);
    env.add(m);
  };
  light(0xf6e4c8, 20, 0.4, 16, -6, 30, -2);            // 天井の面光源
  light(0xc2d8f2, 0.4, 16, 18, -29, 15, 4);            // 窓（左）
  light(0xdcc0a0, 0.4, 8, 12, 29, 11, -4);             // 反射（右）
  light(0x4a3d31, 40, 0.4, 40, 0, -2, 0);              // 床の反射

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const rt = pmrem.fromScene(env, 0.06);
  pmrem.dispose();
  env.traverse(o => { if (o.material) o.material.dispose(); });
  box.dispose();
  return rt.texture;
}

// ---------- 机まわり ----------
export function buildRoom(scene) {
  const grp = new THREE.Group();

  // 背景の壁（負荷を抑えるため板一枚＋棚だけ）
  const wallC = document.createElement('canvas');
  wallC.width = wallC.height = 128;
  {
    const x = wallC.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, '#e4d8c6');
    g.addColorStop(0.55, '#d3c3ad');
    g.addColorStop(1, '#b8a58c');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  }
  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(160, 90),
    new THREE.MeshStandardMaterial({ map: texFromCanvas(wallC, { srgb: true }), roughness: 0.98, metalness: 0 })
  );
  wall.position.set(0, 24, -40);
  wall.receiveShadow = false;
  grp.add(wall);

  // 棚と小包（遠景・簡略）
  const shelfWood = mat({ color: 0xb08a63, roughness: 0.8, metalness: 0 });
  const shelf = new THREE.Mesh(roundedSlab(70, 9, 1.6, 0.3, 0.15), shelfWood);
  shelf.position.set(-6, 20, -36);
  grp.add(shelf);
  const parcelGeo = new THREE.BoxGeometry(1, 1, 1);
  const parcelMats = [0xd7bb92, 0xc9a97f, 0xe2cbaa, 0xbfa07c].map(c => mat({ color: c, roughness: 0.92 }));
  const parcels = [[-24, 3.6, 4, 5], [-18.5, 5.2, 4.4, 6.2], [-11, 3.0, 3.4, 4.6],
                   [4, 4.6, 4.2, 5.4], [10.5, 3.2, 3.6, 4.4], [16, 5.6, 4.6, 6.0]];
  parcels.forEach(([px, h, d, w], i) => {
    const m = new THREE.Mesh(parcelGeo, parcelMats[i % 4]);
    m.scale.set(w, h, d);
    m.position.set(px, 20.8 + h / 2, -36);
    m.rotation.y = (i % 3 - 1) * 0.14;
    grp.add(m);
  });
  // 糸巻き風の円柱2本（かたち違いのアクセント）
  const spool = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 4, 12),
    mat({ color: 0xd98f9e, roughness: 0.85 }));
  spool.position.set(21.5, 22.8, -35.4); grp.add(spool);
  const spool2 = spool.clone(); spool2.position.set(24.6, 22.4, -35.6); spool2.scale.setScalar(0.82);
  spool2.material = mat({ color: 0x8fb7cf, roughness: 0.85 });
  grp.add(spool2);

  // 机（天板＋幕板）
  const woodTex = texFromCanvas(woodCanvas(512, '#b07f4c', '#6d4322', 5), { srgb: true, repeat: [3, 3] });
  const woodRough = texFromCanvas(woodRoughCanvas(256, 9), { repeat: [3, 3] });
  const deskMat = new THREE.MeshStandardMaterial({
    map: woodTex, roughnessMap: woodRough, roughness: 0.70, metalness: 0.0,
    envMapIntensity: 0.30,
  });
  const desk = new THREE.Mesh(roundedSlab(86, 74, 3.6, 0.5, 0.22), deskMat);
  desk.position.set(0, -1.8, -8);
  desk.receiveShadow = true;
  grp.add(desk);

  const apron = new THREE.Mesh(new THREE.BoxGeometry(80, 8, 2), deskMat);
  apron.position.set(0, -7.6, 26.4);
  grp.add(apron);

  // フェルトのマット（作業面）
  const feltTex = texFromCanvas(feltCanvas(256, '#28503f'), { srgb: true, repeat: [5, 5] });
  const matMesh = new THREE.Mesh(roundedSlab(44, 50, 0.34, 0.9, 0.08),
    new THREE.MeshStandardMaterial({
      map: feltTex, roughness: 0.98, metalness: 0, envMapIntensity: 0.12,
      bumpMap: feltTex, bumpScale: 0.02,
    }));
  matMesh.position.set(0, 0.17, -1.0);
  matMesh.receiveShadow = true;
  grp.add(matMesh);

  scene.add(grp);
  return grp;
}

// ---------- スタンプ立て ----------
export function buildRack(scene) {
  const grp = new THREE.Group();
  const woodTex = texFromCanvas(woodCanvas(512, '#c08a54', '#77492a', 12), { srgb: true, repeat: [2, 2] });
  const m = new THREE.MeshStandardMaterial({
    map: woodTex, roughness: 0.58, metalness: 0, envMapIntensity: 0.36,
  });

  const W = 28.0;
  const base = new THREE.Mesh(roundedSlab(W, 9.4, 1.0, 0.35, 0.16), m);
  base.position.set(0, L.matTop + 0.5, L.rackZ - 0.9);
  base.castShadow = true; base.receiveShadow = true;
  grp.add(base);

  // 丸棒を受ける小さな台（両端）
  for (const sx of [-13.6, 13.6]) {
    const post = new THREE.Mesh(roundedSlab(1.0, 3.2, 1.6, 0.25, 0.12), m);
    post.position.set(sx, L.matTop + 1.6, L.rackZ + 0.6);
    post.castShadow = true; post.receiveShadow = true;
    grp.add(post);
  }

  // スタンプの軸が乗る丸棒（筆置きのように）
  const dowel = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, W - 1.0, 16),
    new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.46, metalness: 0, envMapIntensity: 0.45 }));
  dowel.rotation.z = Math.PI / 2;
  dowel.position.set(0, 1.96, L.rackZ + 0.6);
  dowel.castShadow = true; dowel.receiveShadow = true;
  grp.add(dowel);

  // 後ろの止め（持ち手の玉が転がり落ちない）
  const back = new THREE.Mesh(roundedSlab(W, 0.9, 1.5, 0.28, 0.12), m);
  back.position.set(0, L.matTop + 0.9, L.rackZ - 4.6);
  back.castShadow = true; back.receiveShadow = true;
  grp.add(back);

  scene.add(grp);
  return grp;
}

// ---------- インクパッド ----------
export function buildPads(scene) {
  const pads = [];
  const tinMat = new THREE.MeshStandardMaterial({
    color: 0xdcd5c7, roughness: 0.30, metalness: 0.78, envMapIntensity: 0.9,
  });
  const pts = [
    [0.0, 0.0], [1.66, 0.0], [1.78, 0.10], [1.78, 0.60], [1.72, 0.70],
    [1.50, 0.72], [1.44, 0.62], [1.44, 0.30], [1.36, 0.24], [0.0, 0.24],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const tinGeo = new THREE.LatheGeometry(pts, 36);
  tinGeo.computeVertexNormals();
  const inkGeo = new THREE.CylinderGeometry(1.42, 1.40, 0.34, 32, 1, false);

  INKS.forEach((ink, i) => {
    const g = new THREE.Group();
    const tin = new THREE.Mesh(tinGeo, tinMat);
    tin.castShadow = true; tin.receiveShadow = true;
    g.add(tin);

    const clothTex = texFromCanvas(padClothCanvas(256, ink.hex), { srgb: true });
    const roughTex = texFromCanvas(padRoughCanvas(256));
    const inkMat = new THREE.MeshPhysicalMaterial({
      map: clothTex,
      roughnessMap: roughTex,
      roughness: 0.55,
      metalness: 0.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.12,
      sheen: 0.5,
      sheenRoughness: 0.6,
      sheenColor: new THREE.Color(ink.hex).lerp(new THREE.Color(0xffffff), 0.4),
      envMapIntensity: 1.25,
      bumpMap: clothTex,
      bumpScale: 0.012,
    });
    const surf = new THREE.Mesh(inkGeo, inkMat);
    surf.position.y = 0.41;
    surf.receiveShadow = true;
    g.add(surf);

    g.position.set(L.padPos[i][0], L.matTop, L.padPos[i][1]);
    g.scale.setScalar(L.padR / 1.78);
    scene.add(g);
    pads.push({ group: g, surface: surf, ink, index: i, baseY: L.matTop });
  });
  return pads;
}

// ---------- 集めたカードの置き場 ----------
export function buildCollectShelf(scene) {
  const woodTex = texFromCanvas(woodCanvas(512, '#bb8a5c', '#77492a', 31), { srgb: true, repeat: [2, 2] });
  const m = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.62, metalness: 0, envMapIntensity: 0.32 });
  const g = new THREE.Group();
  const TILT = 1.0;

  // 立てかけの背板（カードと同じ角度）
  const board = new THREE.Mesh(roundedSlab(25, 8.5, 0.9, 0.4, 0.16), m);
  board.position.set(
    0,
    L.matTop + 0.42 + 4.6 * Math.sin(TILT) - 0.75 * Math.cos(TILT),
    L.collectZ - 4.6 * Math.cos(TILT) - 0.75 * Math.sin(TILT)
  );
  board.rotation.x = TILT;
  board.castShadow = true; board.receiveShadow = true;
  g.add(board);

  // 底板と受け桟（カードの下端が引っかかる）
  const base = new THREE.Mesh(roundedSlab(25, 7.5, 0.7, 0.35, 0.14), m);
  base.position.set(0, L.matTop + 0.35, L.collectZ - 3.0);
  base.receiveShadow = true; base.castShadow = true;
  g.add(base);

  const rail = new THREE.Mesh(roundedSlab(25, 1.0, 1.5, 0.28, 0.12), m);
  rail.position.set(0, L.matTop + 0.75, L.collectZ + 0.75);
  rail.castShadow = true; rail.receiveShadow = true;
  g.add(rail);

  // 両端の袖
  for (const sx of [-12.3, 12.3]) {
    const side = new THREE.Mesh(roundedSlab(0.8, 8.0, 3.6, 0.3, 0.14), m);
    side.position.set(sx, L.matTop + 1.8, L.collectZ - 2.9);
    side.castShadow = true; side.receiveShadow = true;
    g.add(side);
  }

  // 背板に布を張る（空のときも寂しくない）
  const cloth = new THREE.Mesh(
    roundedSlab(22.6, 6.6, 0.16, 0.3, 0.05),
    new THREE.MeshStandardMaterial({
      map: texFromCanvas(feltCanvas(256, '#9c5468'), { srgb: true, repeat: [4, 2] }),
      roughness: 0.96, metalness: 0, envMapIntensity: 0.15,
    })
  );
  cloth.position.copy(board.position);
  cloth.position.y += 0.53 * Math.cos(TILT);
  cloth.position.z += 0.53 * Math.sin(TILT);
  cloth.rotation.x = TILT;
  cloth.receiveShadow = true;
  g.add(cloth);

  scene.add(g);
  return g;
}

// ---------- 紙のマテリアル（はがき・切手で共有） ----------
export function paperMaterials() {
  const pTex = texFromCanvas(paperCanvas(512), { srgb: true, repeat: [1, 1] });
  const pRough = texFromCanvas(paperRoughCanvas(256), { repeat: [2, 2] });
  const pBump = texFromCanvas(paperBumpCanvas(256), { repeat: [2, 2] });
  return {
    paperTex: pTex, roughTex: pRough, bumpTex: pBump,
    edge: new THREE.MeshStandardMaterial({
      color: 0xefe6d4, roughness: 0.95, metalness: 0, envMapIntensity: 0.35,
    }),
  };
}

// ---------- 光 ----------
export function buildLights(scene) {
  const hemi = new THREE.HemisphereLight(0xd6e6ff, 0xb08f6c, 0.34);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xfff1dc, 3.6);
  key.position.set(-17, 32, 15);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -26;
  key.shadow.camera.right = 26;
  key.shadow.camera.top = 30;
  key.shadow.camera.bottom = -26;
  key.shadow.camera.near = 8;
  key.shadow.camera.far = 90;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.028;
  key.shadow.radius = 1.6;
  scene.add(key);
  scene.add(key.target);
  key.target.position.set(-1, 0, 0);

  const fill = new THREE.DirectionalLight(0xc4d8f5, 0.38);
  fill.position.set(20, 16, -14);
  scene.add(fill);

  const front = new THREE.DirectionalLight(0xffe4c4, 0.22);
  front.position.set(4, 10, 30);
  scene.add(front);

  return { hemi, key, fill, front };
}
