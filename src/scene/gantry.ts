// ============================================================
// 架空のガントリー式建設3Dプリンター "GP-6"
//  軸構成（実機COBOD BOD2系に準拠した3軸直交）:
//   - 地面に固定された左右レール上を門型フレームが Z 方向へ走行
//   - 門型の梁（トラス）が柱に沿って Y 方向へ昇降（層高に追従）
//   - 梁上のキャリッジが X 方向へ走行し、プリントヘッドを保持
//  ノズルは丸口で回転不要。可動部は上記3軸のみ（空中自由飛行なし）
//  付帯: エネルギーチェーン（ケーブルキャリア）、材料ホース、
//        ボルト接合、車輪とモーター、汚れ、警告縞
// ============================================================

import * as THREE from 'three';
import { COLORS, DIM } from '../config';
import { grimeTexture, hazardTexture, roughNoiseTexture } from '../materials/textures';
import { HeadState } from '../print/printJob';
import { clamp } from '../util/math2d';

const roughTex = roughNoiseTexture(97);

function steel(color: number, rough = 0.58, metal = 0.6): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, roughnessMap: roughTex });
}

/** 固定セグメント数のチューブ。毎フレーム頂点をin-placeで更新（alloc無し） */
class HoseTube {
  mesh: THREE.Mesh;
  private nSeg: number;
  private nRad: number;
  private radius: number;
  private pos: Float32Array;
  private nrm: Float32Array;
  private tmp = {
    t: new THREE.Vector3(), n: new THREE.Vector3(), b: new THREE.Vector3(),
    p: new THREE.Vector3(), prev: new THREE.Vector3(0, 1, 0),
  };

  constructor(nSeg: number, radius: number, mat: THREE.Material, nRad = 8) {
    this.nSeg = nSeg; this.nRad = nRad; this.radius = radius;
    const nV = (nSeg + 1) * nRad;
    this.pos = new Float32Array(nV * 3);
    this.nrm = new Float32Array(nV * 3);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3));
    const idx: number[] = [];
    for (let i = 0; i < nSeg; i++) {
      for (let j = 0; j < nRad; j++) {
        const j2 = (j + 1) % nRad;
        const a = i * nRad + j, b = (i + 1) * nRad + j, c = (i + 1) * nRad + j2, d = i * nRad + j2;
        idx.push(a, c, b, a, d, c);
      }
    }
    geom.setIndex(idx);
    this.mesh = new THREE.Mesh(geom, mat);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
  }

  /** ctrl: 制御点列（3点以上）。CatmullRomで nSeg 分割して更新 */
  update(ctrl: THREE.Vector3[]): void {
    const { t, n, b, p, prev } = this.tmp;
    prev.set(0, 1, 0);
    for (let i = 0; i <= this.nSeg; i++) {
      const u = i / this.nSeg;
      catmull(ctrl, u, p);
      catmullTangent(ctrl, u, t);
      if (t.lengthSq() < 1e-10) t.set(1, 0, 0);
      t.normalize();
      // 平行移動フレーム
      n.copy(prev).sub(t.clone().multiplyScalar(prev.dot(t)));
      if (n.lengthSq() < 1e-6) n.set(0, 0, 1).sub(t.clone().multiplyScalar(t.z));
      n.normalize();
      prev.copy(n);
      b.crossVectors(t, n);
      for (let j = 0; j < this.nRad; j++) {
        const a = (j / this.nRad) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const o = (i * this.nRad + j) * 3;
        this.pos[o] = p.x + (n.x * ca + b.x * sa) * this.radius;
        this.pos[o + 1] = p.y + (n.y * ca + b.y * sa) * this.radius;
        this.pos[o + 2] = p.z + (n.z * ca + b.z * sa) * this.radius;
        this.nrm[o] = n.x * ca + b.x * sa;
        this.nrm[o + 1] = n.y * ca + b.y * sa;
        this.nrm[o + 2] = n.z * ca + b.z * sa;
      }
    }
    (this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.mesh.geometry.getAttribute('normal') as THREE.BufferAttribute).needsUpdate = true;
  }
}

