// ============================================================
// 基準寸法（docs/TECH_NOTES.md 参照）
// 実在するガントリー式建設3Dプリンター（COBOD BOD2 等）の公開仕様を
// 参考にした架空機 "GP-6 ガーデンプリンター" の設定。
// 単位はすべてメートル・秒。
// ============================================================

export const DIM = {
  // --- 基礎スラブ ---
  slabW: 5.2,          // X方向（ガントリー梁方向）
  slabD: 5.2,          // Z方向（レール走行方向）
  slabH: 0.15,         // スラブ厚
  buildW: 3.8,         // 建築可能範囲 X
  buildD: 3.8,         // 建築可能範囲 Z

  // --- 押出ビード / 壁 ---
  beadW: 0.06,         // ビード幅 60mm（BOD2ノズル 20–100mm の中庸）
  layerH: 0.02,        // 層高 20mm（BOD2 5–40mm の中庸）
  wallLayers: 90,      // 90層 = 1.8m（庭園シェルター壁体）
  benchLayers: 26,     // 26層 = 0.52m（庭園ベンチ）
  nozzleBore: 0.032,   // ノズル内径 32mm

  // --- プリンター運転 ---
  printSpeed: 0.30,    // 定常ノズル速度 300mm/s（有人現場上限250mm/sの約1.2倍を演出用に許容）
  accel: 0.55,         // 加減速 m/s^2
  minTurnRadius: 0.22, // 旋回可能最小半径（中心線）
  cornerSlowK: 2.2,    // 曲率による減速強度

  // --- ガントリー機体 ---
  railGauge: 6.6,      // レール間隔（X）
  railLen: 8.8,        // レール長（Z）
  beamClear: 3.05,     // 梁下クリアランス
  beamH: 0.52,         // 梁トラス高
  legW: 0.42,          // 柱幅

  // --- サイト ---
  groundY: 0,
  slabTop: 0.15,
};

export const TIMING = {
  firstLayerScale: 1.7,   // 第1層: ほぼ実時間（実速の1.7倍再生）
  earlyLayerScale: 4.5,   // 2〜3層目
  lapseScale: 230,        // 積層タイムラプス
  lapseCornerScale: 9,    // タイムラプス中、見せ場の角での速度
  maxRingsPerFrame: 420,
};

export const COLORS = {
  sky: 0x9db8d2,
  fog: 0xa8bccd,
  ground: 0x8d7f6a,
  slab: 0xb5b0a6,
  concreteWet: 0x6e6b63,
  concreteDry: 0xa8a499,
  steelBlue: 0x37536b,
  steelLight: 0x8797a3,
  safetyYellow: 0xd9a521,
  hiVis: 0xe07020,
};
