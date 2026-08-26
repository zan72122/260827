// 検証契約の6形状（ワールド座標、建築可能範囲 ±1.9m）
// 手描きの揺らぎを少し混ぜ、テンプレート吸着が起きないことを確認する。

function jitter(pts, amp, seed = 1) {
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return (s / 2147483647) * 2 - 1;
  };
  return pts.map(([x, z]) => [x + rnd() * amp, z + rnd() * amp]);
}

export const SHAPES = {
  // 円に近い閉曲線
  circleish: jitter(
    Array.from({ length: 64 }, (_, i) => {
      const a = (i / 63) * Math.PI * 1.97;
      return [Math.cos(a) * 1.25, Math.sin(a) * 1.3];
    }), 0.03, 7),

  // 横長の楕円
  ellipse: jitter(
    Array.from({ length: 64 }, (_, i) => {
      const a = (i / 63) * Math.PI * 1.96 + 0.4;
      return [Math.cos(a) * 1.75, Math.sin(a) * 0.85];
    }), 0.03, 11),

  // 緩いS字の開放壁
  sCurve: jitter(
    Array.from({ length: 50 }, (_, i) => {
      const t = i / 49;
      const z = -1.6 + t * 3.2;
      const x = Math.sin(t * Math.PI * 2 - Math.PI) * 1.1 * Math.sin(t * Math.PI);
      return [x + 0.2, z];
    }), 0.025, 13),

  // 右側が膨らんだ形
  rightBulge: jitter(
    Array.from({ length: 64 }, (_, i) => {
      const a = (i / 63) * Math.PI * 1.97;
      const bulge = 1 + 0.52 * Math.exp(-((Math.atan2(Math.sin(a), Math.cos(a))) ** 2) / 0.55);
      return [Math.cos(a) * 1.05 * bulge, Math.sin(a) * 1.15];
    }), 0.03, 17),

  // 左側が膨らんだ形
  leftBulge: jitter(
    Array.from({ length: 64 }, (_, i) => {
      const a = (i / 63) * Math.PI * 1.97;
      const d = Math.atan2(Math.sin(a), -Math.cos(a));
      const bulge = 1 + 0.52 * Math.exp(-(d ** 2) / 0.55);
      return [Math.cos(a) * 1.05 * bulge, Math.sin(a) * 1.15];
    }), 0.03, 19),

  // 丸い角を持つ四角形
  roundedSquare: (() => {
    const pts = [];
    const h = 1.25, r = 0.42;
    const corners = [[h, h], [-h, h], [-h, -h], [h, -h]];
    for (let c = 0; c < 4; c++) {
      const [cx, cz] = corners[c];
      const a0 = (c * Math.PI) / 2;
      for (let i = 0; i < 8; i++) {
        const a = a0 + (i / 7) * (Math.PI / 2);
        pts.push([cx - Math.sign(cx) * r + Math.cos(a) * r, cz - Math.sign(cz) * r + Math.sin(a) * r]);
      }
    }
    pts.push(pts[0]);
    return jitter(pts, 0.025, 23);
  })(),
};
