// 会場の実ジオメトリ構築：ホール、大扉、カーテン、窓、テーブル、アーチ、作業台、照明。
// 実寸ベース（m）：ホール 16×22×高さ7、大扉 各1.8×4.4、テーブル高 0.74。

import * as THREE from 'three';
import { PARTY_LAYOUT } from './party-layout.js';

// ---------- キャンバステクスチャ ----------

function canvasTex(w, h, draw, { repeat = null, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  return t;
}

function woodFloorTexture() {
  return canvasTex(512, 512, (g) => {
    const plankH = 512 / 8;
    for (let p = 0; p < 8; p++) {
      const l = 58 + Math.random() * 14;
      g.fillStyle = `hsl(28, ${34 + Math.random() * 8}%, ${l * 0.62}%)`;
      g.fillRect(0, p * plankH, 512, plankH);
      // 木目
      g.globalAlpha = 0.18;
      for (let i = 0; i < 9; i++) {
        g.strokeStyle = `hsl(25, 30%, ${l * 0.45}%)`;
        g.lineWidth = 1 + Math.random() * 1.6;
        g.beginPath();
        const y = p * plankH + Math.random() * plankH;
        g.moveTo(0, y);
        for (let x = 0; x <= 512; x += 64) {
          g.lineTo(x, y + Math.sin(x * 0.02 + i) * 3 + (Math.random() - 0.5) * 3);
        }
        g.stroke();
      }
      g.globalAlpha = 1;
      // 板の継ぎ目・ずれ
      g.fillStyle = 'rgba(40,22,10,0.5)';
      g.fillRect(0, p * plankH, 512, 2);
      const seam = Math.random() * 512;
      g.fillRect(seam, p * plankH, 2, plankH);
    }
    // 使用感（すり減り・くすみ）
    for (let i = 0; i < 26; i++) {
      g.globalAlpha = 0.05;
      g.fillStyle = Math.random() > 0.5 ? '#2e1c0e' : '#ffe9c9';
      const r = 20 + Math.random() * 70;
      g.beginPath();
      g.arc(Math.random() * 512, Math.random() * 512, r, 0, 7);
      g.fill();
    }
    g.globalAlpha = 1;
  }, { repeat: [5, 7] });
}

function plasterTexture() {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = '#e9dfd0';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(120,100,80,0.05)';
      g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
    // 下部の擦れ汚れ
    const grad = g.createLinearGradient(0, 200, 0, 256);
    grad.addColorStop(0, 'rgba(90,70,50,0)');
    grad.addColorStop(1, 'rgba(90,70,50,0.13)');
    g.fillStyle = grad; g.fillRect(0, 200, 256, 56);
  }, { repeat: [6, 2] });
}

function fabricTexture() {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 4) {
      g.fillStyle = `rgba(0,0,0,${0.03 + 0.05 * Math.abs(Math.sin(x * 0.11))})`;
      g.fillRect(x, 0, 2, 256);
    }
    for (let i = 0; i < 900; i++) {
      g.fillStyle = 'rgba(0,0,0,0.03)';
      g.fillRect(Math.random() * 256, Math.random() * 256, 1.6, 1.6);
    }
  }, { repeat: [4, 2] });
}

function clothTexture() {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = 'rgba(210,195,175,0.16)';
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      if ((x + y) % 2 === 0) {
        g.beginPath(); g.arc(x * 32 + 16, y * 32 + 16, 7, 0, 7); g.fill();
      }
    }
  }, { repeat: [3, 3] });
}

function glowTexture() {
  return canvasTex(128, 128, (g) => {
    const grad = g.createRadialGradient(64, 64, 2, 64, 64, 62);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,240,200,0.55)');
    grad.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  }, { srgb: true });
}

function rayTexture() {
  return canvasTex(128, 256, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, 'rgba(255,244,214,0.85)');
    grad.addColorStop(1, 'rgba(255,244,214,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 256);
    // 縦のムラ
    for (let i = 0; i < 20; i++) {
      g.globalAlpha = 0.1;
      g.fillStyle = '#000';
      g.fillRect(Math.random() * 128, 0, 2 + Math.random() * 6, 256);
    }
  });
}

// 窓から床へ落ちる光は「白い板」ではなく、窓の位置に対応した柔らかな光溜まりにする。
function windowPoolTexture() {
  return canvasTex(192, 256, (g, w, h) => {
    const gradient = g.createRadialGradient(w * 0.5, h * 0.18, 3, w * 0.5, h * 0.34, h * 0.65);
    gradient.addColorStop(0, 'rgba(255,246,218,.72)');
    gradient.addColorStop(0.32, 'rgba(255,232,188,.28)');
    gradient.addColorStop(0.72, 'rgba(255,222,166,.08)');
    gradient.addColorStop(1, 'rgba(255,222,166,0)');
    g.fillStyle = gradient;
    g.fillRect(0, 0, w, h);
  });
}

