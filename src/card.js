// はがき・切手・印影デカール。紙は薄いが、ちゃんと厚みと角がある立体。
import * as THREE from './three.js';
import { texFromCanvas, makeCanvas, paperCanvas, paperRoughCanvas, paperBumpCanvas, guideRingCanvas, rng } from './textures.js';
import { stampArtCanvas, STAMP_ART_COUNT } from './seals.js';
import { renderImpression, newImpressionCanvas, IMPRESSION_PLANE } from './impression.js';
import { L, cardTopY } from './world.js';

const R = {};   // 共有リソース

/** 切手のミシン目：半円の切り欠きを実ジオメトリで刻む */
function perforatedShape(w, h, r = 0.075, nx = 13, ny = 15) {
  const pts = [];
  const edge = (x0, y0, x1, y1, n) => {
    const dx = (x1 - x0) / n, dy = (y1 - y0) / n;
    const len = Math.hypot(dx, dy);
    const ux = dx / len, uy = dy / len;
    const nxv = uy, nyv = -ux; // 内向き法線（時計回り前提）
    for (let i = 0; i < n; i++) {
      const sx = x0 + dx * i, sy = y0 + dy * i;
      const mx = sx + dx * 0.5, my = sy + dy * 0.5;
      pts.push(new THREE.Vector2(sx, sy));
      // 中点を中心に、内側へえぐる半円（ミシン目）
      const seg = 6;
      for (let k = 0; k <= seg; k++) {
        const th = (k / seg) * Math.PI;
        pts.push(new THREE.Vector2(
          mx + r * (-Math.cos(th) * ux + Math.sin(th) * nxv),
          my + r * (-Math.cos(th) * uy + Math.sin(th) * nyv)
        ));
      }
    }
  };
  const hw = w / 2, hh = h / 2;
  edge(-hw, hh, hw, hh, nx);
  edge(hw, hh, hw, -hh, ny);
  edge(hw, -hh, -hw, -hh, nx);
  edge(-hw, -hh, -hw, hh, ny);
  const s = new THREE.Shape(pts);
  return s;
}

function cardArtCanvas() {
  const W = 512, H = 768;
  const c = makeCanvas(W, H);
  const x = c.getContext('2d');
  const paper = paperCanvas(512);
  x.drawImage(paper, 0, 0, W, H);
  const r = rng(61);

  // やわらかい縁の色
  const g = x.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, 'rgba(255,249,236,0.75)');
  g.addColorStop(1, 'rgba(240,220,192,0.75)');
  x.fillStyle = g; x.fillRect(0, 0, W, H);

  // 外枠（細い二重線）
  x.strokeStyle = 'rgba(178,134,92,0.85)';
  x.lineWidth = 4;
  x.strokeRect(20, 20, W - 40, H - 40);
  x.strokeStyle = 'rgba(200,160,118,0.62)';
  x.lineWidth = 2;
  x.strokeRect(31, 31, W - 62, H - 62);

  // 宛名の罫（点線・文字は入れない）
  x.setLineDash([4, 10]);
  x.strokeStyle = 'rgba(168,138,106,0.45)';
  x.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const y = H * (0.50 + i * 0.085);
    x.beginPath(); x.moveTo(W * 0.16, y); x.lineTo(W * 0.84, y); x.stroke();
  }
  x.setLineDash([]);

  // 切手の位置を示すうすい枠
  x.strokeStyle = 'rgba(176,142,112,0.50)';
  x.lineWidth = 2;
  x.setLineDash([6, 6]);
  x.strokeRect(34, 37, 142, 170);
  x.setLineDash([]);

  // 小さな飾り（花と点）
  const petals = ['#f3c8d6', '#cfe0ef', '#d8ecd6', '#f0dcc0'];
  for (let i = 0; i < 16; i++) {
    const px = 46 + r() * (W - 92), py = 46 + r() * (H - 92);
    if (py < H * 0.30 && px < W * 0.42) continue;
    x.globalAlpha = 0.45 + r() * 0.40;
    x.fillStyle = petals[Math.floor(r() * petals.length)];
    const rad = 3 + r() * 7;
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + r();
      x.beginPath();
      x.ellipse(px + Math.cos(a) * rad, py + Math.sin(a) * rad, rad * 0.6, rad * 0.4, a, 0, Math.PI * 2);
      x.fill();
    }
  }
  x.globalAlpha = 1;
  // 下辺のリボン線
  x.strokeStyle = 'rgba(214,144,168,0.70)';
  x.lineWidth = 4;
  x.beginPath();
  for (let px = 44; px <= W - 44; px += 8) {
    const y = H - 62 + Math.sin(px * 0.06) * 5;
    px === 44 ? x.moveTo(px, y) : x.lineTo(px, y);
  }
  x.stroke();
  return c;
}

