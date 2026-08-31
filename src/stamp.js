// 特別日付印風のスタンプ。持ち手・台座・色帯・ゴム印面をすべて実ジオメトリで。
import * as THREE from './three.js';
import { texFromCanvas, woodCanvas, woodRoughCanvas, rubberBumpCanvas, makeCanvas } from './textures.js';
import { INKS, SEAL_KINDS } from './seals.js';
import { paintDieFace, dieBumpTexture } from './impression.js';
import { L } from './world.js';

export const DIE_R = 1.80;      // 印面の半径(cm) → 直径 36mm
const DIE_H = 0.34;
const DIE_FACE_TEX = 512;

// 4本ぶんの「かたち」の作り分け。ひと目で違うように。
const BODIES = [
  { // 丸みのあるくびれ型
    seg: 32, band: 1.62,
    wood: ['#f0d3ab', '#c08a52', 41],
    profile: [[1.50,0.34],[1.56,0.42],[1.56,0.78],[1.44,0.96],[1.34,1.14],[1.30,1.36],
              [1.30,1.62],[1.10,1.90],[0.86,2.5],[0.74,3.2],[0.78,4.0],[0.94,4.7],
              [1.22,5.4],[1.34,6.0],[1.22,6.5],[0.92,6.94],[0.50,7.18],[0,7.24]],
  },
  { // 六角の持ち手
    seg: 6, band: 1.60,
    wood: ['#a85f43', '#5e2f1e', 77],
    profile: [[1.52,0.34],[1.58,0.42],[1.58,0.78],[1.48,0.94],[1.40,1.12],[1.38,1.34],
              [1.36,1.60],[1.16,1.84],[1.02,2.6],[0.96,4.2],[1.04,5.2],[1.16,6.0],
              [1.06,6.5],[0.80,6.92],[0.44,7.14],[0,7.2]],
  },
  { // つまみが大きい鏡餅型
    seg: 32, band: 1.58,
    wood: ['#6b4a35', '#37231a', 23],
    profile: [[1.48,0.34],[1.54,0.42],[1.54,0.76],[1.42,0.92],[1.30,1.10],[1.26,1.32],
              [1.26,1.58],[1.02,1.86],[0.78,2.4],[0.70,3.0],[0.76,3.5],[1.10,4.1],
              [1.46,4.8],[1.52,5.5],[1.34,6.1],[0.94,6.6],[0.46,6.9],[0,6.96]],
  },
  { // 段のついた細身
    seg: 24, band: 1.64,
    wood: ['#d29a4e', '#8a5220', 95],
    profile: [[1.50,0.34],[1.56,0.42],[1.56,0.80],[1.46,0.96],[1.36,1.16],[1.32,1.38],
              [1.34,1.64],[1.12,1.88],[0.88,2.2],[0.86,3.0],[1.02,3.2],[1.00,4.0],
              [0.82,4.2],[0.80,5.2],[1.06,5.6],[1.16,6.2],[1.00,6.7],[0.62,7.06],[0,7.14]],
  },
];

// 立てかけたとき、印面と持ち手が両方見えるように扇形に開く
const RACK_YAW = [0.85, 0.45, -0.45, -0.85];

let rubberBump = null;
function getRubberBump() {
  if (!rubberBump) {
    rubberBump = texFromCanvas(rubberBumpCanvas(256), { repeat: [3, 3] });
  }
  return rubberBump;
}