// 外景は1枚の共有テクスチャに抑える。固定形状なので各ロードで景色が変わらず、
// ガラス越しに空・庭木・遠景の宮殿が読める程度の情報量だけを持たせる。
function gardenExteriorTexture() {
  return canvasTex(320, 512, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#b8d5e2');
    sky.addColorStop(0.5, '#e9ddc8');
    sky.addColorStop(1, '#80906f');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);

    // 遠景の宮殿と石塀。
    g.fillStyle = 'rgba(225,215,194,.82)';
    g.fillRect(w * 0.16, h * 0.47, w * 0.68, h * 0.16);
    g.fillStyle = 'rgba(171,146,111,.68)';
    for (let x = w * 0.2; x < w * 0.82; x += w * 0.12) g.fillRect(x, h * 0.5, w * 0.045, h * 0.09);
    g.fillStyle = '#80715c';
    g.beginPath();
    g.moveTo(w * 0.12, h * 0.47);
    g.lineTo(w * 0.5, h * 0.32);
    g.lineTo(w * 0.88, h * 0.47);
    g.closePath();
    g.fill();

    // 左右非対称の樹冠と手前の植栽。
    const crowns = [
      [0.03, 0.58, 0.26, '#53694e'], [0.25, 0.65, 0.2, '#667957'],
      [0.72, 0.59, 0.27, '#4f674c'], [0.94, 0.68, 0.18, '#75815b'],
      [0.5, 0.82, 0.34, '#657452'],
    ];
    for (const [x, y, radius, color] of crowns) {
      g.fillStyle = color;
      g.beginPath();
      g.arc(x * w, y * h, radius * w, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = 'rgba(239,232,203,.4)';
    g.fillRect(w * 0.46, h * 0.63, w * 0.08, h * 0.37);
  });
}

// ---------- 環境マップ（簡易ルーム） ----------

function makeEnvironment(renderer) {
  const scene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(50, 16, 12);
  const colors = [];
  const pos = geo.getAttribute('position');
  const cTop = new THREE.Color(0xfff2dc), cMid = new THREE.Color(0xcbb9a4), cBot = new THREE.Color(0x574433);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 50;
    const c = y > 0 ? cMid.clone().lerp(cTop, y) : cMid.clone().lerp(cBot, -y);
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const lm = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const [x, y, z] of [[0, 20, 0], [-15, 8, 10], [15, 8, -10]]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(10, 6), lm);
    p.position.set(x, y, z); p.lookAt(0, 0, 0);
    scene.add(p);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(scene, 0.04).texture;
  pmrem.dispose();
  return env;
}

// ---------- カーテン ----------

// 原点＝外側上端、+x方向へ width 伸びる。setOpenで外側へ寄る。
export function makeCurtain(width, height, color, foldAmp = 0.18) {
  const segX = Math.max(24, Math.round(width * 6));
  const geo = new THREE.PlaneGeometry(width, height, segX, 6);
  const p = geo.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + width / 2; // 0..width
    const yn = (p.getY(i) + height / 2) / height; // 0..1
    const amp = foldAmp * (0.45 + 0.55 * yn); // 裾は落ち着き、上部にひだ
    const z = amp * Math.sin(x * 5.1) + amp * 0.4 * Math.sin(x * 11.7 + 1.3);
    p.setZ(i, z);
    p.setX(i, x); // 原点を左端へ
    p.setY(i, p.getY(i) - height / 2); // 原点を上端へ
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color, roughness: 0.75, metalness: 0,
    map: fabricTexture(), side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  // 裾の厚みを別ジオメトリで見せ、薄いPlaneが床際で紙のように切れないようにする。
  const hem = new THREE.Mesh(new THREE.BoxGeometry(width, 0.055, 0.06), mat);
  hem.position.set(width / 2, -height + 0.032, 0.025);
  hem.castShadow = true;
  mesh.add(hem);
  mesh.userData.open = 0;
  mesh.userData.setOpen = (t) => {
    mesh.userData.open = t;
    mesh.scale.x = 1 - 0.8 * t;
    mesh.scale.z = 1 - 0.35 * t; // 寄せた分は平らに畳む（ギザつき防止）
  };
  return mesh;
}

// ---------- メイン構築 ----------

