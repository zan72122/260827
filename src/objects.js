/**
 * objects.js
 * すべての主役・接触対象を実メッシュで組み立てる。
 * 板画像 (ビルボード) は主役・接触対象には一切使わない。
 * 封筒の厚み / 切手の段差と目打ち / 印章の持ち手・印面の縁 は
 * すべて実ジオメトリで作る。
 */
import * as THREE from 'three';
import {
  envelopeMaterials, postageMaterials, rubberFaceMaterial,
  woodMaterial, deskMaterial, feltMaterial, impressionTexture,
} from './textures.js';

/* 単位: 1 = 10cm 相当。封筒は 22cm x 11cm ≒ 2.2 x 1.1 */

export const ENV_W = 2.2;
export const ENV_D = 1.15;
export const ENV_T = 0.05;   // 紙の厚み(封筒として少し誇張)
export const POSTAGE_W = 0.36;
export const POSTAGE_H = 0.44;
export const POSTAGE_T = 0.014;

// 封筒ローカル座標での切手位置 (右上)
export const POSTAGE_POS = new THREE.Vector2(ENV_W * 0.5 - 0.34, -ENV_D * 0.5 + 0.30);
// 印を押すスロット (1つ目は切手にかかる位置、2つ目はその隣)
export const SLOTS = [
  new THREE.Vector2(POSTAGE_POS.x - 0.02, POSTAGE_POS.y + 0.02),
  new THREE.Vector2(POSTAGE_POS.x - 0.74, POSTAGE_POS.y + 0.04),
];

/* ---------- 目打ち付きの切手 ---------- */

function perforatedStampGeometry(w, h, nx, ny, depth) {
  const s = new THREE.Shape();
  const hw = w / 2, hh = h / 2;
  const sx = w / nx, sy = h / ny;
  const rx = sx * 0.30, ry = sy * 0.30;

  s.moveTo(-hw, -hh);
  for (let i = 0; i < nx; i++) {
    const cx = -hw + sx * (i + 0.5);
    s.lineTo(cx - rx, -hh);
    s.absarc(cx, -hh, rx, Math.PI, 0, true);
  }
  s.lineTo(hw, -hh);
  for (let i = 0; i < ny; i++) {
    const cy = -hh + sy * (i + 0.5);
    s.lineTo(hw, cy - ry);
    s.absarc(hw, cy, ry, -Math.PI / 2, Math.PI / 2, true);
  }
  s.lineTo(hw, hh);
  for (let i = 0; i < nx; i++) {
    const cx = hw - sx * (i + 0.5);
    s.lineTo(cx + rx, hh);
    s.absarc(cx, hh, rx, 0, Math.PI, true);
  }
  s.lineTo(-hw, hh);
  for (let i = 0; i < ny; i++) {
    const cy = hh - sy * (i + 0.5);
    s.lineTo(-hw, cy + ry);
    s.absarc(-hw, cy, ry, Math.PI / 2, -Math.PI / 2, true);
  }
  s.lineTo(-hw, -hh);

  const g = new THREE.ExtrudeGeometry(s, {
    depth, bevelEnabled: true, bevelSize: 0.0015, bevelThickness: 0.0015, bevelSegments: 1,
    curveSegments: 4,
  });
  g.translate(0, 0, -depth / 2);
  // UV を切手の矩形に合わせ直す
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, (pos.getX(i) + hw) / w, (pos.getY(i) + hh) / h);
  }
  uv.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/* ---------- 封筒 ---------- */

export function createEnvelope() {
  const group = new THREE.Group();
  const mats = envelopeMaterials();

  // BoxGeometry の面順は +x,-x,+y,-y,+z,-z
  const geo = new THREE.BoxGeometry(ENV_W, ENV_T, ENV_D, 44, 1, 26);
  const body = new THREE.Mesh(geo, [
    mats.edge, mats.edge, mats.top, mats.back, mats.edge, mats.edge,
  ]);
  body.castShadow = true;
  body.receiveShadow = true;
  body.position.y = ENV_T / 2;
  group.add(body);

  // たわみ用に元の頂点を保存
  const pos = geo.attributes.position;
  const base = new Float32Array(pos.array);
  const topIdx = [];
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > ENV_T / 2 - 1e-4) topIdx.push(i);
  }
  group.userData.deform = { geo, pos, base, topIdx };

  // 切手 (実際の段差を持つ別メッシュ)
  const pm = postageMaterials();
  const pg = perforatedStampGeometry(POSTAGE_W, POSTAGE_H, 7, 8, POSTAGE_T);
  const postage = new THREE.Mesh(pg, [pm.front, pm.side]);
  postage.rotation.x = -Math.PI / 2;
  postage.rotation.z = 0.035; // ほんの少し傾けて貼ってある
  postage.position.set(POSTAGE_POS.x, ENV_T + POSTAGE_T / 2, POSTAGE_POS.y);
  postage.castShadow = true;
  postage.receiveShadow = true;
  group.add(postage);
  group.userData.postage = postage;

  group.userData.dents = [];
  return group;
}

