import * as THREE from 'three';
import { LabScene, type CameraShot } from '../render3d/lab';
import { QualityController } from './quality';
import { GameClock, formatClock } from './clock';
import { AIR, LiveRun, summarize, type RunLog } from '../sim/engine';
import { expectedBaths, expectedStepText } from '../sim/progress';
import { BATHS, BATH_INDEX, STATIONS, bathById, TEACHING, type StationId } from '../sim/protocol';
import { DIM, SECTION } from '../sim/geometry';
import { jarLayout } from '../render3d/jar';
import { simulateMounting, type MountParams } from '../sim/mounting';
import { Audio } from './audio';

const SECTION_H = SECTION.y1 - SECTION.y0;
/** ラック底の可動範囲(mm)。 */
const RACK_MIN_Y = DIM.jar.wall;
const RACK_MAX_Y = 165;
/** 槽の縁を越えて横移動できる高さ。 */
const TRANSPORT_Y = 92;

export type Mode = 'practice' | 'exam';
export type MagnifyMode = 'auto' | 'ondemand' | 'off';
export type MountPhase = 'take' | 'dispense' | 'place' | 'lower' | 'done';

export interface GameCallbacks {
  onHud: () => void;
  onMountPhase: (p: MountPhase) => void;
  onFinished: () => void;
  onHint: (text: string | null) => void;
  /** 練習モードで手順から外れたときの確認。実践モードでは呼ばない。 */
  onConfirm: (text: string, onYes: () => void) => void;
}

interface Transition {
  t: number;
  dur: number;
  fromX: number;
  toX: number;
  fromY: number;
  toY: number;
  jarTo: string | null;
  stationTo: StationId | null;
}

/** ラックと封入操作の実体。描画とシミュレーションを結ぶ。 */
export class Game {
  renderer: THREE.WebGLRenderer;
  lab: LabScene;
  quality: QualityController;
  clock = new GameClock();
  audio = new Audio();
  run: LiveRun;
  mode: Mode;
  magnify: MagnifyMode;
  station: StationId = 'deparaffin';
  currentJar: string | null = null;
  rackY = TRANSPORT_Y;
  rackX = 0;
  rackZ = 0;
  phase: 'play' | 'mount' | 'finished' = 'play';
  mountPhase: MountPhase = 'take';
  mount: MountParams = {
    volumeUl: 0,
    dropY: 27,
    dropX: 0,
    slipY: DIM.coverDefaultY,
    angleSamples: [],
  };
  private coverAngle = 30;
  private coverStartedAt = -1;
  private lastFrontPreview = -1;
  blockMistakes = false;
  statusText = '';
  private cb: GameCallbacks;
  private canvas: HTMLCanvasElement;
  private shot: CameraShot;
  private shotTarget: CameraShot;
  private transition: Transition | null = null;
  private raf = 0;
  private lastFrame = 0;
  private disposed = false;
  private contextLost = false;
  private firstHintShown = false;

  constructor(
    canvas: HTMLCanvasElement,
    opts: { mode: Mode; magnify: MagnifyMode; seed: string; resumeLog?: RunLog; station?: StationId },
    cb: GameCallbacks,
  ) {
    this.canvas = canvas;
    this.cb = cb;
    this.mode = opts.mode;
    this.magnify = opts.magnify;
    this.run = opts.resumeLog ? LiveRun.resume(opts.resumeLog) : new LiveRun(opts.seed);
    // 画質は自動判定だが、?q=low|medium|high で固定できる（低速な環境や検証用）
    const q = new URLSearchParams(location.search).get('q');
    this.quality = new QualityController(q === 'low' || q === 'medium' || q === 'high' ? q : undefined);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this.quality.tier !== 'low',
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
    this.renderer.setPixelRatio(this.quality.dpr);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.shadowMap.enabled = this.quality.tier !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.lab = new LabScene(this.renderer, this.quality.tier);
    this.shot = { ...this.lab.stationShot('deparaffin') };
    this.shotTarget = this.shot;
    this.applyShot(1);
    const startStation: StationId = opts.station ?? 'deparaffin';
    this.station = startStation;
    this.shot = this.lab.stationShot(startStation);
    this.shotTarget = this.shot;
    this.lab.setVisibleStations(startStation);
    if (startStation === 'mount') {
      this.phase = 'mount';
      this.shotTarget = this.lab.stationShot('mount');
      this.shot = { ...this.shotTarget, look: this.shotTarget.look.clone() };
      this.applyShot(1);
    } else {
      this.selectJar(this.jarsOfStation(startStation)[0], true);
    }
    this.run.station(startStation);

    this.quality.onChange = (t, dpr) => {
      this.renderer.setPixelRatio(dpr);
      this.renderer.shadowMap.enabled = t !== 'low';
      this.resize();
    };

    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    window.addEventListener('resize', this.resize);
    window.addEventListener('orientationchange', this.onOrientation);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.resize();
  }

