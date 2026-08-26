// ゲーム状態機械:
// draw(一筆) → homing(機械が開始点へ) → printing(第1層実時間→積層)
// → finishing(作業員の安全確認・屋根クレーン設置) → reveal(全景)
// → compare(上空比較 + もう一回)

import * as THREE from 'three';
import { DIM } from './config';
import { processStroke, RawSample, WallPath } from './path/process';
import { BeadBuilder } from './geometry/bead';
import { makeConcreteMaterial } from './materials/concrete';
import { PrintJob } from './print/printJob';
import { buildSite, SiteRefs } from './scene/site';
import { Gantry } from './scene/gantry';
import { Worker } from './scene/people';
import { Crane } from './scene/crane';
import { CameraDirector, GamePhase } from './camera/director';
import { StrokeInput } from './input/stroke';
import { Overlay } from './ui/overlay';

export class Game {
  scene: THREE.Scene;
  director: CameraDirector;
  site: SiteRefs;
  gantry: Gantry;
  stroke: StrokeInput;
  overlay: Overlay;
  private crane: Crane;
  private workerIdle: Worker;
  private workerInspector: Worker;
  private concrete = makeConcreteMaterial();
  private builder: BeadBuilder;
  private startMarker: THREE.Group;

  phase: GamePhase = 'draw';
  private path: WallPath | null = null;
  private rawStroke: RawSample[] = [];
  private job: PrintJob | null = null;
  private phaseT = 0;
  private extTimeScale = 1;
  private inspectorState = 0; // 0待機 1歩行中 2点検中 3戻り中 4完了
  private craneStarted = false;
  private sunBaseAz = Math.atan2(7, -9);

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene();
    this.director = new CameraDirector(canvas.clientWidth / Math.max(1, canvas.clientHeight));
    this.site = buildSite(this.scene);
    this.gantry = new Gantry(this.site.pumpHoseStart);
    this.scene.add(this.gantry.group);

    this.builder = new BeadBuilder(this.concrete.mat);
    this.scene.add(this.builder.group);

    this.crane = new Crane();
    this.scene.add(this.crane.group);

    this.workerIdle = new Worker(0.6);
    this.workerIdle.setPosition(-3.0, -3.6);
    this.scene.add(this.workerIdle.group);
    this.workerInspector = new Worker(-2.6);
    this.workerInspector.setPosition(0.6, 5.6);
    this.scene.add(this.workerInspector.group);

    this.stroke = new StrokeInput(canvas, this.director.camera);
    this.scene.add(this.stroke.group);

    this.overlay = new Overlay();
    this.overlay.onReplay = () => this.reset();

