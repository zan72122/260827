/**
 * 実物寸法（mm）。出典:
 *  [S6] Marienfeld HistoBond スライド 約 76 x 26 x 1 mm
 *  [S7] Marienfeld カバーガラス 24 x 50 mm
 *       ※ [S7] の "thickness No. 1" は 0.13〜0.16 mm。本教材が採用する 0.17 mm は
 *          No. 1.5 相当であり、資料間の差異として PROTOCOL.md に記録する。
 *  [S5] Marienfeld 染色槽 蓋込み外寸 105 x 85 x 70 mm、ステンレス製ラック（最大10枚）
 * 上記以外（ラックの線径、作業台寸法など）は教材モデルの寸法。
 */
export const DIM = {
  slide: { len: 76, wid: 26, thick: 1.0 },
  /** ラベル（白いすりガラス／ラベル紙）の占める長さ(mm)、スライド上端側 */
  slideLabelLen: 20,
  cover: { len: 50, wid: 24, thick: 0.17 },
  /** 槽の外寸（蓋込み）。本体はここから蓋の高さを引く。 */
  jar: { w: 105, d: 70, hWithLid: 85, lid: 9, wall: 3.5 },
  /** 槽内の液面高さ(mm)。教材モデル。 */
  liquidDepth: 55,
  /** ラック（1枚のみ装着）。[S5] の形状を参考に自作したモデル寸法。 */
  rack: { w: 92, d: 55, h: 62, handleH: 40, wire: 1.6, slots: 10, slotPitch: 8 },
  /** ラックに挿したときのスライド下端の、ラック底からの高さ(mm) */
  slideRestY: 4,
  /** カバーガラスをスライド上に置く位置（スライド下端からの mm、リード辺） */
  coverDefaultY: 2,
} as const;

/** 切片のスライド上の位置(mm)。教材モデル。 */
export const SECTION = { y0: 18, y1: 32, x0: 4, x1: 22 } as const;
