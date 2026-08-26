// ============================================================
// プリントジョブ: 経路→ステーション列→送り速度計画→押出の実行。
// - 台形速度計画（前後パス）で角の減速を機械的に再現（瞬間旋回なし）
// - 各層はフラット。層端はテーパーで材料が細って切れ、
//   層替わりはノズルが小さくリフトして次層へ（実機のZシーム相当）
// - 開放壁は層ごとに往復印刷
// - タイムスケール: 第1層ほぼ実時間 → 2,3層短縮 → 数秒のタイムラプス
//   （見せ場の角ではタイムラプスを緩めて減速を見せる）
// ============================================================

import { DIM, TIMING } from '../config';
import { WallPath } from '../path/process';
import { BeadBuilder, RingInput } from '../geometry/bead';
import { clamp, lerp } from '../util/math2d';

interface Station {
  x: number; z: number; tx: number; tz: number;
  curv: number; widthF: number; heightF: number;
  s: number;        // 層内の進行距離
  vPlan: number;    // 計画送り速度 m/s
  taper: number;    // 端部絞り 0..1
}

export interface HeadState {
  x: number; y: number; z: number;
  tx: number; tz: number;
  v: number;            // 実際の移動速度（タイムスケール込み, m/s）
  vMachine: number;     // 機械送り速度（実時間, m/s）
  flow: number;         // 押出係数 0..1
  layer: number;        // 1-based
  layersTotal: number;
  phase: 'first' | 'early' | 'lapse' | 'done';
  layerProgress: number;
  curv: number;
  lifted: number;       // 層替わりリフト 0..1
}

const TAPER_OPEN = 0.075;  // 開放端テーパー長
const TAPER_SEAM = 0.05;   // 閉曲線シームのテーパー長
const STANDOFF = 0.003;    // ノズル先端と押出面の隙間

export class PrintJob {
  private path: WallPath;
  private builder: BeadBuilder;
  private stationsFwd: Station[];
  private stationsRev: Station[] = [];
  private perim: number;
  private layer = 1;
  private sArc = 0;
  private stationIdx = 0;
  private timeScaleCur = 1;
  private gameTime = 0;
  private liftT = 0;
  private done = false;
  private started = false;
  private extScale = 1;

  head: HeadState;
  onLayerDone?: (layer: number) => void;

  constructor(path: WallPath, builder: BeadBuilder) {
    this.path = path;
    this.builder = builder;
    this.perim = path.totalLen;
    this.stationsFwd = this.buildStations(false);
    if (!path.closed) this.stationsRev = this.buildStations(true);
    const s0 = this.stationsFwd[0];
    this.head = {
      x: s0.x, y: DIM.slabTop + DIM.layerH + STANDOFF, z: s0.z,
      tx: s0.tx, tz: s0.tz,
      v: 0, vMachine: 0, flow: 0,
      layer: 1, layersTotal: path.layers,
      phase: 'first', layerProgress: 0, curv: 0, lifted: 0,
    };
  }

  setExternalScale(v: number): void { this.extScale = clamp(v, 0.05, 400); }

  private buildStations(reverse: boolean): Station[] {
    const closed = this.path.closed;
    const spacing = 0.045;
    const total = this.perim;
    const count = Math.max(10, Math.round(total / spacing));
    const out: Station[] = [];
    const taperLen = closed ? TAPER_SEAM : TAPER_OPEN;
    for (let k = 0; k <= count; k++) {
      const sRaw = (k / count) * total;
      const s = reverse ? total - sRaw : sRaw;
      const st = this.sampleAt(clamp(s, 0, total));
      if (reverse) { st.tx = -st.tx; st.tz = -st.tz; st.curv = -st.curv; }
      st.s = sRaw;
      const dEnd = Math.min(sRaw, total - sRaw);
      // 端部は長く幅を保ち、最後で鋭く絞る（実機の材料の切れ方）
      st.taper = Math.pow(clamp(dEnd / taperLen, 0, 1), 0.55);
      out.push(st);
    }
    // --- 送り速度計画（角で減速し、加減速は有限） ---
    const vMax = DIM.printSpeed;
    const a = DIM.accel;
    const vLim: number[] = out.map(st =>
      clamp(vMax / (1 + DIM.cornerSlowK * Math.abs(st.curv) * 0.30), vMax * 0.2, vMax));
    vLim[0] = 0.03;
    vLim[vLim.length - 1] = 0.03;
    const ds = total / count;
    for (let i = out.length - 2; i >= 0; i--) {
      vLim[i] = Math.min(vLim[i], Math.sqrt(vLim[i + 1] ** 2 + 2 * a * ds));
    }
    for (let i = 1; i < out.length; i++) {
      vLim[i] = Math.min(vLim[i], Math.sqrt(vLim[i - 1] ** 2 + 2 * a * ds));
    }
    out.forEach((st, i) => { st.vPlan = vLim[i]; });
    return out;
  }

