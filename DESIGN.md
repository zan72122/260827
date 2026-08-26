# 氷のずっと奥から — 設計メモ

4歳児向けモバイルWebゲーム。1回の連続上スワイプで、氷床深部からアイスコアドリルを雪面まで引き上げ、コアを取り出す。

## 実在資料に基づく採用構成

一次資料（Annals of Glaciology の Hans Tausen ドリル論文、NSF Ice Drilling Program の
Foro 1650 資料）を参照し、**中型電動メカニカルコアドリル（Hans Tausen / Foro 系）** を採用。

| 項目 | 採用値 | 根拠 |
|---|---|---|
| コア径 | 98 mm | Hans Tausen / Foro 1650 の標準コア径 |
| 1回のコア長 | 約 1.0 m | Hans Tausen 浅層構成（1mバレル）。「約1m前後の氷柱」要件に一致 |
| ドリル(sonde)全長 | 約 3.5 m | Hans Tausen 短尺構成（アンチトルク+モーター+1mバレル+ヘッド） |
| ケーブル径 | 約 6 mm | armored steel cable（HTドリル系） |
| ウインチ／タワー | 傾倒式(tilting)マスト + ドラムウインチ | Foro 系。タワーごと水平に倒してコアを取り出す実運用に一致 |
| 掘削孔径 | 126 mm（ドライホール） | Hans Tausen dry version 126.0 mm |
| 想定深度 | 約 300 m（ドライ掘削の実用上限付近） | 液封なしで到達できる中間深度 |
| 表面設備 | 傾倒タワー、ウインチ、作業ソリ、受け台（コアトレイ）、旗竿列 | 中規模キャンプの典型構成 |
| 氷温/環境 | 孔内 −30 ℃ / 地表 −25 ℃、晴天・低い太陽・弱風 | グリーンランド内陸夏季 |

### 画面上の寸法方針

軸方向（長さ）は実寸 1:1（ドリル3.5 m、コア1.05 m）。
**径方向のみ約2.2倍に一様拡大**（コア・バレル・孔・ケーブルを同率）して4歳児の画面での
可読性を確保。相互比率（コア径<バレル径<孔径）は現実の比を維持。
深度方向は 300 m → 視覚 60 m に圧縮し、氷層変化・パララックス・ランドマークで距離感を表現。

### コア回収の現実性

- 主対象は常に「ケーブル+電動sonde+コアバレル+内部コア」の一体。裸のコアは孔内を移動しない。
- 深部ではバレル側面の教育的カットアウト（60°の開口スロット）から内部の氷試料が見える。
  全体を透明カプセルにはしない。
- 雪面到達後、タワーが倒れてsondeが水平になり、バレルシェルが後退して初めて氷柱全体が現れる。

## journeyProgress フェーズ（0–1）

| 範囲 | 内容 |
|---|---|
| 0.00–0.10 | ケーブル張力→コア折り取り（張力音・小さな揺れ） |
| 0.10–0.42 | 深部上昇（青い吸収光、少量気泡） |
| 0.42–0.62 | 年層・火山灰の薄層帯 |
| 0.62–0.78 | firn遷移（白く、気泡・粒状感増、音変化） |
| 0.78–0.90 | 出口光が拡大 |
| 0.90–0.96 | 雪面突破（縁→霜→雪原→タワー脚→ソリ→遠景の順に出現） |
| 0.96–1.00 | タワー傾倒→バレル開放→氷柱露出→受け台に置く音 |

## 実装構成

Vite + TypeScript + Three.js (WebGL2)。
PersistentDrill / 循環BoreholeDetailRing / 深度依存の氷シェーダー / CameraRail（縦=垂直、横=斜行+ロール）/
SurfaceSeam（y=0の孔付き面）/ SurfaceRig / CoreRevealRig / WebAudio合成音 / AdaptiveQuality（pixelRatio段階制御）。
デバッグ: `?debug` パネル + `window.icecore.setProgress(p)`。

Sources: [Hans Tausen drill (Annals of Glaciology)](https://www.cambridge.org/core/journals/annals-of-glaciology/article/hans-tausen-drill-design-performance-further-developments-and-some-lessons-learned/4BA99DEDAAEB0DDE651BB5FC21562A94), [Foro 1650 Drill (NSF Ice Drilling Program)](https://icedrill.org/equipment/foro-1650-drill)
