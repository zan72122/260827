import * as THREE from 'three';
import { Reindeer, DEER_PRESETS } from './reindeer';
import { LeatherLine } from './trace';
import { TackMats, Wearable, NeckCollar, BreastHarness, BellSystem, Brush, BellLoop } from './gear';
import { Sled } from './sled';
import { Environment, Particles, SnowMarks } from './environment';
import { CameraRig } from './camera';
import { InputManager, Pickable, DragInfo } from './input';
import { audio } from './audio';
import { leatherTextures } from './textures';

// ---------------------------------------------------------------------------
// ゲーム本体。
// 謎(歩いてもそりが動かない) → 接続の理解 → 三頭の編成 → 手綱と離陸 → 自由モード
// 文字・矢印・点数・時間制限は一切出さない。
// ---------------------------------------------------------------------------

export type Phase = 'intro' | 'firstConnect' | 'outfit' | 'ready' | 'launch' | 'run' | 'landing';

const GROUND_Y = 0.0;
const FWD = new THREE.Vector3(0, 0, -1);

interface DeerUnit {
  deer: Reindeer;
  wearable: Wearable;
  trace: LeatherLine;
  /** そりのどのフックへ接続済みか (-1 = 未接続) */
  hook: number;
  /** 接続時に埋まる編成スロットのオフセット（そりローカル） */
  standHome: THREE.Vector3;     // 未接続時の待機位置
  walkTarget: THREE.Vector3 | null;
  walkArrive?: () => void;
  needsBuckle: boolean;
  launchStage: number;          // 離陸連鎖の進行
  gaitOffset: number;           // 編成内の足並みの個性
  swayPhase: number;
}

export class Game {
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  private input: InputManager;
  private env: Environment;
  private particles = new Particles();
  private marks = new SnowMarks();
  private tack = new TackMats();
  private sled: Sled;
  private units: DeerUnit[] = [];
  private bells: BellSystem;
  private brush: Brush;
  private leaders: LeatherLine[] = [];
  private joints: THREE.Object3D[] = [];
  private leatherMat: THREE.MeshStandardMaterial;

  phase: Phase = 'intro';
  private introPlayed = false;
  private elapsed = 0;
  private phaseT = 0;

  // 走行状態
  private teamSpeed = 0;
  private runDist = 0;
  private floatH = 0;
  private launchCharge = 0;
  private landingT = 0;
  private liftedOnce = false;
  private runIdleT = 0;

  // ドラッグ状態
  private dragging:
    | { kind: 'trace'; unit: DeerUnit }
    | { kind: 'wearable'; wear: Wearable }
    | { kind: 'bell'; id: number }
    | { kind: 'brush' }
    | { kind: 'strap'; unit: DeerUnit }
    | { kind: 'deer'; unit: DeerUnit }
    | { kind: 'swipe' }
    | null = null;
  private dragWorld = new THREE.Vector3();
  private lastBrushWorld = new THREE.Vector3();
  private focus = new THREE.Vector3(0, 0.8, 0); // カメラの関心点
  private focusUnit: DeerUnit | null = null;
  private connectCam = 0;    // 接続ショットへの寄り 0..1
  private idleCamT = 0;