/** スタンプ1本。origin は印面の中心（押す点）。 */
export function buildStamp(index, scene) {
  const kind = SEAL_KINDS[index % SEAL_KINDS.length];
  const ink = INKS[index % INKS.length];
  const body = BODIES[index % BODIES.length];
  const group = new THREE.Group();
  const upper = new THREE.Group();   // ゴムが潰れるぶん、上半身がわずかに沈む
  group.add(upper);

  // --- ゴム印面 ---
  const dieCanvas = makeCanvas(DIE_FACE_TEX);
  paintDieFace(dieCanvas, kind, ink.rgb, 1);
  const dieTex = texFromCanvas(dieCanvas, { srgb: true, aniso: 8 });
  const rubberSide = new THREE.MeshStandardMaterial({
    color: 0x5b3a34, roughness: 0.86, metalness: 0,
    bumpMap: getRubberBump(), bumpScale: 0.02, envMapIntensity: 0.30,
  });
  const faceMat = new THREE.MeshStandardMaterial({
    map: dieTex, roughness: 0.66, metalness: 0,
    bumpMap: dieBumpTexture(kind), bumpScale: 0.075,
    envMapIntensity: 0.34,
  });
  const dieGeo = new THREE.CylinderGeometry(DIE_R, DIE_R * 0.995, DIE_H, 56, 1, false);
  const die = new THREE.Mesh(dieGeo, [rubberSide, rubberSide, faceMat]);
  die.position.y = DIE_H / 2;
  die.castShadow = true;
  group.add(die);

  // --- ゴムの座（一段大きい） ---
  const seat = new THREE.Mesh(
    new THREE.CylinderGeometry(DIE_R * 0.86, DIE_R * 0.98, 0.18, 40),
    rubberSide
  );
  seat.position.y = DIE_H + 0.09;
  seat.castShadow = true;
  upper.add(seat);

  // --- 木の持ち手（ろくろ挽きの一体成形） ---
  const woodTex = texFromCanvas(woodCanvas(512, body.wood[0], body.wood[1], body.wood[2]),
    { srgb: true, repeat: [1, 1.4] });
  const woodRough = texFromCanvas(woodRoughCanvas(256, body.wood[2]), { repeat: [1, 1.4] });
  const woodMat = new THREE.MeshStandardMaterial({
    map: woodTex, roughnessMap: woodRough, roughness: 0.40, metalness: 0,
    envMapIntensity: 0.55,
  });
  const pts = body.profile.map(([r, y]) => new THREE.Vector2(r, y + 0.16));
  const handleGeo = new THREE.LatheGeometry(pts, body.seg);
  handleGeo.computeVertexNormals();
  const handle = new THREE.Mesh(handleGeo, woodMat);
  handle.castShadow = true;
  handle.receiveShadow = true;
  upper.add(handle);

  // --- 色帯（どの印か一目で分かる目印・漆塗り風） ---
  const bandMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(ink.hex),
    roughness: 0.28, metalness: 0.0,
    clearcoat: 0.8, clearcoatRoughness: 0.18,
    envMapIntensity: 1.1,
  });
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(1.44, 1.44, 0.30, body.seg === 6 ? 6 : 30),
    bandMat
  );
  band.position.y = body.band;
  band.castShadow = true;
  upper.add(band);

  // --- 天面の色玉（持ち上げても色が分かる） ---
  const capPts = [];
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI * 0.5;
    capPts.push(new THREE.Vector2(Math.cos(a) * 0.52, Math.sin(a) * 0.34));
  }
  const topY = body.profile[body.profile.length - 1][1] + 0.16;
  const cap = new THREE.Mesh(new THREE.LatheGeometry(capPts, 20), bandMat);
  cap.position.y = topY - 0.04;
  cap.castShadow = true;
  upper.add(cap);

  // --- 当たり判定（見えないが広い） ---
  const picker = new THREE.Mesh(
    new THREE.CylinderGeometry(2.9, 2.9, 8.6, 10),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  picker.position.y = 3.9;
  picker.renderOrder = -1;
  group.add(picker);

  scene.add(group);

  const stamp = {
    index, kind, ink, group, upper, die, seat, handle, band, cap,
    dieCanvas, dieTex, picker,
    inkRgb: ink.rgb.slice(),
    inkHex: ink.hex,
    inkLevel: 1.0,
    // 立てかけの姿勢：印面はこちらを向き、持ち手は左奥へ抜ける（両方見える角度）
    home: new THREE.Vector3(L.slotX[index], 4.56, L.rackZ + 3.38),
    homeRot: new THREE.Euler(-1.95, RACK_YAW[index % 4], 0, 'YXZ'),
    bobPhase: index * 1.7,
    dieSquish: 1,
  };
  group.rotation.order = 'YXZ';
  group.position.copy(stamp.home);
  group.rotation.copy(stamp.homeRot);
  return stamp;
}

/** ゴム印面のつぶれ。接触の気持ちよさはここに出る。 */
export function setSquish(stamp, s) {
  stamp.die.scale.y = s;
  stamp.die.position.y = (DIE_H * 0.5) * s;
  stamp.upper.position.y = -DIE_H * (1 - s);
}

/** インクの色・残量を印面に反映する（濡れ具合が見えるのが大事）。 */
export function refreshDieFace(stamp) {
  paintDieFace(stamp.dieCanvas, stamp.kind, stamp.inkRgb, stamp.inkLevel);
  stamp.dieTex.needsUpdate = true;
}
