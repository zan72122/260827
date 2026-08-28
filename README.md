# サンタ郵便中央局 ――一通の手紙が世界へ出るまで

4歳児向けの、iPhone / iPad 向けモバイル Web ゲームです。フィンランド北極圏の郵便文化から
着想した**架空**のクリスマス郵便中央局で、一通の絵手紙に特別消印を押し、絵記号で仕分け、
郵袋に詰め、雪の外へ発送するまでを一周します。

> 実在の郵便事業者の内部業務を再現したものではありません。登場する住所・宛名・手紙の中身は
> すべて架空の絵であり、目的地も抽象化された絵記号です。

## 遊びの流れ

| 回 | 手紙 | 規則 |
| --- | --- | --- |
| 1回目 | 1通 | 規則の発見（印を押す → 絵の同じ袋へ） |
| 2回目 | 3通 | 絵の対応（灯台・山と列車・森の家） |
| 3回目 | 5通 | 絵 ＋ 発送時期の二条件（同じ森でも昼便とクリスマス便を分ける） |

右上の切り替えボタンでいつでも**一条件モード**へ戻れます。誤った投入口へ置いても罰はなく、
棚の小さな機械窓が閉じたままになるだけです。

## 操作

一指のみ。自由カメラはありません。

- 郵袋の口金具を横へ引く
- 封筒を一回スワイプして表向きにする
- 消印レバーを下へ引く
- 封筒を大きな立体記号へ運ぶ
- 郵袋の口紐を引く
- 荷役扉の鎖を引く

## 開発

```bash
npm install
npm run dev        # 開発サーバ
npm run typecheck  # 型検査
npm run build      # 型検査 + production build
npm run test       # Playwright 自動仕分け（縦・横の2画面）
```

Playwright はコンテナ同梱の Chromium を使います。別の場所にある場合は
`PLAYWRIGHT_CHROMIUM_PATH` で指定してください。

## 構成

```
src/
  core/        Rng, 手描き線, 手続き的テクスチャ, AdaptiveQuality, AudioKit, PointerInput
  camera/      CameraDirector（固定ショット鎖 + 縦横それぞれの構図）
  scene/       EnvelopeFactory, PostalBag, PostmarkPress, PostmarkDie,
               DestinationSymbol(+遅延ロードされる destinations/), SorterGraph,
               ConveyorController, DispatchSchedule, PhysicalWorldMap,
               PostOfficeRoom, Worker, materials
  game/        GameFlow（回ごとの進行）, ChildGuidance（文字を使わない誘導）
  ui/          Hud（進行ピップ・モード切替・やり直しのみ）
```

### 実装上の要点

- 封筒は共有 geometry と 1024² アトラスによる InstancedMesh。接写する一通だけが
  独立 mesh へ昇格し、紙の変形は bend / sink / fold の3 morph で表現します。
- 消印は動的 canvas テクスチャへ、押圧差・にじみ・かすれを重ねて焼き込みます（発光しません）。
- ベルトとシュートは決定論的な経路（CatmullRom）で、封筒は途中で見た目も記号も変わりません。
- 帆布郵袋は荷重段階ごとの morph（half / full / gathered）で、箱形にはなりません。
- 地図のランプは InstancedMesh。PointLight は使わず、照明は半球光・平行光・作業灯の
  スポット数灯のみです。
- WebGL 2 で全工程を遊べます。WebGPU が使える環境では紙の枚数・雪粒・反射解像度だけを増やします。
- 追加の目的地は必要になった回でのみ動的 import します。
- DPR 上限、safe-area、AudioContext の unlock（最初のタップ）を実装しています。

## プライバシー

バックエンド、ログイン、広告、分析 SDK、チャット入力はありません。手紙の内容は生成された
絵だけで、外部送信も位置情報の取得も行いません。音はすべて実行時に合成しています。