/**
 * 押印による紙のたわみ。env.userData.dents に貯まった押し跡をすべて反映する。
 * (2 個目を押しても 1 個目のくぼみが消えない)
 */
export function deformEnvelope(env) {
  const d = env.userData.deform;
  if (!d) return;
  const { pos, base, topIdx } = d;
  const dents = env.userData.dents;
  for (const i of topIdx) {
    const x = base[i * 3], z = base[i * 3 + 2];
    let y = base[i * 3 + 1];
    for (const dent of dents) {
      if (dent.depth <= 0) continue;
      const r = dent.radius;
      const dist = Math.hypot(x - dent.x, z - dent.z);
      if (dist >= r * 1.35) continue;
      const f = dist >= r ? 0 : Math.cos((dist / r) * Math.PI * 0.5) ** 2;
      // 縁のわずかな盛り上がり (押されて紙が逃げる)
      const rim = dist > r * 0.72
        ? Math.sin(((dist - r * 0.72) / (r * 0.63)) * Math.PI) * 0.16 : 0;
      y += -dent.depth * f + dent.depth * rim;
    }
    pos.setY(i, y);
  }
  pos.needsUpdate = true;
  d.geo.computeVertexNormals();
}

/* ---------- 印影 (デカール的な薄い実メッシュ + マスクリビール) ---------- */

