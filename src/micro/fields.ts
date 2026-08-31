import { GH, GW } from '../sim/protocol';
import type { SimState } from '../sim/state';

/** 完成画像の生成に使う、切片グリッド上のスカラー場。 */
export interface MicroFields {
  gw: number;
  gh: number;
  hemaN: Float32Array;
  hemaB: Float32Array;
  blue: Float32Array;
  eosin: Float32Array;
  paraffin: Float32Array;
  /** 残留水分・透徹不良による曇り 0..1 */
  haze: Float32Array;
  dried: Float32Array;
  /** 閉じ込められた空気（気泡）0..1 */
  bubble: Float32Array;
  /** 封入剤が届かなかった乾いた面 0..1 */
  unfilled: Float32Array;
}

export function fieldsFromState(s: SimState): MicroFields {
  const n = GW * GH;
  const haze = new Float32Array(n);
  const bubble = new Float32Array(n);
  const unfilled = new Float32Array(n);
  const f = s.field;
  for (let i = 0; i < n; i++) {
    haze[i] = Math.min(1, 0.9 * (1 - f.cleared[i]) + 1.6 * f.water[i]);
  }
  if (s.mount) {
    for (let i = 0; i < n; i++) {
      bubble[i] = s.mount.air[i];
      unfilled[i] = Math.max(0, 1 - s.mount.coverage[i] - s.mount.air[i]);
    }
  } else {
    // 未封入。観察用の像は封入後にしか出さないが、学習用表示のため 0 で埋める。
    unfilled.fill(0);
  }
  return {
    gw: GW,
    gh: GH,
    hemaN: f.hemaN,
    hemaB: f.hemaB,
    blue: f.blue,
    eosin: f.eosin,
    paraffin: f.paraffin,
    haze,
    dried: f.dried,
    bubble,
    unfilled,
  };
}
