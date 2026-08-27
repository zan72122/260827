// 欧州ガーデン宮殿の建築・布・照明レイヤー。
// 既存worldの座標／当たり判定は変えず、薄い視覚レイヤーだけを重ねる。

import * as THREE from 'three';
import { PALACE_LAYOUT } from './palace-config.js';

const STYLE = 'european-garden-palace';
const GOLD = 0xa9823f;
const IVORY = 0xf1e7d4;
const CHAMPAGNE = 0xd7bd8a;

function seededRandom(seedText) {
  let seed = 2166136261;
  for (let i = 0; i < seedText.length; i++) {
    seed ^= seedText.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  return () => {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(size, draw, { srgb = true, repeat = [1, 1], anisotropy = 4 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(...repeat);
  texture.anisotropy = anisotropy;
  return texture;
}

function parquetTextures(anisotropy) {
  // 旧4×4タイルを4×6回反復する方式を止め、床全体を覆う8×11枚の
  // 固定seedアトラスにする。色、板方向、継ぎ位置を一枚ごとに少し崩す。
  const draw = (context, size, bump = false) => {
    const random = seededRandom(`${PALACE_LAYOUT.seed}:parquet-large-atlas`);
    const columns = 8;
    const rows = 11;
    const cellW = size / columns;
    const cellH = size / rows;
    context.fillStyle = bump ? '#777' : '#6c472f';
    context.fillRect(0, 0, size, size);

    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
      const x = column * cellW;
      const y = row * cellH;
      const margin = 3 + random() * 2;
      const hue = 26 + random() * 6;
      const baseLight = 43 + random() * 10;
      const gray = 126 + Math.floor(random() * 16);
      context.fillStyle = bump ? `rgb(${gray},${gray},${gray})` : `hsl(${hue},38%,${baseLight}%)`;
      context.fillRect(x + margin, y + margin, cellW - margin * 2, cellH - margin * 2);

      context.save();
      context.beginPath();
      context.rect(x + margin + 3, y + margin + 3, cellW - margin * 2 - 6, cellH - margin * 2 - 6);
      context.clip();
      context.translate(x + cellW / 2, y + cellH / 2);
      const direction = ((row + column) % 2 ? 1 : -1) * (Math.PI / 4 + (random() - 0.5) * 0.07);
      context.rotate(direction);
      const span = Math.max(cellW, cellH) * 1.3;
      const stripH = Math.min(cellW, cellH) * 0.12;
      for (let strip = -5; strip <= 5; strip++) {
        const value = 125 + strip * 2 + Math.floor(random() * 12);
        const stripHue = hue + (random() - 0.5) * 3;
        const stripLight = 38 + random() * 12;
        context.fillStyle = bump
          ? `rgb(${value},${value},${value})`
          : `hsl(${stripHue},44%,${stripLight}%)`;
        const offset = (strip + (random() - 0.5) * 0.16) * stripH;
        context.fillRect(-span / 2, offset, span, stripH * 0.86);
        if (!bump) {
          context.strokeStyle = 'rgba(255,238,198,.1)';
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(-span / 2, offset + stripH * 0.25);
          context.bezierCurveTo(-span * 0.18, offset - 2, span * 0.18, offset + 2, span / 2, offset + stripH * 0.25);
          context.stroke();
        }
      }
      context.restore();

      // パネル縁と、毎回同じ位置に戻るごく小さな木栓で大面積の反復感を散らす。
      context.strokeStyle = bump ? '#5f5f5f' : 'rgba(54,31,18,.42)';
      context.lineWidth = 2.2 + random();
      context.strokeRect(x + margin, y + margin, cellW - margin * 2, cellH - margin * 2);
      if (random() > 0.58) {
        context.fillStyle = bump ? '#6d6d6d' : 'rgba(72,40,20,.28)';
        context.beginPath();
        context.arc(x + cellW * (0.25 + random() * 0.5), y + cellH * (0.25 + random() * 0.5), 1.5 + random() * 2.5, 0, Math.PI * 2);
        context.fill();
      }
    }
    if (!bump) {
      const gleam = context.createLinearGradient(0, 0, size, size);
      gleam.addColorStop(0, 'rgba(255,239,197,.1)');
      gleam.addColorStop(0.46, 'rgba(255,255,255,.015)');
      gleam.addColorStop(1, 'rgba(68,37,20,.11)');
      context.fillStyle = gleam;
      context.fillRect(0, 0, size, size);
    }
  };
  const map = canvasTexture(1024, (context, size) => draw(context, size, false), {
    repeat: [1, 1], anisotropy,
  });
  const bumpMap = canvasTexture(1024, (context, size) => draw(context, size, true), {
    srgb: false, repeat: [1, 1], anisotropy,
  });
  return { map, bumpMap };
}

function velvetTexture(anisotropy) {
  const random = seededRandom(`${PALACE_LAYOUT.seed}:velvet`);
  return canvasTexture(256, (context, size) => {
    context.fillStyle = '#d6c091';
    context.fillRect(0, 0, size, size);
    for (let x = 0; x < size; x += 3) {
      const alpha = 0.025 + random() * 0.045;
      context.fillStyle = `rgba(77,49,23,${alpha})`;
      context.fillRect(x, 0, 1, size);
    }
    const glow = context.createLinearGradient(0, 0, size, 0);
    glow.addColorStop(0, 'rgba(255,255,255,.03)');
    glow.addColorStop(0.5, 'rgba(255,251,226,.22)');
    glow.addColorStop(1, 'rgba(91,58,27,.06)');
    context.fillStyle = glow;
    context.fillRect(0, 0, size, size);
  }, { repeat: [2, 18], anisotropy });
}

function damaskTexture(anisotropy) {
  return canvasTexture(256, (context, size) => {
    context.fillStyle = '#eee3d1';
    context.fillRect(0, 0, size, size);
    context.strokeStyle = 'rgba(176,144,95,.13)';
    context.fillStyle = 'rgba(255,252,241,.13)';
    context.lineWidth = 3;
    for (let y = 0; y < size; y += 64) for (let x = 0; x < size; x += 64) {
      context.save();
      context.translate(x + 32, y + 32);
      context.beginPath();
      context.moveTo(0, -25);
      context.bezierCurveTo(20, -11, 18, 8, 0, 25);
      context.bezierCurveTo(-18, 8, -20, -11, 0, -25);
      context.fill();
      context.stroke();
      context.beginPath();
      context.arc(0, 0, 10, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    }
  }, { repeat: [2, 3], anisotropy });
}

function radialGlowTexture() {
  return canvasTexture(128, (context, size) => {
    const gradient = context.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,250,223,.95)');
    gradient.addColorStop(0.32, 'rgba(255,216,144,.34)');
    gradient.addColorStop(1, 'rgba(255,216,144,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  });
}

function gatheredPanelGeometry(width, height, fold = 0.06, xSegments = 28, ySegments = 8) {
  const geometry = new THREE.PlaneGeometry(width, height, xSegments, ySegments);
  const positions = geometry.getAttribute('position');
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const edge = 0.6 + 0.4 * ((y + height / 2) / height);
    positions.setZ(index, fold * edge * (Math.sin(x * 15.5) + 0.35 * Math.sin(x * 31 + 0.8)));
  }
  geometry.computeVertexNormals();
  return geometry;
}

function ceilingSwagGeometry(width = 14.4, depth = 1.42, sag = 0.54) {
  const columns = 32, rows = 4;
  const positions = [], uvs = [], indices = [];
  for (let row = 0; row <= rows; row++) {
    const v = row / rows;
    for (let column = 0; column <= columns; column++) {
      const u = column / columns;
      const x = (u - 0.5) * width;
      const z = (v - 0.5) * depth;
      const y = -sag * Math.sin(Math.PI * u) + 0.025 * Math.sin(v * Math.PI * 4 + u * 8);
      positions.push(x, y, z);
      uvs.push(u, v);
    }
  }
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const a = row * (columns + 1) + column;
    const b = a + columns + 1;
    indices.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function addInstances(parent, geometry, material, transforms) {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, transforms.length));
  const dummy = new THREE.Object3D();
  transforms.forEach(({ position, rotation = [0, 0, 0], scale = [1, 1, 1] }, index) => {
    dummy.position.set(...position);
    dummy.rotation.set(...rotation);
    dummy.scale.set(...scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  });
  mesh.count = transforms.length;
  parent.add(mesh);
  return mesh;
}

function rootMetrics(root) {
  let drawCalls = 0, triangles = 0, instances = 0, capacity = 0;
  root.traverse((object) => {
    if ((!object.isMesh && !object.isSprite) || !object.visible) return;
    let parent = object.parent;
    while (parent && parent !== root) {
      if (!parent.visible) return;
      parent = parent.parent;
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const materialPasses = materials.reduce((sum, material) => (
      sum + (material?.transparent && material.side === THREE.DoubleSide && !material.forceSinglePass ? 2 : 1)
    ), 0);
    drawCalls += materialPasses;
    const copies = object.isInstancedMesh ? object.count : 1;
    if (object.isSprite) triangles += 2;
    else {
      const geometryTriangles = object.geometry.index
        ? object.geometry.index.count / 3
        : object.geometry.getAttribute('position').count / 3;
      triangles += geometryTriangles * copies;
    }
    if (object.isInstancedMesh) {
      instances += object.count;
      capacity += object.instanceMatrix.count;
    }
  });
  return { drawCalls, triangles: Math.round(triangles), instances, capacity };
}

function smoothstep(value) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

export function buildPalaceInterior(scene, world, renderer) {
  const root = new THREE.Group();
  root.name = 'palace-interior';
  scene.add(root);

  const maxAnisotropy = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() || 4);
  const brass = new THREE.MeshStandardMaterial({ color: GOLD, metalness: 0.72, roughness: 0.31 });
  const ivory = new THREE.MeshPhysicalMaterial({ color: IVORY, roughness: 0.52, sheen: 0.23, sheenColor: new THREE.Color(0xfff3dc) });
  const silk = new THREE.MeshPhysicalMaterial({ color: 0xead7b6, roughness: 0.42, sheen: 0.65, sheenColor: new THREE.Color(0xffefd0), side: THREE.DoubleSide });
  const voile = new THREE.MeshPhysicalMaterial({
    color: 0xfff7e8, roughness: 0.72, transparent: true, opacity: 0.36,
    depthWrite: false, side: THREE.DoubleSide, sheen: 0.35,
  });
  voile.forceSinglePass = true;
  const mirrorMaterial = new THREE.MeshPhysicalMaterial({ color: 0xb9c1c1, metalness: 0.78, roughness: 0.12 });

  // --- 磨き寄木と中央ランナー。床面から数mmだけ上げ、既存床を非破壊で覆う。 ---
  const parquet = parquetTextures(maxAnisotropy);
  const floorMaterial = new THREE.MeshStandardMaterial({
    map: parquet.map, bumpMap: parquet.bumpMap, bumpScale: 0.025,
    roughness: 0.47, metalness: 0.04, envMapIntensity: 0.7,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(16.55, 22.5), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0.012, -1);
  floor.receiveShadow = true;
  root.add(floor);
  const borderMaterial = new THREE.MeshStandardMaterial({ color: 0x5c3925, roughness: 0.42 });
  addInstances(root, new THREE.BoxGeometry(1, 1, 1), borderMaterial, [
    { position: [0, 0.022, -12.12], scale: [16.2, 0.018, 0.14] },
    { position: [0, 0.022, 10.12], scale: [16.2, 0.018, 0.14] },
    { position: [-8.02, 0.022, -1], scale: [0.14, 0.018, 22.1] },
    { position: [8.02, 0.022, -1], scale: [0.14, 0.018, 22.1] },
  ]);

  const runnerMaterial = new THREE.MeshPhysicalMaterial({
    color: CHAMPAGNE, map: velvetTexture(maxAnisotropy), roughness: 0.78,
    sheen: 0.75, sheenColor: new THREE.Color(0xffe8b8),
  });
  const runner = new THREE.Mesh(new THREE.BoxGeometry(2.28, 0.026, 19.5), runnerMaterial);
  runner.position.set(0, 0.036, 0);
  runner.receiveShadow = true;
  root.add(runner);
  const accentMaterial = new THREE.MeshPhysicalMaterial({ color: 0xc5889e, roughness: 0.4, sheen: 0.6 });
  addInstances(root, new THREE.BoxGeometry(1, 1, 1), brass, [-1, 1].map(side => ({
    position: [side * 1.075, 0.057, 0], scale: [0.025, 0.018, 19.35],
  })));
  addInstances(root, new THREE.BoxGeometry(1, 1, 1), accentMaterial, [-1, 1].map(side => ({
    position: [side * 1.025, 0.06, 0], scale: [0.032, 0.022, 19.25],
  })));

  // --- ダマスク壁面と金古美の額縁。窓の間だけを埋め、開口は残す。 ---
  const damaskMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xf2e8d7, map: damaskTexture(maxAnisotropy), roughness: 0.69,
    sheen: 0.28, sheenColor: new THREE.Color(0xfff4df),
  });
  const panels = [];
  const sidePanelZ = [-7, -3, 1.55, 5.45];
  for (const side of [-1, 1]) for (const z of sidePanelZ) {
    panels.push({
      position: [side * 7.965, 3.18, z],
      rotation: [0, side > 0 ? -Math.PI / 2 : Math.PI / 2, 0],
      width: 2.35,
      height: 3.85,
    });
  }
  for (const x of [-5.45, 5.45]) {
    panels.push({ position: [x, 3.18, -11.965], rotation: [0, 0, 0], width: 2.55, height: 3.85 });
  }
  // パネルの下地を数cmだけ前へ出し、縁に実厚と接合影を作る。
  addInstances(root, new THREE.BoxGeometry(1, 1, 1), ivory, panels.map(panel => ({
    position: panel.position, rotation: panel.rotation,
    scale: [panel.width + 0.12, panel.height + 0.12, 0.045],
  })));
  addInstances(root, new THREE.PlaneGeometry(1, 1), damaskMaterial, panels.map(panel => ({
    position: panel.position, rotation: panel.rotation, scale: [panel.width, panel.height, 1],
  })));

  const frameCapacity = panels.length * 4;
  const frameInstances = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), brass, frameCapacity);
  const dummy = new THREE.Object3D();
  let frameIndex = 0;
  for (const panel of panels) {
    const horizontal = panel.width - 0.12;
    const vertical = panel.height - 0.12;
    for (const y of [-vertical / 2, vertical / 2]) {
      dummy.position.set(...panel.position);
      dummy.position.y += y;
      dummy.rotation.set(...panel.rotation);
      dummy.scale.set(horizontal, 0.055, 0.065);
      dummy.updateMatrix();
      frameInstances.setMatrixAt(frameIndex++, dummy.matrix);
    }
    for (const x of [-horizontal / 2, horizontal / 2]) {
      dummy.position.set(...panel.position);
      dummy.rotation.set(...panel.rotation);
      const offset = new THREE.Vector3(x, 0, 0).applyEuler(dummy.rotation);
      dummy.position.add(offset);
      dummy.scale.set(0.055, vertical, 0.065);
      dummy.updateMatrix();
      frameInstances.setMatrixAt(frameIndex++, dummy.matrix);
    }
  }
  root.add(frameInstances);

  const pilasterPositions = [];
  for (const side of [-1, 1]) for (const z of [-10.8, -7, -3, 1.2, 5.2, 8.9]) pilasterPositions.push([side * 7.88, 3.35, z]);
  for (const x of [-7.2, -4.05, 4.05, 7.2]) pilasterPositions.push([x, 3.35, -11.88]);
  const pilasters = new THREE.InstancedMesh(new THREE.BoxGeometry(0.11, 4.75, 0.11), brass, pilasterPositions.length);
  pilasterPositions.forEach((position, index) => {
    dummy.position.set(...position);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    pilasters.setMatrixAt(index, dummy.matrix);
  });
  root.add(pilasters);
  addInstances(root, new THREE.BoxGeometry(1, 1, 1), brass, [
    { position: [-7.88, 6.38, -1], scale: [0.13, 0.18, 22.25] },
    { position: [7.88, 6.38, -1], scale: [0.13, 0.18, 22.25] },
    { position: [0, 6.38, -11.88], scale: [15.65, 0.18, 0.13] },
  ]);

  // 梁の座標は吊り装花の契約なので、材質だけを替えて金の細縁を重ねる。
  const beamIvory = ivory.clone();
  for (const beam of world.beams || []) beam.material = beamIvory;
  const beamTrimCount = world.beams?.length || 0;
  const beamTrim = new THREE.InstancedMesh(new THREE.BoxGeometry(16.25, 0.035, 0.18), brass, Math.max(1, beamTrimCount));
  for (let index = 0; index < beamTrimCount; index++) {
    dummy.position.set(0, 6.42, world.beams[index].position.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    beamTrim.setMatrixAt(index, dummy.matrix);
  }
  beamTrim.count = beamTrimCount;
  root.add(beamTrim);

  // 鏡は前半の壁面だけに限定し、花の背景を反射色で引き締める。
  const mirrorTransforms = [];
  for (const side of [-1, 1]) for (const z of [3.5, 7.25]) mirrorTransforms.push({
    position: [side * 7.84, 3.45, z],
    rotation: [0, side > 0 ? -Math.PI / 2 : Math.PI / 2, 0],
    scale: [1, 1.42, 1],
  });
  addInstances(root, new THREE.CircleGeometry(0.66, 32), mirrorMaterial, mirrorTransforms);
  addInstances(root, new THREE.TorusGeometry(0.69, 0.045, 8, 32), brass, mirrorTransforms);

  // --- 壁灯。全8器具は焼き込み風グラデーション、左右1灯ずつだけ実ライトを併用。 ---
  const glowTexture = radialGlowTexture();
  const sconcePositions = [];
  for (const side of [-1, 1]) for (const z of [-7, -3, 1.3, 6.25]) sconcePositions.push([side, z]);
  const sconceMaterial = new THREE.MeshStandardMaterial({
    color: 0xffe5b0, emissive: 0xffbd62, emissiveIntensity: 0.04,
  });
  const sconceGlowMaterial = new THREE.MeshBasicMaterial({
    map: glowTexture, color: 0xffd58d, transparent: true, opacity: 0.015,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  sconceGlowMaterial.forceSinglePass = true;
  addInstances(root, new THREE.CylinderGeometry(0.025, 0.035, 0.34, 8), brass,
    sconcePositions.map(([side, z]) => ({
      position: [side * 7.62, 3.5, z], rotation: [0, 0, Math.PI / 2],
    })));
  addInstances(root, new THREE.CylinderGeometry(0.065, 0.095, 0.13, 12), brass,
    sconcePositions.map(([side, z]) => ({ position: [side * 7.76, 3.6, z] })));
  addInstances(root, new THREE.SphereGeometry(0.07, 10, 8), sconceMaterial,
    sconcePositions.map(([side, z]) => ({ position: [side * 7.76, 3.72, z], scale: [1, 1.35, 1] })));
  addInstances(root, new THREE.PlaneGeometry(0.85, 0.85), sconceGlowMaterial,
    sconcePositions.map(([side, z]) => ({
      position: [side * 7.70, 3.7, z],
      rotation: [0, side > 0 ? -Math.PI / 2 : Math.PI / 2, 0],
    })));

  const sconceLights = [-1, 1].map((side) => {
    const light = new THREE.PointLight(0xffc879, 0, 5.8, 2);
    light.position.set(side * 7.25, 3.62, -2.7);
    light.userData.category = 'sconce-fill';
    root.add(light);
    return light;
  });

  // 卓上キャンドルの光は床面の局所デカールを6卓分まとめ、実ライトは左右1灯ずつ。
  const candlePoolMaterial = new THREE.MeshBasicMaterial({
    map: glowTexture, color: 0xffc878, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  candlePoolMaterial.forceSinglePass = true;
  addInstances(root, new THREE.PlaneGeometry(2.7, 2.7), candlePoolMaterial,
    PALACE_LAYOUT.tableCenters.map(([x, z]) => ({
      position: [x, 0.02, z], rotation: [-Math.PI / 2, 0, 0], scale: [1, 0.72, 1],
    })));
  const candleLights = [-1, 1].map((side) => {
    const light = new THREE.PointLight(0xffb864, 0, 6.6, 2);
    light.position.set(side * 4.2, 1.35, -2.5);
    light.userData.category = 'candle-fill';
    root.add(light);
    return light;
  });

  // --- 新しい3基の多段クリスタルシャンデリア。 ---
  // 中央器具にはworld.chandelier自体を再利用する。mainが追加する花は、
  // 見えない旧アンカーではなく実表示器具のリングへ直接付く。
  const chandelierBulbMaterial = new THREE.MeshStandardMaterial({
    color: 0xffefd0, emissive: 0xffc265, emissiveIntensity: 0.07,
  });
  const crystalMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xe8f1ee, roughness: 0.08, metalness: 0.24,
    thickness: 0.08, transparent: true, opacity: 0.86, emissive: 0xffdca2, emissiveIntensity: 0.02,
  });
  crystalMaterial.forceSinglePass = true;
  const bulbsPerChandelier = 12;
  const crystalsPerChandelier = 30;
  const chandelierTiers = [[0.68, 0.12, 5], [0.48, -0.2, 4], [0.28, -0.46, 3]];
  const chainGeometry = new THREE.CylinderGeometry(0.018, 0.018, 1, 8);
  const bulbGeometry = new THREE.SphereGeometry(0.055, 10, 8);
  const crystalGeometry = new THREE.OctahedronGeometry(0.075, 0);
  const chandelierGroups = [];
  for (let fixtureIndex = 0; fixtureIndex < PALACE_LAYOUT.chandeliers.length; fixtureIndex++) {
    const position = PALACE_LAYOUT.chandeliers[fixtureIndex];
    const fixture = fixtureIndex === 1 && world.chandelier
      ? world.chandelier
      : new THREE.Group();
    fixture.clear();
    fixture.name = fixtureIndex === 1 ? 'primary-chandelier' : `chandelier-${fixtureIndex + 1}`;
    fixture.position.set(...position);
    root.add(fixture);
    chandelierGroups.push(fixture);

    const chainLength = PALACE_LAYOUT.hall.ceilingY - position[1];
    const chain = new THREE.Mesh(chainGeometry, brass);
    chain.position.y = chainLength / 2;
    chain.scale.y = chainLength;
    fixture.add(chain);

    const chandelierBulbs = new THREE.InstancedMesh(bulbGeometry, chandelierBulbMaterial, bulbsPerChandelier);
    const crystals = new THREE.InstancedMesh(crystalGeometry, crystalMaterial, crystalsPerChandelier);
    let bulbIndex = 0;
    for (let tierIndex = 0; tierIndex < chandelierTiers.length; tierIndex++) {
      const [radius, y, count] = chandelierTiers[tierIndex];
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.025, 8, 32), brass);
      ring.position.y = y;
      ring.rotation.x = Math.PI / 2;
      fixture.add(ring);
      for (let index = 0; index < count; index++) {
        const angle = index / count * Math.PI * 2;
        dummy.position.set(Math.cos(angle) * radius, y + 0.09, Math.sin(angle) * radius);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1.18, 1);
        dummy.updateMatrix();
        chandelierBulbs.setMatrixAt(bulbIndex++, dummy.matrix);
      }
    }
    let crystalIndex = 0;
    for (let index = 0; index < crystalsPerChandelier; index++) {
      const row = index % 3;
      const angle = index / crystalsPerChandelier * Math.PI * 6;
      const radius = 0.2 + row * 0.18;
      dummy.position.set(
        Math.cos(angle) * radius,
        -0.2 - row * 0.15 - (index % 2) * 0.09,
        Math.sin(angle) * radius,
      );
      dummy.rotation.set(0, angle, (index % 3 - 1) * 0.15);
      dummy.scale.set(0.72, 1.35 + row * 0.18, 0.72);
      dummy.updateMatrix();
      crystals.setMatrixAt(crystalIndex++, dummy.matrix);
    }
    chandelierBulbs.count = bulbIndex;
    crystals.count = crystalIndex;
    const finial = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.25, 10), brass);
    finial.position.y = -0.72;
    fixture.add(chandelierBulbs, crystals, finial);
  }

  world.chandelier = chandelierGroups[1];
  world.chandelierGroups = chandelierGroups;
  world.chandBulbs = [chandelierBulbMaterial];
  const chandelierLights = PALACE_LAYOUT.chandeliers.map((position, index) => {
    const light = new THREE.PointLight(0xffc77c, 0, 10.5, 2);
    light.position.set(position[0], position[1] - 0.34, position[2]);
    light.userData.category = 'chandelier';
    light.userData.fixtureIndex = index;
    light.userData.masterScale = 1 / 3;
    root.add(light);
    return light;
  });
  world.chandLights.splice(0, world.chandLights.length, ...chandelierLights);
  // 3灯を登録した後に、buildWorld側へ既に渡されたマスター値を再分配する。
  world.chandLight.intensity = world.chandLight.intensity;
  const chandelierUnified = world.chandelier === chandelierGroups[1]
    && chandelierGroups.every((fixture) => fixture.children.some((child) => child.isInstancedMesh));

  // --- 天井シフォン（面積約28%）と高砂三層幕。 ---
  const fabricActors = [];
  const registerFabric = (object, amplitude, period, phase = 0) => {
    fabricActors.push({
      object, amplitude, period, phase,
      baseY: object.position.y, baseRotationZ: object.rotation.z,
    });
  };
  const swagPositions = [-8.7, -4.65, -0.3, 4.25, 7.25];
  swagPositions.forEach((z, index) => {
    const swag = new THREE.Mesh(ceilingSwagGeometry(), index % 2 ? voile : silk);
    swag.position.set(0, 6.61, z);
    root.add(swag);
    registerFabric(swag, 0.018, 8.4 + index * 0.65, index * 0.7);
  });

  const backdrop = new THREE.Group();
  backdrop.position.set(0, 0, -11.82);
  const centralVoile = new THREE.Mesh(gatheredPanelGeometry(6.6, 4.85, 0.075), voile);
  centralVoile.position.set(0, 3.48, 0.035);
  backdrop.add(centralVoile);
  for (const side of [-1, 1]) {
    const sideSilk = new THREE.Mesh(gatheredPanelGeometry(2.05, 5.05, 0.1), silk);
    sideSilk.position.set(side * 2.8, 3.46, 0.13);
    sideSilk.rotation.z = side * -0.07;
    backdrop.add(sideSilk);
    registerFabric(sideSilk, 0.025, 9.6, side > 0 ? 1.3 : 0.2);
  }
  const topCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-3.8, 6.12, 0.22), new THREE.Vector3(-1.8, 5.55, 0.34),
    new THREE.Vector3(0, 5.92, 0.3), new THREE.Vector3(1.8, 5.55, 0.34),
    new THREE.Vector3(3.8, 6.12, 0.22),
  ]);
  const upperSwag = new THREE.Mesh(new THREE.TubeGeometry(topCurve, 52, 0.12, 8, false), silk);
  backdrop.add(upperSwag);
  addInstances(backdrop, new THREE.CylinderGeometry(0.025, 0.025, 0.55, 8), brass,
    [-1, 1].map(side => ({ position: [side * 3.65, 5.48, 0.25] })));
  addInstances(backdrop, new THREE.ConeGeometry(0.11, 0.28, 12), brass,
    [-1, 1].map(side => ({ position: [side * 3.65, 5.08, 0.25] })));
  root.add(backdrop);
  registerFabric(centralVoile, 0.018, 10.8, 0.8);

  // 既存窓に薄いボイルと絹の上飾りを追加。窓面そのものは塞がない。
  const windowDressings = [];
  const windowVoileTransforms = [];
  const windowValanceTransforms = [];
  const valanceCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.78, 1.37, 0.08), new THREE.Vector3(0, 1.09, 0.13), new THREE.Vector3(0.78, 1.37, 0.08),
  ]);
  for (const side of [-1, 1]) for (const z of [-9, -5, -1]) {
    const rotation = [0, side > 0 ? -Math.PI / 2 : Math.PI / 2, 0];
    windowVoileTransforms.push({ position: [side * 7.91, 3.4, z], rotation });
    windowValanceTransforms.push({ position: [side * 7.91, 3.55, z], rotation });
    windowDressings.push({ side, z });
  }
  addInstances(root, gatheredPanelGeometry(1.34, 2.65, 0.035, 18, 6), voile, windowVoileTransforms);
  addInstances(root, new THREE.TubeGeometry(valanceCurve, 20, 0.07, 7), silk, windowValanceTransforms);

  // 高砂だけを柔らかく浮かせる疑似ピンライト。実ライトは追加しない。
  const headGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture, color: 0xffe2a8, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  headGlow.position.set(0, 2.5, -11.45);
  headGlow.scale.set(5.8, 4.6, 1);
  root.add(headGlow);

  let accent = new THREE.Color(0xc5889e);
  let finaleStart = null;
  let lastTime = 0;
  let lightingStage = 0;
  let fabricComplete = false;

  // 内装レイヤーでは影生成を行わない。既存worldの主要物だけが影を担当する。
  root.traverse((object) => {
    if (object.isMesh) object.castShadow = false;
  });

  function setAccent(colorHex) {
    accent = new THREE.Color(colorHex);
    accentMaterial.color.copy(accent);
  }

  function beginFinale(time = lastTime) {
    finaleStart = Number.isFinite(time) ? time : lastTime;
    lightingStage = 1;
    fabricComplete = false;
  }

  function update(time = 0) {
    lastTime = Number.isFinite(time) ? time : lastTime;
    const elapsed = finaleStart === null ? -1 : Math.max(0, lastTime - finaleStart);
    const gust = elapsed < 0 || elapsed > 4.6
      ? 0
      : Math.sin(Math.min(1, elapsed / 2.7) * Math.PI) * Math.exp(-elapsed * 0.28);
    for (const actor of fabricActors) {
      const wave = Math.sin(lastTime * Math.PI * 2 / actor.period + actor.phase);
      actor.object.position.y = actor.baseY + wave * actor.amplitude + gust * 0.075;
      actor.object.rotation.z = actor.baseRotationZ + wave * 0.0025 + gust * 0.018;
    }

    if (elapsed >= 0) {
      const sconceLevel = smoothstep(elapsed / 0.9);
      const chandelierLevel = smoothstep((elapsed - 0.65) / 1.15);
      const candleLevel = smoothstep((elapsed - 1.15) / 1.1);
      const pinLevel = smoothstep((elapsed - 1.55) / 1.2);
      sconceMaterial.emissiveIntensity = 0.04 + 1.7 * sconceLevel;
      sconceGlowMaterial.opacity = 0.015 + 0.23 * sconceLevel;
      for (const light of sconceLights) light.intensity = 4.2 * sconceLevel;
      chandelierBulbMaterial.emissiveIntensity = 0.07 + 2.3 * chandelierLevel;
      crystalMaterial.emissiveIntensity = 0.02 + 0.23 * chandelierLevel;
      world.chandLight.intensity = Math.max(world.chandLight.intensity, 45 * chandelierLevel);
      candlePoolMaterial.opacity = 0.075 * candleLevel;
      for (const light of candleLights) light.intensity = 3.4 * candleLevel;
      headGlow.material.opacity = 0.19 * pinLevel;
      lightingStage = elapsed < 0.65 ? 1 : elapsed < 1.55 ? 2 : elapsed < 2.75 ? 3 : 4;
      fabricComplete = elapsed >= 4.6;
    }
  }

  return {
    setAccent,
    beginFinale,
    update,
    get stats() {
      const metrics = rootMetrics(root);
      return {
        style: STYLE,
        counts: {
          damaskPanels: panels.length,
          pilasters: pilasterPositions.length,
          mirrors: 4,
          sconces: sconcePositions.length,
          chandeliers: PALACE_LAYOUT.chandeliers.length,
          windowOpenings: world.windowOpenings?.length || 0,
          realLights: chandelierLights.length + sconceLights.length + candleLights.length,
          ceilingSwags: swagPositions.length,
          windowDressings: windowDressings.length,
          backdropLayers: 3,
        },
        lightingStage,
        fabricComplete,
        windowOpenings: world.windowOpenings?.length || 0,
        realLights: chandelierLights.length + sconceLights.length + candleLights.length,
        chandelierUnified,
        parquetAtlasCells: 88,
        drawCalls: metrics.drawCalls,
        triangles: metrics.triangles,
        instances: metrics.instances,
        capacity: metrics.capacity,
      };
    },
  };
}
