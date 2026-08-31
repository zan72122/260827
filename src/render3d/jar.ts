import * as THREE from 'three';
import { DIM } from '../sim/geometry';
import { BATHS, type BathDef } from '../sim/protocol';
import { REAGENTS } from '../sim/reagents';
import { canvasTexture, liquidMaterial, type MaterialSet } from './materials';

/** 染色槽 1 個ぶんの 3D 表現。 */
export class JarObject {
  group = new THREE.Group();
  def: BathDef;
  liquid: THREE.Mesh;
  private liquidTopY: number;
  private slosh = new THREE.Vector2();
  private sloshV = new THREE.Vector2();
  labelMesh: THREE.Mesh;
  /** 液面の高さ（作業台からの mm）。 */
  readonly surfaceY: number;

  constructor(def: BathDef, mats: MaterialSet) {
    this.def = def;
    const { w, d, wall } = DIM.jar;
    const bodyH = DIM.jar.hWithLid - DIM.jar.lid;

    // --- ガラス槽（底 + 4 面）。壁に厚みを持たせ、縁は薄く見せる。
    const glassGroup = new THREE.Group();
    const mk = (gw: number, gh: number, gd: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(gw, gh, gd), mats.glass);
      m.position.set(x, y, z);
      m.castShadow = false;
      m.receiveShadow = false;
      return m;
    };
    glassGroup.add(mk(w, wall, d, 0, wall / 2, 0));
    glassGroup.add(mk(wall, bodyH, d, -(w - wall) / 2, bodyH / 2, 0));
    glassGroup.add(mk(wall, bodyH, d, (w - wall) / 2, bodyH / 2, 0));
    glassGroup.add(mk(w - wall * 2, bodyH, wall, 0, bodyH / 2, -(d - wall) / 2));
    glassGroup.add(mk(w - wall * 2, bodyH, wall, 0, bodyH / 2, (d - wall) / 2));
    this.group.add(glassGroup);

    // --- 液体
    const rp = REAGENTS[def.kind];
    this.liquidTopY = DIM.liquidDepth;
    this.surfaceY = DIM.liquidDepth;
    const iw = w - wall * 2 - 0.6;
    const idp = d - wall * 2 - 0.6;
    this.liquid = new THREE.Mesh(new THREE.BoxGeometry(iw, DIM.liquidDepth - wall, idp), liquidMaterial(rp.tint, rp.absorb));
    this.liquid.position.set(0, wall + (DIM.liquidDepth - wall) / 2, 0);
    this.liquid.renderOrder = 2;
    this.group.add(this.liquid);