  // 検証フック
  readonly debugMarkers = new Map<string, () => THREE.Vector3>();

  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private tmpV3 = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, aspect: number) {
    this.rig = new CameraRig(aspect);
    this.input = new InputManager(canvas, this.rig.camera);
    this.env = new Environment();
    this.scene.add(this.env.group, this.particles.group, this.marks.group);
    this.scene.fog = new THREE.Fog('#dfe4ee', 40, 150);

    const lt = leatherTextures(51);
    this.leatherMat = new THREE.MeshStandardMaterial({
      map: lt.map, bumpMap: lt.bump, bumpScale: 0.5, roughnessMap: lt.rough,
      roughness: 1, metalness: 0.02
    });

    // --- そり ---------------------------------------------------------------
    this.sled = new Sled(this.tack);
    this.sled.group.position.set(0.2, 0, 3.4);
    this.scene.add(this.sled.group);

    // そり側の短い牽引線（各フックから雪へ垂れる）
    for (let i = 0; i < 3; i++) {
      const leader = new LeatherLine(1.05, 0.018, this.leatherMat, this.tack.brass, 'clip');
      leader.setEndA(this.sled.hooks[i]);
      this.scene.add(leader.group);
      this.leaders.push(leader);
      const joint = new THREE.Object3D();
      this.scene.add(joint);
      this.joints.push(joint);
    }

    // --- トナカイ3頭 --------------------------------------------------------
    const homes = [
      new THREE.Vector3(-0.5, 0, -0.3),   // ホシ: 最初からそりの前
      new THREE.Vector3(-1.85, 0, 0.55),  // ユキ: 厩舎から来てここに立つ
      new THREE.Vector3(2.0, 0, 0.35)     // クリ
    ];
    const wearables: Wearable[] = [
      new BreastHarness(this.tack, false),  // ホシ: 装着済み
      new NeckCollar(this.tack),
      new BreastHarness(this.tack, true)    // クリ: バックル工程あり
    ];
    for (let i = 0; i < 3; i++) {
      const deer = new Reindeer(DEER_PRESETS[i]);
      deer.root.position.copy(homes[i]);
      deer.root.rotation.y = i === 0 ? 0 : (i === 1 ? -0.5 : 0.45);
      this.scene.add(deer.root);
      const trace = new LeatherLine(2.9, 0.021, this.leatherMat, this.tack.brass, 'ring');
      this.scene.add(trace.group);
      const unit: DeerUnit = {
        deer, wearable: wearables[i], trace, hook: -1,
        standHome: homes[i].clone(), walkTarget: null,
        needsBuckle: i === 2, launchStage: -1,
        gaitOffset: [0, 0.3, 0.62][i], swayPhase: i * 2.1
      };
      this.units.push(unit);
      deer.onFootfall = (p, w) => {
        audio.step(w * (0.7 + 0.3 * Math.random()), THREE.MathUtils.clamp(p.x / 8, -0.7, 0.7));
        this.particles.puff(p, 3, 0.12, 0.7);
        this.marks.hoofPrint(p, deer.root.rotation.y);
      };
      deer.onBreath = (p) => this.particles.breath(p);
      wearables[i].onFitted = () => {
        audio.click(0.6);
        deer.calmSettle();
        this.layTraceOut(unit);
        // 装着が成立したトナカイへカメラの関心を移す（ドラッグ後なので安全）
        this.focusUnit = unit;
        this.idleCamT = 0;
      };
    }
    // ホシは最初からハーネス装着・牽引線が雪の上
    const first = this.units[0];
    first.wearable.startFit(first.deer);
    // startFit の補間を即完了させる
    first.wearable.update(10);
    first.trace.setEndA(first.wearable.dRing);
    // イントロでは後続の2頭は隠しておく（接続後に厩舎から歩いてくる）
    this.units[1].deer.root.visible = false;
    this.units[2].deer.root.visible = false;

    // ユキとクリの装具は柵へ
    wearables[1].setStored(new THREE.Vector3(-0.6, 0.95, -5.1), new THREE.Euler(0.15, 0.1, 0));
    wearables[2].setStored(new THREE.Vector3(1.05, 0.93, -5.13), new THREE.Euler(0.15, -0.1, 0));
    for (const w of wearables) {
      if (w !== first.wearable) this.scene.add(w.group);
    }

    // --- 鈴とラック ----------------------------------------------------------
    const rack = this.buildBellRack();
    rack.position.set(-1.28, 0, -4.5);
    rack.rotation.y = 0.15;
    this.scene.add(rack);
    rack.updateWorldMatrix(true, true);
    const rackTops = [new THREE.Vector3(-0.24, 0.78, 0), new THREE.Vector3(0, 0.78, 0), new THREE.Vector3(0.24, 0.78, 0)]
      .map((v) => rack.localToWorld(v.clone()));
    this.bells = new BellSystem(this.tack, [
      { pos: rackTops[0], size: 0 },
      { pos: rackTops[1], size: 1 },
      { pos: rackTops[2], size: 2 }
    ]);
    this.scene.add(this.bells.inst);
    this.bells.onRing = (size, vel, wx) => {
      if (audio.ready) audio.bell(size, vel, THREE.MathUtils.clamp(wx / 7, -0.8, 0.8));
    };

    // --- ブラシ -------------------------------------------------------------
    this.brush = new Brush(this.tack);
    this.brush.setStored(new THREE.Vector3(1.35, 0.14, -3.3), new THREE.Euler(0.1, 0.6, 1.3));
    this.scene.add(this.brush.group);

    // ユキは雪をかぶっている / クリは少しだけ
    this.units[1].deer.setSnowCover(1);
    this.units[2].deer.setSnowCover(0.45);

    this.setupPickables();
    this.setupInputHandlers();
    this.setupDebugMarkers();
    this.enterIntro();
  }

  // =========================================================================
  private buildBellRack(): THREE.Group {
    const g = new THREE.Group();
    const postL = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.85, 8), this.tack.wood);
    postL.position.set(-0.34, 0.42, 0);
    const postR = postL.clone();
    postR.position.x = 0.34;
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.78, 8), this.tack.wood);
    bar.rotation.z = Math.PI / 2;
    bar.position.y = 0.83;
    g.add(postL, postR, bar);
    g.traverse((o) => { o.castShadow = true; });
    return g;
  }

  // =========================================================================
  // ピック対象
  // =========================================================================
  private pickTrace: Pickable[] = [];
  private pickBells: Pickable[] = [];
  private pickWear: Pickable[] = [];
  private pickBrush!: Pickable;
  private pickStrap!: Pickable;
  private pickDeer: Pickable[] = [];

  private setupPickables(): void {
    const reg = (p: Pickable) => this.input.register(p);
    for (let i = 0; i < 3; i++) {
      const unit = this.units[i];
      this.pickTrace.push(reg({
        id: `trace${i}`, radiusPx: 64, enabled: false, priority: 3,
        getWorld: (out) => { out.copy(unit.trace.endB); }
      }));
      this.pickDeer.push(reg({
        id: `deer${i}`, radiusPx: 90, enabled: false, priority: 0,
        getWorld: (out) => {
          unit.deer.root.getWorldPosition(out);
          out.y += 0.8 * unit.deer.params.shoulderHeight;
        }
      }));
    }
    for (let b = 0; b < 3; b++) {
      this.pickBells.push(reg({
        id: `bell${b}`, radiusPx: 52, enabled: false, priority: 2,
        getWorld: (out) => { this.bells.bellWorld(b, out); }
      }));
    }
    this.pickWear.push(reg({
      id: 'collar1', radiusPx: 72, enabled: false, priority: 2,
      getWorld: (out) => { this.units[1].wearable.grabWorld(out); }
    }));
    this.pickWear.push(reg({
      id: 'harness2', radiusPx: 72, enabled: false, priority: 2,
      getWorld: (out) => { this.units[2].wearable.grabWorld(out); }
    }));
    this.pickBrush = reg({
      id: 'brush', radiusPx: 58, enabled: false, priority: 2,
      getWorld: (out) => { this.brush.group.getWorldPosition(out); }
    });
    this.pickStrap = reg({
      id: 'strap2', radiusPx: 54, enabled: false, priority: 4,
      getWorld: (out) => {
        (this.units[2].wearable as BreastHarness).strapEnd.getWorldPosition(out);
      }
    });
  }

  private refreshPickables(): void {
    const outfitting = this.phase === 'outfit' || this.phase === 'firstConnect';
    for (let i = 0; i < 3; i++) {
      const unit = this.units[i];
      const wearFitted = unit.wearable.state === 'fitted';
      const canDragTrace =
        unit.deer.root.visible && wearFitted && unit.hook < 0 &&
        (this.phase === 'intro' || outfitting) &&
        (!unit.needsBuckle || (unit.wearable as BreastHarness).buckled);
      this.pickTrace[i].enabled = canDragTrace;
      this.pickDeer[i].enabled = outfitting && unit.deer.root.visible && unit.hook < 0 && this.phase !== 'firstConnect';
    }
    for (let b = 0; b < 3; b++) this.pickBells[b].enabled = this.phase === 'outfit';
    this.pickWear[0].enabled = this.phase === 'outfit' && this.units[1].wearable.state !== 'fitted' && this.units[1].wearable.state !== 'fitting';
    this.pickWear[1].enabled = this.phase === 'outfit' && this.units[2].wearable.state !== 'fitted' && this.units[2].wearable.state !== 'fitting';
    this.pickBrush.enabled = this.phase === 'outfit';
    const h2 = this.units[2].wearable as BreastHarness;
    this.pickStrap.enabled = this.phase === 'outfit' && h2.state === 'fitted' && !h2.buckled;
  }

  // =========================================================================
  // 入力
  // =========================================================================
  private setupInputHandlers(): void {
    this.input.onDragStart = (d) => this.handleDragStart(d);
    this.input.onDragMove = (d) => this.handleDragMove(d);
    this.input.onDragEnd = (d) => this.handleDragEnd(d);
  }

  /** 検証用: 直近に掴んだ対象 */
  lastPickId: string | null = null;

  private handleDragStart(d: DragInfo): void {
    audio.unlock();
    this.lastPickId = d.pick?.id ?? null;
    // ドラッグ中はカメラを完全に固定する（指の下で世界がずれないように）
    this.rig.frozen = !!d.pick && d.pick.id !== 'none';
    if (!d.pick) {
      this.dragging = { kind: 'swipe' };
      return;
    }
    const id = d.pick.id;
    if (id.startsWith('trace')) {
      const unit = this.units[parseInt(id[5], 10)];
      unit.trace.beginDrag(unit.trace.endB.clone());
      this.dragging = { kind: 'trace', unit };
      unit.deer.gazeTarget = unit.trace.endB;
      audio.leatherCreak();
    } else if (id.startsWith('bell')) {
      const bi = parseInt(id[4], 10);
      const b = this.bells.bells[bi];
      this.bells.bellWorld(bi, b.dragPos);
      if (b.attachedLoop) this.bells.detach(bi);
      b.dragging = true;
      this.dragging = { kind: 'bell', id: bi };
      audio.bell(b.size, 0.25, 0);
    } else if (id === 'collar1') {
      this.units[1].wearable.beginDrag();
      this.dragging = { kind: 'wearable', wear: this.units[1].wearable };
    } else if (id === 'harness2') {
      this.units[2].wearable.beginDrag();
      this.dragging = { kind: 'wearable', wear: this.units[2].wearable };
    } else if (id === 'brush') {
      this.dragging = { kind: 'brush' };
      this.brush.group.getWorldPosition(this.lastBrushWorld);
    } else if (id === 'strap2') {
      this.dragging = { kind: 'strap', unit: this.units[2] };
    } else if (id.startsWith('deer')) {
      const unit = this.units[parseInt(id[4], 10)];
      this.dragging = { kind: 'deer', unit };
      unit.deer.perkUp();
    }
  }

  private handleDragMove(d: DragInfo): void {
    if (!this.dragging) return;
    const kind = this.dragging.kind;
    if (kind === 'swipe') {
      if (this.phase === 'ready' || this.phase === 'run' || this.phase === 'launch') {
        // 上/前方向のスワイプで加速（指の速さが手綱の引きの速さ）
        const up = -d.velocity.y;
        if (up > 120) {
          this.launchCharge = Math.min(1, this.launchCharge + up / 26000);
        }
      }
      return;
    }
    // 地面基準のドラッグ位置（視差を避けるため、対象の高さに近い平面で追跡する）
    const h = kind === 'wearable' || kind === 'bell' ? 0.8
      : kind === 'brush' ? 0.9
      : kind === 'strap' ? 1.0 : 0.12;
    const gp = this.input.groundPoint(d.ndc, h, this.tmpV);
    if (!gp) return;
    this.dragWorld.copy(gp);

    if (kind === 'trace') {
      const unit = (this.dragging as { kind: 'trace'; unit: DeerUnit }).unit;
      unit.trace.moveDrag(this.dragWorld);
      unit.deer.gazeTarget = unit.trace.endB;
      // 金具が触れ合う距離まで来たらカチンと留まる
      const near = this.nearestFreeLeader(unit.trace.endB, 0.5);
      if (near >= 0) {
        this.dragging = null;
        this.connectUnitToHook(unit, near);
      }
    } else if (kind === 'wearable') {
      (this.dragging as { kind: 'wearable'; wear: Wearable }).wear.dragTo(this.dragWorld);
    } else if (kind === 'bell') {
      const b = this.bells.bells[(this.dragging as { kind: 'bell'; id: number }).id];
      b.dragPos.lerp(this.dragWorld, 0.6);
    } else if (kind === 'brush') {
      this.brush.dragTo(this.dragWorld);
      this.doBrushStroke(d);
    } else if (kind === 'strap') {
      const unit = (this.dragging as { kind: 'strap'; unit: DeerUnit }).unit;
      const h2 = unit.wearable as BreastHarness;
      // ストラップ端はハーネスローカルで小さく追従
      const local = h2.group.worldToLocal(this.dragWorld.clone());
      local.clampLength(0, 0.45);
      h2.strapEnd.position.lerp(local, 0.5);
      // バックルに近づいたら留まる（画面距離で判定）
      const bw = h2.buckleTarget.getWorldPosition(this.tmpV2);
      if (this.screenDistToPointer(bw, d) < 50) {
        h2.closeBuckle();
        audio.click(1);
        unit.deer.calmSettle();
        this.layTraceOut(unit);
        this.dragging = null;
        this.refreshPickables();
      }
    } else if (kind === 'deer') {
      const unit = (this.dragging as { kind: 'deer'; unit: DeerUnit }).unit;
      // 指の地点へ歩かせる（引っ張るのではなく、ついてくる）
      const target = this.tmpV2.copy(this.dragWorld);
      target.y = 0;
      this.clampToPlayArea(target);
      unit.walkTarget = target.clone();
      unit.walkArrive = undefined;
    }
  }

  private handleDragEnd(d: DragInfo): void {
    this.rig.frozen = false;
    const drag = this.dragging;
    this.dragging = null;
    if (!drag) return;
    if (drag.kind === 'trace') {
      this.tryConnectTrace(drag.unit);
    } else if (drag.kind === 'wearable') {
      this.tryFitWearable(drag.wear, d);
    } else if (drag.kind === 'bell') {
      this.tryAttachBell(drag.id, d);
    } else if (drag.kind === 'brush') {
      this.brush.release();
    } else if (drag.kind === 'strap') {
      const h2 = this.units[2].wearable as BreastHarness;
      if (!h2.buckled) {
        h2.resetStrap();
        this.units[2].deer.tiltHead();
      }
    } else if (drag.kind === 'deer') {
      const unit = drag.unit;
      // 手を離した位置が編成エリアに近ければスロット近くへ自然に補正
      if (unit.walkTarget) this.clampToPlayArea(unit.walkTarget);
    }
  }

  private clampToPlayArea(v: THREE.Vector3): void {
    v.x = THREE.MathUtils.clamp(v.x, -5.5, 5.5);
    v.z = THREE.MathUtils.clamp(v.z, -5.5, 4.5);
    // そりの中へは入らない
    const sled = this.sled.group.position;
    if (Math.abs(v.x - sled.x) < 1.0 && Math.abs(v.z - sled.z) < 1.6) {
      v.z = sled.z - 2.0;
    }
  }

  // =========================================================================
  // 接続・装着ロジック
  // =========================================================================

  /** 装着済みユニットの牽引線を、そりへ向けて雪の上に自然に出す */
  private layTraceOut(unit: DeerUnit): void {
    unit.trace.setEndA(unit.wearable.dRing);
    unit.trace.releaseB();
    const a = unit.wearable.dRing.getWorldPosition(this.tmpV);
    const toward = this.sled.group.position.clone().setY(GROUND_Y + 0.05);
    const b = a.clone().lerp(toward, 0.55);
    b.y = GROUND_Y + 0.05;
    unit.trace.layout(a, b, GROUND_Y);
  }

  private nearestFreeLeader(pos: THREE.Vector3, maxD: number): number {
    let best = -1;
    let bestD = maxD;
    for (let i = 0; i < 3; i++) {
      if (this.leaders[i].endBMode === 'pinned') continue;
      if (this.units.some((u) => u.hook === i)) continue;
      // 持ち上げ中の高さ差は無視して水平距離で判定
      const e = this.leaders[i].endB;
      const d = Math.hypot(e.x - pos.x, e.z - pos.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  private tryConnectTrace(unit: DeerUnit): void {
    // 最も近い空きリーダーの先端へスナップ
    const best = this.nearestFreeLeader(unit.trace.endB, 0.8);
    if (best < 0) {
      // 届かなかった: 線は雪へ落ちるだけ（失敗表示はしない）
      unit.trace.releaseB();
      unit.deer.gazeTarget = null;
      return;
    }
    this.connectUnitToHook(unit, best);
  }

  private connectUnitToHook(unit: DeerUnit, hookIndex: number): void {
    unit.hook = hookIndex;
    const joint = this.joints[hookIndex];
    unit.trace.pinB(joint);
    this.leaders[hookIndex].pinB(joint);
    audio.click(1);
    // 小さな金属の煌めきの代わりに雪の微粒子
    joint.getWorldPosition(this.tmpV);
    this.particles.puff(this.tmpV, 5, 0.08, 0.9);
    unit.deer.perkUp();
    unit.deer.gazeTarget = null;

    // 接続したら、そのフックに合うスロットへ自然に歩いて補正
    const slot = this.slotWorld(hookIndex, this.tmpV2);
    unit.walkTarget = slot.clone();
    unit.walkArrive = () => {
      unit.deer.settleToIdle();
      unit.trace.pullStraight = 0;
      // ひと呼吸置いて張りを見せ、そりを少し動かす（最初の一回のみ大きく）
      if (this.phase === 'intro' || this.phase === 'firstConnect') {
        this.playFirstPull(unit);
      } else {
        this.playSmallTug(unit);
      }
    };
    if (this.phase === 'intro') {
      this.phase = 'firstConnect';
      this.phaseT = 0;
    }
    this.refreshPickables();
    this.checkAllConnected();
  }

  /** フックに対応する編成スロット（ワールド） */
  private slotWorld(hookIndex: number, out: THREE.Vector3): THREE.Vector3 {
    const lateral = [-0.95, 0, 0.95][hookIndex];
    out.set(lateral, 0, -2.35);
    // 中央スロットはやや前（先頭格）
    if (hookIndex === 1) out.z -= 0.55;
    this.sled.group.localToWorld(out);
    out.y = 0;
    return out;
  }

  /** 編成の前方（-Z）へ向き直る */
  private alignForward(unit: DeerUnit): Promise<void> {
    let s = unit.deer.root.rotation.y % (Math.PI * 2);
    if (s > Math.PI) s -= Math.PI * 2;
    if (s < -Math.PI) s += Math.PI * 2;
    unit.deer.root.rotation.y = s;
    const T = 260 + Math.abs(s) * 380;
    const t0 = performance.now();
    return new Promise((res) => {
      const step = () => {
        const t = Math.min(1, (performance.now() - t0) / T);
        const e = 1 - Math.pow(1 - t, 2);
        unit.deer.root.rotation.y = s * (1 - e);
        if (t < 1) requestAnimationFrame(step);
        else res();
      };
      step();
    });
  }

  /** 最初の接続後の「歩く→張る→そりが動く」を同一ショットで見せる */
  private playFirstPull(unit: DeerUnit): void {
    const seq = async () => {
      await wait(300);
      await this.alignForward(unit);
      unit.deer.mode = 'walk';
      unit.deer.speed = 0.55;
      unit.deer.setStretch(0.8);
      audio.leatherCreak();
      // 前進歩行: 0.9秒かけて0.45m
      const start = unit.deer.root.position.clone();
      const dir = new THREE.Vector3(0, 0, -1);
      const T = 900;
      const t0 = performance.now();
      const tug = () => {
        const t = Math.min(1, (performance.now() - t0) / T);
        unit.deer.root.position.copy(start).addScaledVector(dir, t * 0.5);
        unit.trace.pullStraight = Math.min(1, t * 1.6);
        this.leaders[unit.hook].pullStraight = Math.min(1, t * 1.6);
        if (t < 1) requestAnimationFrame(tug);
      };
      tug();
      await wait(650);
      // 張った → そりが雪を押して動く
      audio.sledShove();
      const sledStart = this.sled.group.position.clone();
      const t1 = performance.now();
      const sledMove = () => {
        const t = Math.min(1, (performance.now() - t1) / 800);
        const e = 1 - Math.pow(1 - t, 2);
        this.sled.group.position.copy(sledStart).addScaledVector(dir, e * 0.5);
        this.emitRunnerSpray(0.6);
        if (t < 1) requestAnimationFrame(sledMove);
      };
      sledMove();
      await wait(900);
      unit.deer.settleToIdle();
      unit.deer.setStretch(0);
      unit.trace.pullStraight = 0.35;
      this.leaders[unit.hook].pullStraight = 0.35;
      await wait(500);
      if (this.phase === 'firstConnect') this.enterOutfit();
      else this.checkAllConnected();
    };
    void seq();
  }

  /** 2頭目以降の接続時: 小さく張って一歩だけ（理解の再確認） */
  private playSmallTug(unit: DeerUnit): void {
    const seq = async () => {
      await wait(250);
      await this.alignForward(unit);
      unit.deer.setStretch(0.5);
      unit.trace.pullStraight = 0.8;
      this.leaders[unit.hook].pullStraight = 0.8;
      audio.leatherCreak();
      await wait(500);
      unit.deer.setStretch(0);
      unit.trace.pullStraight = 0.35;
      this.leaders[unit.hook].pullStraight = 0.35;
      this.checkAllConnected();
    };
    void seq();
  }

  /** ワールド点の画面上の距離(px)。視差に左右されない子ども目線の判定に使う */
  private screenDistToPointer(world: THREE.Vector3, d: DragInfo): number {
    const p = this.input.worldToScreen(world, this.tmpScreen);
    return Math.hypot(p.x - d.screen.x, p.y - d.screen.y);
  }
  private tmpScreen = new THREE.Vector2();

  private tryFitWearable(wear: Wearable, d: DragInfo): void {
    // どのトナカイの上で離したか（画面上の近さで判定）
    let target: DeerUnit | null = null;
    let bestPx = 150;
    for (const u of this.units) {
      if (!u.deer.root.visible) continue;
      const dp = u.deer.root.getWorldPosition(this.tmpV2);
      dp.y += 0.8 * u.deer.params.shoulderHeight;
      const px = this.screenDistToPointer(dp, d);
      if (px < bestPx) {
        bestPx = px;
        target = u;
      }
    }
    // 装具はそれぞれのトナカイ専用（サイズが合う相手にだけ収まる）
    const owner = this.units.find((u) => u.wearable === wear)!;
    if (target === owner) {
      // 正しい相手: 前半身（ソケット寄り）に置けたかを画面距離で確認
      const sp = wear.socketOf(owner.deer).getWorldPosition(this.tmpV2);
      const px = this.screenDistToPointer(sp, d);
      if (px < 170) {
        wear.startFit(owner.deer);
        this.refreshPickables();
        return;
      }
      // 胴の後ろ半分など: 首をかしげて手元へ戻る
      owner.deer.tiltHead();
      audio.bell(1, 0.2, 0);
      wear.returnToStore();
      return;
    }
    if (target) {
      // 別のトナカイ: 優しく首をかしげ、装具は戻る
      target.deer.tiltHead();
      audio.bell(1, 0.2, 0);
    }
    wear.returnToStore();
  }

  private tryAttachBell(bellId: number, d: DragInfo): void {
    const b = this.bells.bells[bellId];
    b.dragging = false;
    // 近くの吊り輪へ（画面上の近さで判定）
    let bestLoop: BellLoop | null = null;
    let bestWear: Wearable | null = null;
    let bestD = 90;
    for (const u of this.units) {
      if (u.wearable.state !== 'fitted') continue;
      for (const loop of u.wearable.bellLoops) {
        const lw = loop.anchor.getWorldPosition(this.tmpV);
        const dist = this.screenDistToPointer(lw, d);
        if (dist < bestD) {
          bestD = dist;
          bestLoop = loop;
          bestWear = u.wearable;
        }
      }
    }
    if (bestLoop && bestWear) {
      this.bells.attach(bellId, bestLoop, bestWear);
      audio.click(0.7);
      audio.bell(b.size, 0.7, THREE.MathUtils.clamp(b.dragPos.x / 7, -0.8, 0.8));
      const owner = this.units.find((u) => u.wearable === bestWear);
      owner?.deer.calmSettle();
    } else {
      // 吊り輪でなければラックへ戻る。近くのトナカイは不思議そうにする
      for (const u of this.units) {
        if (!u.deer.root.visible) continue;
        const dp = u.deer.root.getWorldPosition(this.tmpV2);
        if (dp.distanceTo(b.dragPos) < 1.4) {
          u.deer.tiltHead();
          break;
        }
      }
      this.bells.detach(bellId);
      audio.bell(b.size, 0.3, 0);
    }
    this.refreshPickables();
  }

  private doBrushStroke(d: DragInfo): void {
    // ブラシ先端でトナカイ表面をなでる。毛並み（前→後ろ）方向で良く落ちる
    const ray = this.input.raycaster(d.ndc);
    for (const u of this.units) {
      if (!u.deer.root.visible || u.deer.snowCover <= 0.01) continue;
      const hits = ray.intersectObject(u.deer.hitMesh, false);
      if (hits.length === 0) continue;
      const hit = hits[0].point;
      const move = this.tmpV2.subVectors(hit, this.lastBrushWorld);
      if (move.length() < 0.06) return;
      // 毛流れ: 首→尻（トナカイの後方 = ワールドでの root +Z 方向）
      const back = this.tmpV3.set(0, -0.35, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), u.deer.root.rotation.y).normalize();
      const along = move.clone().normalize().dot(back) > 0.25;
      const removed = u.deer.brushAt(hit, along);
      if (removed.length > 0 || Math.random() < 0.4) {
        audio.brush(along ? 0.9 : 0.45);
      }
      for (const r of removed) {
        this.particles.puff(r, 7, 0.15, 0.4, back.clone().multiplyScalar(0.6));
      }
      this.lastBrushWorld.copy(hit);
      return;
    }
    this.lastBrushWorld.copy(this.dragWorld);
  }

  // =========================================================================
  // フェーズ
  // =========================================================================
  private enterIntro(): void {
    this.phase = 'intro';
    this.phaseT = 0;
    this.refreshPickables();
    const unit = this.units[0];
    // 最初の情景: そりから離れて立ち、牽引線は雪の上で二つに分かれている
    this.layTraceOut(unit);
    for (const l of this.leaders) {
      const a = this.sled.hooks[this.leaders.indexOf(l)].getWorldPosition(this.tmpV);
      const b = a.clone().add(new THREE.Vector3((this.leaders.indexOf(l) - 1) * 0.25, 0, -0.75));
      b.y = GROUND_Y + 0.05;
      l.layout(a, b, GROUND_Y);
    }
    // カメラ: 低めの3/4で全景
    this.rig.setShot((portrait, out) => this.shotOverview(portrait, out), true, 1.6);

    // 因果を一度だけ見せる: 歩く → 線が引かれる → そりは残る
    if (!this.introPlayed) {
      this.introPlayed = true;
      const seq = async () => {
        await wait(1600);
        if (this.phase !== 'intro') return;
        const deer = unit.deer;
        deer.mode = 'walk';
        deer.speed = 0.5;
        deer.setStretch(0.35);
        const start = deer.root.position.clone();
        const t0 = performance.now();
        const step = () => {
          const t = Math.min(1, (performance.now() - t0) / 1250);
          deer.root.position.copy(start).add(new THREE.Vector3(0, 0, -0.32 * t));
          if (t < 1 && this.phase === 'intro') requestAnimationFrame(step);
        };
        step();
        await wait(1300);
        if (this.phase !== 'intro') return;
        deer.settleToIdle();
        deer.setStretch(0);
        audio.snort();
        // そりの方（引きずられた線の端）を振り返って見る
        deer.gazeTarget = unit.trace.endB;
        deer.earAlert = 0.95;
        await wait(2600);
        if (this.phase === 'intro') {
          deer.gazeTarget = null;
          // 以後は時々線の端へ視線を戻す（誘導は視線と線の揺れだけ）
          this.introGazeLoop(unit);
        }
      };
      void seq();
    }
  }

  private introGazeLoop(unit: DeerUnit): void {
    const loop = async () => {
      while (this.phase === 'intro') {
        await wait(3500 + Math.random() * 2500);
        if (this.phase !== 'intro') break;
        unit.deer.gazeTarget = unit.trace.endB;
        unit.deer.earAlert = 0.9;
        await wait(1800);
        if (this.phase !== 'intro') break;
        unit.deer.gazeTarget = null;
        unit.deer.earAlert = 0.5;
      }
    };
    void loop();
  }

  private enterOutfit(): void {
    this.phase = 'outfit';
    this.phaseT = 0;
    this.connectCam = 0;
    // 2頭が厩舎脇から歩いてくる（初回のみ非表示→登場）
    for (const i of [1, 2]) {
      const u = this.units[i];
      if (!u.deer.root.visible) {
        u.deer.root.visible = true;
        u.deer.root.position.set(i === 1 ? -4.6 : 5.0, 0, -5.6);
        u.walkTarget = u.standHome.clone();
        u.walkArrive = () => u.deer.settleToIdle();
      }
    }
    this.rig.setShot((portrait, out) => this.shotOverview(portrait, out), false, 1.4);
    this.refreshPickables();
  }

  private checkAllConnected(): void {
    if (this.phase !== 'outfit' && this.phase !== 'firstConnect') return;
    if (this.units.every((u) => u.hook >= 0)) {
      // 全頭がスロットに到着してから ready へ
      const allArrived = this.units.every((u) => !u.walkTarget);
      if (allArrived) this.enterReady();
      else setTimeout(() => this.checkAllConnected(), 400);
    }
  }

  private enterReady(): void {
    if (this.phase === 'ready' || this.phase === 'launch' || this.phase === 'run') return;
    this.phase = 'ready';
    this.phaseT = 0;
    this.launchCharge = 0;
    this.refreshPickables();
    this.rig.setShot((portrait, out) => this.shotTeam(portrait, out), false, 1.5);
    // サンタが手綱を軽く引く
    setTimeout(() => {
      if (this.phase !== 'ready') return;
      this.sled.santa.tug();
      audio.leatherCreak();
      // 連鎖: 一頭ずつ 耳→頭→前脚→鈴→張り
      this.startLaunchChain();
    }, 900);
  }

  private startLaunchChain(): void {
    this.phase = 'launch';
    this.phaseT = 0;
    // 前(中央フック)から順に
    const order = [...this.units].sort((a, b) => {
      const za = a.hook === 1 ? 0 : 1;
      const zb = b.hook === 1 ? 0 : 1;
      return za - zb;
    });
    order.forEach((u, k) => {
      setTimeout(() => {
        if (this.phase !== 'launch' && this.phase !== 'run') return;
        u.launchStage = 0;
        u.deer.earAlert = 1;                      // 耳が前を向く
        setTimeout(() => { u.deer.perkUp(); }, 180);   // 頭が上がる
        setTimeout(() => { u.deer.setStretch(0.7); audio.leatherCreak(); }, 400); // 前脚が出て張る
        setTimeout(() => {
          // 鈴が時間差で鳴る
          for (const loop of u.wearable.bellLoops) {
            if (loop.bellId >= 0) {
              const b = this.bells.bells[loop.bellId];
              b.vel += 3.5;
            }
          }
        }, 620);
        setTimeout(() => {
          u.trace.pullStraight = 1;
          if (u.hook >= 0) this.leaders[u.hook].pullStraight = 1;
        }, 700);
      }, 350 + k * 620);
    });
    // 最後にランナーが食い込み、全体が動き出す
    setTimeout(() => {
      if (this.phase !== 'launch') return;
      audio.sledShove();
      this.emitRunnerSpray(1);
      this.teamSpeed = 0.4;
      this.phase = 'run';
      this.phaseT = 0;
      this.runDist = 0;
      this.marks.reset();
      for (const u of this.units) {
        u.deer.mode = 'walk';
        u.deer.setStretch(0.25);
      }
      this.rig.setShot((portrait, out) => this.shotRun(portrait, out), false, 1.8);
    }, 350 + order.length * 620 + 800);
  }

  /** 走行終了 → 着地・停止 → 自由モードへ */
  private beginLanding(): void {
    if (this.phase !== 'run') return;
    this.phase = 'landing';
    this.landingT = 0;
  }

  private finishToFreeMode(): void {
    // 雪煙の中で編成をそっと元の場所へ（装具・鈴・払った雪は保持）
    const c = this.sled.group.position;
    this.particles.puff(this.tmpV.set(c.x, 0.3, c.z), 60, 3.5, 1.6);
    this.sled.group.position.set(0.2, 0, 3.4);
    this.sled.group.rotation.set(0, 0, 0);
    this.sled.santa.rest();
    this.marks.reset();
    this.teamSpeed = 0;
    this.floatH = 0;
    this.launchCharge = 0;
    this.liftedOnce = false;
    this.runDist = 0;
    this.runIdleT = 0;
    for (const u of this.units) {
      // 接続を外す（カチッ）: 同じ接続行為をすぐ繰り返せる
      u.hook = -1;
      u.launchStage = -1;
      u.deer.settleToIdle();
      u.deer.setStretch(0);
      u.trace.pullStraight = 0;
      u.deer.root.position.copy(u.standHome);
      u.deer.root.rotation.y = 0;
      this.layTraceOut(u);
    }
    for (const l of this.leaders) {
      l.pullStraight = 0;
      l.releaseB();
      const i = this.leaders.indexOf(l);
      const a = this.sled.hooks[i].getWorldPosition(this.tmpV);
      const b = a.clone().add(new THREE.Vector3((i - 1) * 0.25, 0, -0.75));
      b.y = GROUND_Y + 0.05;
      l.layout(a, b, GROUND_Y);
    }
    audio.click(0.5);
    // 軽い雪の再積もり（もう一度ブラシ遊びができる）
    for (const u of this.units) {
      if (u.deer.snowCover < 0.2) u.deer.setSnowCover(0.3);
    }
    this.enterOutfit();
  }

  // =========================================================================
  // カメラショット
  // =========================================================================
  private shotOverview(portrait: boolean, out: { pos: THREE.Vector3; look: THREE.Vector3; fov: number }): void {
    // 自由モードで特定のトナカイに注目していないとき: 庭全体（装具・鈴・三頭・そり）
    if (this.phase === 'outfit' && !this.focusUnit) {
      if (portrait) {
        out.pos.set(0.1, 6.4, -8.2);
        out.look.set(0.1, -0.2, 0.3);
        out.fov = 66;
      } else {
        out.pos.set(0.2, 3.6, -8.0);
        out.look.set(0.15, 0.25, 0.4);
        out.fov = 54;
      }
      return;
    }
    const focusU = this.focusUnit ?? this.units[0];
    const dp = focusU.deer.root.position;
    const sp = this.sled.group.position;
    // トナカイ→そり軸を基準に、両者が画面内で分離する構図を組む
    const dir = this.tmpV.subVectors(sp, dp);
    dir.y = 0;
    const dLen = Math.max(0.001, dir.length());
    dir.divideScalar(dLen);
    const perpX = -dir.z, perpZ = dir.x;
    if (portrait) {
      // 一頭を大きく中央下、そりは奥＝画面上部寄りに残す（低いカメラ）
      out.pos.set(
        dp.x - dir.x * 4.2 + perpX * 0.45, 1.35,
        dp.z - dir.z * 4.2 + perpZ * 0.45);
      out.look.set(
        dp.x + (sp.x - dp.x) * 0.28, 0.8,
        dp.z + (sp.z - dp.z) * 0.28);
      out.fov = 56;
    } else {
      // 低めの3/4: トナカイ全身・手元・そり方向を同時に
      const mx = (dp.x + sp.x) / 2, mz = (dp.z + sp.z) / 2;
      out.pos.set(
        mx + perpX * 5.0 - dir.x * 1.2, 1.5,
        mz + perpZ * 5.0 - dir.z * 1.2);
      out.look.set(mx + dir.x * 0.3, 0.7, mz + dir.z * 0.3);
      out.fov = 48;
    }
    // 接続ドラッグ中は少しだけ寄る（近景: 線と金具 / 中景: 接続部 / 遠景: そり）
    // 注視・位置の基準はドラッグ点ではなく安定したアンカー（装具とそりの中間）
    if (this.connectCam > 0 && this.dragging?.kind === 'trace') {
      const unit = (this.dragging as { kind: 'trace'; unit: DeerUnit }).unit;
      const a = unit.wearable.dRing.getWorldPosition(this.tmpV2);
      const t = this.connectCam * 0.4;
      const mx2 = (a.x + sp.x) / 2, mz2 = (a.z + sp.z) / 2;
      out.pos.lerp(this.tmpV3.set(mx2 + perpX * 3.4 - dir.x * 0.6, 1.0, mz2 + perpZ * 3.4 - dir.z * 0.6), t);
      out.look.lerp(this.tmpV3.set(mx2, 0.45, mz2), t);
    }
  }

  private shotTeam(portrait: boolean, out: { pos: THREE.Vector3; look: THREE.Vector3; fov: number }): void {
    const sp = this.sled.group.position;
    const center = this.tmpV3.set(sp.x, 0.8, sp.z - 2.2);
    if (portrait) {
      out.pos.set(center.x - 1.7, 1.35, center.z - 4.4);
      out.look.set(center.x - 0.1, 0.9, center.z + 1.6);
      out.fov = 62;
    } else {
      out.pos.set(center.x - 5.6, 1.7, center.z - 0.6);
      out.look.set(center.x + 0.4, 0.75, center.z + 0.6);
      out.fov = 50;
    }
  }

  private shotRun(portrait: boolean, out: { pos: THREE.Vector3; look: THREE.Vector3; fov: number }): void {
    const sp = this.sled.group.position;
    const h = this.floatH;
    if (portrait) {
      out.pos.set(sp.x - 1.9, 1.4 + h * 0.75, sp.z + 3.3);
      out.look.set(sp.x - 0.2, 0.9 + h * 0.9, sp.z - 3.6);
      out.fov = 60;
    } else {
      out.pos.set(sp.x - 4.6, 1.6 + h * 0.7, sp.z + 2.2);
      out.look.set(sp.x + 0.6, 0.8 + h * 0.95, sp.z - 3.2);
      out.fov = 52;
    }
  }

  // =========================================================================
  // 毎フレーム更新
  // =========================================================================
  private jointDir = new THREE.Vector3();

  update(dt: number): void {
    this.elapsed += dt;
    this.phaseT += dt;
    dt = Math.min(dt, 0.05);

    // --- 歩行制御 -----------------------------------------------------------
    for (const u of this.units) {
      const deer = u.deer;
      if (u.walkTarget && this.phase !== 'run' && this.phase !== 'landing') {
        const pos = deer.root.position;
        const to = this.tmpV.subVectors(u.walkTarget, pos);
        to.y = 0;
        const dist = to.length();
        if (dist < 0.14) {
          u.walkTarget = null;
          deer.settleToIdle();
          const cb = u.walkArrive;
          u.walkArrive = undefined;
          cb?.();
        } else {
          const targetHeading = Math.atan2(-to.x, -to.z);
          let dh = targetHeading - deer.root.rotation.y;
          while (dh > Math.PI) dh -= Math.PI * 2;
          while (dh < -Math.PI) dh += Math.PI * 2;
          deer.root.rotation.y += THREE.MathUtils.clamp(dh, -dt * 2.2, dt * 2.2);
          deer.mode = 'walk';
          const spd = Math.min(1.1, 0.4 + dist * 0.6);
          deer.speed = spd;
          pos.addScaledVector(to.normalize(), Math.min(dist, spd * dt));
        }
      }
      deer.update(dt, this.elapsed);
    }

    // --- 走行・浮遊 ---------------------------------------------------------
    if (this.phase === 'run') {
      // スワイプの入力が続く間は加速、離すと緩やかに減速
      const targetSpeed = 0.7 + this.launchCharge * 5.6;
      this.teamSpeed += (targetSpeed - this.teamSpeed) * Math.min(1, dt * 1.1);
      this.launchCharge = Math.max(0, this.launchCharge - dt * 0.16);
      this.runDist += this.teamSpeed * dt;

      // 段階: 歩く → 速足 → 雪が流れる → ランナーが軽くなる → 浮く
      const spd = this.teamSpeed;
      const targetFloat = spd > 4.6 ? Math.min(1.15, (spd - 4.6) * 0.9) : 0;
      this.floatH += (targetFloat - this.floatH) * Math.min(1, dt * 1.3);
      if (this.floatH > 0.55) this.liftedOnce = true;

      for (const u of this.units) {
        u.deer.mode = this.floatH > 0.4 ? 'float' : spd > 2.1 ? 'trot' : 'walk';
        u.deer.speed = spd * (1 + Math.sin(this.elapsed * 0.8 + u.swayPhase) * 0.03);
        u.deer.setStretch(THREE.MathUtils.clamp(spd * 0.14, 0.1, 0.4) * (1 - this.floatH));
        u.deer.earAlert = 0.95;
        u.trace.pullStraight = 1;
        if (u.hook >= 0) this.leaders[u.hook].pullStraight = 1;
      }
      // 前進
      const move = this.tmpV.set(0, 0, -this.teamSpeed * dt);
      this.sled.group.position.add(move);
      for (const u of this.units) {
        u.deer.root.position.add(move);
        // 編成内でスロットへ滑らかに収束（足並み・左右の個性は残す）
        const slot = this.slotWorld(u.hook, this.tmpV2);
        slot.y = this.floatH * (0.9 + 0.15 * Math.sin(this.elapsed * 1.9 + u.swayPhase));
        slot.x += Math.sin(this.elapsed * 1.1 + u.swayPhase) * 0.06;
        u.deer.root.position.lerp(slot, Math.min(1, dt * 2.2));
        let dh = (0 - u.deer.root.rotation.y) % (Math.PI * 2);
        if (dh > Math.PI) dh -= Math.PI * 2;
        if (dh < -Math.PI) dh += Math.PI * 2;
        u.deer.root.rotation.y += dh * Math.min(1, dt * 2);
      }
      // そりの浮き・傾き
      const sledY = this.floatH * 0.82;
      this.sled.group.position.y += (sledY - this.sled.group.position.y) * Math.min(1, dt * 2);
      this.sled.group.rotation.x += ((this.floatH > 0.15 ? 0.10 : spd > 3.6 ? 0.03 : 0) - this.sled.group.rotation.x) * Math.min(1, dt * 2);

      // 雪の流れ・そり跡
      if (this.floatH < 0.3) {
        this.emitRunnerSpray(THREE.MathUtils.clamp(spd / 5, 0.2, 1));
        const l = this.tmpV2.set(-this.sled.runnerX, 0, 0.8);
        const r = this.tmpV3.set(this.sled.runnerX, 0, 0.8);
        this.sled.group.localToWorld(l);
        this.sled.group.localToWorld(r);
        this.marks.sledAt(l, r);
      }
      audio.setGlide(this.floatH > 0.3 ? 0.15 : THREE.MathUtils.clamp(spd / 6, 0, 1));
      audio.setWind(THREE.MathUtils.clamp((spd - 2) / 5, 0, 1) + this.floatH * 0.5);

      // 走り終わり: 一度浮いたあと、ゆっくり落ち着いたら着地へ。
      // また、長く指の入力が無ければ（浮かないまま歩き続けても）緩やかに終える
      if (this.launchCharge > 0.02 || this.floatH > 0.05) this.runIdleT = 0;
      else this.runIdleT += dt;
      if ((this.liftedOnce && spd < 1.1 && this.floatH < 0.08) ||
          (this.runIdleT > 14 && spd < 1.0)) {
        this.beginLanding();
      }
      // 距離の上限（雪原の端に来たら緩やかに終える）
      if (this.runDist > 60) this.launchCharge = 0;
      if (this.runDist > 78) this.beginLanding();
    } else if (this.phase === 'landing') {
      this.landingT += dt;
      this.teamSpeed = Math.max(0, this.teamSpeed - dt * 2.2);
      const move = this.tmpV.set(0, 0, -this.teamSpeed * dt);
      this.sled.group.position.add(move);
      this.sled.group.position.y = Math.max(0, this.sled.group.position.y - dt * 0.9);
      this.sled.group.rotation.x *= 0.95;
      for (const u of this.units) {
        u.deer.root.position.add(move);
        u.deer.root.position.y = Math.max(0, u.deer.root.position.y - dt * 0.9);
        u.deer.mode = this.teamSpeed > 0.2 ? 'walk' : 'idle';
        u.deer.speed = this.teamSpeed;
        u.deer.setStretch(0);
      }
      if (this.teamSpeed <= 0.02 && this.landingT > 1.6) {
        this.finishToFreeMode();
      }
      audio.setGlide(this.teamSpeed / 6);
      audio.setWind(0);
    } else {
      audio.setGlide(0);
      audio.setWind(0);
    }

    // --- 牽引線・リーダー・接続ジョイント -----------------------------------
    for (let i = 0; i < 3; i++) {
      const leader = this.leaders[i];
      const unit = this.units.find((u) => u.hook === i) ?? null;
      if (unit) {
        // ジョイント位置: フックからトナカイのD環へ向けリーダー長ぶん進んだ点
        const hp = this.sled.hooks[i].getWorldPosition(this.tmpV);
        const dp = unit.wearable.dRing.getWorldPosition(this.tmpV2);
        this.jointDir.subVectors(dp, hp);
        const total = this.jointDir.length();
        this.jointDir.normalize();
        const leaderReach = Math.min(leader.restLength * 0.92, total * (leader.restLength / (leader.restLength + unit.trace.restLength)));
        const jp = hp.clone().addScaledVector(this.jointDir, leaderReach);
        // たるみがあるときは接続部が下がる
        const slackAll = Math.max(0, leader.restLength + unit.trace.restLength - total);
        const pull = Math.max(unit.trace.pullStraight, leader.pullStraight);
        jp.y -= slackAll * 0.5 * (1 - pull);
        jp.y = Math.max(jp.y, GROUND_Y + 0.06);
        this.joints[i].position.copy(jp);
      }
      leader.update(dt, GROUND_Y);
    }
    for (const u of this.units) {
      if (u.wearable.state === 'fitted') {
        u.trace.update(dt, GROUND_Y, 0.34);
      } else {
        u.trace.setVisible(false);
      }
      if (u.wearable.state === 'fitted') u.trace.setVisible(true);
      u.wearable.update(dt);
      if (u.wearable instanceof BreastHarness) u.wearable.updateStrap(dt);
    }

    // --- 鈴・ブラシ・サンタ ---------------------------------------------------
    this.bells.update(dt);
    this.brush.update(dt);
    this.sled.santa.update(dt);
    if (this.phase === 'ready' || this.phase === 'launch') {
      this.sled.santa.raiseTarget = Math.max(this.sled.santa.raiseTarget, 0.4);
    }

    // --- カメラ・フォーカス --------------------------------------------------
    this.updateCameraFocus(dt);
    this.rig.update(dt);

    // --- 粒子 ---------------------------------------------------------------
    const camFocus = this.phase === 'run' || this.phase === 'landing'
      ? this.sled.group.position
      : (this.focusUnit?.deer.root.position ?? this.units[0].deer.root.position);
    this.particles.update(dt, camFocus);

    // ドラッグしていないときの connectCam 減衰
    if (!this.dragging || this.dragging.kind !== 'trace') {
      this.connectCam = Math.max(0, this.connectCam - dt * 1.6);
    }
    this.refreshPickables();
  }

  private emitRunnerSpray(strength: number): void {
    for (const sx of [-this.sled.runnerX, this.sled.runnerX]) {
      const p = this.tmpV.set(sx, 0.03, -0.9);
      this.sled.group.localToWorld(p);
      this.particles.puff(p, Math.ceil(2 * strength), 0.14, 0.5 * strength,
        this.tmpV2.set(0, 0, 1.6 * strength));
    }
  }

  /** 検証用の固定カメラ（?cam=side|front|tq|back を URL に付けたときだけ） */
  private debugCamMode: string | null =
    typeof location !== 'undefined' ? new URLSearchParams(location.search).get('cam') : null;

  private updateCameraFocus(dt: number): void {
    if (this.debugCamMode) {
      const dp = this.units[0].deer.root.position;
      const m = this.debugCamMode;
      this.rig.setShot((portrait, out) => {
        if (m === 'side') {
          out.pos.set(dp.x - 3.0, 1.1, dp.z + 0.1);
          out.look.set(dp.x, 0.85, dp.z + 0.1);
        } else if (m === 'front') {
          out.pos.set(dp.x - 0.6, 1.0, dp.z - 2.8);
          out.look.set(dp.x, 0.9, dp.z);
        } else if (m === 'back') {
          out.pos.set(dp.x + 0.9, 1.2, dp.z + 2.6);
          out.look.set(dp.x, 0.85, dp.z);
        } else {
          out.pos.set(dp.x - 2.2, 1.25, dp.z - 1.9);
          out.look.set(dp.x, 0.8, dp.z + 0.1);
        }
        out.fov = 46;
      }, true, 50);
      return;
    }
    // ドラッグ中はショットを一切変えない（指の下で世界がずれないように完全固定）
    if (this.dragging) return;
    if (this.phase === 'intro' || this.phase === 'firstConnect' || this.phase === 'outfit') {
      this.idleCamT += dt;
      // 操作対象のトナカイに寄り、少し経ったら装具の見える全景へ戻る
      if (this.idleCamT > 4.5 && this.focusUnit) {
        this.focusUnit = null;
      }
      this.rig.setShot((portrait, out) => this.shotOverview(portrait, out), false, 1.5);
    }
  }

  // =========================================================================
  // 検証フック
  // =========================================================================
  private setupDebugMarkers(): void {
    const g = this;
    for (let i = 0; i < 3; i++) {
      const unit = this.units[i];
      this.debugMarkers.set(`trace${i}`, () => unit.trace.endB.clone());
      this.debugMarkers.set(`leader${i}`, () => g.leaders[i].endB.clone());
      this.debugMarkers.set(`deer${i}`, () => {
        const v = unit.deer.root.position.clone();
        v.y += 0.8;
        return v;
      });
      this.debugMarkers.set(`bell${i}`, () => {
        const v = new THREE.Vector3();
        g.bells.bellWorld(i, v);
        return v;
      });
    }
    this.debugMarkers.set('brush', () => this.brush.group.getWorldPosition(new THREE.Vector3()));
    this.debugMarkers.set('collar1', () => this.units[1].wearable.grabWorld(new THREE.Vector3()));
    this.debugMarkers.set('harness2', () => this.units[2].wearable.grabWorld(new THREE.Vector3()));
    this.debugMarkers.set('strap2', () =>
      (this.units[2].wearable as BreastHarness).strapEnd.getWorldPosition(new THREE.Vector3()));
    this.debugMarkers.set('sled', () => this.sled.group.position.clone());
    this.debugMarkers.set('collarSocket1', () => {
      const v = this.units[1].deer.root.position.clone();
      v.y += 1.0;
      v.z -= 0.6;
      return v;
    });
    for (let i = 0; i < 3; i++) {
      const unit = this.units[i];
      this.debugMarkers.set(`neck${i}`, () => {
        const v = new THREE.Vector3();
        unit.deer.collarSocket.getWorldPosition(v);
        return v;
      });
      this.debugMarkers.set(`chest${i}`, () => {
        const v = new THREE.Vector3();
        unit.deer.chestSocket.getWorldPosition(v);
        return v;
      });
      this.debugMarkers.set(`loop${i}a`, () => {
        const v = new THREE.Vector3();
        const loops = unit.wearable.bellLoops;
        if (loops.length) loops[0].anchor.getWorldPosition(v);
        return v;
      });
      this.debugMarkers.set(`buckle2`, () => {
        const v = new THREE.Vector3();
        (this.units[2].wearable as BreastHarness).buckleTarget.getWorldPosition(v);
        return v;
      });
    }
  }

  /** テスト用: 名前からスクリーン座標を得る */
  screenPosOf(name: string, w: number, hpx: number): { x: number; y: number } | null {
    const fn = this.debugMarkers.get(name);
    if (!fn) return null;
    const v = fn().project(this.rig.camera);
    return { x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * hpx };
  }

  get stateSummary(): Record<string, unknown> {
    return {
      phase: this.phase,
      hooks: this.units.map((u) => u.hook),
      wear: this.units.map((u) => u.wearable.state),
      buckled: (this.units[2].wearable as BreastHarness).buckled,
      snow: this.units.map((u) => +u.deer.snowCover.toFixed(2)),
      bells: this.bells.bells.map((b) => (b.attachedLoop ? 'on' : 'rack')),
      teamSpeed: +this.teamSpeed.toFixed(2),
      floatH: +this.floatH.toFixed(2),
      liftedOnce: this.liftedOnce,
      runDist: +this.runDist.toFixed(1),
      cam: this.rig.camera.position.toArray().map((v) => +v.toFixed(2)),
      deer0: this.units[0].deer.root.position.toArray().map((v) => +v.toFixed(2)),
      lastPick: this.lastPickId,
      dragKind: this.dragging?.kind ?? null,
      t0: this.units[0].trace.endB.toArray().map((v) => +v.toFixed(2)),
      l0: this.leaders[0].endB.toArray().map((v) => +v.toFixed(2)),
      dRing0: this.units[0].wearable.dRing.getWorldPosition(new THREE.Vector3()).toArray().map((v) => +v.toFixed(2))
    };
  }

  /** テスト用: スワイプ相当の加速入力 */
  debugSwipeImpulse(amount: number): void {
    this.launchCharge = Math.min(1, this.launchCharge + amount);
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