export function buildWorld(scene, renderer) {
  const world = { accentMeshes: [] };
  scene.environment = makeEnvironment(renderer);
  scene.environmentIntensity = 0.25;
  world.setEnvIntensity = (v) => { scene.environmentIntensity = v; };

  const woodTex = woodFloorTexture();
  const plasterTex = plasterTexture();
  const clothTex = clothTexture();
  world.glowTex = glowTexture();
  world.rayTex = rayTexture();
  world.windowPoolTex = windowPoolTexture();
  world.gardenExteriorTex = gardenExteriorTexture();

  const matFloor = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.62, metalness: 0.04 });
  const matWall = new THREE.MeshStandardMaterial({ map: plasterTex, roughness: 0.9 });
  const matWainscot = new THREE.MeshStandardMaterial({ color: 0xd7c6ae, roughness: 0.7 });
  const matTrim = new THREE.MeshStandardMaterial({ color: 0xb99a55, roughness: 0.35, metalness: 0.65 });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x6b5136, roughness: 0.6 });
  const matGold = new THREE.MeshStandardMaterial({ color: 0xd8b25f, roughness: 0.3, metalness: 0.85 });
  const matWhitePaint = new THREE.MeshStandardMaterial({ color: 0xf2ebdd, roughness: 0.5 });

  const H = 7, HW = 8, ZB = -12, ZF = 10;

  // 床
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(16.6, 22.6), matFloor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, -1);
  floor.receiveShadow = true;
  scene.add(floor);

  // 赤い絨毯（扉→ステージ、遠近の手掛かり）
  const carpet = new THREE.Mesh(
    new THREE.PlaneGeometry(1.9, 19.4),
    new THREE.MeshStandardMaterial({ color: 0x8e3c50, roughness: 0.95 })
  );
  carpet.rotation.x = -Math.PI / 2;
  carpet.position.set(0, 0.006, 0);
  carpet.receiveShadow = true;
  scene.add(carpet);

  // 天井
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(16.6, 22.6), new THREE.MeshStandardMaterial({ color: 0xefe6d6, roughness: 0.95 }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, H, -1);
  scene.add(ceil);

  // 壁
  function wallBox(w, h, d, x, y, z, mat = matWall) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  }
  wallBox(16.8, H, 0.4, 0, H / 2, ZB - 0.2);            // 奥

  // 左右壁は窓を上から貼るのではなく、実際の開口を残して分割する。
  // 開口は z方向1.7m × 高さ3.65m（腰高1.45m）で、窓台・見込み厚を含めても
  // 背後に全面壁が残らない。
  const windowCenters = [-9, -5, -1];
  const windowOpeningWidth = 1.7;
  const windowBottom = 1.45;
  const windowTop = 5.1;
  const sideWallStart = ZB - 0.4;
  const sideWallEnd = ZF + 0.4;
  const windowIntervals = windowCenters.map((z) => [z - windowOpeningWidth / 2, z + windowOpeningWidth / 2]);
  const solidIntervals = [];
  let intervalStart = sideWallStart;
  for (const [openingStart, openingEnd] of windowIntervals) {
    if (openingStart > intervalStart) solidIntervals.push([intervalStart, openingStart]);
    intervalStart = openingEnd;
  }
  if (intervalStart < sideWallEnd) solidIntervals.push([intervalStart, sideWallEnd]);
  const sideWallTransforms = [];
  for (const side of [-1, 1]) {
    const x = side * (HW + 0.2);
    for (const [start, end] of solidIntervals) {
      sideWallTransforms.push({ position: [x, H / 2, (start + end) / 2], scale: [0.4, H, end - start] });
    }
    for (const z of windowCenters) {
      sideWallTransforms.push({ position: [x, windowBottom / 2, z], scale: [0.4, windowBottom, windowOpeningWidth] });
      sideWallTransforms.push({ position: [x, windowTop + (H - windowTop) / 2, z], scale: [0.4, H - windowTop, windowOpeningWidth] });
    }
  }
  const sideWalls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), matWall, sideWallTransforms.length);
  const wallDummy = new THREE.Object3D();
  sideWallTransforms.forEach((transform, index) => {
    wallDummy.position.set(...transform.position);
    wallDummy.scale.set(...transform.scale);
    wallDummy.updateMatrix();
    sideWalls.setMatrixAt(index, wallDummy.matrix);
  });
  sideWalls.receiveShadow = true;
  sideWalls.name = 'side-walls-with-window-openings';
  scene.add(sideWalls);
  // 前壁（扉開口 3.6m）
  wallBox(6.2, H, 0.4, -(1.8 + 3.1), H / 2, ZF + 0.2);
  wallBox(6.2, H, 0.4, (1.8 + 3.1), H / 2, ZF + 0.2);
  wallBox(3.6, H - 4.4, 0.4, 0, 4.4 + (H - 4.4) / 2, ZF + 0.2);
  // 腰壁・巾木
  for (const [w, d, x, z] of [[16.6, 0.1, 0, ZB + 0.06], [0.1, 22.6, -HW + 0.06, -1], [0.1, 22.6, HW - 0.06, -1]]) {
    wallBox(w, 1.0, d, x, 0.5, z, matWainscot);
    wallBox(w === 0.1 ? 0.12 : w, 0.14, d === 0.1 ? 0.12 : d, x, 0.07, z, matDark);
  }

  // 天井梁
  world.beams = [];
  for (const z of [-8.5, -4.5, -0.5, 3.5, 7.5]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(16.6, 0.32, 0.26), matDark);
    beam.position.set(0, H - 0.4, z);
    beam.castShadow = true;
    scene.add(beam);
    world.beams.push(beam);
  }

  // 扉枠＋大扉（ヒンジ付き）
  const frameMat = matWhitePaint;
  wallBox(0.3, 4.6, 0.6, -1.95, 2.3, ZF, frameMat);
  wallBox(0.3, 4.6, 0.6, 1.95, 2.3, ZF, frameMat);
  wallBox(4.2, 0.3, 0.6, 0, 4.55, ZF, frameMat);

  function makeDoorPanel(side) { // side: -1 左, +1 右
    const hinge = new THREE.Group();
    hinge.position.set(side * 1.8, 0, ZF);
    const panel = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 4.4, 0.12), matWhitePaint);
    body.position.set(-side * 0.9, 2.2, 0);
    body.castShadow = true;
    panel.add(body);
    // 化粧パネル（上下2枚の額縁）
    for (const [py, ph] of [[3.1, 1.7], [1.15, 1.9]]) {
      const fr = new THREE.Mesh(new THREE.BoxGeometry(1.3, ph, 0.05), matTrim);
      fr.position.set(-side * 0.9, py, 0.06);
      panel.add(fr);
      const inner = new THREE.Mesh(new THREE.BoxGeometry(1.14, ph - 0.16, 0.06), matWhitePaint);
      inner.position.set(-side * 0.9, py, 0.065);
      panel.add(inner);
    }
    // 取っ手（縦バー）
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 10), matGold);
    bar.position.set(-side * 1.62, 1.15, 0.14);
    panel.add(bar);
    for (const oy of [-0.3, 0.3]) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.1, 8), matGold);
      st.rotation.x = Math.PI / 2;
      st.position.set(-side * 1.62, 1.15 + oy, 0.09);
      panel.add(st);
    }
    hinge.add(panel);
    scene.add(hinge);
    return hinge;
  }
  world.doorL = makeDoorPanel(-1);
  world.doorR = makeDoorPanel(1);
  // 扉のすき間から漏れる光
  const crack = new THREE.Mesh(
    new THREE.PlaneGeometry(0.03, 4.3),
    new THREE.MeshBasicMaterial({ color: 0xfff3d0, toneMapped: false, transparent: true, opacity: 1 })
  );
  crack.position.set(0, 2.2, ZF + 0.16);
  scene.add(crack);
  world.doorCrack = crack;

  // ホワイエ（扉の外側）
  const foyerFloor = new THREE.Mesh(new THREE.PlaneGeometry(10, 7), new THREE.MeshStandardMaterial({ color: 0x574a5a, roughness: 0.9 }));
  foyerFloor.rotation.x = -Math.PI / 2;
  foyerFloor.position.set(0, 0, ZF + 3.5);
  foyerFloor.receiveShadow = true;
  scene.add(foyerFloor);
  const foyerCarpet = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 7), new THREE.MeshStandardMaterial({ color: 0x7c3346, roughness: 0.95 }));
  foyerCarpet.rotation.x = -Math.PI / 2;
  foyerCarpet.position.set(0, 0.006, ZF + 3.5);
  scene.add(foyerCarpet);
  wallBox(10.4, 5.5, 0.4, 0, 2.75, ZF + 7.2);
  wallBox(0.4, 5.5, 7.4, -5.2, 2.75, ZF + 3.5);
  wallBox(0.4, 5.5, 7.4, 5.2, 2.75, ZF + 3.5);
  const foyerCeil = new THREE.Mesh(new THREE.PlaneGeometry(10.4, 7.4), new THREE.MeshStandardMaterial({ color: 0x3d3542, roughness: 0.95 }));
  foyerCeil.rotation.x = Math.PI / 2;
  foyerCeil.position.set(0, 5.5, ZF + 3.5);
  scene.add(foyerCeil);
  // ホワイエ壁灯
  world.sconces = [];
  for (const sx of [-1, 1]) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffb45e, emissiveIntensity: 2.4 }));
    s.position.set(sx * 4.9, 2.6, ZF + 3.2);
    scene.add(s);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 0.12, 8), matGold);
    cup.position.set(sx * 4.95, 2.5, ZF + 3.2);
    scene.add(cup);
    world.sconces.push(s);
  }

  // 窓（左右3つずつ）＋窓カーテン。側壁の実開口に、見込み・外景・ガラスを収める。
  world.windowCurtains = [];
  world.windowGlows = [];
  world.windowRays = [];
  world.windowGroups = [];
  world.windowOpenings = [];
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xffedcb, transparent: true, opacity: 0.11, toneMapped: false,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const exteriorMat = new THREE.MeshBasicMaterial({ map: world.gardenExteriorTex, color: 0xe7e2d7, side: THREE.DoubleSide });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xdce8e8, roughness: 0.12, metalness: 0.34,
    clearcoat: 0.28, clearcoatRoughness: 0.12,
    transparent: true, opacity: 0.22,
    depthWrite: false, side: THREE.DoubleSide,
    envMapIntensity: 1.4,
  });
  const reflectionMat = new THREE.MeshBasicMaterial({
    color: 0xfff8e9, transparent: true, opacity: 0.17,
    depthWrite: false, side: THREE.DoubleSide,
  });
  for (const sx of [-1, 1]) {
    for (const wz of windowCenters) {
      const wallX = sx * (HW - 0.02);
      const g = new THREE.Group();
      g.name = `window-${sx < 0 ? 'left' : 'right'}-${Math.abs(wz)}`;
      g.position.set(wallX, 3.4, wz);
      g.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2; // 内側を向く

      // 壁厚の向こう側に簡略庭園、室内面に薄いガラスを置く。
      const exterior = new THREE.Mesh(new THREE.PlaneGeometry(1.58, 3.46), exteriorMat);
      exterior.position.z = -0.36;
      g.add(exterior);
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.58, 3.46), glowMat.clone());
      pane.position.z = -0.015;
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.56, 3.42), glassMat);
      glass.position.z = 0.012;
      g.add(pane, glass);
      world.windowGlows.push(pane.material);

      // 45cmの壁厚が見える見込みと、内外のケーシング。9部材を1 draw callへ集約。
      const framePieces = [
        { position: [-0.82, 0, -0.18], scale: [0.09, 3.62, 0.46] },
        { position: [0.82, 0, -0.18], scale: [0.09, 3.62, 0.46] },
        { position: [0, -1.82, -0.18], scale: [1.73, 0.09, 0.46] },
        { position: [0, 1.82, -0.18], scale: [1.73, 0.09, 0.46] },
        { position: [-0.79, 0, 0.055], scale: [0.075, 3.48, 0.07] },
        { position: [0, 0, 0.055], scale: [0.045, 3.48, 0.07] },
        { position: [0.79, 0, 0.055], scale: [0.075, 3.48, 0.07] },
        { position: [0, 0.62, 0.055], scale: [1.6, 0.055, 0.07] },
        { position: [0, -1.83, -0.11], scale: [1.82, 0.1, 0.58] },
      ];
      const frameMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), matWhitePaint, framePieces.length);
      const frameDummy = new THREE.Object3D();
      framePieces.forEach((piece, index) => {
        frameDummy.position.set(...piece.position);
        frameDummy.scale.set(...piece.scale);
        frameDummy.updateMatrix();
        frameMesh.setMatrixAt(index, frameDummy.matrix);
      });
      g.add(frameMesh);

      // ガラスに細い縦反射を二本だけ重ね、外景を消さずに面の存在を示す。
      const streaks = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.075, 3.15), reflectionMat, 2);
      [-0.43, 0.28].forEach((x, index) => {
        frameDummy.position.set(x, 0.05, 0.062);
        frameDummy.rotation.set(0, 0, -0.08);
        frameDummy.scale.set(1, 1, 1);
        frameDummy.updateMatrix();
        streaks.setMatrixAt(index, frameDummy.matrix);
      });
      g.add(streaks);
      // カーテンレール＋カーテン2枚
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.9, 8), matGold);
      rod.rotation.z = Math.PI / 2;
      rod.position.y = 1.62;
      g.add(rod);
      const cl = makeCurtain(0.95, 3.1, 0xe8d8bd, 0.07);
      cl.position.set(-0.92, 1.58, 0.1);
      const cr = makeCurtain(0.95, 3.1, 0xe8d8bd, 0.07);
      cr.scale.x = -1;
      cr.position.set(0.92, 1.58, 0.1);
      cr.userData.setOpen = (t) => { cr.userData.open = t; cr.scale.x = -(1 - 0.8 * t); cr.scale.z = 1 - 0.35 * t; };
      g.add(cl, cr);
      world.windowCurtains.push(cl, cr);
      // フィナーレの照度は窓直下の床へ落ちる柔らかな光溜まりで示す。
      const ray = new THREE.Mesh(
        new THREE.PlaneGeometry(3.7, 2.15),
        new THREE.MeshBasicMaterial({
          map: world.windowPoolTex, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        })
      );
      ray.position.set(wallX - sx * 1.78, 0.044, wz);
      ray.rotation.x = -Math.PI / 2;
      scene.add(ray);
      world.windowRays.push(ray);
      scene.add(g);
      world.windowGroups.push(g);
      world.windowOpenings.push(Object.freeze({
        side: sx, center: Object.freeze([wallX, 3.275, wz]),
        width: windowOpeningWidth, height: windowTop - windowBottom,
        revealDepth: 0.46,
      }));
    }
  }

  // 仕切りカーテン。最前列の円卓を横切らない位置で準備会場を隠す。
  const dividerZ = 4.7;
  const rodBeam = new THREE.Mesh(new THREE.BoxGeometry(16.6, 0.18, 0.18), matGold);
  rodBeam.position.set(0, 6.45, dividerZ);
  scene.add(rodBeam);
  world.dividerL = makeCurtain(8.6, 6.4, 0xa85a72, 0.24);
  world.dividerL.position.set(-8.3, 6.4, dividerZ);
  world.dividerR = makeCurtain(8.6, 6.4, 0xa85a72, 0.24);
  world.dividerR.scale.x = -1;
  world.dividerR.position.set(8.3, 6.4, dividerZ);
  world.dividerR.userData.setOpen = (t) => { world.dividerR.userData.open = t; world.dividerR.scale.x = -(1 - 0.8 * t); world.dividerR.scale.z = 1 - 0.35 * t; };
  scene.add(world.dividerL, world.dividerR);

  // ステージ
  const stage = new THREE.Mesh(new THREE.BoxGeometry(10, 0.35, 2.6), new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.55 }));
  stage.position.set(0, 0.175, -10.6);
  stage.receiveShadow = true; stage.castShadow = true;
  scene.add(stage);
  world.stageTop = 0.35;

  // メインテーブル（ステージ上）
  const head = new THREE.Group();
  head.position.set(PARTY_LAYOUT.headTable.center[0], 0.35, PARTY_LAYOUT.headTable.center[1]);
  const headTop = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.74, 0.9), new THREE.MeshStandardMaterial({ map: clothTex, color: 0xf6efe2, roughness: 0.85 }));
  headTop.position.y = 0.37;
  headTop.castShadow = true; headTop.receiveShadow = true;
  head.add(headTop);
  const headSkirtF = new THREE.Mesh(new THREE.PlaneGeometry(3.7, 0.76), headTop.material);
  headSkirtF.position.set(0, 0.37, 0.47);
  head.add(headSkirtF);
  // アクセント帯（選んだ色に染まる）
  const headBandMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.5 });
  world.accentMeshes.push(headBandMat);
  const headBand = new THREE.Mesh(new THREE.PlaneGeometry(3.7, 0.14), headBandMat);
  headBand.position.set(0, 0.62, 0.475);
  head.add(headBand);
  scene.add(head);
  world.headTable = head;

  // ゲスト用丸テーブル6卓×8席。純ロジックのPARTY_LAYOUTと座標を共有する。
  world.tables = [];
  world.chairSpots = [];
  const clothMat = new THREE.MeshStandardMaterial({ map: clothTex, color: 0xf8f2e6, roughness: 0.85, side: THREE.DoubleSide });
  const runnerMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.6 });
  world.accentMeshes.push(runnerMat);
  const profile = [];
  for (const [r, y] of [[0.02, 0.745], [0.5, 0.745], [0.78, 0.74], [0.85, 0.66], [0.9, 0.42], [0.87, 0.14]]) profile.push(new THREE.Vector2(r, y));
  const clothGeo = new THREE.LatheGeometry(profile, 28);
  const chairSeatG = new THREE.BoxGeometry(0.42, 0.05, 0.42);
  const chairBackG = new THREE.BoxGeometry(0.42, 0.5, 0.045);
  const chairLegG = new THREE.BoxGeometry(0.05, 0.46, 0.42);
  const chairMatG = new THREE.MeshStandardMaterial({ color: 0xcfa85e, roughness: 0.4, metalness: 0.5 });
  const chairPad = new THREE.MeshStandardMaterial({ color: 0xf4ead8, roughness: 0.8 });
  for (const layoutTable of PARTY_LAYOUT.tables) {
    const [tx, , tz] = layoutTable.center;
    const grp = new THREE.Group();
    grp.position.set(tx, 0, tz);
    const cloth = new THREE.Mesh(clothGeo, clothMat);
    cloth.castShadow = true; cloth.receiveShadow = true;
    grp.add(cloth);
    const runner = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.012, 0.34), runnerMat);
    runner.position.y = 0.752;
    grp.add(runner);
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.4, 10), matDark);
    ped.position.y = 0.2;
    grp.add(ped);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.05, 14), matDark);
    base.position.y = 0.025;
    grp.add(base);
    const tableSeats = PARTY_LAYOUT.seats.filter((seatPlan) => seatPlan.tableIndex === layoutTable.index);
    for (const seatPlan of tableSeats) {
      const ch = new THREE.Group();
      ch.position.set(...seatPlan.chairLocal);
      ch.rotation.y = seatPlan.angle;
      ch.userData.seatIndex = seatPlan.index;
      ch.userData.tableIndex = seatPlan.tableIndex;
      ch.userData.accessible = seatPlan.accessible;
      const seat = new THREE.Mesh(chairSeatG, chairPad);
      seat.position.y = 0.46; seat.castShadow = true;
      const back = new THREE.Mesh(chairBackG, chairMatG);
      back.position.set(0, 0.75, 0.19);
      const leg1 = new THREE.Mesh(chairLegG, chairMatG);
      leg1.position.set(-0.18, 0.23, 0);
      const leg2 = new THREE.Mesh(chairLegG, chairMatG);
      leg2.position.set(0.18, 0.23, 0);
      ch.add(seat, back, leg1, leg2);
      grp.add(ch);
      world.chairSpots.push(ch);
    }
    scene.add(grp);
    world.tables.push({ group: grp, x: tx, z: tz, topY: layoutTable.topY, layout: layoutTable });
  }

  // アーチ（ステージ前・葉で覆う）
  const arch = new THREE.Group();
  arch.position.set(0, 0.35, -9.3);
  const archR = 1.55, legH = 1.25;
  function archPoint(t) {
    // t 0..1: 左脚→アーチ→右脚
    if (t < 0.25) return new THREE.Vector3(-archR, (t / 0.25) * legH, 0);
    if (t > 0.75) return new THREE.Vector3(archR, (1 - (t - 0.75) / 0.25) * legH, 0);
    const a = Math.PI - ((t - 0.25) / 0.5) * Math.PI;
    return new THREE.Vector3(Math.cos(a) * archR, legH + Math.sin(a) * archR, 0);
  }
  class ArchCurve extends THREE.Curve {
    getPoint(t) { return archPoint(t); }
  }
  const tube = new THREE.Mesh(new THREE.TubeGeometry(new ArchCurve(), 40, 0.05, 8), matDark);
  tube.castShadow = true;
  arch.add(tube);
  // 葉（インスタンス）
  const leafGeo = new THREE.PlaneGeometry(0.055, 0.11);
  leafGeo.translate(0, 0.05, 0);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x4d7c3a, roughness: 0.7, side: THREE.DoubleSide });
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, 380);
  const dummy = new THREE.Object3D();
  const leafCol = new THREE.Color();
  const tangent = new THREE.Vector3();
  for (let i = 0; i < 380; i++) {
    const t = Math.random();
    const p = archPoint(t);
    tangent.copy(archPoint(Math.min(1, t + 0.01))).sub(p).normalize();
    // 茎から少しだけ離して房状に、向きはチューブ沿い＋ランダムな傾き
    const off = new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).normalize().multiplyScalar(0.05 + Math.random() * 0.05);
    dummy.position.copy(p).add(off);
    dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
    dummy.rotateOnAxis(new THREE.Vector3(1, 0, 0), (Math.random() - 0.5) * 1.6);
    dummy.rotateOnAxis(new THREE.Vector3(0, 1, 0), Math.random() * 6.28);
    dummy.scale.setScalar(0.7 + Math.random() * 0.7);
    dummy.updateMatrix();
    leaves.setMatrixAt(i, dummy.matrix);
    leafCol.setHSL(0.29 + Math.random() * 0.05, 0.45, 0.28 + Math.random() * 0.14);
    leaves.setColorAt(i, leafCol);
  }
  leaves.castShadow = true;
  arch.add(leaves);
  scene.add(arch);
  world.arch = arch;
  // 花の取り付け位置（アーチのローカル座標と外向きの姿勢）
  function archSlotAt(t) {
    const p = archPoint(t);
    const outward = new THREE.Vector3(p.x, Math.max(0.2, p.y - legH), 0).normalize();
    if (t < 0.25 || t > 0.75) outward.set(Math.sign(p.x) * 0.7, 0.2, 0.7).normalize();
    else outward.z = 0.75;
    outward.normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), outward);
    return {
      local: p.clone().add(outward.clone().multiplyScalar(0.09)),
      quaternion: q,
      parent: arch,
    };
  }
  world.archSlotAt = archSlotAt;
  world.archSlots = [0.1, 0.22, 0.36, 0.5, 0.64, 0.78, 0.9].map(archSlotAt);

  // シャンデリアの公開アンカー。表示器具そのものは palace-interior がこのGroupへ
  // 組み立てるため、旧1基のダミー器具と新3基が二重に存在しない。
  const chand = new THREE.Group();
  chand.name = 'primary-chandelier';
  chand.position.set(0, 5.55, -2.2);
  world.chandBulbs = [];
  scene.add(chand);
  world.chandelier = chand;

  // ストリングライト（フィナーレで点灯）
  const bulbGeo = new THREE.SphereGeometry(0.03, 8, 6);
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff3d2, emissive: 0xffcf7d, emissiveIntensity: 0 });
  world.stringBulbMat = bulbMat;
  const strands = [
    [[-7.5, 6.4, -8.5], [0, 5.2, -4.5], [7.5, 6.4, -0.5]],
    [[7.5, 6.4, -8.5], [0, 5.2, -4.5], [-7.5, 6.4, -0.5]],
    [[-7.5, 6.4, -0.5], [0, 5.4, 1.6], [7.5, 6.4, 3.5]],
  ];
  const bulbCount = strands.length * 22;
  const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, bulbCount);
  let bi = 0;
  const lineMat = new THREE.LineBasicMaterial({ color: 0xb49258, transparent: true, opacity: 0.24 });
  for (const s of strands) {
    const curve = new THREE.CatmullRomCurve3(s.map(p => new THREE.Vector3(...p)));
    const pts = curve.getPoints(40);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat);
    scene.add(line);
    for (let i = 0; i < 22; i++) {
      const p = curve.getPoint(i / 21);
      dummy.position.copy(p); dummy.position.y -= 0.05;
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      bulbs.setMatrixAt(bi++, dummy.matrix);
    }
  }
  scene.add(bulbs);

  // 作業台（準備ゾーン z≈6.5）
  const bench = new THREE.Group();
  bench.position.set(0, 0, 6.5);
  const benchTopY = 0.92;
  const btop = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.07, 0.95), new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.5 }));
  btop.position.y = benchTopY - 0.035;
  btop.castShadow = true; btop.receiveShadow = true;
  bench.add(btop);
  for (const [lx, lz] of [[-1.05, -0.38], [1.05, -0.38], [-1.05, 0.38], [1.05, 0.38]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, benchTopY - 0.07, 0.09), matDark);
    leg.position.set(lx, (benchTopY - 0.07) / 2, lz);
    leg.castShadow = true;
    bench.add(leg);
  }
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.04, 0.7), matDark);
  shelf.position.y = 0.3;
  bench.add(shelf);
  // 小物：じょうろ・バケツ・切りくず
  const canMat = new THREE.MeshStandardMaterial({ color: 0x7fa8b8, roughness: 0.35, metalness: 0.7 });
  const can = new THREE.Group();
  const canBody = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.2, 14), canMat);
  canBody.position.y = 0.1;
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.025, 0.24, 8), canMat);
  spout.rotation.z = 0.8; spout.position.set(0.14, 0.14, 0);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 6, 14, Math.PI), canMat);
  handle.position.set(-0.09, 0.18, 0); handle.rotation.z = -0.5;
  can.add(canBody, spout, handle);
  can.position.set(0.95, benchTopY, 0.28);
  can.traverse(o => { if (o.isMesh) o.castShadow = true; });
  bench.add(can);
  const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.28, 14, 1, true), canMat);
  bucket.position.set(-1.35, 0.14, 0.3);
  bucket.castShadow = true;
  bench.add(bucket);
  scene.add(bench);
  world.bench = bench;
  world.benchTopY = benchTopY;

  // ---------- 照明 ----------
  const hemi = new THREE.HemisphereLight(0x8a7d92, 0x3a3028, 0.32);
  scene.add(hemi);
  world.hemi = hemi;

  const workLight = new THREE.SpotLight(0xffd9a6, 75, 18, 0.42, 0.7, 1.6);
  workLight.castShadow = true;
  workLight.shadow.mapSize.set(1024, 1024);
  workLight.shadow.bias = -0.002;
  workLight.position.set(0.5, 4.5, 8);
  workLight.target.position.set(0, 1, 6.5);
  scene.add(workLight, workLight.target);
  world.workLight = workLight;

  const sun = new THREE.DirectionalLight(0xffe7bb, 0);
  sun.position.set(2.5, 9, 20);
  sun.target.position.set(0, 0.5, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -10; sun.shadow.camera.right = 10;
  sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -6;
  sun.shadow.camera.far = 45;
  sun.shadow.bias = -0.0015;
  scene.add(sun, sun.target);
  world.sun = sun;

  // main.jsとの既存契約（world.chandLight.intensity）を保ったまま、
  // palace-interior が登録する3灯へマスター照度を分配する。
  world.chandLights = [];
  let chandelierMasterIntensity = 0;
  world.chandLight = {
    get intensity() { return chandelierMasterIntensity; },
    set intensity(value) {
      chandelierMasterIntensity = Math.max(0, Number(value) || 0);
      for (const light of world.chandLights) {
        light.intensity = chandelierMasterIntensity * (light.userData.masterScale || 1 / 3);
      }
    },
  };

  const stageLight = new THREE.PointLight(0xffd7ae, 0, 14, 1.8);
  stageLight.position.set(0, 3.4, -7.6);
  scene.add(stageLight);
  world.stageLight = stageLight;

  // 扉からの光も空中を横切る白い板ではなく、入口側の床へ落ちる投影にする。
  const doorRay = new THREE.Mesh(
    new THREE.PlaneGeometry(3.7, 8.4),
    new THREE.MeshBasicMaterial({ map: world.rayTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  doorRay.position.set(0, 0.047, 5.75);
  doorRay.rotation.x = -Math.PI / 2;
  scene.add(doorRay);
  world.doorRay = doorRay;

  // 扉の奥のまぶしい光（開いた瞬間）
  const burst = new THREE.Sprite(new THREE.SpriteMaterial({
    map: world.glowTex, color: 0xfff6dd, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  burst.position.set(0, 2.4, 9.8);
  burst.scale.setScalar(9);
  scene.add(burst);
  world.doorBurst = burst;

  // 48人分の着席位置。車椅子席も同じ空間契約から供給する。
  scene.updateMatrixWorld(true);
  world.seatSpots = PARTY_LAYOUT.seats.map((seatPlan) => {
    const table = PARTY_LAYOUT.tables[seatPlan.tableIndex];
    const [x, y, z] = seatPlan.body;
    return {
      x, y, z,
      faceY: Math.atan2(table.center[0] - x, table.center[2] - z),
      accessible: seatPlan.accessible,
      wheelchair: seatPlan.accessible,
      tableIndex: seatPlan.tableIndex,
      seatIndex: seatPlan.index,
    };
  });
  world.partyLayout = PARTY_LAYOUT;

  // 天井の梁（吊り飾り配置用のガイド線）
  world.beamLines = [
    { y: 6.6, z: -8.5, xMin: -7, xMax: 7 },
    { y: 6.6, z: -4.5, xMin: -7, xMax: 7 },
    { y: 6.6, z: -0.5, xMin: -7, xMax: 7 },
  ];

  // メインテーブル上の花瓶アンカー（ローカル座標をワールドへ変換）
  world.headTable.updateWorldMatrix(true, false);
  world.headVaseAnchors = [];
  for (let i = 0; i < 5; i++) {
    world.headVaseAnchors.push(world.headTable.localToWorld(new THREE.Vector3(-1.1 + i * 0.55, 0.74, 0.1)));
  }

  // テーブルクロス上に花を置ける半径
  world.clothRadius = PARTY_LAYOUT.tableGeometry.floralRadius;

  return world;
}
