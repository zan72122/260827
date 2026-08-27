# 人工衛星クリーンルーム

4歳児向けの、文字説明・失敗・制限時間なしで遊べる一指操作のWebGL2ゲームです。3種類の絵のミッションから1つを選び、エアロック、衛星バス統合、機器搭載、ケーブル接続、金色の多層断熱材、太陽電池パネルとアンテナ、やさしい試験を経て、軌道上で自分の指で展開します。

## 起動

ビルドも外部ネットワークも不要です。Three.jsは `vendor/` に同梱しています。

```sh
cd satellite-cleanroom
npm run dev
# http://127.0.0.1:4173/
```

## 操作の流れ

画面内の大きな対象を、各場面で1種類だけ操作します。

1. 雲・海・離島の大きな絵をタップ
2. カートを内側へスワイプ
3. 送風ボタンを長押し
4. クレーンを横へ動かし、下へ降ろす
5. 大きな機器3個を広くドラッグして取り付ける
6. 太い色付きケーブルを溝に沿ってなぞる
7. 皺のある金色断熱材3枚を当てて包む
8. 折り畳みパネル左右とミッション固有アンテナを取り付ける
9. 試験ボタンを長押し
10. 軌道上で左右パネルとアンテナを展開し、地球へ信号を送る

3.5秒操作がない場合は、局所リングと半透明の手が次の一指操作を示します。縦横の画面回転では、進行状態を保ったまま工程別カメラだけを組み替えます。

## 実装

- `src/snap-integration.js`: 指から48px上へ対象を見せる、広い吸着域の失敗しない配置
- `src/deployable-assembly-system.js`: ヒンジ・3段パネル・ロックとミッション別アンテナ
- `src/planned-satellite-installation.js`: 補助箱、支持具、放熱フィン、クランプ、留め具の `InstancedMesh`
- `src/mission-plan.js`: ミッションと固定seedから作る決定論的な部品計画
- `src/cleanroom-layout.js`: 技術者、設備、通路、扉、カメラ、展開占有域の純粋データ検証
- `src/technicians.js`: 8人・5役割・工程別状態機械を9個の `InstancedMesh` プールで描画
- `src/audio.js`: WebAudioだけで合成するHVAC、送風、クレーン、固定、接続、試験、移送、軌道音
- `src/main.js`: 12フェーズの一周ゲーム、縦横専用カメラ、無音切替、リプレイ、デバッグAPI、低速端末向け適応解像度

ソーラーセルは左右合計120枚を `InstancedMesh` で描画します。自動補完部品はミッションごとに68要素で、種類別に20%以上の予約容量を検証します。金色断熱材は軽量な分割メッシュとmorph target、法線・粗さの差で折り畳みから面へ広がります。

## デバッグAPI

`window.__satellite` が以下を読み取り可能にします。

- `phase`, `busy`, `busyReasons`, `targets()`
- `mission`, `airlock`, `airShower`, `integration`, `payload`, `harness`, `blanket`
- `arrays`, `antenna`, `test`, `orbit`, `missionResult`, `complete`, `replay`
- `technicians`, `spatialValidation`, `installation`, `deployables`, `audio`, `renderer`
- `replayNow()`

`targets()` は現在操作できる一指ジェスチャーの画面座標・経路・広い半径を返します。

## 自動検証

Playwrightが公開UIと `targets()` だけを使い、全12フェーズを自動操作します。

```sh
cd satellite-cleanroom
npm install
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium npm run verify
```

検証は 1280×800、480×800、iPad相当の横1180×820・縦820×1180で、全工程スクリーンショット、3ミッション伝播、ターゲット範囲、全接続・全展開、衝突・容量、WebGL2、コンソール、リプレイ、ミュート同期、5秒性能、画面回転、休止復帰、固定seedの再現性を確認し、`verify-artifacts/verify-report.json` に記録します。