  // -------------------------------------------------------------------------
  // 基本
  // -------------------------------------------------------------------------

  jarsOfStation(id: StationId): string[] {
    return BATHS.filter((b) => b.station === id).sort((a, b) => a.slot - b.slot).map((b) => b.id);
  }

  get liquidTopY(): number {
    return DIM.liquidDepth;
  }

  /** 現在の浸漬レベル（0 = 切片下端が液面、1 = 切片上端が液面）。 */
  get level(): number {
    const secBottom = this.rackY + DIM.slideRestY + SECTION.y0;
    return (this.liquidTopY - secBottom) / SECTION_H;
  }

  get bathIndex(): number {
    if (this.phase !== 'play' || !this.currentJar) return AIR;
    if (this.transition) return AIR;
    return this.level > 0 ? BATH_INDEX[this.currentJar] : AIR;
  }

  get dipsHere(): number {
    return this.currentJar ? this.run.state.baths[BATH_INDEX[this.currentJar]].dips : 0;
  }

  get secondsHere(): number {
    return this.currentJar ? this.run.state.baths[BATH_INDEX[this.currentJar]].usedSec : 0;
  }

  selectJar(id: string, instant = false): void {
    const p = this.lab.jarPos.get(id);
    if (!p) return;
    this.currentJar = id;
    this.rackX = p.x;
    this.rackZ = p.z;
    this.shotTarget = this.lab.jarShot(id);
    if (instant) {
      this.shot = { ...this.shotTarget, look: this.shotTarget.look.clone() };
      this.applyShot(1);
    }
    this.cb.onHud();
  }

  goStation(id: StationId): void {
    if (this.transition || this.station === id) return;
    this.station = id;
    this.lab.setVisibleStations(id);
    this.run.station(id);
    if (id === 'mount') {
      this.phase = 'mount';
      this.mountPhase = 'take';
      this.currentJar = null;
      this.shotTarget = this.lab.stationShot('mount');
      this.cb.onMountPhase(this.mountPhase);
      this.cb.onHud();
      return;
    }
    this.phase = 'play';
    const jars = this.jarsOfStation(id);
    const target = this.lab.jarPos.get(jars[0])!;
    this.transition = {
      t: 0,
      dur: 0.9,
      fromX: this.rackX,
      toX: target.x,
      fromY: this.rackY,
      toY: TRANSPORT_Y,
      jarTo: jars[0],
      stationTo: id,
    };
    this.cb.onHud();
  }

  stepStation(dir: 1 | -1): void {
    const i = STATIONS.findIndex((s) => s.id === this.station);
    const n = Math.max(0, Math.min(STATIONS.length - 1, i + dir));
    if (n !== i) this.goStation(STATIONS[n].id);
  }

  /** 水洗槽の水を新しいものに置き換える（同じ古い水に戻すのとは別扱い）。 */
  refreshJar(): boolean {
    const id = this.currentJar;
    if (!id) return false;
    const def = bathById(id);
    if (!def.replaceable) return false;
    if (this.level > 0) return false;
    this.run.refresh(id);
    this.statusText = `${def.labelJa} の水を交換しました（${this.run.state.baths[BATH_INDEX[id]].generation} 回目）`;
    this.cb.onHud();
    return true;
  }

  // -------------------------------------------------------------------------
  // 入力（ラック）
  // -------------------------------------------------------------------------

  private dragging = false;
  private dragPointer = -1;
  private dragStartY = 0;
  private dragStartX = 0;
  private dragBaseRackY = 0;
  private movedX = false;

  /** ラックをつかめる画面上の位置か。指が対象を隠さないようオフセットを設ける。 */
  grabHandleScreen(): { x: number; y: number } | null {
    if (this.phase !== 'play' || !this.currentJar) return null;
    const world = new THREE.Vector3(this.rackX, this.rackY + DIM.rack.h + DIM.rack.handleH * 0.6, this.rackZ);
    const p = world.clone().project(this.lab.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: ((p.x + 1) / 2) * r.width, y: ((1 - p.y) / 2) * r.height };
  }

