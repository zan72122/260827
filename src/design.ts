/**
 * 作中の設計値 (in-work design values).
 *
 * 参照資料 (https://www.excelpoint.co.jp/denguri-honeycomb.html) は本セッションの
 * ネットワーク送出ポリシーにより取得できなかった。したがって以下の数値は
 * 「現物の実測値」ではなく、課題文で与えられた初期設計値と、そこから
 * 構造の整合のために導出した作中設計値である。変更した箇所は理由を併記する。
 */

export const MM = 0.001

/** 課題文で与えられた初期設計値。 */
export const GIVEN = {
  /** 完成高 280 mm。本モデルでは「開いた状態の頂点高さ」= 平らな紙の高さ。 */
  treeHeightMm: 280,
  /** 最大径 180 mm。半径方向は紙が伸縮しないので開閉で変わらない。 */
  maxDiameterMm: 180,
  /** 紙厚 約 0.04 mm。 */
  paperThicknessMm: 0.04,
  /** 端台紙 約 0.8 mm。 */
  endBoardThicknessMm: 0.8,
} as const

/**
 * 構造パラメータ。ハニカム紙は「層ごとに糊の線を互い違いに置く」ことで
 * 平たい束が開く。ここでは
 *   - 糊の線は水平（回転軸に直交）
 *   - 束は垂直軸まわりに扇状に開く（0°→ほぼ180°、両端台紙が背中合わせで出会う）
 *   - セルの筒は半径方向を向き、外から見ると六角の穴が並ぶ
 * とした。
 *
 * 枚数 N と縦ピッチ P は次の拘束から選んだ:
 *   全開時の隣接シート角 δ = π / N
 *   自由スパン（糊帯と糊帯の間の紙）長さ hf = P/2 - w
 *   半径 u での周方向のずれ = u·δ  ≤ hf  でなければ紙が伸びてしまう
 * 最大半径 90 mm で u·δ = 90·π/36 = 7.85 mm < hf = 13.5 mm。余裕あり。
 */
export const STRUCT = {
  /**
   * 紙の枚数（端台紙を除く）。作中設計値。
   * 4歳児が「紙の間が開く」ことを見て分かる大きさのセルにするため、
   * 全開時のセル幅 2R*delta ≈ 24 mm、セル高さ ≈ 30 mm になる枚数を選んだ。
   */
  sheetCount: 24,
  /** 糊パターンの縦の繰り返し（平たい状態）。280 / 40 = 7 段ちょうど。 */
  cellPitchMm: 40,
  /** 糊帯の幅。作中設計値。 */
  glueBandMm: 4,
  /** 断面の輪郭を刻む段数（もみの木の裾）。 */
  tiers: 4,
} as const

export interface HoneycombSpec {
  /** 平たい紙の高さ = 完成時の頂点高さ (m) */
  H: number
  /** 縦ピッチ (m) */
  P: number
  /** 糊帯幅 (m) */
  w: number
  /** 自由スパン長 = P/2 - w (m)。紙は伸びないのでこの長さは常に一定。 */
  hf: number
  /** 枚数 */
  N: number
  /** 最大半径 (m) */
  Rmax: number
  /** 紙厚 (m) */
  tau: number
  /** 端台紙厚 (m) */
  tauBoard: number
  /** 全開時の隣接シート角 (rad) */
  deltaMax: number
  /** 芯（軸まわり）の内半径 (m)。ここで隣接シートの間隔がちょうど紙厚になる。 */
  uMin: number
  /** 縦の繰り返し段数 */
  periods: number
}

export function makeSpec(): HoneycombSpec {
  const H = GIVEN.treeHeightMm * MM
  const P = STRUCT.cellPitchMm * MM
  const w = STRUCT.glueBandMm * MM
  const hf = P / 2 - w
  const N = STRUCT.sheetCount
  const Rmax = (GIVEN.maxDiameterMm / 2) * MM
  const tau = GIVEN.paperThicknessMm * MM
  const tauBoard = GIVEN.endBoardThicknessMm * MM
  const deltaMax = Math.PI / N
  // 芯半径: u·δmax = tau となる半径。ここより内側では紙同士が重なるので穴にする。
  const uMin = tau / deltaMax
  return { H, P, w, hf, N, Rmax, tau, tauBoard, deltaMax, uMin, periods: Math.round(H / P) }
}

export const SPEC = makeSpec()

/**
 * 半径 u における縦方向の縮み率。
 *
 * 自由スパンの紙は長さ hf のまま、上下の糊帯を結ぶ。開くと上下の糊帯は
 * 周方向に u·δ だけずれるので、残る縦の高さは sqrt(hf² - (u·δ)²)。
 * つまり s(u) = sqrt(1 - (u·δ/hf)²)。紙は決して伸びない（s ≤ 1）。
 * u = 0（軸上）では s = 1 なので頂点の高さは変わらず、外周ほど沈む。
 * これが「平らな輪郭が立体になる」仕組みそのもの。
 */
export function shrinkAt(absU: number, delta: number, hf: number): number {
  const k = (absU * delta) / hf
  const v = 1 - k * k
  return v <= 0 ? 0 : Math.sqrt(v)
}
