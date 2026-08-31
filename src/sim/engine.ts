import { BATHS, BATH_INDEX, GH, TEACHING } from './protocol';
import { SimState, rowSubmergeFraction } from './state';
import { applyTick, applyWithdrawFilm } from './chemistry';
import { simulateMounting, type MountParams } from './mounting';

export const TICK = TEACHING.tickSec;
export const AIR = 255;

/** レベル(浸漬割合) を u8 へ量子化。-0.25 〜 1.34 を 0..255 に写す。 */
export const encodeLevel = (level: number): number =>
  Math.max(0, Math.min(255, Math.round((level + 0.25) * 160)));
export const decodeLevel = (u8: number): number => u8 / 160 - 0.25;

export type Mark =
  | { tick: number; kind: 'refresh'; jar: string }
  | { tick: number; kind: 'station'; station: string }
  | { tick: number; kind: 'note'; text: string };

/**
 * 1 プレイの完全な入力記録。**このログと seed だけで結果が再現できる。**
 * 表示や案内はここに含まれない（練習/実践で標本状態が一致する根拠）。
 */
export interface RunLog {
  seed: string;
  /** tick ごとの槽インデックス（255 = 空気中） */
  bath: number[];
  /** tick ごとの浸漬レベル(u8) */
  level: number[];
  marks: Mark[];
  mount: MountParams | null;
}

export function emptyLog(seed: string): RunLog {
  return { seed, bath: [], level: [], marks: [], mount: null };
}

export function cloneLog(l: RunLog): RunLog {
  return {
    seed: l.seed,
    bath: l.bath.slice(),
    level: l.level.slice(),
    marks: l.marks.map((m) => ({ ...m })),
    mount: l.mount ? { ...l.mount, angleSamples: l.mount.angleSamples.map((s) => ({ ...s })) } : null,
  };
}

/** 記録を 1 tick ずつ適用する共通ステップ。live と replay が同じ経路を通る。 */
export class Stepper {
  state = new SimState();
  private prevLevel = -0.25;
  private prevBath = AIR;
  private outOfLiquid = true;
  tickIndex = 0;

  step(bathIdx: number, levelU8: number): void {
    const level = decodeLevel(levelU8);

    // --- 引き上げによる液膜形成（液面より上に出た行に膜が残る）
    if (level < this.prevLevel) {
      const speedNorm = ((this.prevLevel - level) * (GH * 1.0)) / TICK / 60; // mm/s を 60mm/s で正規化
      const leaving: number[] = [];
      for (let r = 0; r < GH; r++) {
        const before = rowSubmergeFraction(r, this.prevLevel);
        const after = rowSubmergeFraction(r, level);
        if (before > 0 && after < before) leaving.push(r);
      }
      if (leaving.length && this.prevBath !== AIR) applyWithdrawFilm(this.state, leaving, speedNorm);
    }

    // --- ディップ計数（沈めた範囲と往復を追跡する。pointermove の数では数えない）
    if (bathIdx !== AIR) {
      const d = this.state.dip;
      if (d.lastBath !== bathIdx) {
        d.lastBath = bathIdx;
        d.phase = 0;
        this.outOfLiquid = true;
      }
      if (level <= 0.1) this.outOfLiquid = true;
      if (level >= 1.0 && this.outOfLiquid) {
        this.state.baths[bathIdx].dips += 1;
        this.outOfLiquid = false;
      }
    } else {
      this.outOfLiquid = true;
    }

    applyTick(this.state, bathIdx === AIR ? -1 : bathIdx, level, TICK);
    this.prevLevel = level;
    this.prevBath = bathIdx;
    this.tickIndex++;
  }

  refresh(jarId: string): void {
    const i = BATH_INDEX[jarId];
    if (i === undefined) return;
    const b = this.state.baths[i];
    b.generation += 1;
    b.dye = 0;
    b.acid = 0;
    b.water = 0;
    b.usedSec = 0;
    b.dips = 0;
  }

  mount(p: MountParams): void {
    this.state.mount = simulateMounting(p);
  }
}

/** ログ全体を最初から再生し、確定した標本状態を返す。 */
export function replay(log: RunLog): SimState {
  const st = new Stepper();
  const marksByTick = new Map<number, Mark[]>();
  for (const m of log.marks) {
    const arr = marksByTick.get(m.tick) ?? [];
    arr.push(m);
    marksByTick.set(m.tick, arr);
  }
  const n = Math.min(log.bath.length, log.level.length);
  for (let i = 0; i < n; i++) {
    const ms = marksByTick.get(i);
    if (ms) for (const m of ms) if (m.kind === 'refresh') st.refresh(m.jar);
    st.step(log.bath[i], log.level[i]);
  }
  const tail = marksByTick.get(n);
  if (tail) for (const m of tail) if (m.kind === 'refresh') st.refresh(m.jar);
  if (log.mount) st.mount(log.mount);
  return st.state;
}

/** ライブ進行用。ログへ追記しつつ同じ Stepper を進める。 */
export class LiveRun {
  log: RunLog;
  stepper = new Stepper();

  constructor(seed: string) {
    this.log = emptyLog(seed);
  }

  /** 途中までのログから再開する（部分再練習・巻き戻しで使う）。 */
  static resume(log: RunLog): LiveRun {
    const r = new LiveRun(log.seed);
    r.log = cloneLog(log);
    r.log.mount = null;
    r.stepper = rebuildStepper(r.log);
    return r;
  }

