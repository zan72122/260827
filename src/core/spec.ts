/**
 * 作中設計の記録 / In-work design record.
 *
 * これは実測値ではなく、この作品のためだけの設計値です。
 * These are NOT measurements of a real factory mechanism. They are the
 * dimensions, tolerances and gearing ratios chosen for THIS piece, recorded
 * here so every other module reads them from one place and so the
 * simplifications stay auditable (see STATUS.md).
 *
 * 参照した事実 (facts referenced, structure only):
 *  - シリンダーのピンが金属の櫛歯を弾いて発音する  (pin plucks a steel comb tooth)
 *    https://suwanone.jp/suwa_musicbox/history
 *  - 調律とは別に「噛み合い調整」という工程がある  (meshing adjustment is a
 *    separate step from tuning)
 *    https://suwanone.jp/suwa_musicbox/technology
 * 画像は構造の参照のみ。転載もホットリンクもしていません。
 *
 * すべての長さの単位は mm。All lengths in millimetres.
 */

/** 機構の全体寸法 / overall envelope of the movement (design start point). */
export const MOVEMENT = {
  /** ベッドプレート幅 (シリンダー軸方向) */
  bedWidth: 82,
  /** ベッドプレート奥行 */
  bedDepth: 46,
  /** ベッドプレート厚 */
  bedThickness: 3.2,
} as const

/** シリンダーとピン / cylinder and pins. */
export const CYLINDER = {
  /** シリンダー本体の半径 */
  bodyRadius: 6.5,
  /** シリンダーの有効長 (ピンが並ぶ範囲) */
  pinnedLength: 34,
  /** 軸(アーバー)の半径 */
  arborRadius: 1.6,
  /** ピンの半径 (丸線ピン) */
  pinRadius: 0.22,
  /** ピンの突出量 (本体表面から先端まで) */
  pinProtrusion: 0.9,
} as const

/** ピン先端が描く円の半径。The radius swept by a pin tip. */
export const PIN_TIP_RADIUS = CYLINDER.bodyRadius + CYLINDER.pinProtrusion // 7.4
/** ピン先端の丸みの中心が描く円の半径。Radius of the pin tip's cap centre. */
export const PIN_CAP_CENTRE_RADIUS = PIN_TIP_RADIUS - CYLINDER.pinRadius // 7.18

/**
 * 櫛歯 / the comb.
 *
 * 実物の櫛は全ての歯先が一直線に揃っていて、音程は歯の幅と先端の鉛錘で
 * 決めます (長さだけでは 2 オクターブ以上を賄えないため)。ここでもそれに
 * 倣い、歯先の半径は全歯共通、低音側ほど幅広で先端に錘を付けています。
 * これにより噛み合い深さ e は全ての歯で同じ値になります。
 */
export const COMB = {
  /** 歯数 */
  teeth: 12,
  /** 歯のピッチ (軸方向の間隔) */
  pitch: 2.35,
  /** 歯の厚み (板厚) */
  thickness: 0.55,
  /** 根元から自由端まで (全歯共通)。歯先は一直線に揃う。 */
  freeLength: 13.2,
  /** 最低音の歯の幅 (軸方向) */
  widthLow: 2.15,
  /** 最高音の歯の幅 */
  widthHigh: 0.92,
  /** 先端の鉛錘を付ける歯の本数 (低音側から) */
  weightedTeeth: 6,
  /** 錘の最大の高さ (歯の裏側に付く) */
  weightHeight: 1.5,
  /** 歯先が一番近い点になるように、櫛全体を接線からわずかに傾ける角度 (度)。 */
  tiltDeg: 20,
  /** 歯の根元を挟む台座 (コムベース) の奥行 */
  baseLength: 5.2,
  /** 台座の高さ */
  baseHeight: 4.8,
} as const

/**
 * 噛み合い調整 / the meshing adjustment.
 *
 * `travel` = 櫛歯ブロックがシリンダーへ近づいた実変位 (mm)。
 * `engagement` (e) = ピン先端が歯の自由端を押し込む深さ (mm)。
 *   e = travel - INITIAL_CLEARANCE
 *   e <= 0 なら空振り。e > 0 なら接触してたわむ。
 */
export const MESH = {
  /** 起動時の隙間。ピン先端円と歯先の間に残っている空き。 */
  initialClearance: 0.10,
  /** 治具のストッパーが効く最大変位。これ以上は押し込めない。 */
  maxTravel: 0.72,
  /** 歯先が壊れない設計上の最大押し込み量 (= maxTravel - initialClearance)。 */
  get maxEngagement() {
    return this.maxTravel - this.initialClearance // 0.62
  },
  /**
   * この深さ未満では、たわみが小さすぎて解放しても楽音にならない。
   * 接触の擦れ音 (機械音) だけが出る。
   */
  audibleEngagement: 0.028,
  /** 固定ねじを締めてよいと判断する噛み合い深さの下限。 */
  secureEngagement: 0.075,
} as const

/**
 * 治具の倍率 / jig gearing.
 *
 * 実物の噛み合い調整は数十µm単位の作業です。4歳児が指一本で扱えるように、
 * 大きな調整つまみと試し回しハンドルを独自に設計しました。現物工場の治具
 * そのものではありません。方向と倍率は常に一定です。
 */