    // --- 液面（メニスカス）: 縁がわずかに立ち上がる薄い枠
    const surfaceMat = new THREE.MeshPhysicalMaterial({
      color: rp.tint ? new THREE.Color(rp.tint[0], rp.tint[1], rp.tint[2]).convertSRGBToLinear() : 0xeef3f5,
      transparent: true,
      opacity: rp.tint ? 0.9 : 0.30,
      roughness: 0.02,
      metalness: 0,
      envMapIntensity: 1.6,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const men = new THREE.Mesh(new THREE.BoxGeometry(iw, 0.8, idp), surfaceMat);
    men.renderOrder = 3;
    this.liquid.add(men);
    men.position.y = DIM.liquidDepth - this.liquid.position.y;

    // メニスカス: 壁際でわずかに立ち上がる縁。無色の液でも液面の位置が読めるようにする。
    const rimMat = new THREE.MeshPhysicalMaterial({
      color: rp.tint ? new THREE.Color(rp.tint[0], rp.tint[1], rp.tint[2]).convertSRGBToLinear() : 0xffffff,
      transparent: true,
      opacity: rp.tint ? 0.95 : 0.62,
      roughness: 0.01,
      metalness: 0,
      envMapIntensity: 2.2,
      depthWrite: false,
    });
    const rimT = 1.6;
    for (const [rw, rd, rx, rz] of [
      [iw, rimT, 0, -(idp - rimT) / 2],
      [iw, rimT, 0, (idp - rimT) / 2],
      [rimT, idp, -(iw - rimT) / 2, 0],
      [rimT, idp, (iw - rimT) / 2, 0],
    ] as const) {
      const r2 = new THREE.Mesh(new THREE.BoxGeometry(rw, 2.4, rd), rimMat);
      r2.position.set(rx, DIM.liquidDepth - this.liquid.position.y + 0.4, rz);
      r2.renderOrder = 4;
      this.liquid.add(r2);
    }

    // --- ラベル（白い紙。無色試薬はこれと位置で見分ける）
    const tex = canvasTexture(512, 220, (ctx) => {
      ctx.fillStyle = '#fbfbf8';
      ctx.fillRect(0, 0, 512, 220);
      ctx.fillStyle = '#e9e9e4';
      ctx.fillRect(0, 0, 512, 8);
      ctx.fillStyle = '#16181a';
      ctx.textBaseline = 'top';
      // 長い名前は字を小さくして 2 行に収める
      let size = 54;
      ctx.font = `bold ${size}px system-ui, sans-serif`;
      while (size > 30 && ctx.measureText(def.labelJa).width > 476 * 2) {
        size -= 4;
        ctx.font = `bold ${size}px system-ui, sans-serif`;
      }
      wrapText(ctx, def.labelJa, 18, 24, 476, size + 6);
      ctx.fillStyle = '#5a6066';
      let esize = 34;
      ctx.font = `${esize}px system-ui, sans-serif`;
      while (esize > 20 && ctx.measureText(def.labelEn).width > 476) {
        esize -= 2;
        ctx.font = `${esize}px system-ui, sans-serif`;
      }
      ctx.fillText(def.labelEn, 18, 158);
      ctx.strokeStyle = '#c9ccc7';
      ctx.lineWidth = 3;
      ctx.strokeRect(1.5, 1.5, 509, 217);
    });
    const labelMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.84, metalness: 0 });
    this.labelMesh = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.74, w * 0.74 * (220 / 512)), labelMat);
    this.labelMesh.position.set(0, 18, d / 2 + 0.4);
    this.group.add(this.labelMesh);

    // --- 蓋（横に置いてある）
    const lid = new THREE.Mesh(new THREE.BoxGeometry(w * 0.96, DIM.jar.lid, d * 0.96), mats.glass);
    lid.position.set(0, DIM.jar.lid / 2, -d * 0.92);
    lid.rotation.y = 0.04;
    this.group.add(lid);
  }

  /** 器具の動きに応じた控えめな揺れ。体積と位置は変えない。 */
  nudge(vx: number, vz: number): void {
    this.sloshV.x += vx * 0.02;
    this.sloshV.y += vz * 0.02;
  }

  update(dt: number): void {
    const k = 26;
    const c = 4.2;
    this.sloshV.x += (-k * this.slosh.x - c * this.sloshV.x) * dt;
    this.sloshV.y += (-k * this.slosh.y - c * this.sloshV.y) * dt;
    this.slosh.x += this.sloshV.x * dt;
    this.slosh.y += this.sloshV.y * dt;
    this.liquid.rotation.z = THREE.MathUtils.clamp(this.slosh.x, -0.02, 0.02);
    this.liquid.rotation.x = THREE.MathUtils.clamp(-this.slosh.y, -0.02, 0.02);
  }

  get topOfLiquidY(): number {
    return this.liquidTopY;
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
  }
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number): void {
  let line = '';
  let yy = y;
  for (const ch of text) {
    const t = line + ch;
    if (ctx.measureText(t).width > maxW && line) {
      ctx.fillText(line, x, yy);
      line = ch;
      yy += lh;
    } else line = t;
  }
  if (line) ctx.fillText(line, x, yy);
}

/** ステーション内での槽の並び（縦画面でも 2 列に収まるよう 2 列 x N 行）。 */
export function jarLayout(station: string): { id: string; x: number; z: number }[] {
  const list = BATHS.filter((b) => b.station === station).sort((a, b) => a.slot - b.slot);
  const pitchX = DIM.jar.w + 14;
  const pitchZ = DIM.jar.d + 22;
  const cols = Math.min(2, list.length);
  const rows = Math.ceil(list.length / cols);
  return list.map((b, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const colsInRow = Math.min(cols, list.length - r * cols);
    return {
      id: b.id,
      x: (c - (colsInRow - 1) / 2) * pitchX,
      // 手前の行から順番に並べる（第1槽が手前）
      z: ((rows - 1) / 2 - r) * pitchZ,
    };
  });
}