export function initCardResources() {
  if (R.ready) return R;
  R.cardGeo = new THREE.BoxGeometry(L.cardW, L.cardH, L.cardD);
  const artTex = texFromCanvas(cardArtCanvas(), { srgb: true, aniso: 8 });
  const bump = texFromCanvas(paperBumpCanvas(256), { repeat: [3, 4] });
  const rough = texFromCanvas(paperRoughCanvas(256), { repeat: [3, 4] });
  const top = new THREE.MeshStandardMaterial({
    map: artTex, bumpMap: bump, bumpScale: 0.012, roughnessMap: rough,
    roughness: 0.93, metalness: 0, envMapIntensity: 0.16,
  });
  const edge = new THREE.MeshStandardMaterial({
    color: 0xe6d9c2, roughness: 0.96, metalness: 0, envMapIntensity: 0.14,
  });
  const back = new THREE.MeshStandardMaterial({
    color: 0xf1e7d4, roughness: 0.95, metalness: 0, envMapIntensity: 0.14,
    bumpMap: bump, bumpScale: 0.01,
  });
  R.cardMats = [edge, edge, top, back, edge, edge];

  // 切手
  R.stampGeo = new THREE.ExtrudeGeometry(
    perforatedShape(L.stampW, L.stampD, 0.072, 13, 15),
    { depth: 0.016, bevelEnabled: false, curveSegments: 2 }
  );
  R.stampGeo.rotateX(-Math.PI / 2);
  R.stampGeo.computeVertexNormals();
  // 上面のUVを 0..1 に正規化
  {
    const pos = R.stampGeo.attributes.position;
    const uv = R.stampGeo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, (pos.getX(i) + L.stampW / 2) / L.stampW, (-pos.getZ(i) + L.stampD / 2) / L.stampD);
    }
    uv.needsUpdate = true;
  }
  R.stampMats = [];
  for (let i = 0; i < STAMP_ART_COUNT; i++) {
    R.stampMats.push(new THREE.MeshStandardMaterial({
      map: texFromCanvas(stampArtCanvas(i, 256), { srgb: true, aniso: 8 }),
      bumpMap: bump, bumpScale: 0.008,
      roughness: 0.86, metalness: 0, envMapIntensity: 0.22,
    }));
  }

  // 押す場所のあたり（破線リング）
  R.guideGeo = new THREE.PlaneGeometry(6.2, 6.2);
  R.guideGeo.rotateX(-Math.PI / 2);
  R.guideMat = new THREE.MeshBasicMaterial({
    map: texFromCanvas(guideRingCanvas(256), { srgb: true }),
    transparent: true, depthWrite: false, opacity: 0.0,
    color: 0xc9683c, toneMapped: false,
  });

  R.decalGeo = new THREE.PlaneGeometry(IMPRESSION_PLANE, IMPRESSION_PLANE);
  R.decalGeo.rotateX(-Math.PI / 2);

  R.pool = [];
  R.poolIndex = 0;
  R.ready = true;
  return R;
}

const POOL_MAX = 10;
function takeImpressionSlot() {
  if (R.pool.length < POOL_MAX) {
    const canvas = newImpressionCanvas();
    const slot = { canvas, tex: null, owner: null };
    R.pool.push(slot);
    return slot;
  }
  const slot = R.pool[R.poolIndex % POOL_MAX];
  R.poolIndex++;
  return slot;
}

let cardSerial = 0;

export function createCard(scene) {
  initCardResources();
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(R.cardGeo, R.cardMats);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  const artIndex = cardSerial % STAMP_ART_COUNT;
  const stamp = new THREE.Mesh(R.stampGeo, R.stampMats[artIndex]);
  stamp.position.set(L.stampLocal[0], L.cardH / 2 + 0.0005, L.stampLocal[1]);
  stamp.rotation.y = (Math.random() - 0.5) * 0.05;
  stamp.castShadow = true;
  stamp.receiveShadow = true;
  group.add(stamp);

  const guide = new THREE.Mesh(R.guideGeo, R.guideMat.clone());
  guide.position.set(L.pressLocal[0], L.cardH / 2 + 0.03, L.pressLocal[1]);
  guide.renderOrder = 3;
  group.add(guide);

  scene.add(group);
  cardSerial++;
  return {
    group, mesh, stampMesh: stamp, guide,
    decal: null, slot: null, done: false, id: cardSerial,
  };
}

/** 印影を貼る。デカール（実メッシュ＋アルファ）で軽く。 */
export function applyImpression(card, stamp, seed = Math.random()) {
  const slot = takeImpressionSlot();
  if (slot.owner && slot.owner !== card) {
    // 使い回し：古いカードから印影を外す
    const old = slot.owner;
    if (old.decal) {
      old.group.remove(old.decal);
      old.decal.material.dispose();
      old.decal = null;
    }
    old.recycled = true;
  }
  renderImpression(slot.canvas, stamp.kind, stamp.inkRgb, stamp.inkLevel, seed);
  if (slot.tex) slot.tex.dispose();
  slot.tex = texFromCanvas(slot.canvas, { srgb: true, aniso: 8 });
  slot.owner = card;

  const m = new THREE.MeshStandardMaterial({
    map: slot.tex, transparent: true, opacity: 0,
    roughness: 0.88, metalness: 0, envMapIntensity: 0.2,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
  const decal = new THREE.Mesh(R.decalGeo, m);
  decal.position.set(L.pressLocal[0], L.cardH / 2 + 0.022, L.pressLocal[1]);
  decal.rotation.y = (Math.random() - 0.5) * 0.06;
  decal.renderOrder = 2;
  card.group.add(decal);
  card.decal = decal;
  card.slot = slot;
  return decal;
}

export function cardResources() { return R; }

/** はがきの待機位置（プレイヤーの手前） */
export function activeCardPose(card) {
  card.group.position.set(0, cardTopY - L.cardH / 2, L.cardZ);
  card.group.rotation.set(0, 0, 0);
}
