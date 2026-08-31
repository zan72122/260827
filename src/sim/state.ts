import { BATHS, GH, GW, NCELL, TEACHING } from './protocol';
import { FILM_COMPONENTS, type FilmComponent } from './reagents';

const zeroComp = (): Record<FilmComponent, number> => ({ water: 0, alcohol: 0, xylene: 0, acid: 0, hema: 0, eosin: 0 });

/** 切片の 2D 状態マップ。行 0 = 切片の下端（スライド下端側）。 */
export class SpecimenField {
  paraffin = new Float32Array(NCELL);
  /** 媒体の極性 0..1 */
  polar = new Float32Array(NCELL);
  /** 残留水分 0..1 */
  water = new Float32Array(NCELL);
  /** 核のヘマトキシリン量 */
  hemaN = new Float32Array(NCELL);
  /** 核外（背景）のヘマトキシリン量 */
  hemaB = new Float32Array(NCELL);
  /** 色出しの進行 0..1 */
  blue = new Float32Array(NCELL);
  /** エオジン量 */
  eosin = new Float32Array(NCELL);
  /** 透徹の進行 0..1 */
  cleared = new Float32Array(NCELL);
  /** 乾燥による不可逆の障害 0..1 */
  dried = new Float32Array(NCELL);
  /** その細胞がこれまで一度でも液に浸かった総時間（教材内・秒） */
  wetSec = new Float32Array(NCELL);
  /**
   * 行内の全列が同一の状態かどうか（1 = 同一）。
   * 浸漬の化学は液面（=行）にしか依存しないため、行が均一な間は
   * 1 列だけ計算して横へ複製できる。乾燥は列方向に差が出るのでそこで 0 になる。
   * 値そのものは計算結果に影響しない（速度のためのフラグ）。
   */
  rowUniform = new Uint8Array(GH).fill(1);

  constructor() {
    this.paraffin.fill(1);
    // 初期状態: 貼付・乾燥・ラベル照合済み。切片は乾いたパラフィン切片。
  }

  clone(): SpecimenField {
    const f = new SpecimenField();
    f.paraffin.set(this.paraffin);
    f.polar.set(this.polar);
    f.water.set(this.water);
    f.hemaN.set(this.hemaN);
    f.hemaB.set(this.hemaB);
    f.blue.set(this.blue);
    f.eosin.set(this.eosin);
    f.cleared.set(this.cleared);
    f.dried.set(this.dried);
    f.wetSec.set(this.wetSec);
    f.rowUniform.set(this.rowUniform);
    return f;
  }
}

export interface BathRuntime {
  id: string;
  /** 交換回数（交換式の槽で使う）。 */
  generation: number;
  /** 槽全体に持ち込まれた水の割合 0..1（溶剤・アルコール槽で効く） */
  water: number;
  /** スライド近傍の境界層の組成（持ち込み由来）。次の液膜の下限になる。 */
  local: Record<FilmComponent, number>;
  /** 表示用: 境界層の色素量 */
  dye: number;
  /** 表示用: 境界層の酸量 */
  acid: number;
  /** その槽に入れた累計時間（教材内・秒）。 */
  usedSec: number;
  /** その槽で数えた有効ディップ数。 */
  dips: number;
}

/** スライド上の液膜。行ごとの量と、全体の組成。 */
export class FilmState {
  /** 行ごとの液膜量（無次元、TEACHING.filmBase が基準） */
  vol = new Float32Array(GH);
  /** 組成（合計 1 に正規化。空のときは全て 0） */
  comp: Record<FilmComponent, number> = { water: 0, alcohol: 0, xylene: 0, acid: 0, hema: 0, eosin: 0 };
  /** 空気中に出てからの経過（教材内・秒） */
  airSec = 0;

  totalVol(): number {
    let s = 0;
    for (let i = 0; i < GH; i++) s += this.vol[i];
    return s;
  }

  clone(): FilmState {
    const f = new FilmState();
    f.vol.set(this.vol);
    f.comp = { ...this.comp };
    f.airSec = this.airSec;
    return f;
  }

  normalize(): void {
    let s = 0;
    for (const c of FILM_COMPONENTS) s += this.comp[c];
    if (s > 1e-9) for (const c of FILM_COMPONENTS) this.comp[c] /= s;
  }
}

/** 封入の結果（幾何モデルの出力）。 */
export interface MountResult {
  /** 封入剤の被覆 0..1（グリッド） */
  coverage: Float32Array;
  /** 閉じ込められた空気 0..1（グリッド） */
  air: Float32Array;
  /** 封入剤が溢れた量（無次元） */
  overflow: number;
  /** 使った封入剤量(µL) */
  volumeUl: number;
  /** カバーガラスの接触開始位置（スライド長手方向 0..1） */
  contactX: number;
  /** 下ろすのに要した時間(秒) */
  lowerSec: number;
  /** 接触時の角度(度) */
  angleDeg: number;
  /** 気泡の代表位置（描画用、グリッド座標） */
  bubbles: { x: number; y: number; r: number }[];
}

export class SimState {
  field = new SpecimenField();
  film = new FilmState();
  baths: BathRuntime[] = BATHS.map((b) => ({
    id: b.id,
    generation: 0,
    water: 0,
    local: zeroComp(),
    dye: 0,
    acid: 0,
    usedSec: 0,
    dips: 0,
  }));
  /** 教材内の経過時間（秒） */
  modelSec = 0;
  /** 封入結果（未封入なら null） */
  mount: MountResult | null = null;
  /** 直近のディップ検出用の内部状態 */
  dip = { phase: 0 as 0 | 1, minLevel: 2, maxLevel: -2, lastBath: -1 };

  clone(): SimState {
    const s = new SimState();
    s.field = this.field.clone();
    s.film = this.film.clone();
    s.baths = this.baths.map((b) => ({ ...b, local: { ...b.local } }));
    s.modelSec = this.modelSec;
    s.mount = this.mount
      ? {
          ...this.mount,
          coverage: new Float32Array(this.mount.coverage),
          air: new Float32Array(this.mount.air),
          bubbles: this.mount.bubbles.map((b) => ({ ...b })),
        }
      : null;
    s.dip = { ...this.dip };
    return s;
  }
}

/** グリッド行 r の中心が、浸漬レベル level のとき液面下にあるか。 */
export function rowSubmerged(r: number, level: number): boolean {
  return level > (r + 0.5) / GH;
}

/** グリッド行 r の浸漬割合（液面が行の途中にある場合の按分）。 */
export function rowSubmergeFraction(r: number, level: number): number {
  const lo = r / GH;
  const hi = (r + 1) / GH;
  if (level <= lo) return 0;
  if (level >= hi) return 1;
  return (level - lo) / (hi - lo);
}

export const idx = (x: number, y: number): number => y * GW + x;

/** 切片のグリッド 1 マスの物理サイズ(mm)。 */
export const CELL_W_MM = (TEACHING.sectionX1mm - TEACHING.sectionX0mm) / GW;
export const CELL_H_MM = (TEACHING.sectionY1mm - TEACHING.sectionY0mm) / GH;