const revealVert = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const revealFrag = /* glsl */`
uniform sampler2D map;
uniform float reveal;
uniform float opacity;
varying vec2 vUv;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  float a = hash(i), b = hash(i+vec2(1.0,0.0));
  float c = hash(i+vec2(0.0,1.0)), d = hash(i+vec2(1.0,1.0));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}

void main() {
  vec4 t = texture2D(map, vUv);
  if (t.a < 0.01) discard;
  // 中心から外へ、ノイズで揺らぎながらインクが移る
  float d = length(vUv - 0.5) * 2.0;
  float n = noise(vUv * 9.0) * 0.28 + noise(vUv * 24.0) * 0.10;
  float mask = smoothstep(reveal + 0.10, reveal - 0.16, d + n - 0.19);
  float a = t.a * mask * opacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(t.rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createImpression(kind, seed) {
  const r = kind === 'special' ? 0.31 : 0.28;
  const geo = new THREE.CircleGeometry(r, 40);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: impressionTexture(kind, seed) },
      reveal: { value: 0 },
      opacity: { value: 1 },
    },
    vertexShader: revealVert,
    fragmentShader: revealFrag,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 4;
  return m;
}

/* ---------- 印章 (ハンコ) ---------- */

function latheProfile(points, seg = 24) {
  return new THREE.LatheGeometry(points.map(p => new THREE.Vector2(p[0], p[1])), seg);
}

/**
 * kind: 'special' | 'normal'
 * 返り値: group。group.userData.faceY = 印面の底面(ローカル y)
 */
export function createStamp(kind) {
  const g = new THREE.Group();
  const special = kind === 'special';
  const R = special ? 0.30 : 0.27;     // 印面半径
  const headH = 0.16;

  // --- 印面 (ゴム) ---
  const faceMat = rubberFaceMaterial(kind);
  const rubber = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R * 0.985, 0.075, 48, 1, true),
    new THREE.MeshStandardMaterial({ color: special ? 0x5c3330 : 0x2f3138, roughness: 0.85 })
  );
  rubber.position.y = 0.0375;
  rubber.castShadow = true;
  g.add(rubber);

  // 印面の面 (下向き)。彫刻された縁と模様。
  const faceDisc = new THREE.Mesh(new THREE.CircleGeometry(R * 0.985, 48), faceMat);
  faceDisc.rotation.x = Math.PI / 2;   // 下を向く
  faceDisc.position.y = 0.0005;
  g.add(faceDisc);
  g.userData.faceDisc = faceDisc;

  // 印面の外周リング (実ジオメトリの縁)
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(R * 0.96, 0.012, 8, 40),
    new THREE.MeshStandardMaterial({ color: special ? 0x4a2724 : 0x24262e, roughness: 0.7 })
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.008;
  rim.castShadow = true;
  g.add(rim);

  // --- 頭部 (印面を支える台) ---
  const headMat = special
    ? new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.42, metalness: 0.55 })
    : new THREE.MeshStandardMaterial({ color: 0x1e2026, roughness: 0.36, metalness: 0.15 });
  const head = new THREE.Mesh(
    latheProfile([
      [R * 0.99, 0.075], [R * 1.0, 0.10], [R * 0.96, 0.14],
      [R * 0.80, 0.20], [R * 0.62, 0.235], [R * 0.40, 0.25], [0, 0.255],
    ], 40),
    headMat
  );
  head.castShadow = true;
  head.receiveShadow = true;
  g.add(head);

  // 頭部と持ち手の間のリング (特別印は真鍮、普通印はローレット樹脂)
  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(R * 0.44, R * 0.46, 0.055, 32),
    special
      ? new THREE.MeshStandardMaterial({ color: 0xc9a24a, roughness: 0.28, metalness: 0.95 })
      : new THREE.MeshStandardMaterial({ color: 0x33363d, roughness: 0.55, metalness: 0.2 })
  );
  collar.position.y = 0.275;
  collar.castShadow = true;
  g.add(collar);

  // --- 持ち手 ---
  let handle;
  if (special) {
    // 挽き物の木製グリップ (くびれのあるロクロ形状)
    handle = new THREE.Mesh(
      latheProfile([
        [0, 0.30], [R * 0.44, 0.305], [R * 0.46, 0.34],
        [R * 0.30, 0.44], [R * 0.24, 0.56], [R * 0.27, 0.70],
        [R * 0.40, 0.84], [R * 0.44, 0.95], [R * 0.34, 1.03],
        [R * 0.16, 1.075], [0, 1.09],
      ], 36),
      woodMaterial({ light: '#d3a06a', dark: '#8a5326', rings: 9, seed: 4, roughness: 0.35 })
    );
    // 赤いアクセントリング (特別印であることの手がかり)
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(R * 0.265, 0.022, 10, 30),
      new THREE.MeshStandardMaterial({ color: 0xb3312a, roughness: 0.3, metalness: 0.1 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.58;
    ring.castShadow = true;
    g.add(ring);
  } else {
    // 樹脂のストレートグリップ
    handle = new THREE.Mesh(
      latheProfile([
        [0, 0.30], [R * 0.46, 0.305], [R * 0.44, 0.36],
        [R * 0.33, 0.42], [R * 0.31, 0.80], [R * 0.34, 0.90],
        [R * 0.32, 0.98], [R * 0.20, 1.02], [0, 1.035],
      ], 32),
      new THREE.MeshStandardMaterial({ color: 0x2b2e36, roughness: 0.34, metalness: 0.25 })
    );
    // 指かかりの溝 (実ジオメトリ)
    for (let i = 0; i < 3; i++) {
      const groove = new THREE.Mesh(
        new THREE.TorusGeometry(R * 0.315, 0.011, 8, 26),
        new THREE.MeshStandardMaterial({ color: 0x494d57, roughness: 0.45, metalness: 0.3 })
      );
      groove.rotation.x = Math.PI / 2;
      groove.position.y = 0.52 + i * 0.085;
      g.add(groove);
    }
  }
  handle.castShadow = true;
  handle.receiveShadow = true;
  g.add(handle);

  g.userData.kind = kind;
  g.userData.radius = R;
  return g;
}

/* ---------- 印章置き台 ---------- */

export function createStampRest(tone = 0) {
  const g = new THREE.Group();
  const wood = woodMaterial({
    light: tone ? '#b8875a' : '#a9784d', dark: '#5d3a1c', rings: 6, seed: 12 + tone, roughness: 0.5,
  });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.075, 0.72), wood);
  base.position.y = 0.0375;
  base.castShadow = true; base.receiveShadow = true;
  g.add(base);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.30, 0.035, 10, 32), wood);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.085;
  ring.castShadow = true; ring.receiveShadow = true;
  g.add(ring);
  return g;
}

/* ---------- スタンプ台 (インクパッド) ---------- */

export function createInkPad(color = 0x8e2620) {
  const g = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: 0.42, metalness: 0.3 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.13, 0.62), shell);
  box.position.y = 0.065;
  box.castShadow = true; box.receiveShadow = true;
  g.add(box);
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.05, 0.50), feltMaterial(color));
  pad.position.y = 0.125;
  pad.receiveShadow = true;
  g.add(pad);
  // ふた (少し開いた状態、実ジオメトリの厚み)
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.045, 0.62), shell);
  lid.position.set(0, 0.30, -0.44);
  lid.rotation.x = -1.05;
  lid.castShadow = true;
  g.add(lid);
  return g;
}

/* ---------- カウンターまわり (主役以外は軽量に) ---------- */

export function createCounter() {
  const g = new THREE.Group();
  const desk = deskMaterial();

  // 天板 (厚みのある実ボックス)
  const top = new THREE.Mesh(new THREE.BoxGeometry(11, 0.34, 6.2), desk);
  top.position.y = -0.17;
  top.receiveShadow = true;
  top.castShadow = true;
  g.add(top);

  // 天板の小口 (少し明るい木口)
  const lip = new THREE.Mesh(
    new THREE.BoxGeometry(11.1, 0.10, 0.10),
    new THREE.MeshStandardMaterial({ color: 0xa87b4c, roughness: 0.5 })
  );
  lip.position.set(0, -0.06, 3.13);
  lip.receiveShadow = true;
  g.add(lip);

  // カウンター前板
  const front = new THREE.Mesh(new THREE.BoxGeometry(11, 1.8, 0.24), desk);
  front.position.set(0, -1.24, 3.06);
  front.receiveShadow = true;
  g.add(front);

  // 押印マット
  const mat = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.045, 2.05), feltMaterial(0x24463a));
  mat.position.set(0, 0.022, 0.05);
  mat.receiveShadow = true;
  mat.castShadow = true;
  g.add(mat);
  const edge = new THREE.Mesh(
    new THREE.BoxGeometry(3.84, 0.028, 2.19),
    new THREE.MeshStandardMaterial({ color: 0x16302a, roughness: 0.85 })
  );
  edge.position.set(0, 0.014, 0.05);
  edge.receiveShadow = true;
  g.add(edge);

  // 背後の引き出しユニット
  const cabWood = woodMaterial({ light: '#8d6640', dark: '#472c13', rings: 3, seed: 17, roughness: 0.62 });
  const cab = new THREE.Group();
  const cabBody = new THREE.Mesh(new THREE.BoxGeometry(5.0, 2.3, 1.2), cabWood);
  cabBody.position.y = 1.15;
  cabBody.castShadow = true; cabBody.receiveShadow = true;
  cab.add(cabBody);
  const drawerFace = new THREE.MeshStandardMaterial({ color: 0x9d7c56, roughness: 0.65 });
  const knobMat = new THREE.MeshStandardMaterial({ color: 0xb9962f, roughness: 0.32, metalness: 0.9 });
  for (let r = 0; r < 3; r++) {
    for (let cix = 0; cix < 3; cix++) {
      const d = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.62, 0.06), drawerFace);
      d.position.set(-1.6 + cix * 1.6, 0.42 + r * 0.72, 0.62);
      d.castShadow = true; d.receiveShadow = true;
      cab.add(d);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), knobMat);
      knob.position.set(d.position.x, d.position.y, 0.68);
      cab.add(knob);
    }
  }
  cab.position.set(-1.0, 0.0, -3.9);
  g.add(cab);

  // 荷物 (小包) — 背景の軽量プロップ
  const paperMat = new THREE.MeshStandardMaterial({ color: 0xb99a6d, roughness: 0.9 });
  const twine = new THREE.MeshStandardMaterial({ color: 0xe8e2d2, roughness: 0.85 });
  const parcels = [
    { p: [3.0, 0.34, -3.0], s: [1.15, 0.68, 0.9], r: 0.2 },
    { p: [3.9, 0.26, -2.2], s: [0.85, 0.52, 0.72], r: -0.35 },
    { p: [3.3, 0.94, -3.05], s: [0.8, 0.5, 0.66], r: 0.55 },
  ];
  for (const b of parcels) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(...b.s), paperMat);
    m.position.set(...b.p);
    m.rotation.y = b.r;
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    const t1 = new THREE.Mesh(new THREE.BoxGeometry(b.s[0] * 1.02, b.s[1] * 1.02, 0.035), twine);
    t1.position.copy(m.position); t1.rotation.y = b.r;
    g.add(t1);
  }

  // ペン立て
  const cup = new THREE.Mesh(
    new THREE.CylinderGeometry(0.20, 0.17, 0.42, 20, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x3f4753, roughness: 0.5, metalness: 0.35, side: THREE.DoubleSide })
  );
  cup.position.set(-2.9, 0.21, -0.9);
  cup.castShadow = true; cup.receiveShadow = true;
  g.add(cup);
  const penCols = [0xd94f3d, 0x2f5fa8, 0x2b2b2b];
  for (let i = 0; i < 3; i++) {
    const pen = new THREE.Mesh(
      new THREE.CylinderGeometry(0.026, 0.026, 0.78, 8),
      new THREE.MeshStandardMaterial({ color: penCols[i], roughness: 0.35 })
    );
    pen.position.set(-2.9 + (i - 1) * 0.075, 0.5, -0.9 + (i - 1) * 0.05);
    pen.rotation.z = (i - 1) * 0.12;
    pen.rotation.x = 0.08;
    pen.castShadow = true;
    g.add(pen);
  }

  // 差し出しトレー (封筒が届く場所)
  const trayMat = new THREE.MeshStandardMaterial({ color: 0x6d6f77, roughness: 0.45, metalness: 0.45 });
  const tray = new THREE.Group();
  const tb = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.05, 1.7), trayMat);
  tb.position.y = 0.025; tb.receiveShadow = true; tb.castShadow = true;
  tray.add(tb);
  for (const [w, d, x, z] of [[2.6, 0.06, 0, -0.85], [2.6, 0.06, 0, 0.85]]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(w, 0.16, d), trayMat);
    s.position.set(x, 0.08, z); s.castShadow = true; s.receiveShadow = true;
    tray.add(s);
  }
  for (const x of [-1.3, 1.3]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 1.7), trayMat);
    s.position.set(x, 0.08, 0); s.castShadow = true; s.receiveShadow = true;
    tray.add(s);
  }
  // トレーの中の待機中の封筒 (薄い実ボックスの束)
  for (let i = 0; i < 4; i++) {
    const e = new THREE.Mesh(
      new THREE.BoxGeometry(2.1, 0.035, 1.05),
      new THREE.MeshStandardMaterial({ color: 0xf0ead9, roughness: 0.95 })
    );
    e.position.set(0.02 * i, 0.07 + i * 0.037, -0.01 * i);
    e.rotation.y = (i - 1.5) * 0.012;
    e.castShadow = true; e.receiveShadow = true;
    tray.add(e);
  }
  tray.position.set(-3.35, 0, 1.05);
  tray.rotation.y = 0.28;
  g.add(tray);
  g.userData.tray = tray;

  // 背景の壁 (軽量な板 1 枚 + 幅木)
  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(26, 12),
    new THREE.MeshStandardMaterial({ color: 0xa8b0ae, roughness: 0.95 })
  );
  wall.position.set(0, 4.0, -6.2);
  wall.receiveShadow = true;
  g.add(wall);
  const skirt = new THREE.Mesh(
    new THREE.BoxGeometry(26, 0.5, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x6f6257, roughness: 0.8 })
  );
  skirt.position.set(0, -1.7, -6.1);
  g.add(skirt);
  // 床
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 24),
    new THREE.MeshStandardMaterial({ color: 0x6a5c50, roughness: 0.92 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.95;
  floor.receiveShadow = true;
  g.add(floor);

  return g;
}

/* ---------- 完成演出用の紙飛行機 (実メッシュ) ---------- */

export function createPaperPlane() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xfffaf0, roughness: 0.78, metalness: 0.0, side: THREE.DoubleSide,
    emissive: 0x7a6440, emissiveIntensity: 0.55, transparent: true, opacity: 1,
  });
  const mkWing = (sign) => {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(0.62, 0.0);
    s.lineTo(0.10, 0.30 * sign);
    s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false });
    return new THREE.Mesh(geo, mat);
  };
  const left = mkWing(1); left.rotation.x = -0.30;
  const right = mkWing(-1); right.rotation.x = 0.30;
  g.add(left, right);
  const keel = new THREE.Mesh(
    new THREE.BoxGeometry(0.60, 0.10, 0.010),
    mat
  );
  keel.position.set(0.30, -0.03, 0);
  g.add(keel);
  g.userData.mat = mat;
  return g;
}