export const JIG = {
  /** 調整つまみの回転角 (度) の可動範囲。0 = 一番離れた位置。 */
  knobSweepDeg: 240,
  /** つまみ 1 度あたりの櫛歯ブロックの実変位 (mm/deg) = 0.72 / 240 = 0.003 */
  get mmPerKnobDeg() {
    return MESH.maxTravel / this.knobSweepDeg
  },
  /** 調整つまみ (ドラム) の実半径 (mm)。 */
  knobRadius: 7.5,
  /** 試し回しハンドルの実半径 (mm)。 */
  handleRadius: 6.5,
  /** ベルト車の半径 (mm)。シリンダー側 / ハンドル側。 */
  pulleyCylinder: 4.6,
  pulleyHandle: 6.0,
  /** 調整つまみの画面上の当たり半径 (CSS px)。指で掴める大きさ。 */
  knobScreenRadiusPx: 62,
  /**
   * 調整倍率。ドラムの縁が何 mm 動くと櫛歯が 1 mm 進むか。
   * 240 度 (4.189 rad) × 半径 7.5 mm = 31.4 mm の縁の動きで 0.72 mm 進むので
   * 約 43.6 倍。指はドラムの縁を転がすので、画面上でもこの倍率がそのまま
   * 効きます (画面の px/mm はカメラで決まり、向きと倍率は常に一定)。
   */
  get rimMmPerTravelMm() {
    return ((this.knobSweepDeg * Math.PI) / 180) * this.knobRadius / MESH.maxTravel
  },
  /**
   * 試し回しハンドルの回転とシリンダー回転の比。
   * 丸ベルトで、ハンドル側 φ6.0 → シリンダー側 φ4.6 なので
   * シリンダーはハンドルの 6.0/4.6 = 1.30 倍だけ回る。
   * ハンドル 0.77 回転で曲が一巡する。
   */
  get handleToCylinder() {
    return this.pulleyHandle / this.pulleyCylinder
  },
  /** ハンドルの画面上の半径 (CSS px)。 */
  handleScreenRadiusPx: 58,
  /** ラチェットの歯数。逆回しはここで止まる。 */
  ratchetTeeth: 24,
  /** 工具の把手をつかむ点と、工具先端の画面上の距離 (CSS px)。指で隠れないため。 */
  toolTipOffsetPx: 46,
  /** ねじ 1 本を締めきるのに必要な工具の回転量 (度)。短い円弧を数回。 */
  screwTightenDeg: 300,
  /** 締結ねじの本数。 */
  screwCount: 2,
} as const

/**
 * 機構の配置 / where the parts sit (mm, 右手系 X=シリンダー軸, Y=上, Z=手前)。
 * 接触点がカメラから読めて、かつ櫛の台座が視線を塞がない角度を選んでいます。
 */
export const LAYOUT = {
  /** シリンダー軸の高さ */
  axisY: 17.0,
  /** シリンダー軸の前後位置 */
  axisZ: -3.0,
  /**
   * 接触点の方位。+Z を 0 度とし、下向きを負にとった角度。
   * -50 度 = シリンダーの手前下。カメラから隙間が正面に見え、
   * かつシリンダー自身の陰にならない。
   */
  contactAngleDeg: -50,
  /** ベッドプレートの前後中心 */
  bedZ: 2.0,
  /** 軸受けブラケットの X 位置 */
  bearingX: 20.5,
  /** 調整つまみ (ローレットドラム) の中心 — 手前左、机に近い側 */
  knobCentre: { x: 16.0, y: 5.0, z: 34.5 },
  /** 試し回しハンドル (ハンドホイール) の中心 — 手前右 */
  handleCentre: { x: 19.5, y: 13.5, z: 24.0 },
  /** ハンドル側の中間軸に乗るプーリーの X 位置 */
  pulleyX: 28.0,
  /** 中間軸の X 範囲 */
  jackshaftX: [16.0, 30.0],
  /**
   * 固定ねじの位置 (押さえ板の上)。歯の根元より奥にあるので、歯の並びとは
   * ぶつかりません。作業構図のどちらの端でも指が届く間隔に寄せています。
   */
  screwX: [-8.5, 8.5],
} as const

/** 曲を安定して聴かせるための速度制限。実機の空気ガバナー相当。 */
export const GOVERNOR = {
  /** シリンダーの最大角速度 (rad/s)。約 0.45 回転/秒。 */
  maxAngularSpeed: 2.83,
  /** 指を離してから追従が止まるまでの緩み (rad/s^2 相当の追従係数)。 */
  followRate: 26,
} as const

/** 判定に使う許容域 / tolerances used by the judgement code. */
export const TOLERANCE = {
  /** 角度計算で 0 とみなす値 (rad)。 */
  angleEpsilon: 1e-9,
  /** 1 フレームで処理する通過イベントの上限 (安全弁)。 */
  maxEventsPerStep: 64,
} as const

/** 誇張した箇所の記録 / recorded exaggerations (see STATUS.md for the full list). */
export const EXAGGERATIONS = {
  /**
   * 発音後の歯の残響振動。実際は数百 Hz。巨大な歯がゆっくり揺れる運動には
   * 置き換えず、実周波数のまま振幅 0.05 mm 以下・120 ms 減衰の微細なブレ
   * (時間平均のにじみ) として描く。
   */
  releaseShimmerAmplitude: 0.05,
  releaseShimmerDecaySec: 0.12,
  /**
   * 片持ち梁のたわみ形状は 3 次曲線 y(x)=δ(3(x/L)^2-(x/L)^3)/2 で近似。
   * オイラー梁の静たわみそのもので、動的モードは無視している。
   */
  cantileverCubic: true,
} as const