  canGrab(clientX: number, clientY: number): boolean {
    const h = this.grabHandleScreen();
    if (!h) return false;
    const r = this.canvas.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    // 指の下にラックが隠れないよう、掴む位置は取っ手より少し下に取る
    return Math.hypot(x - h.x, y - (h.y + 60)) < 130;
  }

  beginDrag(pointerId: number, clientX: number, clientY: number): boolean {
    if (this.transition || this.phase !== 'play') return false;
    if (!this.canGrab(clientX, clientY)) return false;
    this.dragging = true;
    this.dragPointer = pointerId;
    this.dragStartY = clientY;
    this.dragStartX = clientX;
    this.dragBaseRackY = this.rackY;
    this.movedX = false;
    return true;
  }

  moveDrag(pointerId: number, clientX: number, clientY: number): void {
    if (!this.dragging || pointerId !== this.dragPointer) return;
    const dx = clientX - this.dragStartX;
    const dy = clientY - this.dragStartY;
    if (!this.movedX && Math.abs(dx) > 46 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      this.movedX = true;
      this.moveToNeighbour(dx > 0 ? 1 : -1);
      return;
    }
    if (this.movedX) return;
    const gain = this.worldPerPixel();
    this.rackY = Math.max(RACK_MIN_Y, Math.min(RACK_MAX_Y, this.dragBaseRackY - dy * gain));
  }

  endDrag(pointerId: number): void {
    if (pointerId !== this.dragPointer) return;
    this.dragging = false;
    this.dragPointer = -1;
  }

  cancelDrag(): void {
    this.dragging = false;
    this.dragPointer = -1;
  }

  get isDragging(): boolean {
    return this.dragging;
  }

  /** 画面 1px あたりのワールド Y 移動量。ラックが指に追従して見えるようにする。 */
  private worldPerPixel(): number {
    const cam = this.lab.camera;
    const a = new THREE.Vector3(this.rackX, this.rackY + 40, this.rackZ).project(cam);
    const b = new THREE.Vector3(this.rackX, this.rackY + 41, this.rackZ).project(cam);
    const r = this.canvas.getBoundingClientRect();
    const px = Math.abs((a.y - b.y) * 0.5 * r.height);
    return px > 0.05 ? 1 / px : 0.3;
  }

  /** 練習モードの「誤操作を止める」設定で、手順から外れた移動を確認する。 */
  private guard(bathId: string, go: () => void): void {
    if (!this.blockMistakes || this.mode !== 'practice') {
      go();
      return;
    }
    const sum = summarize(this.run.log);
    const exp = expectedBaths(sum);
    if (exp.includes(bathId)) {
      go();
      return;
    }
    this.cb.onConfirm(
      `手順書では次は「${expectedStepText(sum)}」です。それでも ${bathById(bathId).labelJa} へ移しますか。`,
      go,
    );
  }

  /** 隣の槽へ移す。縁との衝突を避けるための持ち上げだけを補助する。 */
  private moveToNeighbour(dir: 1 | -1): void {
    if (!this.currentJar) return;
    const layout = jarLayout(this.station);
    const i = layout.findIndex((l) => l.id === this.currentJar);
    const n = i + dir;
    if (n < 0 || n >= layout.length) {
      this.statusText = dir > 0 ? 'この工程の右端です' : 'この工程の左端です';
      this.cb.onHud();
      return;
    }
    this.guard(layout[n].id, () => this.travelTo(layout[n].id, layout[n].x, layout[n].z, 0.55));
  }

  private travelTo(jarId: string, lx: number, lz: number, dur: number): void {
    const st = STATIONS.find((s) => s.id === this.station)!;
    this.rackZ = lz;
    this.transition = {
      t: 0,
      dur,
      fromX: this.rackX,
      toX: st.benchX + lx,
      fromY: this.rackY,
      toY: TRANSPORT_Y,
      jarTo: jarId,
      stationTo: null,
    };
  }


