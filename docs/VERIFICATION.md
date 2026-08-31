# 検証 / Verification

`npm run verify` は**実際のブラウザで実際にドラッグして**確認します。
静止画の比較だけでは合格にしていません。確認画像は `node tests/shoot.mjs …` で生成します。

## 実行環境（重要）

計測はこの開発コンテナで行いました。

- Linux コンテナ、GPU なし
- Chromium 1194 + **SwiftShader（ソフトウェアラスタライザ）**
- 4 コア相当

**したがってフレーム時間の実測値は実機の性能ではありません。**
iPhone / iPad の実機では未検証です（下の「未検証事項」参照）。

## 検証項目と結果

`npm run verify` の出力そのままです（2026-08-31 実行、21 項目すべて PASS）。

```
... measuring 41 openings (+7s)
PASS  the opened tree is much larger than the shut stack  area 9523 -> 19961, width 79 -> 155
PASS  paper visible at 0% (a closed stack, not nothing)  green=9523
PASS  no discontinuous jump between neighbouring openings  max step = 8.0% of full area
PASS  opening never shrinks the paper on screen  breaks=0
  ... dragging (+69s)
PASS  grab point is on screen  x=287 y=566
PASS  dragging opens the paper  open=1.000
PASS  opening follows the finger without stepping back
PASS  half open is held while the finger rests  0.5000 -> 0.5000
PASS  reversing closes the same paper  0.250
PASS  letting go keeps the opening  0.250
PASS  re-gripping elsewhere does not jump the opening  0.2500 -> 0.2500
PASS  a re-grip drives the opening again
  ... swinging the end round the back (+133s)
PASS  input survives the end swinging round the back  open=1.000
PASS  finger leaving the screen does not break the drag  open=1.000
  ... multi-touch and cancel (+220s)
PASS  a second finger is ignored  {"before":0.4,"afterSecond":0.4,"afterFirst":0.5780626780626781}
PASS  the first finger still drives it
PASS  pointercancel stops the drag and keeps the opening  {"mid":0.7205128205128205,"after":0.7205128205128205}
  ... rotation (+222s)
PASS  rotating the screen keeps the opening
PASS  landscape is re-composed, not the same camera stretched  portrait az=-19 el=14 fov=46 -> landscape az=-44 el=29 fov=40
PASS  rotating back keeps the opening
  ... 20 open/close cycles (+227s)
PASS  geometry count stable over 20 cycles  32 -> 32
PASS  shader program count stable over 20 cycles  13 -> 13
PASS  listener count stable over 20 cycles  9 -> 9
PASS  shape still correct after 20 cycles  width 79 -> 155, area 9523 -> 19961
  ... audio refused (+249s)
PASS  the game keeps running when audio is refused  {"before":0.45,"open":0.7705128205128204,"fps":20.000000000000004,"frames":1}
  ... frame timing (+250s)
frame time low   {"median":650.4000000003725,"p95":772,"calls":29,"tris":72000}
frame time high  {"median":812.4000000003725,"p95":972.1000000005588,"calls":84,"tris":72000}
PASS  paper structure identical at every quality level  72000 vs 72000
PASS  no console errors
--- ALL CHECKS PASSED ---
```

### フレーム時間について

`frame time` の中央値 650 ms（低画質）/ 812 ms（高画質）は
**SwiftShader（CPU によるソフトウェアラスタライズ）の値**です。
実機 GPU の性能とは何の関係もありません。実機では測っていません。

意味のある数字は同じ行の以下です。

- `tris: 72000` — 低画質と高画質で**完全に同一**。
  画質設定は解像度・影・遠景の小物だけを変え、紙の構造は一切省略していません。
- `calls: 29`（低画質）/ `84`（高画質）— 差は遠景の小物と影の分です。

紙は 48 枚が同一平面近くに重なるため、閉じた状態では**重ね描き（オーバードロー）が大きい**
実装です。TBDR の iPhone では隠面消去が効くはずですが、**実機で確かめていません。**

## 確認画像

`node tests/shoot.mjs poses` で 開度 0 / 25 / 50 / 75 / 100 % × 正面 / 斜め / 背面 / 上方 を
`shots/pose-<開度>-<視点>.png` に出力します。
`node tests/shoot.mjs smoke` は縦画面の実プレイ構図、`land` は横画面、
`closeup` はセル 1 個が読める近景です。

## 未検証事項

- **実機未検証。** iPhone / iPad の Safari では一度も動かしていません。
  タッチ、Pointer Events の細部、実際のフレームレート、音の鳴り方は未確認です。
- **面白さは未検証。** 4 歳児（あるいは誰か）に触ってもらっていません。
  操作量（画面幅の 72% で全開）、ドラッグ方向、留め具の挙動が幼児に合うかは推測です。
- **参照資料未確認。** 製造元ページと掲載画像は環境のネットワークポリシーで遮断され、
  閲覧できませんでした。詳細は [REFERENCE.md](REFERENCE.md)。
- **性能未確認。** ソフトウェアラスタライザでしか計測していません。
  60 fps / 低品質 30 fps は目標であって、達成の実測ではありません。
