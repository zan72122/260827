// カメラ演出。フェーズごとに目標(位置/注視点/fov)を計算し、
// 臨界減衰で滑らかに追従する。縦画面と横画面は別フレーミング:
//  - 縦: 手前から奥へ続く壁と高さの成長を強調（低め・近め・広角）
//  - 横: ガントリー全幅と曲線壁を同時に見せる（引き・標準画角）

import * as THREE from 'three';
import { DIM } from '../config';
import { HeadState } from '../print/printJob';
import { WallPath } from '../path/process';
import { clamp, lerp } from '../util/math2d';

export type GamePhase = 'draw' | 'homing' | 'printing' | 'finishing' | 'reveal' | 'compare';

interface CamGoal {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
  stiffness: number; // 追従の速さ
}

export class CameraDirector {
  camera: THREE.PerspectiveCamera;
  private goal: CamGoal = {
    pos: new THREE.Vector3(0, 8, 11),
    look: new THREE.Vector3(0, 0, 0),
    fov: 44,
    stiffness: 2.2,
  };
  private curLook = new THREE.Vector3(0, 0, 0);
  private portrait = false;
  private orbitT = 0;
  private wallTopY = DIM.slabTop;
  private pathCenter = new THREE.Vector3(0, 0, 0);
  private pathRadius = 1.6;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(44, aspect, 0.1, 220);
    this.camera.position.copy(this.goal.pos);
    this.camera.lookAt(this.curLook);
  }

  setViewport(w: number, h: number): void {
    this.portrait = h > w;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setPath(path: WallPath | null): void {
    if (!path) return;
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const p of path.samples) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    this.pathCenter.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    this.pathRadius = Math.max(0.9, Math.hypot(maxX - minX, maxZ - minZ) / 2);
  }

  snap(): void {
    this.camera.position.copy(this.goal.pos);
    this.curLook.copy(this.goal.look);
    this.camera.fov = this.goal.fov;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.curLook);
  }

  update(dt: number, phase: GamePhase, head: HeadState | null, gantryPos: { x: number; z: number }): void {
    const g = this.goal;
    const P = this.portrait;

    switch (phase) {
      case 'draw': {
        // 高めの斜め俯瞰。近景スラブ / 中景ガントリー / 遠景資材設備。
        // 画面の左右とスラブの左右を一致させる（正面から、ロールなし）
        if (P) {
          g.pos.set(0, 8.6, 8.9);
          g.look.set(0, -0.4, -1.1);
          g.fov = 50;
        } else {
          g.pos.set(0, 6.9, 9.4);
          g.look.set(0, 0.1, -0.9);
          g.fov = 44;
        }
        g.stiffness = 2.0;
        break;
      }
      case 'homing': {
        // 機械が動き出す: 少し寄って、ヘッドの移動を追う
        const hx = gantryPos.x, hz = gantryPos.z;
        if (P) {
          g.pos.set(hx * 0.4, 3.4, hz + 4.6);
          g.look.set(hx, 0.9, hz);
          g.fov = 54;
        } else {
          g.pos.set(hx * 0.3 - 1.6, 2.8, hz + 5.2);
          g.look.set(hx, 1.1, hz);
          g.fov = 46;
        }
        g.stiffness = 1.6;
        break;
      }
      case 'printing': {
        if (!head) break;
        const layerY = DIM.slabTop + head.layer * DIM.layerH;
        this.wallTopY = layerY;
        // カメラ追従遅れの先読み補償（低フレームレート時もヘッドを画面内に）
        const la = Math.min(0.9, head.v * 0.45);
        const hx = head.x + head.tx * la;
        const hz = head.z + head.tz * la;
        if (head.phase === 'first') {
          // 低い接写: ほぼ真横から。ノズルを画面の進行方向側に置き、
          // 押出直後の湿ったビードが横へ流れていくのを見せる
          const side = P ? 0.88 : 1.15;
          const ahead = 0.3, hgt = P ? 0.42 : 0.4;
          const bx = head.tz * side + head.tx * ahead;
          const bz = -head.tx * side + head.tz * ahead;
          g.pos.set(hx + bx, layerY + hgt, hz + bz);
          g.look.set(hx - head.tx * 0.42, layerY - 0.01, hz - head.tz * 0.42);
          g.fov = P ? 54 : 47;
          g.stiffness = 4.2;
        } else if (head.phase === 'early') {
          // 中距離: 追従して積層を理解させる
          const back = 2.2, side = 1.4, hgt = 1.1;
          const bx = -head.tx * back + head.tz * side;
          const bz = -head.tz * back - head.tx * side;
          if (P) {
            g.pos.set(hx + bx * 0.85, layerY + hgt * 0.85, hz + bz * 0.85);
            g.look.set(hx, layerY - 0.05, hz);
            g.fov = 56;
          } else {
            g.pos.set(hx + bx, layerY + hgt, hz + bz);
            g.look.set(hx, layerY - 0.02, hz);
            g.fov = 46;
          }
          g.stiffness = 2.4;
        } else {
          // タイムラプス: 壁の側面が下から上へ育つ中距離。ゆっくり周回
          this.orbitT += dt * 0.05;
          const c = this.pathCenter;
          const r = this.pathRadius;
          const a = 0.6 + this.orbitT;
          if (P) {
            const dist = r + 2.8;
            g.pos.set(c.x + Math.sin(a) * dist, Math.max(1.3, this.wallTopY + 0.75), c.z + Math.cos(a) * dist * 1.15);
            g.look.set(c.x, Math.max(0.55, this.wallTopY - 0.35), c.z);
            g.fov = 54;
          } else {
            const dist = r + 3.6;
            g.pos.set(c.x + Math.sin(a) * dist, Math.max(1.5, this.wallTopY + 0.9), c.z + Math.cos(a) * dist);
            g.look.set(c.x, Math.max(0.5, this.wallTopY - 0.4), c.z);
            g.fov = 47;
          }
          g.stiffness = 1.4;
        }
        break;
      }
      case 'finishing': {
        // 作業員の確認とクレーンが見える引き画
        const c = this.pathCenter;
        if (P) {
          g.pos.set(c.x + 3.4, 3.1, c.z + 6.6);
          g.look.set(c.x + 0.6, this.wallTopY * 0.55, c.z - 0.4);
          g.fov = 56;
        } else {
          g.pos.set(c.x + 4.6, 2.9, c.z + 7.2);
          g.look.set(c.x + 0.4, this.wallTopY * 0.5, c.z);
          g.fov = 46;
        }
        g.stiffness = 1.2;
        break;
      }
      case 'reveal': {
        // 引いて全景: 一筆が実寸の壁になったことを見せる
        const c = this.pathCenter;
        if (P) {
          g.pos.set(c.x + 2.6, 5.4, c.z + 10.6);
          g.look.set(c.x, 1.0, c.z - 0.6);
          g.fov = 55;
        } else {
          g.pos.set(c.x + 3.8, 4.6, c.z + 11.6);
          g.look.set(c.x, 1.0, c.z);
          g.fov = 46;
        }
        g.stiffness = 0.9;
        break;
      }
      case 'compare': {
        // 上空から: 最初の一筆と完成平面形状の比較
        const c = this.pathCenter;
        const h = (P ? 3.6 : 3.0) * this.pathRadius + 4.2;
        g.pos.set(c.x, h, c.z + 0.22);
        g.look.set(c.x, 0.2, c.z);
        g.fov = P ? 50 : 44;
        g.stiffness = 1.1;
        break;
      }
    }

    // 臨界減衰風の追従
    const k = 1 - Math.exp(-g.stiffness * dt);
    this.camera.position.lerp(g.pos, k);
    this.curLook.lerp(g.look, k);
    this.camera.fov = lerp(this.camera.fov, g.fov, k);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.curLook);
  }
}