function catmull(pts: THREE.Vector3[], u: number, out: THREE.Vector3): void {
  const n = pts.length - 1;
  const t = u * n;
  const i = Math.min(Math.floor(t), n - 1);
  const f = t - i;
  const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[Math.min(n, i + 1)], p3 = pts[Math.min(n, i + 2)];
  const f2 = f * f, f3 = f2 * f;
  out.set(
    0.5 * ((2 * p1.x) + (-p0.x + p2.x) * f + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * f2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * f3),
    0.5 * ((2 * p1.y) + (-p0.y + p2.y) * f + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * f2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * f3),
    0.5 * ((2 * p1.z) + (-p0.z + p2.z) * f + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * f2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * f3),
  );
}
function catmullTangent(pts: THREE.Vector3[], u: number, out: THREE.Vector3): void {
  const e = 0.004;
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  catmull(pts, Math.max(0, u - e), a);
  catmull(pts, Math.min(1, u + e), b);
  out.subVectors(b, a);
}

export class Gantry {
  group: THREE.Group;
  private portal: THREE.Group;      // Z走行部（門型全体）
  private beamAsm: THREE.Group;     // Y昇降部（梁+キャリッジ）
  private carriage: THREE.Group;    // X走行部
  private headAsm: THREE.Group;     // プリントヘッド
  private nozzle: THREE.Mesh;
  private auger: THREE.Mesh;
  private wheels: THREE.Mesh[] = [];
  private chain: THREE.InstancedMesh;
  private chainDummy = new THREE.Object3D();
  private hoseGround: HoseTube;
  private hoseColumn: HoseTube;
  private hoseDrop: HoseTube;
  private pumpStart: THREE.Vector3;

  // 現在の軸位置
  posX = -1.2;   // キャリッジ
  posZ = -3.3;   // 門型
  beamY = 1.35;  // 梁中心高
  private velX = 0; private velZ = 0;
  private swayX = 0; private swayZ = 0; private swayVX = 0; private swayVZ = 0;
  private prevHeadX = 0; private prevHeadZ = 0;
  private lastZ = -3.3;

  private headHang = 0.86; // 梁中心からノズル先端まで

