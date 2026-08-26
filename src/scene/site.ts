// 施工現場の情景: 地面 / 基礎スラブ / 空 / 仮設フェンス /
// 材料サイロ / バッチング・ミキシング装置 / ポンプ / 小物

import * as THREE from 'three';
import { COLORS, DIM } from '../config';
import { fenceTexture, grimeTexture, groundTexture, hazardTexture, roughNoiseTexture, slabTexture } from '../materials/textures';
import { mulberry32 } from '../util/math2d';

export interface SiteRefs {
  group: THREE.Group;
  slabTopY: number;
  sun: THREE.DirectionalLight;
  pumpHoseStart: THREE.Vector3;   // ポンプ吐出口（ホース起点）
  mixerDrum?: THREE.Mesh;
  pumpPulse?: THREE.Mesh;
}

const ROUGH = { steel: null as THREE.Texture | null };

function steelMat(color: number, rough = 0.62, metal = 0.55): THREE.MeshStandardMaterial {
  if (!ROUGH.steel) ROUGH.steel = roughNoiseTexture(31);
  return new THREE.MeshStandardMaterial({
    color, roughness: rough, metalness: metal, roughnessMap: ROUGH.steel,
  });
}

export function buildSite(scene: THREE.Scene): SiteRefs {
  const group = new THREE.Group();
  scene.add(group);

  // ---- 空・霧・環境光 ----
  scene.background = new THREE.Color(COLORS.sky);
  scene.fog = new THREE.Fog(COLORS.fog, 30, 90);
  const hemi = new THREE.HemisphereLight(0xcfe0f0, 0x8a7c66, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2dd, 1.75);
  sun.position.set(-9, 14, 7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -10;
  sun.shadow.camera.right = 10;
  sun.shadow.camera.top = 10;
  sun.shadow.camera.bottom = -10;
  sun.shadow.camera.near = 2;
  sun.shadow.camera.far = 42;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);

  // 空のグラデーション球
  const skyGeo = new THREE.SphereGeometry(160, 20, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      cTop: { value: new THREE.Color(0x6f96bd) },
      cMid: { value: new THREE.Color(0xa9c2d8) },
      cBot: { value: new THREE.Color(0xd8ceb8) },
    },
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vP; uniform vec3 cTop; uniform vec3 cMid; uniform vec3 cBot;
      void main(){
        float h = normalize(vP).y;
        vec3 c = h > 0.0 ? mix(cMid, cTop, smoothstep(0.0, 0.55, h)) : mix(cMid, cBot, smoothstep(0.0, -0.3, h));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  group.add(sky);

  // 雲（ビルボード）
  const cloudCanvas = document.createElement('canvas');
  cloudCanvas.width = 256; cloudCanvas.height = 128;
  const cc = cloudCanvas.getContext('2d')!;
  const rndC = mulberry32(500);
  cc.clearRect(0, 0, 256, 128);
  for (let i = 0; i < 26; i++) {
    const g = cc.createRadialGradient(60 + rndC() * 140, 50 + rndC() * 36, 4, 60 + rndC() * 140, 55 + rndC() * 30, 18 + rndC() * 30);
    g.addColorStop(0, 'rgba(255,255,255,0.75)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    cc.fillStyle = g;
    cc.fillRect(0, 0, 256, 128);
  }
  const cloudTex = new THREE.CanvasTexture(cloudCanvas);
  const cloudMat = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.85, fog: false });
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Sprite(cloudMat);
    const rr = mulberry32(60 + i);
    s.position.set(-60 + rr() * 120, 26 + rr() * 18, -70 + rr() * 40);
    s.scale.set(28 + rr() * 22, 11 + rr() * 8, 1);
    group.add(s);
  }

  // ---- 地面 ----
  const gTex = groundTexture();
  gTex.repeat.set(9, 9);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(90, 40),
    new THREE.MeshStandardMaterial({ color: 0xbfae93, map: gTex, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // 砕石敷き（スラブ周辺）
  const gravel = new THREE.Mesh(
    new THREE.CircleGeometry(9.4, 28),
    new THREE.MeshStandardMaterial({ color: 0xa39a88, map: gTex, roughness: 1 }),
  );
  gravel.rotation.x = -Math.PI / 2;
  gravel.position.y = 0.012;
  gravel.receiveShadow = true;
  group.add(gravel);

  // ---- 基礎スラブ ----
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(DIM.slabW, DIM.slabH, DIM.slabD),
    new THREE.MeshStandardMaterial({ color: 0xffffff, map: slabTexture(), roughness: 0.93 }),
  );
  slab.position.y = DIM.slabH / 2;
  slab.castShadow = true;
  slab.receiveShadow = true;
  group.add(slab);

  // 建築可能範囲の表示（薄い塗装ライン枠 — 発光させない）
  const areaMat = new THREE.MeshBasicMaterial({ color: 0xe8e2d2, transparent: true, opacity: 0.55, depthWrite: false });
  const bw = DIM.buildW, bd = DIM.buildD, lw = 0.035;
  for (const [w, d, x, z] of [
    [bw + lw, lw, 0, bd / 2], [bw + lw, lw, 0, -bd / 2],
    [lw, bd + lw, bw / 2, 0], [lw, bd + lw, -bw / 2, 0],
  ] as [number, number, number, number][]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), areaMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, DIM.slabTop + 0.003, z);
    group.add(m);
  }

  // ---- 仮設フェンス（安全柵） ----
  const fenceTex = fenceTexture();
  fenceTex.repeat.set(2.4, 1);
  const fenceMat = new THREE.MeshStandardMaterial({
    color: 0xd8dbdd, alphaMap: fenceTex, transparent: true, alphaTest: 0.35,
    side: THREE.DoubleSide, roughness: 0.6, metalness: 0.5,
  });
  const postMat = steelMat(0x9aa4ab, 0.55, 0.6);
  const footMat = new THREE.MeshStandardMaterial({ color: 0xb0aca2, roughness: 0.95 });
  const fenceGroup = new THREE.Group();
  const H = 1.75, PW = 2.3;
  const runs: [number, number, number, number][] = [
    // [x0, z0, x1, z1] 前面はゲート開口を空ける
    [-8.2, 6.4, -1.6, 6.4], [2.2, 6.4, 8.2, 6.4],
    [-8.2, -7.4, 8.2, -7.4],
    [-8.2, 6.4, -8.2, -7.4],
    [8.2, 6.4, 8.2, -7.4],
  ];
  for (const [x0, z0, x1, z1] of runs) {
    const dx = x1 - x0, dz = z1 - z0;
    const runLen = Math.hypot(dx, dz);
    const nPanels = Math.max(1, Math.round(runLen / PW));
    const ang = Math.atan2(dz, dx);
    for (let i = 0; i < nPanels; i++) {
      const t0 = i / nPanels, t1 = (i + 1) / nPanels;
      const cx = x0 + dx * (t0 + t1) / 2, cz = z0 + dz * (t0 + t1) / 2;
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(runLen / nPanels - 0.12, H - 0.25), fenceMat);
      panel.position.set(cx, H / 2 + 0.08, cz);
      panel.rotation.y = -ang;
      fenceGroup.add(panel);
      // 支柱と樹脂ベース
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, H, 8), postMat);
      post.position.set(x0 + dx * t0, H / 2, z0 + dz * t0);
      post.castShadow = true;
      fenceGroup.add(post);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.11, 0.22), footMat);
      foot.position.set(x0 + dx * t0, 0.055, z0 + dz * t0);
      foot.rotation.y = -ang + Math.PI / 2;
      foot.castShadow = true;
      fenceGroup.add(foot);
    }
  }
  group.add(fenceGroup);

  // ---- 材料サイロ ----
  const silo = new THREE.Group();
  const siloShell = steelMat(0xc9c4b6, 0.5, 0.45);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 2.6, 18), siloShell);
  body.position.y = 2.6;
  body.castShadow = true;
  silo.add(body);
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.16, 1.1, 18), siloShell);
  cone.position.y = 0.75 + 0.55;
  cone.castShadow = true;
  silo.add(cone);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.85, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), siloShell);
  cap.position.y = 3.9;
  cap.castShadow = true;
  silo.add(cap);
  // 脚
  const legMat = steelMat(0x6b7079, 0.6, 0.6);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.35, 0.09), legMat);
    leg.position.set(Math.cos(a) * 0.62, 0.65, Math.sin(a) * 0.62);
    leg.castShadow = true;
    silo.add(leg);
  }
  // 粉体汚れ（下部ほど白い粉）
  const dustBand = new THREE.Mesh(
    new THREE.CylinderGeometry(0.855, 0.855, 1.1, 18, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0xe8e4da, transparent: true, opacity: 0.5, roughness: 1,
      alphaMap: grimeTexture(41), side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  dustBand.position.y = 1.65;
  dustBand.rotation.y = 1.2;
  silo.add(dustBand);
  // はしご
  const ladder = new THREE.Group();
  for (let i = 0; i < 11; i++) {
    const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.3, 6), legMat);
    rung.rotation.z = Math.PI / 2;
    rung.position.set(0, 0.6 + i * 0.32, 0);
    ladder.add(rung);
  }
  for (const sx of [-0.15, 0.15]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.035, 3.6, 0.035), legMat);
    rail.position.set(sx, 2.2, 0);
    ladder.add(rail);
  }
  ladder.position.set(0.88, 0, 0);
  silo.add(ladder);
  silo.position.set(-6.4, 0, -4.6);
  group.add(silo);

  // ---- バッチング / ミキシング装置 ----
  const mixer = new THREE.Group();
  const frameMat = steelMat(0x37536b, 0.58, 0.5);
  const mixBody = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.0, 1.0), frameMat);
  mixBody.position.y = 0.62;
  mixBody.castShadow = true;
  mixer.add(mixBody);
  // 受入ホッパー
  const hopper = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.24, 0.55, 4), steelMat(0x8a8f96, 0.6, 0.55));
  hopper.rotation.y = Math.PI / 4;
  hopper.position.set(-0.25, 1.42, 0);
  hopper.castShadow = true;
  mixer.add(hopper);
  // ミキサードラム（回転させる）
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.8, 14), steelMat(0xb9bcc0, 0.5, 0.6));
  drum.rotation.z = Math.PI / 2;
  drum.position.set(0.35, 1.28, 0);
  drum.castShadow = true;
  mixer.add(drum);
  // 汚れ
  const mixGrime = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 1.0),
    new THREE.MeshStandardMaterial({
      color: 0x54493a, transparent: true, opacity: 0.55, alphaMap: grimeTexture(42), roughness: 1, depthWrite: false,
    }),
  );
  mixGrime.position.set(0, 0.62, 0.505);
  mixer.add(mixGrime);
  mixer.position.set(-4.7, 0, -5.1);
  mixer.rotation.y = 0.35;
  group.add(mixer);

  // ---- ポンプユニット ----
  const pump = new THREE.Group();
  const pumpBody = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.78, 0.72), steelMat(0xa8552e, 0.62, 0.45));
  pumpBody.position.y = 0.52;
  pumpBody.castShadow = true;
  pump.add(pumpBody);
  // 脈動する吐出配管
  const pulse = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.5, 10), steelMat(0x5a5e63, 0.5, 0.6));
  pulse.rotation.z = Math.PI / 2;
  pulse.position.set(0.66, 0.72, 0);
  pump.add(pulse);
  // 車輪
  for (const [wx, wz] of [[-0.42, 0.4], [0.42, 0.4], [-0.42, -0.4], [0.42, -0.4]]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.09, 12), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.95 }));
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(wx, 0.16, wz);
    wheel.castShadow = true;
    pump.add(wheel);
  }
  // 操作パネル
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.05), steelMat(0xd8d5cc, 0.5, 0.3));
  panel.position.set(-0.3, 0.98, 0.32);
  panel.rotation.x = -0.4;
  pump.add(panel);
  pump.position.set(-3.4, 0, -4.4);
  pump.rotation.y = -0.5;
  group.add(pump);

  // 資材パレット（袋積み）
  const bags = new THREE.Group();
  const bagMat = new THREE.MeshStandardMaterial({ color: 0xd9d2c0, roughness: 0.95 });
  const palletMat = new THREE.MeshStandardMaterial({ color: 0x9a7b52, roughness: 0.95 });
  const rndB = mulberry32(70);
  for (let p = 0; p < 2; p++) {
    const px = -7.6 + p * 1.7, pz = -2.2;
    const pallet = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 1.1), palletMat);
    pallet.position.set(px, 0.06, pz);
    pallet.castShadow = true;
    bags.add(pallet);
    for (let i = 0; i < 6 - p * 2; i++) {
      const bag = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.17, 0.72), bagMat);
      bag.position.set(px - 0.24 + (i % 2) * 0.48 + (rndB() - 0.5) * 0.03, 0.2 + Math.floor(i / 2) * 0.17, pz + (rndB() - 0.5) * 0.05);
      bag.rotation.y = (rndB() - 0.5) * 0.15;
      bag.castShadow = true;
      bags.add(bag);
    }
  }
  group.add(bags);

  // 遠景: 施工中の別パビリオン（同種の小屋、既に完成した例）
  const farWall = new THREE.Group();
  const farMat = new THREE.MeshStandardMaterial({ color: 0x9a968c, roughness: 0.95 });
  const fw = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.55, 1.8, 22, 1, true), farMat);
  fw.position.set(11.5, 0.9, -9);
  fw.castShadow = true;
  farWall.add(fw);
  const fwRoof = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.75, 0.1, 22), farMat);
  fwRoof.position.set(11.5, 1.85, -9);
  fwRoof.castShadow = true;
  farWall.add(fwRoof);
  group.add(farWall);

  // 警告縞バリア（スラブ手前の低い単管）
  const hazMat = new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.7 });
  for (const [bx, bz, rot] of [[-3.6, 4.6, 0.15], [3.4, 4.7, -0.1]] as [number, number, number][]) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.6, 8), hazMat);
    bar.rotation.z = Math.PI / 2;
    bar.rotation.y = rot;
    bar.position.set(bx, 0.62, bz);
    bar.castShadow = true;
    group.add(bar);
    for (const o of [-0.7, 0.7]) {
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.62, 6), steelMat(0x777777));
      stand.position.set(bx + Math.cos(rot) * o, 0.31, bz - Math.sin(rot) * o);
      group.add(stand);
    }
  }

  return {
    group,
    slabTopY: DIM.slabTop,
    sun,
    pumpHoseStart: new THREE.Vector3(-3.4 + 0.66 * Math.cos(-0.5), 0.72, -4.4 - 0.66 * Math.sin(-0.5)),
    mixerDrum: drum,
    pumpPulse: pulse,
  };
}