  private sampleAt(s: number): Station {
    const smp = this.path.samples;
    const n = smp.length;
    const per = this.perim;
    const t = clamp(s / per, 0, 0.99999) * (this.path.closed ? n : n - 1);
    const i0 = Math.floor(t);
    const i1 = this.path.closed ? (i0 + 1) % n : Math.min(i0 + 1, n - 1);
    const f = t - i0;
    const a = smp[i0], b = smp[i1];
    const tx = lerp(a.tx, b.tx, f), tz = lerp(a.tz, b.tz, f);
    const tl = Math.hypot(tx, tz) || 1;
    return {
      x: lerp(a.x, b.x, f), z: lerp(a.z, b.z, f),
      tx: tx / tl, tz: tz / tl,
      curv: lerp(a.curv, b.curv, f),
      widthF: lerp(a.widthF, b.widthF, f),
      heightF: lerp(a.heightF, b.heightF, f),
      s, vPlan: DIM.printSpeed, taper: 1,
    };
  }

  private stations(): Station[] {
    if (this.path.closed) return this.stationsFwd;
    return (this.layer % 2 === 1) ? this.stationsFwd : this.stationsRev;
  }

  private yBase(layer: number): number {
    return DIM.slabTop + (layer - 1) * DIM.layerH;
  }

  private targetScale(): number {
    if (this.layer <= 1) return TIMING.firstLayerScale;
    if (this.layer <= 3) return TIMING.earlyLayerScale;
    return TIMING.lapseScale;
  }

  private ringAt(st: Station, meniscus: number): RingInput {
    const cornerWide = 1 + clamp(1 - st.vPlan / DIM.printSpeed, 0, 1) * 0.10;
    return {
      x: st.x, z: st.z, tx: st.tx, tz: st.tz,
      yBase: this.yBase(this.layer),
      width: DIM.beadW * st.widthF * cornerWide,
      height: DIM.layerH * st.heightF * 1.06,
      curv: st.curv,
      birth: this.gameTime,
      taper: st.taper,
      meniscus,
      layerIdx: this.layer,
      s: st.s,
    };
  }