  constructor(pumpStart: THREE.Vector3) {
    this.pumpStart = pumpStart.clone();
    this.group = new THREE.Group();

    const railY = 0.12;
    const gauge = DIM.railGauge;

    // ---- レール（地面固定・コンクリート基礎帯上） ----
    const railMat = steel(0x777d84, 0.42, 0.75);
    const footMat = new THREE.MeshStandardMaterial({ color: 0xa5a099, roughness: 0.95 });
    for (const sx of [-1, 1]) {
      const x = sx * gauge / 2;
      const foundation = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.14, DIM.railLen + 0.6), footMat);
      foundation.position.set(x, 0.07, 0);
      foundation.receiveShadow = true;
      foundation.castShadow = true;
      this.group.add(foundation);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, DIM.railLen), railMat);
      rail.position.set(x, railY + 0.05, 0);
      rail.castShadow = true;
      this.group.add(rail);
      // レール固定ボルト
      const boltMat = steel(0x4c5158, 0.5, 0.7);
      const boltGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.03, 6);
      const bolts = new THREE.InstancedMesh(boltGeo, boltMat, 24);
      const d = new THREE.Object3D();
      for (let i = 0; i < 24; i++) {
        const z = -DIM.railLen / 2 + 0.35 + (i % 12) * (DIM.railLen - 0.7) / 11;
        d.position.set(x + (i < 12 ? 0.1 : -0.1), railY + 0.02, z);
        d.updateMatrix();
        bolts.setMatrixAt(i, d.matrix);
      }
      this.group.add(bolts);
      // レール端の車止め
      for (const ez of [-DIM.railLen / 2, DIM.railLen / 2]) {
        const stopBlock = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.22, 0.12), steel(0xc9a227, 0.6, 0.4));
        stopBlock.position.set(x, railY + 0.16, ez);
        stopBlock.castShadow = true;
        this.group.add(stopBlock);
      }
    }

    // ---- 門型フレーム（Z走行） ----
    this.portal = new THREE.Group();
    this.group.add(this.portal);

    const colH = 3.7;
    const frameMat = steel(COLORS.steelBlue, 0.56, 0.55);
    const lightMat = steel(COLORS.steelLight, 0.5, 0.6);
    const hazTex = hazardTexture();

    for (const sx of [-1, 1]) {
      const x = sx * gauge / 2;
      // 走行ボギー（台車）
      const bogie = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.3, 1.7), frameMat);
      bogie.position.set(x, railY + 0.28, 0);
      bogie.castShadow = true;
      this.portal.add(bogie);
      // 車輪（レールに載る）
      for (const wz of [-0.62, 0.62]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.09, 16), steel(0x3a3f45, 0.4, 0.8));
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, railY + 0.12, wz);
        wheel.castShadow = true;
        this.portal.add(wheel);
        this.wheels.push(wheel);
      }
      // 走行モーター（片側）
      if (sx === 1) {
        const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.26, 10), steel(0x8a4a20, 0.55, 0.5));
        motor.rotation.z = Math.PI / 2;
        motor.position.set(x - 0.34, railY + 0.32, 0.62);
        motor.castShadow = true;
        this.portal.add(motor);
      }
      // 柱（ラチス構造: 2本の弦材 + 斜材）
      const chordGeo = new THREE.BoxGeometry(0.12, colH, 0.12);
      for (const cz of [-0.28, 0.28]) {
        const chord = new THREE.Mesh(chordGeo, frameMat);
        chord.position.set(x, railY + 0.43 + colH / 2, cz);
        chord.castShadow = true;
        this.portal.add(chord);
      }
      // 柱の斜材・水平材
      const nBay = 7;
      const diagGeo = new THREE.BoxGeometry(0.05, 0.72, 0.05);
      const diag = new THREE.InstancedMesh(diagGeo, lightMat, nBay * 2);
      const dd = new THREE.Object3D();
      for (let i = 0; i < nBay; i++) {
        const y0 = railY + 0.6 + i * (colH - 0.4) / nBay;
        dd.position.set(x, y0 + 0.24, 0);
        dd.rotation.set(((i % 2) ? 1 : -1) * 0.86, 0, 0);
        dd.updateMatrix();
        diag.setMatrixAt(i, dd.matrix);
        dd.rotation.set(Math.PI / 2, 0, 0);
        dd.position.set(x, y0, 0);
        dd.updateMatrix();
        diag.setMatrixAt(nBay + i, dd.matrix);
      }
      diag.castShadow = true;
      this.portal.add(diag);
      // 柱脚の警告縞
      const hazBand = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.75, 0.72),
        new THREE.MeshStandardMaterial({ map: hazTex, roughness: 0.7 }),
      );
      hazBand.position.set(x, railY + 0.85, 0);
      this.portal.add(hazBand);
      // 汚れ（縦だれ・非対称）
      const gr = new THREE.Mesh(
        new THREE.PlaneGeometry(0.5, 2.4),
        new THREE.MeshStandardMaterial({
          color: 0x2f2a24, transparent: true, opacity: sx === 1 ? 0.42 : 0.28,
          alphaMap: grimeTexture(sx === 1 ? 11 : 12), roughness: 1, depthWrite: false,
        }),
      );
      gr.position.set(x + (sx === 1 ? -0.17 : 0.17), railY + 1.8, 0);
      gr.rotation.y = sx === 1 ? -Math.PI / 2 : Math.PI / 2;
      this.portal.add(gr);
      // 制御盤（片側柱に）
      if (sx === -1) {
        const cab = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.5, 0.42), steel(0xd8d5cc, 0.5, 0.3));
        cab.position.set(x + 0.28, railY + 1.35, 0);
        cab.castShadow = true;
        this.portal.add(cab);
        const estop = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 10), new THREE.MeshStandardMaterial({ color: 0xb02020, roughness: 0.5 }));
        estop.rotation.x = Math.PI / 2;
        estop.position.set(x + 0.28, railY + 1.5, 0.23);
        this.portal.add(estop);
      }
    }

    // ---- 梁アセンブリ（Y昇降）: トラス梁 + キャリッジレール ----
    this.beamAsm = new THREE.Group();
    this.portal.add(this.beamAsm);

    const beamLen = gauge + 0.7;
    const chordGeoH = new THREE.BoxGeometry(beamLen, 0.1, 0.1);
    for (const [oy, oz] of [[DIM.beamH / 2, -0.22], [DIM.beamH / 2, 0.22], [-DIM.beamH / 2, -0.22], [-DIM.beamH / 2, 0.22]] as [number, number][]) {
      const chord = new THREE.Mesh(chordGeoH, frameMat);
      chord.position.set(0, oy, oz);
      chord.castShadow = true;
      this.beamAsm.add(chord);
    }
    // 梁の斜材
    const nDiag = 16;
    const bDiagGeo = new THREE.BoxGeometry(0.045, DIM.beamH * 1.18, 0.045);
    for (const oz of [-0.22, 0.22]) {
      const dm = new THREE.InstancedMesh(bDiagGeo, lightMat, nDiag);
      const d = new THREE.Object3D();
      for (let i = 0; i < nDiag; i++) {
        d.position.set(-beamLen / 2 + 0.4 + i * (beamLen - 0.8) / (nDiag - 1), 0, oz);
        d.rotation.set(0, 0, (i % 2 ? 1 : -1) * 0.72);
        d.updateMatrix();
        dm.setMatrixAt(i, d.matrix);
      }
      dm.castShadow = true;
      this.beamAsm.add(dm);
    }
    // ボルト接合プレート（梁端）
    for (const sx of [-1, 1]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.16, DIM.beamH + 0.22, 0.6), frameMat);
      plate.position.set(sx * (gauge / 2), 0, 0);
      plate.castShadow = true;
      this.beamAsm.add(plate);
      const boltGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.04, 6);
      const bolts = new THREE.InstancedMesh(boltGeo, steel(0x3c4148, 0.45, 0.7), 8);
      const d = new THREE.Object3D();
      for (let i = 0; i < 8; i++) {
        d.position.set(sx * (gauge / 2 - 0.09), -DIM.beamH / 2 + 0.1 + (i % 4) * (DIM.beamH - 0.2) / 3, (i < 4 ? -0.2 : 0.2));
        d.rotation.z = Math.PI / 2;
        d.updateMatrix();
        bolts.setMatrixAt(i, d.matrix);
      }
      this.beamAsm.add(bolts);
    }
    // キャリッジ用レール（梁下面の2本）
    for (const oz of [-0.16, 0.16]) {
      const crail = new THREE.Mesh(new THREE.BoxGeometry(beamLen - 0.5, 0.05, 0.05), railMat);
      crail.position.set(0, -DIM.beamH / 2 - 0.05, oz);
      this.beamAsm.add(crail);
    }
    // ケーブルキャリアのトレイ（梁上面）
    const tray = new THREE.Mesh(new THREE.BoxGeometry(beamLen - 0.6, 0.03, 0.24), lightMat);
    tray.position.set(0, DIM.beamH / 2 + 0.08, 0.3);
    this.beamAsm.add(tray);

    // ---- キャリッジ（X走行） ----
    this.carriage = new THREE.Group();
    this.beamAsm.add(this.carriage);
    const carBody = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.42, 0.66), steel(0xcfd3d6, 0.5, 0.5));
    carBody.position.y = -DIM.beamH / 2 - 0.12;
    carBody.castShadow = true;
    this.carriage.add(carBody);
    // キャリッジ走行モーター
    const carMotor = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.2, 10), steel(0x8a4a20, 0.55, 0.5));
    carMotor.position.set(0.36, -DIM.beamH / 2 - 0.02, 0.2);
    carMotor.rotation.x = Math.PI / 2;
    this.carriage.add(carMotor);

    // ---- プリントヘッド ----
    this.headAsm = new THREE.Group();
    this.carriage.add(this.headAsm);
    const headMat = steel(0xe0dcd2, 0.55, 0.35);
    // 垂直マウント
    const mount = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.16), frameMat);
    mount.position.y = -DIM.beamH / 2 - 0.5;
    mount.castShadow = true;
    this.headAsm.add(mount);
    // 材料ホッパー（小型）
    const hopper = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.1, 0.24, 12), headMat);
    hopper.position.y = -DIM.beamH / 2 - 0.62;
    hopper.castShadow = true;
    this.headAsm.add(hopper);
    // 押出モーター（上面）
    this.auger = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.16, 10), steel(0x9a5a28, 0.5, 0.5));
    this.auger.position.y = -DIM.beamH / 2 - 0.46;
    this.auger.position.x = 0.13;
    this.headAsm.add(this.auger);
    // ノズル（円錐 + 丸口）
    const nozzleBody = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.045, 0.14, 12), steel(0x6a6f76, 0.4, 0.7));
    nozzleBody.position.y = -DIM.beamH / 2 - 0.8;
    nozzleBody.castShadow = true;
    this.headAsm.add(nozzleBody);
    this.nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.038, 0.07, 12), steel(0x4c5157, 0.35, 0.75));
    this.nozzle.position.y = -DIM.beamH / 2 - 0.895;
    this.nozzle.castShadow = true;
    this.headAsm.add(this.nozzle);
    // ノズル口のセメント汚れ
    const crust = new THREE.Mesh(
      new THREE.CylinderGeometry(0.052, 0.047, 0.035, 12),
      new THREE.MeshStandardMaterial({ color: 0x7d7a72, roughness: 1 }),
    );
    crust.position.y = -DIM.beamH / 2 - 0.9;
    this.headAsm.add(crust);

    // headHang: 梁中心からノズル先端まで
    this.headHang = DIM.beamH / 2 + 0.93;

    // ---- ケーブルキャリア（エネルギーチェーン） ----
    const linkGeo = new THREE.BoxGeometry(0.1, 0.055, 0.2);
    const linkMat = steel(0x2e3338, 0.7, 0.3);
    this.chain = new THREE.InstancedMesh(linkGeo, linkMat, 52);
    this.chain.castShadow = true;
    this.chain.frustumCulled = false;
    this.beamAsm.add(this.chain);

    // ---- ホース ----
    const hoseMat = new THREE.MeshStandardMaterial({ color: 0x3d4046, roughness: 0.82, metalness: 0.05 });
    this.hoseGround = new HoseTube(30, 0.05, hoseMat);
    this.group.add(this.hoseGround.mesh);
    this.hoseColumn = new HoseTube(10, 0.05, hoseMat);
    this.group.add(this.hoseColumn.mesh);
    this.hoseDrop = new HoseTube(14, 0.045, hoseMat);
    this.group.add(this.hoseDrop.mesh);

    this.applyPose();
  }

  /** ノズル先端のY */
  get nozzleTipY(): number {
    return this.beamY - this.headHang;
  }

  private applyPose(): void {
    this.portal.position.z = this.posZ;
    this.beamAsm.position.y = this.beamY;
    this.carriage.position.x = this.posX;
  }

  /**
   * 軸をターゲットへ追従させる。
   * head があれば印刷追従（正確に一致）、なければ待機位置へ滑らかに移動。
   * 返り値: ノズル先端ワールド位置
   */
  update(dt: number, head: HeadState | null, park: { x: number; z: number } | null, realDt: number): THREE.Vector3 {
    let targetX: number, targetZ: number, targetTipY: number;
    if (head) {
      targetX = head.x;
      targetZ = head.z;
      targetTipY = head.y + head.lifted * 0.0; // head.y に lift 込み
      this.posX = targetX;
      this.posZ = targetZ;
      this.beamY = targetTipY + this.headHang;
    } else if (park) {
      // 待機/ homing: 有限速度で移動（トラベル速度は印刷より速い）
      const vLim = 1.3 * dt;
      const dx = clamp(park.x - this.posX, -vLim, vLim);
      const dz = clamp(park.z - this.posZ, -vLim, vLim);
      this.posX += dx;
      this.posZ += dz;
      const wantBeam = DIM.slabTop + DIM.layerH + 0.005 + this.headHang;
      this.beamY += clamp(wantBeam - this.beamY, -0.5 * dt, 0.5 * dt);
    }

    // 車輪回転（Z移動量に応じて）
    const dz = this.posZ - this.lastZ;
    this.lastZ = this.posZ;
    for (const w of this.wheels) w.rotation.x += dz / 0.14;

    // 押出オーガの回転
    if (head && head.flow > 0.01) this.auger.rotation.y += head.flow * realDt * 14;

    // ヘッドのスウェイ（ホースの遅れ表現に使用）
    const ax = (this.posX - this.prevHeadX) / Math.max(realDt, 1e-3);
    const az = (this.posZ - this.prevHeadZ) / Math.max(realDt, 1e-3);
    this.prevHeadX = this.posX;
    this.prevHeadZ = this.posZ;
    const k = 26, c = 7;
    this.swayVX += (-k * this.swayX - c * this.swayVX - ax * 0.10) * realDt;
    this.swayVZ += (-k * this.swayZ - c * this.swayVZ - az * 0.10) * realDt;
    this.swayX = clamp(this.swayX + this.swayVX * realDt, -0.22, 0.22);
    this.swayZ = clamp(this.swayZ + this.swayVZ * realDt, -0.22, 0.22);

    this.applyPose();
    this.updateChain();
    this.updateHoses();

    return new THREE.Vector3(this.posX, this.nozzleTipY, this.posZ);
  }

  private updateChain(): void {
    // 梁ローカル座標。エネルギーチェーンは全長一定:
    //   下段(トレイ上): xF→xB / 180°折返し(半径r) / 上段: xB→xC(キャリッジ)
    //   L = (xB - xF) + πr + (xB - xC)  →  xB = (L - πr + xF + xC) / 2
    const y0 = DIM.beamH / 2 + 0.12;
    const r = 0.09;
    const xF = -DIM.railGauge / 2 + 0.55;
    const L = 5.1;
    const xC = clamp(this.posX, xF + 0.3, DIM.railGauge / 2 - 0.4);
    const xB = (L - Math.PI * r + xF + xC) / 2;
    const lower = Math.max(0.05, xB - xF);
    const upper = Math.max(0.05, xB - xC);
    const arcLen = Math.PI * r;
    const total = lower + arcLen + upper;
    const n = this.chain.count;
    const d = this.chainDummy;
    for (let i = 0; i < n; i++) {
      const s = (i / (n - 1)) * total;
      if (s < lower) {
        d.position.set(xF + s, y0, 0.3);
        d.rotation.set(0, 0, 0);
      } else if (s < lower + arcLen) {
        const a = (s - lower) / r; // 0..PI
        d.position.set(xB + Math.sin(a) * r, y0 + r - Math.cos(a) * r, 0.3);
        d.rotation.set(0, 0, -a);
      } else {
        const s2 = s - lower - arcLen;
        d.position.set(xB - s2, y0 + 2 * r, 0.3);
        d.rotation.set(0, 0, Math.PI);
      }
      d.updateMatrix();
      this.chain.setMatrixAt(i, d.matrix);
    }
    this.chain.instanceMatrix.needsUpdate = true;
  }

  private hoseCtrlGround: THREE.Vector3[] = [
    new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(),
  ];
  private hoseCtrlCol: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private hoseCtrlDrop: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

  private updateHoses(): void {
    const gauge = DIM.railGauge;
    // 地面区間: ポンプ → 左柱の脚元（門型はZに動く）
    const colBase = new THREE.Vector3(-gauge / 2 + 0.35, 0.16, this.posZ + 0.55);
    const c = this.hoseCtrlGround;
    c[0].copy(this.pumpStart);
    c[1].set(this.pumpStart.x + 0.7, 0.06, this.pumpStart.z + 0.7);
    // 中間はたるみ（地面を這う）
    c[2].set((this.pumpStart.x + colBase.x) / 2 - 0.5, 0.05, (this.pumpStart.z + colBase.z) / 2 + 0.6);
    c[3].set(colBase.x - 0.3, 0.05, colBase.z - 0.3);
    c[4].copy(colBase);
    this.hoseGround.update(c);

    // 柱区間: 脚元 → 梁上トレイ固定端（クリップ留め、梁高さに追従）
    const trayEnd = new THREE.Vector3(-gauge / 2 + 0.55, this.beamY + DIM.beamH / 2 + 0.16, this.posZ + 0.3);
    const cc = this.hoseCtrlCol;
    cc[0].copy(colBase);
    cc[1].set(colBase.x + 0.1, colBase.y + (trayEnd.y - colBase.y) * 0.4, this.posZ + 0.45);
    cc[2].set(trayEnd.x - 0.05, trayEnd.y - 0.25, this.posZ + 0.38);
    cc[3].copy(trayEnd);
    this.hoseColumn.update(cc);

    // ドロップ区間: キャリッジ上 → ヘッドホッパー（加速の遅れでスウェイ）
    const carTop = new THREE.Vector3(this.posX, this.beamY + DIM.beamH / 2 + 0.3, this.posZ + 0.3);
    const hopperIn = new THREE.Vector3(this.posX, this.beamY - DIM.beamH / 2 - 0.5, this.posZ);
    const cd = this.hoseCtrlDrop;
    cd[0].copy(carTop);
    cd[1].set(this.posX + 0.3 + this.swayX * 0.5, carTop.y - 0.06, this.posZ + 0.56);
    cd[2].set(this.posX + 0.46 + this.swayX, (carTop.y + hopperIn.y) / 2, this.posZ + 0.6 + this.swayZ);
    cd[3].set(this.posX + 0.24 + this.swayX * 0.7, hopperIn.y + 0.24, this.posZ + 0.3 + this.swayZ * 0.5);
    cd[4].copy(hopperIn);
    this.hoseDrop.update(cd);
  }
}