  /** 画面タップで槽を選ぶ（レイキャスト）。 */
  pickJar(clientX: number, clientY: number): string | null {
    if (this.phase !== 'play') return null;
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.lab.camera);
    let best: { id: string; d: number } | null = null;
    for (const id of this.jarsOfStation(this.station)) {
      const jar = this.lab.jars.get(id)!;
      const box = new THREE.Box3().setFromObject(jar.group);
      const hit = ray.ray.intersectBox(box, new THREE.Vector3());
      if (hit) {
        const d = hit.distanceTo(this.lab.camera.position);
        if (!best || d < best.d) best = { id, d };
      }
    }
    return best?.id ?? null;
  }

  tapJar(clientX: number, clientY: number): void {
    const id = this.pickJar(clientX, clientY);
    if (!id || id === this.currentJar || this.transition) return;
    const layout = jarLayout(this.station);
    const to = layout.find((l) => l.id === id)!;
    this.guard(id, () => this.travelTo(id, to.x, to.z, 0.6));
  }

  // -------------------------------------------------------------------------
  // 封入
  // -------------------------------------------------------------------------

  takeSlideFromRack(): void {
    if (this.mountPhase !== 'take') return;
    this.lab.rack.slideGroup.visible = false;
    this.mountPhase = 'dispense';
    this.lab.mountStage.setDispenser(true, this.mount.dropX, this.mount.dropY);
    this.lab.mountStage.setVolume(0, this.mount.dropX, this.mount.dropY);
    this.cb.onMountPhase(this.mountPhase);
    this.cb.onHud();
  }

  moveDispenser(dxMm: number, dyMm: number): void {
    if (this.mountPhase !== 'dispense') return;
    this.mount.dropX = Math.max(-9, Math.min(9, this.mount.dropX + dxMm));
    this.mount.dropY = Math.max(6, Math.min(DIM.slide.len - 26, this.mount.dropY + dyMm));
    this.lab.mountStage.setDispenser(true, this.mount.dropX, this.mount.dropY);
    this.lab.mountStage.setVolume(this.mount.volumeUl, this.mount.dropX, this.mount.dropY);
    this.cb.onHud();
  }

  squeeze(dtSec: number): void {
    if (this.mountPhase !== 'dispense') return;
    // 押し出す速さ [教材係数]: 1 秒あたり 16 µL
    this.mount.volumeUl = Math.min(80, this.mount.volumeUl + dtSec * 16);
    this.lab.mountStage.setVolume(this.mount.volumeUl, this.mount.dropX, this.mount.dropY);
    this.cb.onHud();
  }

  finishDispense(): void {
    if (this.mountPhase !== 'dispense' || this.mount.volumeUl <= 0) return;
    this.mountPhase = 'place';
    this.lab.mountStage.setDispenser(false, 0, 0);
    this.coverAngle = 30;
    this.lab.mountStage.setAngle(this.coverAngle);
    this.lab.mountStage.setSlipY(this.mount.slipY);
    this.mount.angleSamples = [];
    this.coverStartedAt = -1;
    this.cb.onMountPhase(this.mountPhase);
    this.cb.onHud();
  }

  beginLower(): void {
    if (this.mountPhase !== 'place') return;
    this.mountPhase = 'lower';
    this.cb.onMountPhase(this.mountPhase);
    this.cb.onHud();
  }

  moveCoverEdge(dyMm: number): void {
    if (this.mountPhase !== 'place') return;
    this.mount.slipY = Math.max(0, Math.min(DIM.slide.len - DIM.cover.len, this.mount.slipY + dyMm));
    this.lab.mountStage.setSlipY(this.mount.slipY);
    this.cb.onHud();
  }

  lowerCover(deltaDeg: number): void {
    if (this.mountPhase !== 'lower') return;
    if (this.coverStartedAt < 0) {
      this.coverStartedAt = this.clock.opSec;
      this.lastFrontPreview = -1;
      this.mount.angleSamples.push({ t: 0, deg: this.coverAngle });
    }
    this.coverAngle = Math.max(0, Math.min(45, this.coverAngle + deltaDeg));
    this.lab.mountStage.setAngle(this.coverAngle);
    const t = this.clock.opSec - this.coverStartedAt;
    const last = this.mount.angleSamples[this.mount.angleSamples.length - 1];
    if (!last || t - last.t > 0.02) this.mount.angleSamples.push({ t, deg: this.coverAngle });
    // 下ろしている最中も、同じモデルを途中で止めて封入剤の前線を見せる
    if (t - this.lastFrontPreview > 0.12) {
      this.lastFrontPreview = t;
      this.lab.mountStage.showResult(simulateMounting({ ...this.mount, angleSamples: this.mount.angleSamples.slice() }, t));
    }
    if (this.coverAngle <= 0.01) this.completeMount();
  }

  get coverAngleDeg(): number {
    return this.coverAngle;
  }

  private completeMount(): void {
    if (this.mountPhase !== 'lower') return;
    this.mountPhase = 'done';
    this.run.mount({ ...this.mount, angleSamples: this.mount.angleSamples.slice() });
    this.audio.glassTick();
    this.lab.mountStage.showResult(this.run.state.mount);
    this.lab.mountStage.updateSection(this.run.state);
    this.phase = 'finished';
    this.cb.onMountPhase(this.mountPhase);
    this.cb.onFinished();
  }

  // -------------------------------------------------------------------------
  // ループ
  // -------------------------------------------------------------------------

  start(): void {
    this.lastFrame = performance.now();
    const loop = (now: number) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      if (this.contextLost) return;
      const t0 = performance.now();
      const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      this.frame(dt);
      this.quality.sample(performance.now() - t0, now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private frame(dt: number): void {
    this.updateTransition(dt);

    // --- 加速率を決める。長い浸漬の時計だけを加速し、ディップは加速しない。
    const accel = this.currentAccel(dt);
    const ticks = this.clock.advance(dt, accel);
    for (let i = 0; i < ticks; i++) {
      const before = this.dipsHere;
      this.run.pushTick(this.bathIndex, this.level);
      if (this.currentJar && this.dipsHere !== before) this.cb.onHud();
    }

    // --- 液切りの滴
    if (ticks > 0 && this.bathIndex === AIR && this.currentJar && this.level > -0.9 && this.rackY < 120) {
      this.dripAccum += ticks * TEACHING.tickSec;
      if (this.dripAccum > 0.55 && this.run.state.film.totalVol() > TEACHING.filmBase * 0.4) {
        this.dripAccum = 0;
        this.lab.rack.spawnDrip(this.rackY + DIM.slideRestY + 4);
        this.audio.drip();
      }
    }

    // --- 液面の出入り・底当たりに音を同期させる
    const lv = this.level;
    if (this.prevLevelForSound !== null) {
      if (this.prevLevelForSound <= 0 && lv > 0) this.audio.liquid(Math.min(1.4, Math.abs(lv - this.prevLevelForSound) * 6));
      else if (this.prevLevelForSound > 0 && lv <= 0) this.audio.liquid(0.7);
    }
    this.prevLevelForSound = lv;
    if (this.rackY <= RACK_MIN_Y + 0.6 && !this.hitBottom) {
      this.hitBottom = true;
      this.audio.metalTick();
    } else if (this.rackY > RACK_MIN_Y + 3) this.hitBottom = false;

    // --- ラックの位置と揺れ
    const prevX = this.lab.rack.group.position.x;
    const prevY = this.lab.rack.group.position.y;
    this.lab.rack.group.position.set(this.rackX, this.rackY, this.rackZ);
    if (this.currentJar) {
      const jar = this.lab.jars.get(this.currentJar);
      jar?.nudge((this.rackX - prevX) / Math.max(dt, 1e-3) * 0.02, (this.rackY - prevY) / Math.max(dt, 1e-3) * 0.02);
    }

    // 切片のテクスチャは毎フレーム作り直さない（1 秒あたり 5 回で十分）
    this.sectionRefresh += dt;
    if (this.sectionRefresh > 0.2) {
      this.sectionRefresh = 0;
      this.lab.rack.updateSection(this.run.state);
      if (this.phase === 'mount') this.lab.mountStage.updateSection(this.run.state);
    }
    this.lab.rack.updateFilm(this.run.state);

    // --- カメラ
    const focus = this.isDragging || this.phase === 'mount' ? 1 : 0.75;
    this.applyShot(Math.min(1, dt * (3.2 + focus)));
    this.lab.update(dt);
    this.renderer.render(this.lab.scene, this.lab.camera);

    if (!this.firstHintShown && this.mode === 'practice') {
      this.firstHintShown = true;
      this.cb.onHint(
        'まずキシレン I の上でラックをつかみ、下へドラッグして切片全体を液面下に沈めてください。' +
          '沈めたまま待つと、長い浸漬の時計だけが加速します。',
      );
    }
  }

  private dripAccum = 0;
  private sectionRefresh = 0;
  private prevLevelForSound: number | null = null;
  private hitBottom = false;

  private stillSec = 0;

  /**
   * その瞬間の加速率。
   * 「静かに沈めたまま待っている長い浸漬」の時計だけを加速する。
   * ディップ（往復）中はラックが動いているので加速せず、回数が水増しされることはない。
   * 分別（酸アルコール）は短時間の操作なので加速しない（反射神経を測らないよう、
   * こちらは実時間で扱い、目安到達で自動的に引き上げることもしない）。
   */
  private currentAccel(dt: number): number {
    if (this.phase !== 'play' || !this.currentJar || this.transition || this.dragging || this.clock.paused) {
      this.stillSec = 0;
      return 1;
    }
    const def = bathById(this.currentJar);
    if (def.kind === 'acid_alcohol' || this.level < 1) {
      this.stillSec = 0;
      return 1;
    }
    this.stillSec += dt;
    // 1.5 秒静止してから徐々に加速する（急に時間が飛ばない）
    const ramp = Math.max(0, Math.min(1, (this.stillSec - 1.0) / 1.0));
    return 1 + (GameClock.MAX_ACCEL - 1) * ramp;
  }

  private updateTransition(dt: number): void {
    const tr = this.transition;
    if (!tr) return;
    tr.t += dt;
    const u = Math.min(1, tr.t / tr.dur);
    const e = u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);
    // まず持ち上げ、次に水平移動する（縁との衝突を避ける補助）
    const lift = Math.min(1, u / 0.35);
    this.rackY = tr.fromY + (Math.max(tr.toY, tr.fromY) - tr.fromY) * lift;
    if (u > 0.3) this.rackX = tr.fromX + (tr.toX - tr.fromX) * ((e - 0.18) / 0.82);
    if (u >= 1) {
      this.rackX = tr.toX;
      this.rackY = tr.toY;
      this.transition = null;
      if (tr.jarTo) this.selectJar(tr.jarTo);
      if (tr.stationTo) this.shotTarget = this.lab.jarShot(tr.jarTo ?? this.currentJar!);
      this.cb.onHud();
    }
  }

  private applyShot(k: number): void {
    const c = this.lab.camera;
    this.shot.look.lerp(this.shotTarget.look, k);
    this.shot.dist += (this.shotTarget.dist - this.shot.dist) * k;
    this.shot.pitch += (this.shotTarget.pitch - this.shot.pitch) * k;
    this.shot.widthMm += (this.shotTarget.widthMm - this.shot.widthMm) * k;
    this.shot.heightMm += (this.shotTarget.heightMm - this.shot.heightMm) * k;

    const pr = THREE.MathUtils.degToRad(this.shot.pitch);
    c.position.set(
      this.shot.look.x,
      this.shot.look.y + Math.sin(pr) * this.shot.dist,
      this.shot.look.z + Math.cos(pr) * this.shot.dist,
    );
    c.lookAt(this.shot.look);

    // 見せたい横幅と高さの両方が収まるように縦画角を決める。
    // 縦画面では横幅が、横画面では高さが効く。
    const aspect = Math.max(0.3, c.aspect);
    const hHalf = Math.atan(this.shot.widthMm / 2 / this.shot.dist);
    const fovFromWidth = 2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(hHalf) / aspect));
    const fovFromHeight = 2 * THREE.MathUtils.radToDeg(Math.atan(this.shot.heightMm / 2 / this.shot.dist));
    const fov = Math.min(80, Math.max(fovFromWidth, fovFromHeight));
    if (Math.abs(c.fov - fov) > 0.02) {
      c.fov = fov;
      c.updateProjectionMatrix();
    }
  }

  // -------------------------------------------------------------------------
  // ライフサイクル
  // -------------------------------------------------------------------------

  resize = (): void => {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    this.renderer.setSize(w, h, false);
    this.lab.camera.aspect = w / h;
    this.applyShot(1);
  };

  private onOrientation = (): void => {
    this.clock.paused = true;
    setTimeout(() => {
      this.resize();
      this.clock.paused = false;
    }, 320);
  };

  private onVisibility = (): void => {
    this.clock.paused = document.hidden;
  };

  private onContextLost = (e: Event): void => {
    e.preventDefault();
    this.contextLost = true;
    this.clock.paused = true;
    this.statusText = '描画コンテキストが失われました。復帰を待っています…';
    this.cb.onHud();
  };

  private onContextRestored = (): void => {
    this.contextLost = false;
    this.clock.paused = false;
    this.statusText = '';
    this.resize();
    this.cb.onHud();
  };

  setPaused(v: boolean): void {
    this.clock.paused = v;
  }

  hudClock(): string {
    const accel = this.clock.accel > 1.01 ? ` <span class="accel">×${this.clock.accel.toFixed(0)} 加速中</span>` : '';
    return `教材内経過 <b>${formatClock(this.clock.modelSec)}</b> / 実操作 ${formatClock(this.clock.opSec)}${accel}`;
  }

  summary() {
    return summarize(this.run.log);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('orientationchange', this.onOrientation);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.audio.dispose();
    this.lab.dispose();
    this.renderer.dispose();
  }
}
