# 木を組んで、歌うツリーを巻く

木を組んで、くるくる回る歌うツリーをつくる。4歳児向けの、iPhone / iPad のブラウザで遊ぶ 1 作品です。

板の葉を幹の溝に差し込んでツリーを組み、鉢の軸受けに載せ、幹の下側を指でくるくる回して巻きます。
指を離すとツリーがゆっくり回り出し、短い旋律が鳴ります。何度でもすぐ巻き直せます。

- TypeScript + Three.js (WebGL2) + Vite。バックエンド、ログイン、外部通信はありません。
- 木材、機構、部屋はすべて実ジオメトリと手続き的な木目シェーダーで、画像アセットは同梱していません。
- 音は WebAudio で毎回合成しています。録音は使っていません。

## 動かし方

```bash
npm install
npm run dev        # http://localhost:5173/ を開く
```

同じ Wi‑Fi 上の iPhone / iPad から開く場合は、`npm run dev` が表示する `Network:` の URL を使ってください。

本番ビルドと確認:

```bash
npm run typecheck  # tsc --noEmit
npm run build      # 型検査 + vite build（dist/ に出力）
npm run preview    # http://localhost:4173/ で dist を配信
```

`dist/` は相対パス (`base: './'`) で出力されるので、任意の静的ホスティングにそのまま置けます。

## 検査

```bash
npm test                     # 設計・機構・ジオメトリの単体テスト (vitest)
npm run test:e2e             # 4 画面サイズでの操作テスト (playwright)
npm run shots                # docs/shots/ に画面証拠を取得（preview 起動中に実行）
```

`npm run test:e2e` と `npm run shots` は Chromium を使います。
既存の Chromium を使う場合は `CHROMIUM_PATH=/path/to/chrome` を指定してください。

## 遊び方（説明は不要な想定です）

1. 手前のトレイに並んだ板を指でつまみ、幹の溝へ近づける。溝に入ると軸に沿って滑り、奥で止まる。
2. 葉 3 枚と星の 4 か所を組んだら、ツリーごと持ち上げて鉢の軸受けへ載せる。
3. 幹の下のあたりを指でくるくる回して巻く。
4. 指を離す。ツリーが回り、音が鳴る。すぐにまた巻ける。

右上のボタンで消音できます。消音中も、下の点が音符ごとに光ります。

## 中身

| ファイル | 役割 |
| --- | --- |
| `src/design/treeSpec.ts` | 作中の設計値（寸法、溝、挿入軸）。純粋な数値のみ |
| `src/mech/mechanism.ts` | 巻く・保持・再生の状態機械。ゼンマイ、調速機、保護クラッチ |
| `src/mech/melody.ts` | ピンドラム（オリジナル旋律をピン角度として記述） |
| `src/audio/musicBox.ts` | オルゴールの発音（WebAudio、実行時合成） |
| `src/render/parts.ts` | 葉板・幹・星・鉢・機構のジオメトリ生成 |
| `src/render/materials.ts` | 物体空間の手続き的木目（木口で木目が終わる） |
| `src/play/assembly.ts` | 木組み（1 部材ずつの運搬と挿入） |
| `src/play/wind.ts` | 巻き上げ（画面上の角度計測） |
| `src/camera/director.ts` | 全景 → 木組み → 鉢と幹 → 完成 の順路 |

詳しい確認結果と残る制約は [STATUS.md](./STATUS.md) にあります。
