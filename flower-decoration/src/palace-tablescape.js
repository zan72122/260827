// 宮殿調の宴席・家具・小景。既存テーブルと椅子の座標契約は変更しない。

import * as THREE from 'three';
import { PALACE_LAYOUT } from './palace-config.js';

const IVORY = 0xf7f0df;
const CHAMPAGNE = 0xd7c19b;
const ANTIQUE_BRASS = 0xa77b38;
const PALE_VELVET = 0xeee3d2;
const DEFAULT_ACCENT = 0xc6889d;

function damaskTexture() {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x / size) * Math.PI * 4;
      const v = (y / size) * Math.PI * 4;
      const petal = Math.abs(Math.sin(u) * Math.sin(v));
      const vine = Math.abs(Math.sin(u * 0.5 + Math.cos(v))) * 0.35;
      const value = Math.round(234 + 15 * Math.pow(Math.max(petal, vine), 4));
      const i = (y * size + x) * 4;
      data[i] = value;
      data[i + 1] = Math.min(255, value + 3);
      data[i + 2] = Math.min(255, value + 7);
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  texture.needsUpdate = true;
  return texture;
}

function material(color, roughness = 0.55, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

// 直方体の記号感を抑える低コストの面取り形状。Shape/Extrude を共有し、
// バー・ソファ・ピアノ・卓上など、輪郭が近景に出る家具だけへ使う。
function roundedBoxGeometry(width, height, depth, radius = 0.035, segments = 2) {
  const r = Math.min(radius, width * 0.22, height * 0.22, depth * 0.22);
  const innerW = Math.max(0.002, width - r * 2);
  const innerH = Math.max(0.002, height - r * 2);
  const shape = new THREE.Shape();
  const x = -innerW / 2;
  const y = -innerH / 2;
  shape.moveTo(x, y + r);
  shape.lineTo(x, y + innerH - r);
  shape.quadraticCurveTo(x, y + innerH, x + r, y + innerH);
  shape.lineTo(x + innerW - r, y + innerH);
  shape.quadraticCurveTo(x + innerW, y + innerH, x + innerW, y + innerH - r);
  shape.lineTo(x + innerW, y + r);
  shape.quadraticCurveTo(x + innerW, y, x + innerW - r, y);
  shape.lineTo(x + r, y);
  shape.quadraticCurveTo(x, y, x, y + r);
  const extrusion = Math.max(0.002, depth - r * 2);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: extrusion,
    steps: 1,
    curveSegments: segments,
    bevelEnabled: true,
    bevelSegments: segments,
    bevelSize: r,
    bevelThickness: r,
  });
  geometry.translate(0, 0, -extrusion / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function fabricFoldTexture() {
  const width = 128;
  const height = 64;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const broad = Math.sin((x / width) * Math.PI * 24) * 38;
      const weave = (Math.sin(x * 1.7) + Math.cos(y * 2.3)) * 5;
      const fade = 0.72 + (y / height) * 0.28;
      const value = Math.max(24, Math.min(232, Math.round(128 + (broad + weave) * fade)));
      const index = (y * width + x) * 4;
      data[index] = data[index + 1] = data[index + 2] = value;
      data[index + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.5, 1);
  texture.needsUpdate = true;
  return texture;
}

function contactShadowTexture() {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = (x + 0.5) / size * 2 - 1;
      const ny = (y + 0.5) / size * 2 - 1;
      const distance = Math.min(1, Math.hypot(nx, ny));
      const value = Math.round(255 * Math.pow(1 - distance, 2.2));
      const index = (y * size + x) * 4;
      data[index] = data[index + 1] = data[index + 2] = value;
      data[index + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

function basisFor(outward) {
  const z = outward.clone().setY(0).normalize();
  const y = new THREE.Vector3(0, 1, 0);
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  const matrix = new THREE.Matrix4().makeBasis(x, y, z);
  return { x, y, z, quaternion: new THREE.Quaternion().setFromRotationMatrix(matrix) };
}

function fromLocal(base, basis, x = 0, y = 0, z = 0) {
  return base.clone()
    .addScaledVector(basis.x, x)
    .addScaledVector(basis.y, y)
    .addScaledVector(basis.z, z);
}

function addMesh(parent, geometry, mat, position, name, rotation = null, scale = null) {
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.name = name;
  mesh.position.copy(position);
  if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  if (scale) mesh.scale.set(scale[0], scale[1], scale[2]);
  // 小景は床や既存家具の影で十分に接地する。個別の影パスはdraw callを倍増させるため使わない。
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  parent.add(mesh);
  return mesh;
}

function createInstanceFactory(root, accounting) {
  const dummy = new THREE.Object3D();
  return function instances(name, geometry, mat, transforms, { dynamic = false } = {}) {
    const mesh = new THREE.InstancedMesh(geometry, mat, transforms.length);
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    transforms.forEach((transform, index) => {
      dummy.position.copy(transform.position);
      dummy.quaternion.copy(transform.quaternion || new THREE.Quaternion());
      dummy.scale.copy(transform.scale || new THREE.Vector3(1, 1, 1));
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.instanceMatrix.setUsage(dynamic ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage);
    root.add(mesh);
    accounting.instanceCount += transforms.length;
    accounting.instanceCapacity += mesh.count;
    accounting.instancedDrawCalls += 1;
    return mesh;
  };
}

function legacyTableUpgrade(scene, world, damask, folds, runnerMat, pipingMat, makeInstances) {
  const profile = [
    [0.02, 0.758], [0.54, 0.758], [0.82, 0.744], [0.91, 0.63],
    [0.94, 0.30], [0.91, 0.035], [0.72, 0.012],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const overlayGeo = new THREE.LatheGeometry(profile, 32);
  const overlayPositions = overlayGeo.getAttribute('position');
  for (let index = 0; index < overlayPositions.count; index += 1) {
    const x = overlayPositions.getX(index);
    const y = overlayPositions.getY(index);
    const z = overlayPositions.getZ(index);
    if (y > 0.71) continue;
    const angle = Math.atan2(z, x);
    const falloff = 1 - Math.max(0, y) / 0.72;
    const scale = 1 + Math.sin(angle * 32) * 0.010 * (0.35 + falloff * 0.65);
    overlayPositions.setXYZ(index, x * scale, y, z * scale);
  }
  overlayGeo.computeVertexNormals();
  const overlayMat = new THREE.MeshPhysicalMaterial({
    color: IVORY, map: damask, roughness: 0.56, sheen: 0.7,
    sheenColor: new THREE.Color(0xfff4dc), sheenRoughness: 0.42,
    bumpMap: folds, bumpScale: 0.018, side: THREE.DoubleSide,
  });
  const runnerGeo = roundedBoxGeometry(1.62, 0.018, 0.31, 0.008, 1);
  const pipeGeo = new THREE.CylinderGeometry(0.009, 0.009, 1.65, 6);
  pipeGeo.rotateZ(Math.PI / 2);

  scene.updateMatrixWorld(true);
  const overlays = [];
  const runners = [];
  const pipes = [];

  world.tables.forEach((table, tableIndex) => {
    // 旧アクセント帯だけを隠す。クロスと花の親Group・topYはそのまま残す。
    const oldRunner = table.group.children.find((child) => {
      const p = child.geometry?.parameters;
      return child.isMesh && p && Math.abs((p.width || 0) - 1.5) < 0.01
        && Math.abs((p.height || 0) - 0.012) < 0.002;
    });
    if (oldRunner) oldRunner.visible = false;
    const quaternion = table.group.getWorldQuaternion(new THREE.Quaternion());
    const scale = table.group.getWorldScale(new THREE.Vector3());
    overlays.push({
      position: table.group.localToWorld(new THREE.Vector3(0, 0, 0)), quaternion, scale,
      tableIndex,
    });
    runners.push({
      position: table.group.localToWorld(new THREE.Vector3(0, table.topY + 0.009, 0)),
      quaternion, scale, tableIndex,
    });
    for (const z of [-0.154, 0.154]) {
      pipes.push({
        position: table.group.localToWorld(new THREE.Vector3(0, table.topY + 0.019, z)),
        quaternion, scale, tableIndex,
      });
    }
  });
  makeInstances('palace-table-damask-overlays', overlayGeo, overlayMat, overlays);
  makeInstances('palace-table-runners', runnerGeo, runnerMat, runners);
  makeInstances('palace-table-accent-piping', pipeGeo, pipingMat, pipes);
}

function upgradeHeadTable(scene, world, damask, folds, runnerMat, pipingMat, makeInstances) {
  const table = world.headTable;
  const silk = new THREE.MeshPhysicalMaterial({
    color: IVORY, map: damask, roughness: 0.54, sheen: 0.72,
    sheenColor: new THREE.Color(0xfff1d8), bumpMap: folds, bumpScale: 0.022,
    side: THREE.DoubleSide,
  });
  const skirtGeometry = new THREE.PlaneGeometry(3.76, 0.76, 36, 4);
  const positions = skirtGeometry.getAttribute('position');
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index);
    positions.setZ(index, Math.sin((x + 1.88) * Math.PI * 7.5) * 0.026);
  }
  skirtGeometry.computeVertexNormals();
  const skirt = new THREE.Mesh(skirtGeometry, silk);
  skirt.name = 'palace-head-table-pleated-skirt';
  skirt.position.set(0, 0.38, 0.49);
  table.add(skirt);

  const overlay = new THREE.Mesh(roundedBoxGeometry(3.72, 0.032, 0.93, 0.012, 1), runnerMat);
  overlay.name = 'palace-head-table-silk-overlay';
  overlay.position.y = 0.755;
  table.add(overlay);
  scene.updateMatrixWorld(true);
  const pipeGeometry = new THREE.CylinderGeometry(0.013, 0.013, 3.73, 6);
  pipeGeometry.rotateZ(Math.PI / 2);
  const tableQuaternion = table.getWorldQuaternion(new THREE.Quaternion());
  const tableScale = table.getWorldScale(new THREE.Vector3());
  const pipes = [0.71, 0.16].map((y) => ({
    position: table.localToWorld(new THREE.Vector3(0, y, 0.515)),
    quaternion: tableQuaternion,
    scale: tableScale,
  }));
  makeInstances('palace-head-table-accent-piping', pipeGeometry, pipingMat, pipes);
}

function buildChairTransforms(scene, world) {
  scene.updateMatrixWorld(true);
  const chairs = [];
  for (const spot of world.chairSpots) {
    // 旧箱形椅子は描画だけ停止し、入場先に使うGroupと親子関係は保持する。
    spot.children.forEach((child) => { child.visible = false; });
    // 車椅子席は丸背椅子を置かず、移乗不要の実在する席構成にする。
    if (spot.userData.accessible) continue;
    const table = world.tables.find((entry) => entry.group === spot.parent);
    const position = spot.getWorldPosition(new THREE.Vector3());
    const center = table.group.getWorldPosition(new THREE.Vector3());
    chairs.push({ position, center, floorY: center.y, scale: 1, kind: 'guest' });
  }
  for (const chair of PALACE_LAYOUT.headTable.chairs) {
    const [x, z] = chair.center;
    const y = world.headTable.position.y;
    chairs.push({
      position: new THREE.Vector3(x, y, z),
      center: new THREE.Vector3(
        PALACE_LAYOUT.headTable.center[0], y, PALACE_LAYOUT.headTable.center[1],
      ),
      floorY: y,
      scale: 1.12,
      kind: 'head',
    });
  }
  return chairs;
}

function renderChairs(root, chairs, makeInstances, mats) {
  const seat = [];
  const backRing = [];
  const backPad = [];
  const legs = [];
  const posts = [];
  const knots = [];
  const finials = [];
  const ribbonTails = [];

  chairs.forEach((chair, chairIndex) => {
    const outward = chair.position.clone().sub(chair.center).setY(0).normalize();
    const b = basisFor(outward);
    const s = chair.scale;
    const transform = (x, y, z, scale = [s, s, s]) => ({
      position: fromLocal(chair.position, b, x * s, chair.floorY - chair.position.y + y * s, z * s),
      quaternion: b.quaternion,
      scale: new THREE.Vector3(...scale),
      kind: chair.kind,
    });
    seat.push(transform(0, 0.48, 0, [s, s, s]));
    backRing.push(transform(0, 0.82, 0.18, [s, s, s]));
    backPad.push(transform(0, 0.82, 0.172, [s, s, s]));
    for (const x of [-0.18, 0.18]) {
      for (const z of [-0.14, 0.14]) legs.push(transform(x, 0.23, z, [s, s, s]));
      posts.push(transform(x, 0.67, 0.16, [s, s, s]));
    }
    knots.push(transform(0, 0.72, 0.226, [s, s, s]));
    if (chair.kind === 'head') finials.push(transform(0, 1.075, 0.18, [s, s, s]));

    for (const side of [-1, 1]) {
      ribbonTails.push({
        position: fromLocal(chair.position, b, side * 0.055, 0.69, 0.232),
        quaternion: b.quaternion.clone(),
        baseQuaternion: b.quaternion.clone(),
        scale: new THREE.Vector3(1, 1, 1),
        kind: chair.kind,
        phase: chairIndex * 0.73 + (side > 0 ? 1.1 : 0),
        period: 8 + ((chairIndex + (side > 0 ? 2 : 0)) % 5),
      });
    }
  });

  const staticPools = [
    [makeInstances('palace-chair-seats', new THREE.CylinderGeometry(0.25, 0.24, 0.075, 16), mats.velvet, seat), seat],
    [makeInstances('palace-chair-round-backs', new THREE.TorusGeometry(0.225, 0.027, 6, 20), mats.brass, backRing), backRing],
    [makeInstances('palace-chair-back-pads', new THREE.CircleGeometry(0.188, 18), mats.velvetDouble, backPad), backPad],
    [makeInstances('palace-chair-legs', new THREE.BoxGeometry(0.035, 0.46, 0.035), mats.brass, legs), legs],
    [makeInstances('palace-chair-back-posts', new THREE.BoxGeometry(0.032, 0.43, 0.032), mats.brass, posts), posts],
    [makeInstances('palace-chair-ribbon-knots', new THREE.SphereGeometry(0.067, 8, 6), mats.accentRibbon, knots), knots],
    [makeInstances('palace-head-chair-finials', new THREE.SphereGeometry(0.062, 8, 6), mats.brass, finials), finials],
  ];
  const ribbonGeometry = new THREE.PlaneGeometry(0.075, 0.38, 1, 4);
  ribbonGeometry.translate(0, -0.19, 0);
  const ribbonMesh = makeInstances(
    'palace-chair-ribbon-tails', ribbonGeometry, mats.accentRibbon, ribbonTails, { dynamic: true },
  );
  const visibilityDummy = new THREE.Object3D();
  function setHeadVisible(visible) {
    for (const [mesh, entries] of staticPools) {
      entries.forEach((entry, index) => {
        visibilityDummy.position.copy(entry.position);
        visibilityDummy.quaternion.copy(entry.quaternion || new THREE.Quaternion());
        if (entry.kind === 'head' && !visible) visibilityDummy.scale.setScalar(0);
        else visibilityDummy.scale.copy(entry.scale);
        visibilityDummy.updateMatrix();
        mesh.setMatrixAt(index, visibilityDummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
  return { mesh: ribbonMesh, entries: ribbonTails, setHeadVisible, headVisible: true };
}

function guestSettingBases(scene, world) {
  scene.updateMatrixWorld(true);
  return world.chairSpots.map((spot) => {
    const table = world.tables.find((entry) => entry.group === spot.parent);
    const chairPosition = spot.getWorldPosition(new THREE.Vector3());
    const center = table.group.getWorldPosition(new THREE.Vector3());
    const outward = chairPosition.clone().sub(center).setY(0).normalize();
    return {
      position: center.clone().addScaledVector(outward, 0.61).setY(center.y + table.topY),
      outward,
      kind: 'guest',
    };
  });
}

function renderSettings(root, scene, world, makeInstances, mats) {
  const settings = guestSettingBases(scene, world);
  for (const [x, y, z] of PALACE_LAYOUT.headTable.settings) {
    settings.push({ position: new THREE.Vector3(x, y, z), outward: new THREE.Vector3(0, 0, 1), kind: 'head' });
  }

  const bins = Object.fromEntries([
    'charger', 'plate', 'cutlery', 'glassStem', 'glassBowl', 'napkin', 'ring',
    'menu', 'placeCard', 'candle', 'candleGlass', 'flame', 'breadPlate', 'bread',
    'entree', 'garnish', 'water', 'drink',
  ].map((name) => [name, []]));
  const push = (bin, base, b, x, y, z, scale = [1, 1, 1], quaternion = b.quaternion) => {
    bins[bin].push({ position: fromLocal(base, b, x, y, z), quaternion, scale: new THREE.Vector3(...scale) });
  };

  settings.forEach((setting, index) => {
    const b = basisFor(setting.outward);
    const base = setting.position;
    push('charger', base, b, 0, 0.018, 0, [1, 1, 1]);
    push('plate', base, b, 0, 0.032, 0, [1, 1, 1]);
    // 空の舞台用セッティングに見せず、全50席を実際の一皿と飲料まで整える。
    push('breadPlate', base, b, -0.305, 0.029, -0.155, [1, 1, 1]);
    push('bread', base, b, -0.305, 0.071, -0.155, [1, 0.72, 0.78]);
    push('entree', base, b, 0, 0.054, 0.012, [1, 1, 1]);
    for (const [x, z, scale] of [[-0.055, 0.035, 0.82], [0.052, 0.046, 0.68], [0.018, -0.042, 0.58]]) {
      push('garnish', base, b, x, 0.078, z, [scale, scale * 0.68, scale]);
    }
    for (const [x, z, length] of [[-0.27, -0.025, 0.22], [-0.32, -0.015, 0.18], [0.27, -0.025, 0.22], [0.32, -0.015, 0.18]]) {
      push('cutlery', base, b, x, 0.041, z, [1, 1, length / 0.22]);
    }
    for (const [x, z, scale] of [[0.19, -0.20, 1], [0.31, -0.15, 0.84]]) {
      push('glassStem', base, b, x, 0.105 * scale, z, [scale, scale, scale]);
      push('glassBowl', base, b, x, 0.185 * scale, z, [scale, scale, scale]);
    }
    push('water', base, b, 0.19, 0.152, -0.20, [1, 1, 1]);
    push('drink', base, b, 0.31, 0.132, -0.15, [0.84, 0.72, 0.84]);
    push('napkin', base, b, 0, 0.092, 0.015, [1, 1, 1]);
    push('ring', base, b, 0, 0.096, 0.055, [1, 1, 1]);
    push('menu', base, b, -0.18, 0.09, -0.20, [1, 1, 1]);
    push('placeCard', base, b, 0, 0.09, -0.25, [1, 1, 1]);
    const candleHeight = 0.16 + (index % 3) * 0.045;
    push('candle', base, b, -0.37, candleHeight / 2 + 0.03, -0.10, [1, candleHeight, 1]);
    push('candleGlass', base, b, -0.37, candleHeight / 2 + 0.03, -0.10, [1, candleHeight + 0.035, 1]);
    push('flame', base, b, -0.37, candleHeight + 0.07, -0.10, [1, 1 + (index % 2) * 0.15, 1]);
  });

  makeInstances('palace-chargers', new THREE.CylinderGeometry(0.205, 0.205, 0.012, 20), mats.brass, bins.charger);
  makeInstances('palace-dinner-plates', new THREE.CylinderGeometry(0.166, 0.166, 0.018, 20), mats.porcelain, bins.plate);
  makeInstances('palace-bread-plates', new THREE.CylinderGeometry(0.087, 0.087, 0.014, 16), mats.porcelain, bins.breadPlate);
  makeInstances('palace-bread-rolls', new THREE.SphereGeometry(0.066, 10, 6), mats.bread, bins.bread);
  makeInstances('palace-plated-entrees', new THREE.CylinderGeometry(0.105, 0.112, 0.026, 14), mats.entree, bins.entree);
  makeInstances('palace-entree-garnish', new THREE.SphereGeometry(0.037, 7, 5), mats.garnish, bins.garnish);
  makeInstances('palace-cutlery', new THREE.BoxGeometry(0.018, 0.012, 0.22), mats.silver, bins.cutlery);
  makeInstances('palace-glass-stems', new THREE.CylinderGeometry(0.009, 0.012, 0.13, 8), mats.glass, bins.glassStem, { shadows: false });
  makeInstances('palace-glass-bowls', new THREE.CylinderGeometry(0.055, 0.026, 0.10, 10, 1, true), mats.glass, bins.glassBowl, { shadows: false });
  makeInstances('palace-water-servings', new THREE.CylinderGeometry(0.046, 0.034, 0.040, 10), mats.water, bins.water, { shadows: false });
  makeInstances('palace-coloured-drinks', new THREE.CylinderGeometry(0.046, 0.034, 0.040, 10), mats.drink, bins.drink, { shadows: false });
  makeInstances('palace-folded-napkins', new THREE.ConeGeometry(0.10, 0.13, 4), mats.accentFabric, bins.napkin);
  makeInstances('palace-napkin-rings', new THREE.TorusGeometry(0.038, 0.009, 5, 12), mats.brass, bins.ring);
  makeInstances('palace-menus', new THREE.BoxGeometry(0.14, 0.16, 0.012), mats.paper, bins.menu);
  makeInstances('palace-place-cards', new THREE.BoxGeometry(0.16, 0.085, 0.012), mats.paper, bins.placeCard);
  makeInstances('palace-candles', new THREE.CylinderGeometry(0.025, 0.027, 1, 8), mats.wax, bins.candle);
  makeInstances('palace-candle-glass', new THREE.CylinderGeometry(0.042, 0.048, 1, 10, 1, true), mats.accentGlass, bins.candleGlass, { shadows: false });
  makeInstances('palace-candle-flames', new THREE.SphereGeometry(0.025, 6, 5), mats.flame, bins.flame, { shadows: false });
  return settings;
}

function buildTableFloralMechanics(world, makeInstances, mats) {
  const compotes = [];
  const foam = [];
  const stems = [];
  const upright = new THREE.Quaternion();
  for (const table of world.tables) {
    const center = new THREE.Vector3(table.x, table.topY, table.z);
    compotes.push({
      position: center.clone().add(new THREE.Vector3(0, 0.045, 0)),
      quaternion: upright,
      scale: new THREE.Vector3(1, 1, 1),
    });
    foam.push({
      position: center.clone().add(new THREE.Vector3(0, 0.095, 0)),
      quaternion: upright,
      scale: new THREE.Vector3(1, 0.42, 1),
    });
    for (let index = 0; index < 6; index += 1) {
      const angle = index * Math.PI * 2 / 6 + table.x * 0.11;
      stems.push({
        position: center.clone().add(new THREE.Vector3(Math.cos(angle) * 0.085, 0.145, Math.sin(angle) * 0.085)),
        quaternion: upright,
        scale: new THREE.Vector3(1, 0.78 + (index % 3) * 0.12, 1),
      });
    }
  }
  makeInstances('palace-table-floral-compotes', new THREE.CylinderGeometry(0.18, 0.12, 0.09, 18), mats.brass, compotes);
  makeInstances('palace-table-floral-foam', new THREE.SphereGeometry(0.135, 10, 6), mats.garnish, foam);
  makeInstances('palace-table-visible-stems', new THREE.CylinderGeometry(0.008, 0.011, 0.16, 6), mats.garnish, stems);
  return Object.freeze({ compotes: compotes.length, foam: foam.length, stems: stems.length });
}

function buildCake(root, at, mats, makeInstances) {
  const group = new THREE.Group(); group.position.copy(at); group.name = 'palace-vignette-cake'; root.add(group);
  // 床置きの塔ではなく、クロス付きの専用卓へケーキを載せる。
  addMesh(group, new THREE.CylinderGeometry(0.72, 0.77, 0.68, 28, 1, true), mats.ivoryFabric,
    new THREE.Vector3(0, 0.37, 0), 'cake-dedicated-table-skirt');
  addMesh(group, new THREE.CylinderGeometry(0.78, 0.78, 0.075, 28), mats.wood,
    new THREE.Vector3(0, 0.73, 0), 'cake-dedicated-table-top');
  addMesh(group, new THREE.CylinderGeometry(0.44, 0.48, 0.08, 24), mats.brass,
    new THREE.Vector3(0, 0.81, -0.08), 'cake-pedestal');
  const tiers = [[0.41, 0.52, 1.11], [0.31, 0.40, 1.57], [0.21, 0.31, 1.92]].map(([radius, height, y]) => ({
    position: new THREE.Vector3(at.x, y, at.z - 0.08),
    scale: new THREE.Vector3(radius, height, radius),
  }));
  makeInstances('palace-cake-tiers', new THREE.CylinderGeometry(0.93, 1, 1, 22), mats.cake, tiers);
  const bandGeometry = new THREE.TorusGeometry(1, 0.048, 6, 28);
  bandGeometry.rotateX(Math.PI / 2);
  const bands = [[0.395, 1.36], [0.295, 1.76], [0.195, 2.075]].map(([radius, y]) => ({
    position: new THREE.Vector3(at.x, y, at.z - 0.08),
    scale: new THREE.Vector3(radius, radius, radius),
  }));
  makeInstances('palace-cake-gold-bands', bandGeometry, mats.brass, bands);
  const toppers = [-1, 1].map((side) => ({
    position: new THREE.Vector3(at.x + side * 0.065, 2.19, at.z - 0.08),
    quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, side * -0.18, 0)),
    scale: new THREE.Vector3(1, 1, 1),
  }));
  makeInstances('palace-cake-ring-toppers', new THREE.TorusGeometry(0.11, 0.018, 6, 20), mats.brass, toppers);

  // 手前0.27mをサービス帯として空け、皿・ナイフを左右へまとめる。
  const servicePlates = [-0.60, -0.55, -0.50].map((x, index) => ({
    position: new THREE.Vector3(at.x + x, 0.795 + index * 0.012, at.z + 0.25),
    scale: new THREE.Vector3(1, 1, 1),
  }));
  makeInstances('palace-cake-service-plates', new THREE.CylinderGeometry(0.105, 0.105, 0.012, 16), mats.porcelain, servicePlates);
  const knifeBlade = addMesh(group, roundedBoxGeometry(0.035, 0.016, 0.36, 0.006, 1), mats.silver,
    new THREE.Vector3(0.58, 0.81, 0.22), 'cake-service-knife-blade', [0, 0.16, 0]);
  knifeBlade.rotation.y = -0.25;
  addMesh(group, roundedBoxGeometry(0.048, 0.026, 0.16, 0.009, 1), mats.wood,
    new THREE.Vector3(0.65, 0.815, 0.42), 'cake-service-knife-handle', [0, -0.25, 0]);
  const blossoms = [];
  for (let i = 0; i < 18; i += 1) {
    const angle = i * 2.4;
    const radius = i < 9 ? 0.40 : 0.29;
    const y = i < 9 ? 1.35 : 1.75;
    blossoms.push({ position: new THREE.Vector3(at.x + Math.cos(angle) * radius, y, at.z - 0.08 + Math.sin(angle) * radius), scale: new THREE.Vector3(1, 0.7, 1) });
  }
  makeInstances('palace-cake-blossoms', new THREE.SphereGeometry(0.075, 7, 5), mats.blush, blossoms);
  return Object.freeze({ dedicatedTable: true, servicePlates: 3, knife: true, serviceClearance: 0.27 });
}

function buildBar(root, at, mats, makeInstances) {
  const group = new THREE.Group(); group.position.copy(at); group.name = 'palace-vignette-bar'; root.add(group);
  addMesh(group, roundedBoxGeometry(2.18, 1.02, 0.62, 0.055), mats.wood,
    new THREE.Vector3(0, 0.53, 0), 'bar-counter-bevelled');
  addMesh(group, roundedBoxGeometry(2.02, 0.58, 0.035, 0.012, 1), mats.backlight,
    new THREE.Vector3(0, 0.55, 0.325), 'bar-backlight');
  addMesh(group, roundedBoxGeometry(2.28, 0.09, 0.74, 0.035), mats.brass,
    new THREE.Vector3(0, 1.075, 0), 'bar-rounded-top');
  // 客から設備が読める背面棚。鏡と二段棚にボトルを分ける。
  addMesh(group, roundedBoxGeometry(2.02, 1.15, 0.045, 0.025), mats.mirror,
    new THREE.Vector3(0, 1.62, -0.46), 'bar-backbar-mirror');
  const shelves = [1.19, 1.68, 2.13].map((y) => ({
    position: new THREE.Vector3(at.x, y, at.z - 0.34),
    scale: new THREE.Vector3(1, 1, 1),
  }));
  makeInstances('palace-bar-backbar-shelves', roundedBoxGeometry(2.14, 0.055, 0.32, 0.018), mats.brass, shelves);
  // 埋込流し・水栓・氷槽と、バーテンダー用の滑り止め作業域。
  addMesh(group, roundedBoxGeometry(0.50, 0.045, 0.33, 0.045), mats.sink,
    new THREE.Vector3(-0.48, 1.13, 0.02), 'bar-sink-basin');
  addMesh(group, new THREE.TorusGeometry(0.11, 0.018, 6, 16, Math.PI), mats.silver,
    new THREE.Vector3(-0.48, 1.28, -0.10), 'bar-faucet', [0, 0, Math.PI]);
  addMesh(group, roundedBoxGeometry(0.39, 0.15, 0.31, 0.045), mats.silver,
    new THREE.Vector3(0.48, 1.15, 0.03), 'bar-ice-well');
  addMesh(group, new THREE.PlaneGeometry(1.62, 0.48), mats.workMat,
    new THREE.Vector3(0, 0.018, 0.70), 'bar-working-zone', [-Math.PI / 2, 0, 0]);
  const bottles = [];
  for (let i = 0; i < 14; i += 1) bottles.push({
    position: new THREE.Vector3(at.x - 0.86 + (i % 7) * 0.285, 1.39 + Math.floor(i / 7) * 0.49, at.z - 0.31),
    scale: new THREE.Vector3(1, 0.82 + (i % 4) * 0.09, 1),
  });
  makeInstances('palace-bar-bottles', new THREE.CylinderGeometry(0.045, 0.055, 0.34, 7), mats.bottle, bottles, { shadows: false });
  const ice = [];
  for (let i = 0; i < 16; i += 1) ice.push({
    position: new THREE.Vector3(at.x + 0.36 + (i % 4) * 0.08, 1.25 + Math.floor(i / 8) * 0.055, at.z - 0.065 + (Math.floor(i / 4) % 2) * 0.10),
    quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(i * 0.17, i * 0.31, i * 0.11)),
    scale: new THREE.Vector3(0.8 + (i % 3) * 0.1, 0.8, 0.8),
  });
  makeInstances('palace-bar-ice', roundedBoxGeometry(0.075, 0.065, 0.075, 0.014, 1), mats.ice, ice, { shadows: false });
  const stems = [];
  const bowls = [];
  for (let i = 0; i < 8; i += 1) {
    const x = at.x - 0.13 + (i % 4) * 0.12;
    const z = at.z + 0.15 + Math.floor(i / 4) * 0.14;
    stems.push({ position: new THREE.Vector3(x, 1.21, z), scale: new THREE.Vector3(0.72, 0.72, 0.72) });
    bowls.push({ position: new THREE.Vector3(x, 1.275, z), scale: new THREE.Vector3(0.72, 0.72, 0.72) });
  }
  makeInstances('palace-bar-glass-stems', new THREE.CylinderGeometry(0.008, 0.012, 0.12, 7), mats.glass, stems, { shadows: false });
  makeInstances('palace-bar-glasses', new THREE.CylinderGeometry(0.052, 0.025, 0.095, 9, 1, true), mats.glass, bowls, { shadows: false });
  return Object.freeze({ backbar: true, sink: true, icePortions: ice.length, glasses: bowls.length, workZoneDepth: 0.48 });
}

function buildPiano(root, at, mats, makeInstances) {
  const group = new THREE.Group(); group.position.copy(at); group.rotation.y = -0.22; group.name = 'palace-vignette-piano'; root.add(group);
  addMesh(group, new THREE.SphereGeometry(0.8, 16, 8), mats.lacquer, new THREE.Vector3(-0.18, 0.72, 0), 'grand-piano-body', null, [1.45, 0.30, 1]);
  addMesh(group, roundedBoxGeometry(1.05, 0.12, 0.48, 0.035), mats.lacquer,
    new THREE.Vector3(0.65, 0.76, 0), 'grand-piano-keyboard-bevelled');
  addMesh(group, roundedBoxGeometry(1.45, 0.04, 0.85, 0.015, 1), mats.lacquer,
    new THREE.Vector3(-0.28, 1.03, -0.08), 'grand-piano-lid', [0.10, 0, -0.08]);
  const keys = [];
  const blackKeys = [];
  group.updateMatrixWorld(true);
  const pianoQuaternion = group.getWorldQuaternion(new THREE.Quaternion());
  const legs = [-0.55, 0.42].map((x) => ({
    position: group.localToWorld(new THREE.Vector3(x, 0.36, 0.12)),
    quaternion: pianoQuaternion,
    scale: new THREE.Vector3(1, 1, 1),
  }));
  makeInstances('palace-piano-legs', new THREE.CylinderGeometry(0.035, 0.045, 0.70, 7), mats.lacquer, legs);
  for (let i = 0; i < 14; i += 1) keys.push({
    position: group.localToWorld(new THREE.Vector3(0.18 + i * 0.075, 0.84, 0.25)),
    quaternion: pianoQuaternion,
    scale: new THREE.Vector3(1, 1, 1),
  });
  makeInstances('palace-piano-keys', new THREE.BoxGeometry(0.064, 0.025, 0.27), mats.porcelain, keys);
  for (const i of [0, 1, 3, 4, 5, 7, 8, 10, 11, 12]) blackKeys.push({
    position: group.localToWorld(new THREE.Vector3(0.18 + (i + 0.62) * 0.075, 0.869, 0.19)),
    quaternion: pianoQuaternion,
    scale: new THREE.Vector3(1, 1, 1),
  });
  makeInstances('palace-piano-black-keys', roundedBoxGeometry(0.038, 0.027, 0.16, 0.008, 1), mats.ebony, blackKeys);
  const pedals = [-0.065, 0.065].map((z) => ({
    position: group.localToWorld(new THREE.Vector3(0.50, 0.16, z)),
    quaternion: pianoQuaternion,
    scale: new THREE.Vector3(1, 1, 1),
  }));
  makeInstances('palace-piano-pedals', roundedBoxGeometry(0.18, 0.025, 0.055, 0.008, 1), mats.brass, pedals);
  addMesh(group, new THREE.CylinderGeometry(0.018, 0.022, 0.34, 7), mats.brass,
    new THREE.Vector3(0.40, 1.15, -0.02), 'piano-music-stand-post');
  addMesh(group, roundedBoxGeometry(0.56, 0.38, 0.035, 0.018), mats.lacquer,
    new THREE.Vector3(0.40, 1.40, -0.02), 'piano-music-stand', [0.06, 0, 0]);
  addMesh(group, roundedBoxGeometry(0.44, 0.30, 0.012, 0.008, 1), mats.paper,
    new THREE.Vector3(0.40, 1.41, 0.001), 'piano-open-score', [0.06, 0, 0]);
  addMesh(group, roundedBoxGeometry(0.50, 0.11, 0.38, 0.035), mats.velvet,
    new THREE.Vector3(1.12, 0.49, 0.40), 'piano-bench-seat');
  const benchLegs = [];
  for (const x of [0.94, 1.30]) for (const z of [0.27, 0.53]) benchLegs.push({
    position: group.localToWorld(new THREE.Vector3(x, 0.235, z)),
    quaternion: pianoQuaternion,
    scale: new THREE.Vector3(1, 1, 1),
  });
  makeInstances('palace-piano-bench-legs', new THREE.CylinderGeometry(0.024, 0.032, 0.45, 7), mats.lacquer, benchLegs);
  return Object.freeze({ whiteKeys: keys.length, blackKeys: blackKeys.length, pedals: pedals.length, musicStand: true, bench: true });
}

function buildLounge(root, at, mats, makeInstances) {
  const group = new THREE.Group(); group.position.copy(at); group.name = 'palace-vignette-lounge'; root.add(group);
  addMesh(group, new THREE.PlaneGeometry(2.8, 2.4), mats.rug, new THREE.Vector3(0, 0.012, 0), 'lounge-rug', [-Math.PI / 2, 0, 0]);
  addMesh(group, roundedBoxGeometry(2.15, 0.45, 0.72, 0.11), mats.velvet,
    new THREE.Vector3(0, 0.42, -0.52), 'lounge-sofa-seat-bevelled');
  addMesh(group, roundedBoxGeometry(2.15, 0.68, 0.20, 0.075), mats.velvet,
    new THREE.Vector3(0, 0.78, -0.82), 'lounge-sofa-back-bevelled');
  group.updateMatrixWorld(true);
  const loungeQuaternion = group.getWorldQuaternion(new THREE.Quaternion());
  const arms = [-0.84, 0.84].map((x) => ({
    position: group.localToWorld(new THREE.Vector3(x, 0.48, -0.52)),
    quaternion: loungeQuaternion,
    scale: new THREE.Vector3(1, 1, 1),
  }));
  makeInstances('palace-lounge-sofa-arms', roundedBoxGeometry(0.22, 0.58, 0.76, 0.07), mats.velvet, arms);
  const cushions = [-0.55, 0, 0.55].map((x, index) => ({
    position: group.localToWorld(new THREE.Vector3(x, 0.73, -0.68)),
    quaternion: loungeQuaternion,
    scale: new THREE.Vector3(index === 1 ? 0.82 : 1, 1, 1),
  }));
  makeInstances('palace-lounge-cushions', roundedBoxGeometry(0.50, 0.38, 0.16, 0.075), mats.accentFabric, cushions);
  addMesh(group, new THREE.CylinderGeometry(0.52, 0.52, 0.08, 20), mats.mirror, new THREE.Vector3(0, 0.43, 0.52), 'lounge-low-table');
  addMesh(group, new THREE.CylinderGeometry(0.08, 0.16, 0.40, 10), mats.brass, new THREE.Vector3(0, 0.22, 0.52), 'lounge-table-base');
  return Object.freeze({ sofa: true, cushions: cushions.length, rug: true, drinksTable: true });
}

function buildSeatingChart(root, at, mats, makeInstances) {
  const group = new THREE.Group(); group.position.copy(at); group.rotation.y = -Math.PI / 2; group.name = 'palace-vignette-seating-chart'; root.add(group);
  addMesh(group, roundedBoxGeometry(1.25, 1.75, 0.05, 0.035), mats.mirror,
    new THREE.Vector3(0, 1.35, 0), 'seating-chart-mirror');
  const rows = [];
  group.updateMatrixWorld(true);
  const chartQuaternion = group.getWorldQuaternion(new THREE.Quaternion());
  const verticalFrames = [-0.68, 0.68].map((x) => ({
    position: group.localToWorld(new THREE.Vector3(x, 1.35, 0)),
    quaternion: chartQuaternion,
    scale: new THREE.Vector3(1, 1, 1),
  }));
  const horizontalFrames = [0.35, 2.35].map((y) => ({
    position: group.localToWorld(new THREE.Vector3(0, y, 0)),
    quaternion: chartQuaternion,
    scale: new THREE.Vector3(1, 1, 1),
  }));
  makeInstances('palace-seating-chart-vertical-frame', roundedBoxGeometry(0.07, 1.95, 0.08, 0.018, 1), mats.brass, verticalFrames);
  makeInstances('palace-seating-chart-horizontal-frame', roundedBoxGeometry(1.42, 0.07, 0.08, 0.018, 1), mats.brass, horizontalFrames);

  // 文字レンダリングを増やさず、1〜6の卓番号を七セグ図形と対応線で示す。
  const digitSegments = {
    1: ['b', 'c'], 2: ['a', 'b', 'g', 'e', 'd'], 3: ['a', 'b', 'g', 'c', 'd'],
    4: ['f', 'g', 'b', 'c'], 5: ['a', 'f', 'g', 'c', 'd'], 6: ['a', 'f', 'g', 'e', 'c', 'd'],
  };
  const segmentLayout = {
    a: [0, 0.055, 0], b: [0.032, 0.028, Math.PI / 2], c: [0.032, -0.028, Math.PI / 2],
    d: [0, -0.055, 0], e: [-0.032, -0.028, Math.PI / 2], f: [-0.032, 0.028, Math.PI / 2], g: [0, 0, 0],
  };
  const numberRings = [];
  const numberBars = [];
  const connectorLines = [];
  const destinationDots = [];
  const zAxis = new THREE.Vector3(0, 0, 1);
  for (let digit = 1; digit <= 6; digit += 1) {
    const y = 0.70 + (digit - 1) * 0.255;
    const iconX = -0.43;
    numberRings.push({
      position: group.localToWorld(new THREE.Vector3(iconX, y, 0.046)),
      quaternion: chartQuaternion,
      scale: new THREE.Vector3(1, 1, 1),
    });
    for (const segment of digitSegments[digit]) {
      const [dx, dy, angle] = segmentLayout[segment];
      numberBars.push({
        position: group.localToWorld(new THREE.Vector3(iconX + dx, y + dy, 0.052)),
        quaternion: chartQuaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(zAxis, angle)),
        scale: new THREE.Vector3(1, 1, 1),
      });
    }
    connectorLines.push({
      position: group.localToWorld(new THREE.Vector3(-0.275, y, 0.046)),
      quaternion: chartQuaternion,
      scale: new THREE.Vector3(1, 1, 1),
    });
    destinationDots.push({
      position: group.localToWorld(new THREE.Vector3(-0.18, y, 0.052)),
      quaternion: chartQuaternion,
      scale: new THREE.Vector3(1, 1, 1),
    });
    for (let line = 0; line < 2; line += 1) rows.push({
      position: group.localToWorld(new THREE.Vector3(0.18, y + (line ? -0.035 : 0.035), 0.046)),
      quaternion: chartQuaternion,
      scale: new THREE.Vector3(0.74 - ((digit + line) % 3) * 0.10, 1, 1),
    });
  }
  makeInstances('palace-seating-chart-table-number-rings', new THREE.TorusGeometry(0.09, 0.010, 5, 16), mats.brass, numberRings, { shadows: false });
  makeInstances('palace-seating-chart-table-number-bars', roundedBoxGeometry(0.055, 0.012, 0.012, 0.004, 1), mats.brass, numberBars, { shadows: false });
  makeInstances('palace-seating-chart-correspondence-lines', roundedBoxGeometry(0.13, 0.010, 0.010, 0.003, 1), mats.brass, connectorLines, { shadows: false });
  makeInstances('palace-seating-chart-destination-dots', new THREE.CircleGeometry(0.014, 8), mats.brass, destinationDots, { shadows: false });
  makeInstances('palace-seating-chart-name-rows', roundedBoxGeometry(0.48, 0.013, 0.010, 0.003, 1), mats.brass, rows, { shadows: false });
  return Object.freeze({ tableNumbers: numberRings.length, correspondenceLines: connectorLines.length, nameRows: rows.length });
}

function buildVignetteUsers(root, vignetteAt, makeInstances, mats) {
  const userSpecs = [
    {
      role: 'cakeServer', vignette: 'cake', stance: 'standing',
      position: vignetteAt('cake').add(new THREE.Vector3(1.02, 0, 0.26)),
      target: vignetteAt('cake').add(new THREE.Vector3(0, 1.0, 0)),
    },
    {
      role: 'loungeGuest', vignette: 'lounge', stance: 'seated',
      position: vignetteAt('lounge').add(new THREE.Vector3(0.38, 0, -0.50)),
      target: vignetteAt('lounge').add(new THREE.Vector3(0, 1.0, 0.50)),
    },
    {
      role: 'seatingUsher', vignette: 'seatingChart', stance: 'standing',
      position: vignetteAt('seatingChart').add(new THREE.Vector3(-0.48, 0, -0.22)),
      target: vignetteAt('seatingChart').add(new THREE.Vector3(0, 1.35, 0)),
    },
  ];
  const heads = [];
  const hair = [];
  const staffTorsos = [];
  const guestTorsos = [];
  const legs = [];
  const arms = [];
  const yAxis = new THREE.Vector3(0, 1, 0);
  const segment = (from, to, radius = 1) => {
    const direction = to.clone().sub(from);
    return {
      position: from.clone().add(to).multiplyScalar(0.5),
      quaternion: new THREE.Quaternion().setFromUnitVectors(yAxis, direction.clone().normalize()),
      scale: new THREE.Vector3(radius, direction.length(), radius),
    };
  };

  userSpecs.forEach((user) => {
    const marker = new THREE.Group();
    marker.name = `palace-vignette-user-${user.role}`;
    marker.position.copy(user.position);
    marker.userData.vignette = user.vignette;
    marker.userData.role = user.role;
    root.add(marker);
    const toTarget = user.target.clone().sub(user.position);
    const yaw = Math.atan2(toTarget.x, toTarget.z);
    const facing = new THREE.Quaternion().setFromAxisAngle(yAxis, yaw);
    const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const seated = user.stance === 'seated';
    const headY = seated ? 1.34 : 1.52;
    const shoulderY = seated ? 1.13 : 1.31;
    const hipY = seated ? 0.72 : 0.86;
    const headPosition = user.position.clone().add(new THREE.Vector3(0, headY, 0));
    heads.push({ position: headPosition, quaternion: facing, scale: new THREE.Vector3(1, 1, 1) });
    hair.push({ position: headPosition.clone().addScaledVector(forward, -0.045).add(new THREE.Vector3(0, 0.055, 0)), quaternion: facing, scale: new THREE.Vector3(1.06, 0.72, 1.02) });
    const torsoEntry = {
      position: user.position.clone().add(new THREE.Vector3(0, (shoulderY + hipY) / 2, 0)),
      quaternion: facing,
      scale: new THREE.Vector3(1, (shoulderY - hipY) / 0.52, 1),
    };
    if (user.role === 'loungeGuest') guestTorsos.push(torsoEntry);
    else staffTorsos.push(torsoEntry);

    for (const sideSign of [-1, 1]) {
      const hip = user.position.clone().addScaledVector(side, sideSign * 0.10).add(new THREE.Vector3(0, hipY, 0));
      if (seated) {
        const knee = hip.clone().addScaledVector(forward, 0.29).add(new THREE.Vector3(0, -0.15, 0));
        const foot = knee.clone().addScaledVector(forward, 0.08).setY(0.10);
        legs.push(segment(hip, knee, 1), segment(knee, foot, 0.92));
      } else {
        const foot = user.position.clone().addScaledVector(side, sideSign * 0.11).add(new THREE.Vector3(0, 0.10, 0));
        legs.push(segment(hip, foot, 1));
      }
      const shoulder = user.position.clone().addScaledVector(side, sideSign * 0.21).add(new THREE.Vector3(0, shoulderY - 0.05, 0));
      let hand;
      if (user.role === 'cakeServer') {
        hand = shoulder.clone().addScaledVector(forward, 0.27).addScaledVector(side, -sideSign * 0.08).add(new THREE.Vector3(0, -0.23, 0));
      } else if (user.role === 'seatingUsher' && sideSign > 0) {
        hand = user.target.clone().add(new THREE.Vector3(-0.12, sideSign * 0.12, 0.08));
      } else {
        hand = shoulder.clone().addScaledVector(forward, 0.20).addScaledVector(side, sideSign * 0.02).add(new THREE.Vector3(0, -0.28, 0));
      }
      arms.push(segment(shoulder, hand, 0.88));
    }
  });
  makeInstances('palace-vignette-user-heads', new THREE.SphereGeometry(0.135, 9, 7), mats.skin, heads);
  makeInstances('palace-vignette-user-hair', new THREE.SphereGeometry(0.145, 9, 6), mats.hair, hair);
  makeInstances('palace-vignette-staff-torsos', roundedBoxGeometry(0.36, 0.52, 0.20, 0.07), mats.staffFabric, staffTorsos);
  makeInstances('palace-vignette-guest-torso', roundedBoxGeometry(0.38, 0.52, 0.21, 0.07), mats.accentFabric, guestTorsos);
  makeInstances('palace-vignette-user-legs', new THREE.CylinderGeometry(0.048, 0.058, 1, 7), mats.trousers, legs);
  makeInstances('palace-vignette-user-arms', new THREE.CylinderGeometry(0.042, 0.052, 1, 7), mats.skin, arms);

  const cake = userSpecs[0].position;
  addMesh(root, new THREE.CylinderGeometry(0.19, 0.19, 0.022, 16), mats.silver,
    cake.clone().add(new THREE.Vector3(-0.12, 1.00, -0.18)), 'cake-server-tray');
  const lounge = userSpecs[1].position;
  addMesh(root, new THREE.CylinderGeometry(0.035, 0.025, 0.09, 8, 1, true), mats.glass,
    lounge.clone().add(new THREE.Vector3(0.16, 1.08, 0.18)), 'lounge-guest-drink');
  const usher = userSpecs[2].position;
  addMesh(root, roundedBoxGeometry(0.25, 0.34, 0.018, 0.012, 1), mats.paper,
    usher.clone().add(new THREE.Vector3(-0.15, 1.12, 0.08)), 'seating-usher-list', [0, yawFor(usher, userSpecs[2].target), -0.08]);
  return Object.freeze(userSpecs.map((user) => Object.freeze({ role: user.role, vignette: user.vignette, stance: user.stance })));
}

function yawFor(position, target) {
  const delta = target.clone().sub(position);
  return Math.atan2(delta.x, delta.z);
}

function buildContactShadows(world, chairs, vignetteAt, users, makeInstances, mats) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  const transforms = [];
  for (const table of world.tables) transforms.push({
    position: new THREE.Vector3(table.group.position.x, 0.012, table.group.position.z),
    quaternion: q,
    scale: new THREE.Vector3(1.02, 0.82, 1),
  });
  for (const chair of chairs) transforms.push({
    position: new THREE.Vector3(chair.position.x, 0.014, chair.position.z),
    quaternion: q,
    scale: new THREE.Vector3(0.34, 0.26, 1),
  });
  transforms.push({
    position: new THREE.Vector3(world.headTable.position.x, 0.013, world.headTable.position.z),
    quaternion: q,
    scale: new THREE.Vector3(1.90, 0.58, 1),
  });
  const vignetteScales = { cake: [0.84, 0.78], bar: [1.12, 0.58], piano: [1.24, 0.96], lounge: [1.30, 1.08], seatingChart: [0.48, 0.28] };
  for (const [key, [sx, sy]] of Object.entries(vignetteScales)) transforms.push({
    position: vignetteAt(key).setY(0.013), quaternion: q, scale: new THREE.Vector3(sx, sy, 1),
  });
  const userPositions = {
    cakeServer: vignetteAt('cake').add(new THREE.Vector3(1.02, 0.014, 0.26)),
    loungeGuest: vignetteAt('lounge').add(new THREE.Vector3(0.38, 0.014, -0.50)),
    seatingUsher: vignetteAt('seatingChart').add(new THREE.Vector3(-0.48, 0.014, -0.22)),
  };
  users.forEach((user) => transforms.push({
    position: userPositions[user.role], quaternion: q, scale: new THREE.Vector3(0.24, 0.20, 1),
  }));
  makeInstances('palace-furniture-contact-shadows', new THREE.CircleGeometry(1, 18), mats.contactShadow, transforms, { shadows: false });
  return transforms.length;
}

export function buildPalaceTablescape(scene, world) {
  if (!scene?.isScene) throw new TypeError('buildPalaceTablescape requires a THREE.Scene');
  if (!Array.isArray(world?.tables) || world.tables.length !== PALACE_LAYOUT.counts.guestTables) {
    throw new Error(`Expected ${PALACE_LAYOUT.counts.guestTables} existing guest tables`);
  }
  if (!Array.isArray(world.chairSpots) || world.chairSpots.length !== PALACE_LAYOUT.counts.guestSettings) {
    throw new Error(`Expected ${PALACE_LAYOUT.counts.guestSettings} existing chair spots`);
  }

  const root = new THREE.Group();
  root.name = 'palace-tablescape';
  scene.add(root);
  const accounting = { instanceCount: 0, instanceCapacity: 0, instancedDrawCalls: 0 };
  const makeInstances = createInstanceFactory(root, accounting);
  const damask = damaskTexture();
  const folds = fabricFoldTexture();
  const accentFabric = material(DEFAULT_ACCENT, 0.72);
  const accentRibbon = new THREE.MeshPhysicalMaterial({ color: DEFAULT_ACCENT, roughness: 0.5, sheen: 0.75, side: THREE.DoubleSide });
  const accentGlass = new THREE.MeshPhysicalMaterial({ color: DEFAULT_ACCENT, roughness: 0.12, metalness: 0.16, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false });
  accentGlass.forceSinglePass = true;
  const piping = material(DEFAULT_ACCENT, 0.48, 0.1);
  const mats = {
    brass: material(ANTIQUE_BRASS, 0.27, 0.78),
    velvet: new THREE.MeshPhysicalMaterial({ color: PALE_VELVET, roughness: 0.72, sheen: 0.75, sheenColor: new THREE.Color(0xfff1df) }),
    velvetDouble: new THREE.MeshPhysicalMaterial({ color: PALE_VELVET, roughness: 0.72, sheen: 0.75, side: THREE.DoubleSide }),
    accentFabric, accentRibbon, accentGlass,
    porcelain: new THREE.MeshPhysicalMaterial({ color: 0xfffcf4, roughness: 0.18, clearcoat: 0.24, clearcoatRoughness: 0.16 }),
    silver: material(0xdde2e3, 0.19, 0.82),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xe8f4f2, roughness: 0.045, metalness: 0.22, clearcoat: 0.24, clearcoatRoughness: 0.08, transparent: true, opacity: 0.46, side: THREE.DoubleSide, depthWrite: false }),
    paper: material(0xfff9e9, 0.72),
    wax: material(0xfff4dc, 0.78),
    flame: new THREE.MeshBasicMaterial({ color: 0xffc25a, toneMapped: false }),
    cake: material(0xfff8e8, 0.52), blush: material(0xe8c6bd, 0.62),
    wood: new THREE.MeshPhysicalMaterial({ color: 0x4c2e24, roughness: 0.43, clearcoat: 0.12, clearcoatRoughness: 0.42 }),
    backlight: new THREE.MeshBasicMaterial({ color: 0xffd99b, transparent: true, opacity: 0.82, toneMapped: false }),
    bottle: new THREE.MeshPhysicalMaterial({ color: 0x5f7f65, roughness: 0.18, transparent: true, opacity: 0.72 }),
    lacquer: material(0x171419, 0.12, 0.18),
    rug: new THREE.MeshPhysicalMaterial({ color: 0xb8a078, map: damask, roughness: 0.78, side: THREE.DoubleSide }),
    mirror: new THREE.MeshPhysicalMaterial({ color: 0xdce3de, roughness: 0.08, metalness: 0.65 }),
    bread: material(0xd79a50, 0.82),
    entree: material(0xc9673f, 0.66),
    garnish: material(0x668b4f, 0.74),
    water: new THREE.MeshPhysicalMaterial({ color: 0xbddfe9, roughness: 0.035, metalness: 0.12, transparent: true, opacity: 0.58, depthWrite: false }),
    drink: new THREE.MeshPhysicalMaterial({ color: 0xa84542, roughness: 0.08, metalness: 0.08, transparent: true, opacity: 0.76, depthWrite: false }),
    ivoryFabric: new THREE.MeshPhysicalMaterial({ color: IVORY, map: damask, bumpMap: folds, bumpScale: 0.02, roughness: 0.64, sheen: 0.64, side: THREE.DoubleSide }),
    sink: material(0x263238, 0.24, 0.66),
    ice: new THREE.MeshPhysicalMaterial({ color: 0xd9f0f3, roughness: 0.08, metalness: 0.16, transparent: true, opacity: 0.58, depthWrite: false }),
    workMat: new THREE.MeshStandardMaterial({ color: 0x2b2523, roughness: 0.88, side: THREE.DoubleSide }),
    ebony: material(0x09090b, 0.20, 0.08),
    skin: material(0xd9a47d, 0.76),
    hair: material(0x38261f, 0.80),
    staffFabric: material(0xf3eee4, 0.73),
    trousers: material(0x24252c, 0.78),
    contactShadow: new THREE.MeshBasicMaterial({ color: 0x2a1b16, alphaMap: contactShadowTexture(), transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
  };
  for (const transparentMaterial of [mats.glass, mats.water, mats.drink, mats.ice]) transparentMaterial.forceSinglePass = true;
  const runnerMat = new THREE.MeshPhysicalMaterial({ color: CHAMPAGNE, roughness: 0.62, sheen: 0.65, sheenColor: new THREE.Color(0xffefd1) });

  legacyTableUpgrade(scene, world, damask, folds, runnerMat, piping, makeInstances);
  upgradeHeadTable(scene, world, damask, folds, runnerMat, piping, makeInstances);
  const chairs = buildChairTransforms(scene, world);
  const ribbonMotion = renderChairs(root, chairs, makeInstances, mats);
  const settings = renderSettings(root, scene, world, makeInstances, mats);
  const tableFloralMechanics = buildTableFloralMechanics(world, makeInstances, mats);

  const at = (key) => new THREE.Vector3(...PALACE_LAYOUT.vignettes[key]);
  const vignetteFunctions = Object.freeze({
    cake: buildCake(root, at('cake'), mats, makeInstances),
    bar: buildBar(root, at('bar'), mats, makeInstances),
    piano: buildPiano(root, at('piano'), mats, makeInstances),
    lounge: buildLounge(root, at('lounge'), mats, makeInstances),
    seatingChart: buildSeatingChart(root, at('seatingChart'), mats, makeInstances),
  });
  const renderedVignetteUsers = buildVignetteUsers(root, at, makeInstances, mats);
  const contactShadows = buildContactShadows(world, chairs, at, renderedVignetteUsers, makeInstances, mats);

  const accentMaterials = [accentFabric, accentRibbon, accentGlass, piping, mats.blush];
  const swayQuaternion = new THREE.Quaternion();
  const localZ = new THREE.Vector3(0, 0, 1);
  const ribbonDummy = new THREE.Object3D();
  const anchors = Object.freeze({
    bride: new THREE.Vector3(...PALACE_LAYOUT.characters.bride),
    groom: new THREE.Vector3(...PALACE_LAYOUT.characters.groom),
    pianist: new THREE.Vector3(...PALACE_LAYOUT.characters.pianist),
    bartender: new THREE.Vector3(...PALACE_LAYOUT.characters.bartender),
    cake: at('cake'), bar: at('bar'), piano: at('piano'), lounge: at('lounge'), seatingChart: at('seatingChart'),
  });

  let meshDrawCalls = 0;
  let triangles = 0;
  root.traverse((object) => {
    if (!object.isMesh) return;
    meshDrawCalls += 1;
    const geo = object.geometry;
    const perMesh = geo.index ? geo.index.count / 3 : (geo.attributes.position?.count || 0) / 3;
    triangles += perMesh * (object.isInstancedMesh ? object.count : 1);
  });
  const materialClasses = Object.freeze([
    'wood', 'antique-brass', 'porcelain', 'silver', 'glass', 'water-and-drink',
    'velvet-and-silk', 'paper', 'lacquer', 'mirror', 'food',
  ]);
  const vignetteUsers = Object.freeze({
    assignments: Object.freeze({
      cake: 'cakeServer',
      bar: 'bartender',
      piano: 'pianist',
      lounge: 'loungeGuest',
      seatingChart: 'seatingUsher',
    }),
    renderedHere: renderedVignetteUsers.length,
    externalCelebrationCharacters: 2,
    total: Object.keys(PALACE_LAYOUT.vignettes).length,
  });
  const stats = Object.freeze({
    guestTables: world.tables.length,
    guestChairs: chairs.filter((chair) => chair.kind === 'guest').length,
    headChairs: chairs.filter((chair) => chair.kind === 'head').length,
    guestSettings: settings.filter((setting) => setting.kind === 'guest').length,
    headSettings: settings.filter((setting) => setting.kind === 'head').length,
    functionalSettings: settings.length,
    tableFloralMechanics,
    vignettes: Object.keys(PALACE_LAYOUT.vignettes).length,
    functionalVignettes: Object.keys(vignetteFunctions).length,
    vignetteFunctions,
    vignetteUsers,
    materialClasses,
    materialClassCount: materialClasses.length,
    bevelledFurniture: true,
    fabricFoldLayers: 2,
    contactShadows,
    ribbonTails: ribbonMotion.entries.length,
    instanceCount: accounting.instanceCount,
    instanceCapacity: accounting.instanceCapacity,
    instancedDrawCalls: accounting.instancedDrawCalls,
    drawCalls: meshDrawCalls,
    triangles: Math.round(triangles),
    capacities: Object.freeze({
      chairs: chairs.length,
      settings: settings.length,
      vignettes: Object.keys(PALACE_LAYOUT.vignettes).length,
      ribbonTails: ribbonMotion.entries.length,
    }),
  });

  let headChairsVisible = true;
  return {
    setAccent(colorHex) {
      const color = new THREE.Color(colorHex).lerp(new THREE.Color(0xffffff), 0.12);
      accentMaterials.forEach((mat) => { mat.color.copy(color); mat.needsUpdate = true; });
    },
    update(time) {
      ribbonMotion.entries.forEach((tail, index) => {
        const angle = Math.sin((time / tail.period) * Math.PI * 2 + tail.phase) * 0.035;
        swayQuaternion.setFromAxisAngle(localZ, angle);
        ribbonDummy.position.copy(tail.position);
        ribbonDummy.quaternion.copy(tail.baseQuaternion).multiply(swayQuaternion);
        if (tail.kind === 'head' && !headChairsVisible) ribbonDummy.scale.setScalar(0);
        else ribbonDummy.scale.copy(tail.scale);
        ribbonDummy.updateMatrix();
        ribbonMotion.mesh.setMatrixAt(index, ribbonDummy.matrix);
      });
      ribbonMotion.mesh.instanceMatrix.needsUpdate = true;
    },
    setHeadChairsVisible(visible) {
      headChairsVisible = Boolean(visible);
      ribbonMotion.setHeadVisible(headChairsVisible);
      ribbonMotion.headVisible = headChairsVisible;
    },
    get stats() { return stats; },
    anchors,
  };
}