  get state(): SimState {
    return this.stepper.state;
  }

  pushTick(bathIdx: number, level: number): void {
    const u8 = encodeLevel(level);
    this.log.bath.push(bathIdx);
    this.log.level.push(u8);
    this.stepper.step(bathIdx, u8);
  }

  refresh(jarId: string): void {
    this.log.marks.push({ tick: this.log.bath.length, kind: 'refresh', jar: jarId });
    this.stepper.refresh(jarId);
  }

  note(text: string): void {
    this.log.marks.push({ tick: this.log.bath.length, kind: 'note', text });
  }

  station(station: string): void {
    const last = [...this.log.marks].reverse().find((m) => m.kind === 'station');
    if (last && last.kind === 'station' && last.station === station) return;
    this.log.marks.push({ tick: this.log.bath.length, kind: 'station', station });
  }

  mount(p: MountParams): void {
    this.log.mount = p;
    this.stepper.mount(p);
  }

  /** 巻き戻し（教材機能）: 指定 tick まで切り捨てて、状態を再構成する。 */
  rewindTo(tick: number): void {
    this.log.bath.length = Math.min(this.log.bath.length, tick);
    this.log.level.length = Math.min(this.log.level.length, tick);
    this.log.marks = this.log.marks.filter((m) => m.tick <= tick);
    this.log.mount = null;
    // 標本・槽・履歴を矛盾なく戻すため、切り詰めたログから Stepper を作り直す。
    this.stepper = rebuildStepper(this.log);
  }
}

function rebuildStepper(log: RunLog): Stepper {
  const st = new Stepper();
  const marksByTick = new Map<number, Mark[]>();
  for (const m of log.marks) {
    const arr = marksByTick.get(m.tick) ?? [];
    arr.push(m);
    marksByTick.set(m.tick, arr);
  }
  const n = Math.min(log.bath.length, log.level.length);
  for (let i = 0; i < n; i++) {
    const ms = marksByTick.get(i);
    if (ms) for (const m of ms) if (m.kind === 'refresh') st.refresh(m.jar);
    st.step(log.bath[i], log.level[i]);
  }
  return st;
}

// ---------------------------------------------------------------------------
// 操作履歴の要約（振り返りで使う）
// ---------------------------------------------------------------------------

export interface BathVisit {
  bathId: string;
  order: number;
  /** その訪問で切片が液面下にあった時間（教材内・秒）。行ごとの最大値。 */
  submergedSec: number;
  /** 切片が完全に浸かっていた時間 */
  fullSec: number;
  /** その訪問中の最大浸漬レベル（1 以上で全面浸漬） */
  maxLevel: number;
  dips: number;
  /** 槽の交換世代 */
  generation: number;
  startTick: number;
  endTick: number;
}

export interface RunSummary {
  visits: BathVisit[];
  /** 空気中に連続して置かれた最長時間（教材内・秒） */
  maxAirSec: number;
  totalModelSec: number;
  refreshes: { jar: string; tick: number }[];
  mount: MountParams | null;
}

export function summarize(log: RunLog): RunSummary {
  const visits: BathVisit[] = [];
  let cur: BathVisit | null = null;
  let outOfLiquid = true;
  let maxAirSec = 0;
  let airRun = 0;
  const gen: Record<string, number> = {};
  const refreshes: { jar: string; tick: number }[] = [];
  const marksByTick = new Map<number, Mark[]>();
  for (const m of log.marks) {
    const arr = marksByTick.get(m.tick) ?? [];
    arr.push(m);
    marksByTick.set(m.tick, arr);
  }

  const n = Math.min(log.bath.length, log.level.length);
  for (let i = 0; i < n; i++) {
    const ms = marksByTick.get(i);
    if (ms) {
      for (const m of ms) {
        if (m.kind === 'refresh') {
          gen[m.jar] = (gen[m.jar] ?? 0) + 1;
          refreshes.push({ jar: m.jar, tick: i });
        }
      }
    }
    const b = log.bath[i];
    const level = decodeLevel(log.level[i]);
    if (b === AIR) {
      airRun += TICK;
      maxAirSec = Math.max(maxAirSec, airRun);
      if (cur) {
        cur.endTick = i;
        cur = null;
      }
      continue;
    }
    airRun = 0;
    const id = BATHS[b].id;
    if (!cur || cur.bathId !== id) {
      cur = {
        bathId: id,
        order: visits.length + 1,
        submergedSec: 0,
        fullSec: 0,
        maxLevel: -1,
        dips: 0,
        generation: gen[id] ?? 0,
        startTick: i,
        endTick: i,
      };
      visits.push(cur);
      outOfLiquid = true;
    }
    cur.endTick = i;
    cur.maxLevel = Math.max(cur.maxLevel, level);
    if (level > 0) cur.submergedSec += TICK;
    if (level >= 1) cur.fullSec += TICK;
    if (level <= 0.1) outOfLiquid = true;
    if (level >= 1.0 && outOfLiquid) {
      cur.dips += 1;
      outOfLiquid = false;
    }
  }

  return {
    visits,
    maxAirSec,
    totalModelSec: n * TICK,
    refreshes,
    mount: log.mount,
  };
}