  update(dt: number): HeadState {
    if (this.done) return this.head;
    this.gameTime += dt;
    const sts = this.stations();

    // ---- タイムスケール（滑らかに追従） ----
    let target = this.targetScale() * this.extScale;
    if (this.layer > 3) {
      const nearCorner = Math.abs(this.head.curv) > 2.2;
      const showLayer = (this.layer % 16) === 8;
      if (nearCorner && showLayer) target = TIMING.lapseCornerScale * this.extScale;
      if (!this.path.closed) {
        const dEnd = Math.min(this.sArc, this.perim - this.sArc);
        if (dEnd < 0.4 && (this.layer % 12) === 6) target = TIMING.lapseCornerScale * this.extScale;
      }
    }
    this.timeScaleCur += (target - this.timeScaleCur) * Math.min(1, dt * 3.2);

    // ---- 層替わりリフト ----
    if (this.liftT > 0) {
      const liftSpeed = this.layer <= 4 ? 1.5 : 22;
      this.liftT = Math.max(0, this.liftT - dt * liftSpeed);
      const l = Math.sin(this.liftT * Math.PI);
      const st0 = this.stations()[0];
      this.head.lifted = l;
      this.head.v = 0; this.head.vMachine = 0; this.head.flow = 0;
      this.head.x = st0.x; this.head.z = st0.z;
      this.head.tx = st0.tx; this.head.tz = st0.tz;
      this.head.y = this.yBase(this.layer) + DIM.layerH + STANDOFF + l * 0.05;
      this.head.layer = this.layer;
      this.head.layerProgress = 0;
      if (this.liftT === 0) this.beginLayerRun();
      return this.head;
    }

    if (!this.started) {
      this.started = true;
      this.beginLayerRun();
    }

    // ---- 進行 ----
    const stNow = this.interpStation(this.sArc);
    const vMachine = stNow.vPlan;
    const adv = Math.max(vMachine, 0.02) * this.timeScaleCur * dt;
    let sNew = this.sArc + adv;

    // 通過したステーションのリングを確定
    let emitted = 0;
    while (this.stationIdx < sts.length && sts[this.stationIdx].s <= sNew && emitted < TIMING.maxRingsPerFrame) {
      const st = sts[this.stationIdx];
      this.builder.updateLiveRing(this.ringAt(st, 0.15));
      this.builder.addRing(this.ringAt(st, 0.6));
      this.stationIdx++;
      emitted++;
    }
    if (emitted >= TIMING.maxRingsPerFrame && this.stationIdx < sts.length) {
      sNew = sts[this.stationIdx].s;
    }
    this.sArc = Math.min(sNew, this.perim);

    // ライブリング（ノズル直下、ビードはノズルに接続）
    const stHead = this.interpStation(this.sArc);
    this.builder.updateLiveRing(this.ringAt(stHead, 1));

    // ---- ヘッド状態 ----
    this.head.x = stHead.x; this.head.z = stHead.z;
    this.head.tx = stHead.tx; this.head.tz = stHead.tz;
    this.head.curv = stHead.curv;
    this.head.y = this.yBase(this.layer) + DIM.layerH * stHead.heightF + STANDOFF;
    this.head.vMachine = vMachine;
    this.head.v = vMachine * this.timeScaleCur;
    this.head.flow = clamp(vMachine / DIM.printSpeed, 0.25, 1) * clamp(stHead.taper * 2, 0.1, 1);
    this.head.layer = this.layer;
    this.head.layerProgress = this.sArc / this.perim;
    this.head.lifted = 0;
    this.head.phase = this.layer <= 1 ? 'first' : this.layer <= 3 ? 'early' : 'lapse';

    if (this.sArc >= this.perim - 1e-9) this.completeLayer();
    return this.head;
  }

  private interpStation(s: number): Station {
    const sts = this.stations();
    const count = sts.length - 1;
    const t = clamp(s / this.perim, 0, 1) * count;
    const i0 = Math.min(Math.floor(t), count - 1);
    const f = t - i0;
    const a = sts[i0], b = sts[Math.min(i0 + 1, count)];
    const tx = lerp(a.tx, b.tx, f), tz = lerp(a.tz, b.tz, f);
    const tl = Math.hypot(tx, tz) || 1;
    return {
      x: lerp(a.x, b.x, f), z: lerp(a.z, b.z, f),
      tx: tx / tl, tz: tz / tl,
      curv: lerp(a.curv, b.curv, f),
      widthF: lerp(a.widthF, b.widthF, f),
      heightF: lerp(a.heightF, b.heightF, f),
      s, vPlan: lerp(a.vPlan, b.vPlan, f),
      taper: lerp(a.taper, b.taper, f),
    };
  }

  private beginLayerRun(): void {
    const sts = this.stations();
    this.sArc = 0;
    this.stationIdx = 1;
    const st0 = sts[0];
    this.builder.addRing(this.ringAt(st0, 0));
    this.builder.addRing(this.ringAt(st0, 0.5));
  }

  private completeLayer(): void {
    const sts = this.stations();
    const stLast = sts[sts.length - 1];
    this.builder.updateLiveRing(this.ringAt(stLast, 0));
    this.onLayerDone?.(this.layer);
    this.builder.flushActive(false);
    if (this.layer >= this.path.layers) {
      this.builder.finalize();
      this.done = true;
      this.head.phase = 'done';
      this.head.v = 0; this.head.vMachine = 0; this.head.flow = 0;
      return;
    }
    this.layer++;
    this.liftT = 1;
  }

  get isDone(): boolean { return this.done; }
  get now(): number { return this.gameTime; }
  get currentTimeScale(): number { return this.timeScaleCur; }
}