    // 開始点マーカー（機械的な床マーカー: 鋼板 + 白ペイント）
    this.startMarker = new THREE.Group();
    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.075, 0.012, 16),
      new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.5, metalness: 0.6 }),
    );
    plate.castShadow = true;
    this.startMarker.add(plate);
    const paintMat = new THREE.MeshBasicMaterial({ color: 0xf2efe4 });
    for (const rot of [0, Math.PI / 2]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.004, 0.018), paintMat);
      bar.position.y = 0.008;
      bar.rotation.y = rot;
      this.startMarker.add(bar);
    }
    this.startMarker.position.set(-0.9, DIM.slabTop + 0.007, 0.9);
    this.scene.add(this.startMarker);

    this.stroke.onStart = () => this.overlay.cancelHint();
    this.stroke.onComplete = (samples) => this.handleStroke(samples);

    this.enterDraw(true);
  }

  private enterDraw(first: boolean): void {
    this.phase = 'draw';
    this.phaseT = 0;
    this.stroke.enabled = true;
    this.startMarker.visible = true;
    this.overlay.armHint(first ? 1000 : 1600);
    this.overlay.showReplay(false);
    this.overlay.hideCompareCard();
  }

  private handleStroke(samples: RawSample[]): void {
    const path = processStroke(samples);
    if (!path) {
      // 整形不能（短すぎ等）→ そのまま描き直し
      this.stroke.clearChalk();
      this.stroke.enabled = true;
      return;
    }
    this.rawStroke = samples;
    this.path = path;
    this.director.setPath(path);
    // 墨出し線（機械の経路）を表示し、開始マーカーを経路始点へ
    this.stroke.showInkLine(path.samples, path.closed);
    const s0 = path.samples[0];
    this.startMarker.position.set(s0.x, DIM.slabTop + 0.007, s0.z);
    this.phase = 'homing';
    this.phaseT = 0;
  }

  private startPrint(): void {
    if (!this.path) return;
    this.job = new PrintJob(this.path, this.builder);
    this.job.setExternalScale(this.extTimeScale);
    this.phase = 'printing';
    this.phaseT = 0;
  }

  private enterFinishing(): void {
    this.phase = 'finishing';
    this.phaseT = 0;
    this.inspectorState = 0;
    this.inspectT = 0;
    this.craneStarted = false;
    if (this.path?.closed) {
      this.crane.buildRoof(this.path, this.scene);
    }
  }

  private computeInspectRoute(): { x: number; z: number }[] {
    // ゲートから壁の近くへ、壁沿いに少し歩くルート（壁の外側）
    const p = this.path!;
    let cx = 0, cz = 0;
    for (const s of p.samples) { cx += s.x; cz += s.z; }
    cx /= p.samples.length; cz /= p.samples.length;
    const route: { x: number; z: number }[] = [{ x: 0.4, z: 4.6 }];
    const picks = [0.15, 0.3, 0.45];
    for (const f of picks) {
      const s = p.samples[Math.floor(f * (p.samples.length - 1))];
      const dx = s.x - cx, dz = s.z - cz;
      const dl = Math.hypot(dx, dz) || 1;
      route.push({ x: s.x + (dx / dl) * 0.9, z: s.z + (dz / dl) * 0.9 });
    }
    return route;
  }

  update(rawDt: number): void {
    // テスト高速化時は演出フェーズ（仕上げ・全景）も加速する
    const cinScale = (this.phase === 'finishing' || this.phase === 'reveal')
      ? Math.min(this.extTimeScale, 8) : 1;
    const dt = rawDt * Math.max(1, cinScale);
    this.phaseT += dt;
    const camPhase: GamePhase = this.phase;

    // 常時アニメーション（ミキサー・ポンプ・作業員）
    if (this.site.mixerDrum) this.site.mixerDrum.rotation.x += dt * (this.phase === 'printing' ? 2.4 : 0.5);
    if (this.site.pumpPulse && this.job && !this.job.isDone && this.phase === 'printing') {
      const s = 1 + Math.sin(this.phaseT * 9) * 0.03 * this.job.head.flow;
      this.site.pumpPulse.scale.set(s, 1, s);
    }
    this.workerIdle.update(dt, this.phaseT);
    this.workerInspector.update(dt, this.phaseT);

    // 印刷完了後も乾燥は進む（明るく・艶が落ちる）
    if (this.job?.isDone) this.concrete.uniforms.uNow.value += dt * 5;

    switch (this.phase) {
      case 'draw':
        this.gantry.update(dt, null, { x: -1.4, z: -3.4 }, dt);
        break;

      case 'homing': {
        if (!this.path) break;
        const s0 = this.path.samples[0];
        // 少し間を置いてから機械が動く（線→機械の因果を見せる）
        const park = this.phaseT < 0.8 ? null : { x: s0.x, z: s0.z };
        this.gantry.update(dt, null, park ?? { x: this.gantry.posX, z: this.gantry.posZ }, dt);
        const dx = Math.abs(this.gantry.posX - s0.x), dz = Math.abs(this.gantry.posZ - s0.z);
        if (this.phaseT > 1.2 && dx < 0.02 && dz < 0.02) this.startPrint();
        break;
      }

      case 'printing': {
        if (!this.job) break;
        const head = this.job.update(dt);
        this.gantry.update(dt, head, null, dt);
        this.concrete.uniforms.uNow.value = this.job.now;
        // タイムラプス中は太陽がゆっくり回る（時間経過の表現）
        if (head.phase === 'lapse') {
          const f = head.layer / head.layersTotal;
          const az = this.sunBaseAz + f * 0.5;
          const r = 16.6;
          this.site.sun.position.set(Math.cos(az) * -r * 0.7, 14 - f * 2.5, Math.sin(az) * r * 0.55);
        }
        if (this.job.isDone) this.enterFinishing();
        break;
      }

      case 'finishing': {
        this.gantry.update(dt, null, { x: -1.4, z: -3.6 }, dt);
        // 作業員の点検 → （閉曲線なら）クレーンで屋根設置
        if (this.inspectorState === 0 && this.phaseT > 0.6) {
          this.workerInspector.walkRoute(this.computeInspectRoute(), 1.0);
          this.inspectorState = 1;
        } else if (this.inspectorState === 1 && !this.workerInspector.isWalking) {
          this.workerInspector.inspect(true);
          this.inspectorState = 2;
        } else if (this.inspectorState === 2 && (this.inspectT += dt) > 2.6) {
          this.workerInspector.inspect(false);
          this.workerInspector.walkRoute([{ x: 0.6, z: 4.8 }], 1.0);
          this.inspectorState = 3;
          if (this.path?.closed) {
            this.crane.start();
            this.craneStarted = true;
          }
        } else if (this.inspectorState === 3 && !this.workerInspector.isWalking) {
          this.inspectorState = 4;
        }
        this.crane.update(dt);
        const craneOk = !this.craneStarted || this.crane.isFinished;
        if (this.inspectorState >= 3 && craneOk && this.phaseT > 5) {
          this.phase = 'reveal';
          this.phaseT = 0;
        }
        break;
      }

      case 'reveal':
        this.gantry.update(dt, null, { x: -1.4, z: -3.6 }, dt);
        this.crane.update(dt);
        if (this.phaseT > 4.2) {
          this.phase = 'compare';
          this.phaseT = 0;
          this.overlay.showCompareCard(this.rawStroke);
          this.overlay.showReplay(true);
        }
        break;

      case 'compare':
        this.gantry.update(dt, null, { x: -1.4, z: -3.6 }, dt);
        break;
    }

    this.director.update(dt, camPhase, this.job?.head ?? null, { x: this.gantry.posX, z: this.gantry.posZ });
  }

  private inspectT = 0;

  /** 再プレイ: 動的リソースを完全に解放して最初へ */
  reset(): void {
    this.builder.dispose();
    this.crane.reset(this.scene);
    this.job = null;
    this.path = null;
    this.rawStroke = [];
    this.stroke.clearChalk();
    this.stroke.hideInkLine();
    this.workerInspector.setPosition(0.6, 5.6);
    this.workerInspector.inspect(false);
    this.inspectT = 0;
    this.concrete.uniforms.uNow.value = 0;
    this.site.sun.position.set(-9, 14, 7);
    this.startMarker.position.set(-0.9, DIM.slabTop + 0.007, 0.9);
    this.enterDraw(false);
  }

  // ---- テスト用フック ----
  setTimeScale(v: number): void {
    this.extTimeScale = v;
    this.job?.setExternalScale(v);
  }
  getPhase(): string {
    if (this.phase === 'printing' && this.job) return `printing:${this.job.head.phase}:L${this.job.head.layer}`;
    return this.phase;
  }
  getStats(): Record<string, number | boolean | string> {
    return {
      phase: this.getPhase(),
      layer: this.job?.head.layer ?? 0,
      layersTotal: this.path?.layers ?? 0,
      closed: this.path?.closed ?? false,
      isBench: this.path?.isBench ?? false,
      totalLen: this.path?.totalLen ?? 0,
      rings: this.builder.totalRings,
      baked: this.builder.bakedCount,
    };
  }
  getDebug(): unknown {
    return this.builder.debugExtents();
  }
  async testStroke(pts: [number, number][], durMs = 1600): Promise<void> {
    if (this.phase !== 'draw') return;
    await this.stroke.simulateStroke(pts, durMs);
  }
}
